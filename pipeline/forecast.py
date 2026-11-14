"""Stage 4: machine-learning outlook of fire activity for the next 1-3 months.

For every active 0.25 deg cell the model predicts, 1, 2 and 3 months ahead:
  * the expected number of harmonized hotspots (gradient boosting, Poisson loss)
  * an 80% range (gradient boosting, quantile loss at 10% and 90%)
  * the chance of at least one hotspot (gradient boosting classifier)

Features only use information available on the day the outlook is issued:
the cell's history for the target calendar month in *earlier* years, the last
three months, how unusual the year has been so far, the neighbouring cells, and
the ENSO (El Nino) index when its file is present (data/oni.ascii.txt).

The model never sees the last complete year while training. That year is
forecast blind and compared with what happened, against three baselines:
the climatology (average of earlier years), last year, and persistence.

Run:  python pipeline/forecast.py
"""
import json
import sys
import time

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.metrics import brier_score_loss, roc_auc_score

import config as C

LEADS = (1, 2, 3)
MIN_ACTIVE_MONTHS = 3
TRAIN_ROWS = 900_000
RNG = np.random.default_rng(11)


# ---------------------------------------------------------------- data cube
def load_cube():
    h = pd.read_parquet(C.WORK / "harmonized.parquet", columns=["cell", "mi", "H"])
    h = h[h["H"] > 0]
    active = h.groupby("cell")["mi"].nunique()
    cells = np.sort(active[active >= MIN_ACTIVE_MONTHS].index.values)
    h = h[h["cell"].isin(cells)]
    n_months = int(pd.read_parquet(C.WORK / "harmonized.parquet", columns=["mi"])["mi"].max()) + 1
    # pad so that index 0 is January of the first year
    pad = C.START_MONTH - 1
    n_years = (pad + n_months + 11) // 12
    cube = np.zeros((len(cells), n_years * 12), dtype="float32")
    ci = np.searchsorted(cells, h["cell"].values)
    cube[ci, h["mi"].values + pad] = h["H"].values
    valid = np.zeros(n_years * 12, bool)
    valid[pad:pad + n_months] = True
    return cells, cube, valid, n_years


def climatology(cube, valid, n_years):
    """Stats of each calendar month over *earlier* years only (no peeking)."""
    n = cube.shape[0]
    by_year = cube.reshape(n, n_years, 12)
    vmask = valid.reshape(n_years, 12)
    stats = {k: np.full((n, n_years, 12), np.nan, dtype="float32")
             for k in ("mean", "median", "p90", "freq", "nyrs")}
    for k in range(12):
        years = np.flatnonzero(vmask[:, k])        # years in which this month was observed
        for y in range(n_years):
            past = years[years < y]
            if len(past) == 0:
                continue
            x = by_year[:, past, k]                # plain arrays: no NaN handling needed
            stats["mean"][:, y, k] = x.mean(1)
            stats["median"][:, y, k] = np.median(x, 1)
            stats["p90"][:, y, k] = np.percentile(x, 90, 1)
            stats["freq"][:, y, k] = (x > 0).mean(1)
            stats["nyrs"][:, y, k] = len(past)
    return {k: v.reshape(n, n_years * 12) for k, v in stats.items()}


def neighbours(cells):
    row, col = cells // C.NCOLS, cells % C.NCOLS
    idx = []
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            if dr == 0 and dc == 0:
                continue
            nb = (row + dr) * C.NCOLS + (col + dc) % C.NCOLS
            pos = np.searchsorted(cells, nb)
            pos = np.clip(pos, 0, len(cells) - 1)
            idx.append(np.where(cells[pos] == nb, pos, -1))
    return np.stack(idx, 1)


def load_oni(n_years):
    """Optional ENSO index (NOAA CPC oni.ascii.txt). Returns monthly array or None."""
    f = C.ROOT / "data" / "oni.ascii.txt"
    if not f.exists():
        return None
    seasons = ["DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ", "JJA", "JAS", "ASO", "SON", "OND", "NDJ"]
    df = pd.read_csv(f, sep=r"\s+")
    out = np.full(n_years * 12, np.nan, dtype="float32")
    for _, r in df.iterrows():
        y = int(r["YR"]) - C.START_YEAR
        if 0 <= y < n_years:
            out[y * 12 + seasons.index(r["SEAS"])] = r["ANOM"]
    return out


# ---------------------------------------------------------------- features
FEATURES = ["lead", "lat", "lon", "cm_sin", "cm_cos",
            "clim_mean", "clim_median", "clim_p90", "clim_freq", "clim_years",
            "last_year_same_month", "now", "now_1", "now_2", "last12_mean",
            "recent_anomaly", "ytd_anomaly", "clim_now",
            "nb_now", "nb_clim", "season_ramp", "oni"]


def make_features(cells, cube, clim, nbr, oni, ci, t, lead):
    """ci: cell positions, t: issue month index (padded), lead: months ahead."""
    tau = t + lead
    lat = (cells[ci] // C.NCOLS + 0.5) * C.CELL - 90
    lon = (cells[ci] % C.NCOLS + 0.5) * C.CELL - 180
    cm = tau % 12
    g = lambda arr, m: arr[ci, m]
    now, now1, now2 = g(cube, t), g(cube, t - 1), g(cube, t - 2)
    recent = now + now1 + now2
    clim_recent = (np.nan_to_num(g(clim["mean"], t)) + np.nan_to_num(g(clim["mean"], t - 1))
                   + np.nan_to_num(g(clim["mean"], t - 2)))
    # year-to-date: from January of the issue year up to t
    y0 = (t // 12) * 12
    ytd = cube[ci, y0:t + 1].sum(1)
    ytd_clim = np.nan_to_num(clim["mean"][ci, y0:t + 1]).sum(1)
    last12 = cube[ci, t - 11:t + 1].sum(1)
    nb = nbr[ci]
    nb_ok = nb >= 0
    nbi = np.where(nb_ok, nb, 0)
    nb_now = np.where(nb_ok, cube[nbi, t], 0).sum(1)
    nb_clim = np.where(nb_ok, np.nan_to_num(clim["mean"][nbi, tau]), 0).sum(1)
    f = {
        "lead": np.full(len(ci), lead, "float32"),
        "lat": lat, "lon": lon,
        "cm_sin": np.sin(2 * np.pi * cm / 12), "cm_cos": np.cos(2 * np.pi * cm / 12),
        "clim_mean": g(clim["mean"], tau), "clim_median": g(clim["median"], tau),
        "clim_p90": g(clim["p90"], tau), "clim_freq": g(clim["freq"], tau),
        "clim_years": g(clim["nyrs"], tau),
        "last_year_same_month": g(cube, tau - 12),
        "now": now, "now_1": now1, "now_2": now2, "last12_mean": last12 / 12,
        "recent_anomaly": np.log1p(recent) - np.log1p(clim_recent),
        "ytd_anomaly": np.log1p(ytd) - np.log1p(ytd_clim),
        "clim_now": g(clim["mean"], t),
        "nb_now": nb_now, "nb_clim": nb_clim,
        "season_ramp": np.log1p(np.nan_to_num(g(clim["mean"], tau)))
        - np.log1p(np.nan_to_num(g(clim["mean"], t))),
        "oni": (oni[t] if oni is not None else np.full(len(ci), np.nan, "float32")),
    }
    X = np.column_stack([np.asarray(f[k], dtype="float32") * np.ones(len(ci), "float32")
                         for k in FEATURES])
    return X


def sample_rows(cells, cube, clim, nbr, oni, issues, n_rows):
    """Random (cell, issue month, lead) rows. Fire rows are kept more often so the
    model sees enough of them, and each row carries a weight that undoes this,
    so the model still learns how often fire really happens."""
    X, y, w = [], [], []
    per_issue = max(n_rows // max(len(issues) * len(LEADS), 1), 200)
    for t in issues:
        for lead in LEADS:
            target = cube[:, t + lead]
            fire = np.flatnonzero(target > 0)
            calm = np.flatnonzero(target <= 0)
            k_f = min(len(fire), per_issue // 2)
            k_c = min(len(calm), per_issue - k_f)
            ci = np.concatenate([RNG.choice(fire, k_f, replace=False) if k_f else fire[:0],
                                 RNG.choice(calm, k_c, replace=False) if k_c else calm[:0]])
            X.append(make_features(cells, cube, clim, nbr, oni, ci, t, lead))
            y.append(target[ci])
            w.append(np.concatenate([np.full(k_f, len(fire) / max(k_f, 1)),
                                     np.full(k_c, len(calm) / max(k_c, 1))]))
    w = np.concatenate(w)
    return np.vstack(X), np.concatenate(y), (w / w.mean()).astype("float32")


def all_rows(cells, cube, clim, nbr, oni, t, lead):
    ci = np.arange(len(cells))
    return make_features(cells, cube, clim, nbr, oni, ci, t, lead), cube[:, t + lead]


# ---------------------------------------------------------------- models
def fit_models(X, y, w):
    common = dict(max_iter=250, learning_rate=0.08, max_leaf_nodes=63, min_samples_leaf=40,
                  l2_regularization=1.0, early_stopping=True, validation_fraction=0.1,
                  n_iter_no_change=25, random_state=0)

    def fit(model):
        target = (y > 0) if isinstance(model, HistGradientBoostingClassifier) else y
        return model.fit(X, target, sample_weight=w)
    models = {
        "mean": fit(HistGradientBoostingRegressor(loss="poisson", **common)),
        "p10": fit(HistGradientBoostingRegressor(loss="quantile", quantile=0.1, **common)),
        "p90": fit(HistGradientBoostingRegressor(loss="quantile", quantile=0.9, **common)),
        "prob": fit(HistGradientBoostingClassifier(**common)),
    }
    return models


def predict(models, X):
    mean = np.clip(models["mean"].predict(X), 0, None)
    lo = np.clip(models["p10"].predict(X), 0, None)
    hi = np.clip(models["p90"].predict(X), 0, None)
    lo, hi = np.minimum(lo, mean), np.maximum(hi, mean)
    prob = models["prob"].predict_proba(X)[:, 1]
    return mean, lo, hi, prob


def poisson_dev(pred, obs):
    pred = np.maximum(pred, 1e-6)
    with np.errstate(divide="ignore", invalid="ignore"):
        term = np.where(obs > 0, obs * np.log(obs / pred), 0)
    return float(2 * np.mean(term - (obs - pred)))


def evaluate(name, pred, obs, prob=None, base_prob=None):
    out = {"model": name,
           "mae": float(np.abs(pred - obs).mean()),
           "rmse_log": float(np.sqrt(np.mean((np.log1p(pred) - np.log1p(obs)) ** 2))),
           "poisson_deviance": poisson_dev(pred, obs)}
    if prob is not None:
        hit = obs > 0
        out["auc"] = float(roc_auc_score(hit, prob)) if 0 < hit.mean() < 1 else None
        out["brier"] = float(brier_score_loss(hit, np.clip(prob, 0, 1)))
    return out


def main():
    t0 = time.time()
    cells, cube, valid, n_years = load_cube()
    clim = climatology(cube, valid, n_years)
    nbr = neighbours(cells)
    oni = load_oni(n_years)
    print(f"{len(cells):,} active cells, {n_years} years, ENSO index: {oni is not None}", flush=True)
    if oni is None and "oni" in FEATURES:
        FEATURES.remove("oni")   # an all-empty column breaks the tree binning

    last = int(np.flatnonzero(valid)[-1])                   # last observed month
    last_full_year = (last + 1) // 12 - 1 if (last + 1) % 12 else last // 12
    test_year = last_full_year                              # forecast blind
    first_issue = int(np.flatnonzero(valid)[0]) + 24        # need 2 years of history
    issue_all = np.arange(first_issue, last - max(LEADS) + 1)
    targets_year = lambda t, lead: (t + lead) // 12

    # ---- holdout test: train on targets before the test year ------------------
    train_issues = [t for t in issue_all if targets_year(t, max(LEADS)) < test_year]
    test_issues = [t for t in issue_all if targets_year(t, 1) == test_year
                   and targets_year(t, max(LEADS)) == test_year]
    report = {"test_year": int(C.START_YEAR + test_year), "cells": int(len(cells)),
              "enso": oni is not None, "features": FEATURES}
    if len(train_issues) > 6 and test_issues:
        X, y, w = sample_rows(cells, cube, clim, nbr, oni, train_issues, TRAIN_ROWS)
        print(f"training on {len(y):,} rows ({time.time() - t0:.0f}s)", flush=True)
        models = fit_models(X, y, w)
        rows = []
        for t in test_issues:
            for lead in LEADS:
                Xt, yt = all_rows(cells, cube, clim, nbr, oni, t, lead)
                mean, lo, hi, prob = predict(models, Xt)
                f = dict(zip(FEATURES, Xt.T))
                rows.append(pd.DataFrame({
                    "lead": lead, "obs": yt, "pred": mean, "lo": lo, "hi": hi, "prob": prob,
                    "clim": np.nan_to_num(f["clim_mean"]), "clim_freq": np.nan_to_num(f["clim_freq"]),
                    "clim_med": np.nan_to_num(f["clim_median"]),
                    "last_year": f["last_year_same_month"], "persist": f["now"],
                    "t": t + lead}))
        d = pd.concat(rows, ignore_index=True)
        res = {}
        for lead in LEADS:
            e = d[d.lead == lead]
            res[f"lead_{lead}"] = {
                "ml": evaluate("Fire Rings ML", e.pred.values, e.obs.values, e.prob.values),
                "climatology": evaluate("Average of earlier years", e.clim.values, e.obs.values,
                                        e.clim_freq.values),
                "climatology_median": evaluate("Median of earlier years", e.clim_med.values, e.obs.values),
                "last_year": evaluate("Same month last year", e.last_year.values, e.obs.values),
                "persistence": evaluate("This month repeats", e.persist.values, e.obs.values),
                "range_coverage_80": float(((e.obs >= e.lo) & (e.obs <= e.hi)).mean()),
            }
            R = res[f"lead_{lead}"]
            ml, cl = R["ml"], R["climatology"]
            R["skill_vs_climatology_mae_pct"] = float((1 - ml["mae"] / cl["mae"]) * 100)
            # compare with the strongest simple method, on both error measures
            base = [R[k] for k in ("climatology", "climatology_median", "last_year", "persistence")]
            best_mae = min(base, key=lambda b: b["mae"])
            best_dev = min(base, key=lambda b: b["poisson_deviance"])
            R["skill_vs_best_baseline_mae_pct"] = float((1 - ml["mae"] / best_mae["mae"]) * 100)
            R["best_baseline_mae"] = best_mae["model"]
            R["skill_vs_best_baseline_deviance_pct"] = float(
                (1 - ml["poisson_deviance"] / best_dev["poisson_deviance"]) * 100)
            R["best_baseline_deviance"] = best_dev["model"]
            if ml.get("brier") is not None and cl.get("brier"):
                res[f"lead_{lead}"]["brier_skill_vs_climatology"] = float(1 - ml["brier"] / cl["brier"])
        # regional sanity check: sum over all cells per month
        g = d.groupby(["lead", "t"])[["obs", "pred", "clim"]].sum().reset_index()
        res["global_monthly_totals"] = {
            "corr_ml": float(np.corrcoef(g.obs, g.pred)[0, 1]) if len(g) > 2 else None,
            "corr_climatology": float(np.corrcoef(g.obs, g.clim)[0, 1]) if len(g) > 2 else None}
        pick = RNG.choice(len(y), min(20000, len(y)), replace=False)
        imp = feature_importance(models["mean"], X[pick], y[pick])
        res["feature_importance"] = imp
        report["holdout"] = res
        print(json.dumps(res, indent=1)[:3000], flush=True)
    else:
        print("Not enough years for a holdout test yet.", flush=True)

    # ---- final model on everything, outlook from the last observed month -------
    final_issues = list(issue_all)
    X, y, w = sample_rows(cells, cube, clim, nbr, oni, final_issues, TRAIN_ROWS)
    models = fit_models(X, y, w)
    out = {"cell": cells}
    for lead in LEADS:
        if last + lead >= cube.shape[1]:
            # extend arrays so features for months beyond the record can be read
            pad = last + lead - cube.shape[1] + 1
            cube = np.pad(cube, ((0, 0), (0, pad)))
            for k in clim:
                extra = clim[k][:, -12:][:, :pad] if k != "nyrs" else clim[k][:, -12:][:, :pad]
                clim[k] = np.concatenate([clim[k], extra], 1)
            if oni is not None:
                oni = np.pad(oni, (0, pad), constant_values=np.nan)
        Xt, _ = all_rows(cells, cube, clim, nbr, oni, last, lead)
        mean, lo, hi, prob = predict(models, Xt)
        out[f"m{lead}"], out[f"lo{lead}"], out[f"hi{lead}"], out[f"p{lead}"] = mean, lo, hi, prob
    pd.DataFrame(out).to_parquet(C.WORK / "outlook.parquet", index=False)
    pad = C.START_MONTH - 1
    report["issued_month_index"] = int(last - pad)
    (C.WORK / "forecast_report.json").write_text(json.dumps(report, indent=1))
    print(f"done in {time.time() - t0:.0f}s", flush=True)


def feature_importance(model, X, y):
    from sklearn.inspection import permutation_importance
    r = permutation_importance(model, X, y, n_repeats=3, random_state=0,
                               scoring="neg_mean_poisson_deviance")
    order = np.argsort(-r.importances_mean)
    return [{"feature": FEATURES[i], "importance": float(r.importances_mean[i])} for i in order[:10]]


if __name__ == "__main__":
    sys.exit(main())
