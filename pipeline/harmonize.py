"""Stage 3: build one consistent hotspot record from MODIS and VIIRS.

Three problems are fixed here:
  1. MODIS itself changes in mid-2002, when Aqua joins Terra. Terra-only months
     are scaled by the Terra+Aqua / Terra ratio learned after 2002.
  2. VIIRS flies on one, two or three satellites depending on the year. Its
     counts are averaged per satellite, so a new satellite is not a new trend.
  3. VIIRS sees far smaller fires than MODIS. Two bridges are fitted on the
     years when both sensors fly:
       * back-cast  MODIS -> VIIRS detail:  V = q * M   (per 5 deg tile, per calendar month)
       * physical   VIIRS -> MODIS eyes:    VIIRS pixels merged to 1 km, weak ones
         below the MODIS detection limit dropped, then M = r * Veq
     Ratios are shrunk toward larger-area values when a tile has few fires,
     and their uncertainty comes from resampling years.

The main record ("H") is in VIIRS-detail units: real VIIRS counts where VIIRS
exists, MODIS scaled by q before that. "Hm" is the same record in MODIS units.

Both bridges are tested by pretending MODIS retired: fit on the early overlap
years, predict the last overlap years, compare with what was really observed.

Run:  python pipeline/harmonize.py
"""
import json
import sys

import numpy as np
import pandas as pd

import config as C

ALPHA = 50.0      # prior weight (in detections) pulling a tile toward the global ratio
BETA = 50.0       # prior weight pulling a calendar month toward its tile ratio
TEST_YEARS = 4    # overlap years held out to test the bridges
RNG = np.random.default_rng(7)


def load_agg():
    frames = []
    for f in sorted(C.AGG.glob("*_*.parquet")):
        name = f.stem
        if name.startswith(("weekday_", "static_")):
            continue
        sat_name, year = name.rsplit("_", 1)
        df = pd.read_parquet(f)
        df["sat"] = C.SAT[sat_name]
        frames.append(df)
    df = pd.concat(frames, ignore_index=True).fillna(0)
    # Drop a month that is still running (e.g. data downloaded mid-November):
    # a half month would look like a sudden fall in burning.
    days = [int(p.read_text() or 0) for p in C.AGG.glob("lastday_*.txt")]
    if days:
        import calendar
        last = max(days)
        y, m, d = last // 10000, last // 100 % 100, last % 100
        complete = d >= calendar.monthrange(y, m)[1] - 1
        keep = C.month_index(y, m) - (0 if complete else 1)
        if not complete:
            print(f"Dropping unfinished month {y}-{m:02d} (data ends on day {d}).", flush=True)
        df = df[df["mi"] <= keep]
    return df


def tile_of(cell):
    row, col = cell // C.NCOLS, cell % C.NCOLS
    k = int(C.TILE_DEG / C.CELL)
    return (row // k) * (C.NCOLS // k) + (col // k)


def active_months(df, sats):
    """Months in which a satellite delivered data anywhere on Earth."""
    out = {}
    for s in sats:
        m = np.sort(df.loc[df.sat == s, "mi"].unique())
        if len(m):
            out[s] = set(m.tolist())
    return out


def build_table(df, eq_col):
    n_months = int(df["mi"].max()) + 1
    act = active_months(df, list(C.SAT.values()))
    terra = act.get(C.SAT["Terra"], set())
    aqua = act.get(C.SAT["Aqua"], set())
    viirs = {s: m for s, m in act.items() if s in C.VIIRS_SATS}

    wide = df.pivot_table(index=["cell", "mi"], columns="sat", values="n",
                          aggfunc="sum", fill_value=0)
    t = wide.get(C.SAT["Terra"], 0)
    a = wide.get(C.SAT["Aqua"], 0)
    tab = pd.DataFrame(index=wide.index)
    tab["T"] = t
    tab["A"] = a
    mi = tab.index.get_level_values("mi").values

    # VIIRS: mean over the satellites that were flying that month
    nv = np.zeros(len(tab))
    v_sum = np.zeros(len(tab))
    v_all = np.zeros(len(tab))
    veq_sum = np.zeros(len(tab))
    has_eq = eq_col in df.columns
    if has_eq:
        weq = df[df.sat.isin(C.VIIRS_SATS)].pivot_table(
            index=["cell", "mi"], columns="sat", values=eq_col, aggfunc="sum", fill_value=0
        ).reindex(tab.index, fill_value=0)
    for s, months in viirs.items():
        on = np.isin(mi, list(months))
        nv += on
        col = wide.get(s, 0)
        col = np.asarray(col) if not np.isscalar(col) else np.zeros(len(tab))
        v_sum += np.where(on, col, 0)
        v_all += col
        if has_eq and s in weq.columns:
            veq_sum += np.where(on, weq[s].values, 0)
    with np.errstate(invalid="ignore", divide="ignore"):
        tab["V"] = np.where(nv > 0, v_sum / np.maximum(nv, 1), np.nan)
        tab["Veq"] = np.where(nv > 0, veq_sum / np.maximum(nv, 1), np.nan)
    tab["V_naive"] = v_all  # every VIIRS satellite simply added up
    tab["t_on"] = np.isin(mi, list(terra))
    tab["a_on"] = np.isin(mi, list(aqua))
    tab = tab.reset_index()
    tab["tile"] = tile_of(tab["cell"].values)
    tab["cm"] = (C.START_MONTH - 1 + tab["mi"]) % 12  # calendar month 0..11
    tab["year"] = C.START_YEAR + (C.START_MONTH - 1 + tab["mi"]) // 12
    return tab, n_months, viirs


def shrink_ratio(num, den, prior, weight):
    return (num + weight * prior) / (den + weight)


def fit_ratio(tab, num_col, den_col, mask):
    """Two-level ratio: global -> 5 deg tile -> tile x calendar month."""
    d = tab[mask]
    g = d[num_col].sum() / max(d[den_col].sum(), 1e-9)
    by_tile = d.groupby("tile")[[num_col, den_col]].sum()
    tile_r = shrink_ratio(by_tile[num_col], by_tile[den_col], g, ALPHA)
    by_tm = d.groupby(["tile", "cm"])[[num_col, den_col]].sum()
    prior = tile_r.reindex(by_tm.index.get_level_values("tile")).values
    tm_r = shrink_ratio(by_tm[num_col].values, by_tm[den_col].values, prior, BETA)
    tm_r = pd.Series(tm_r, index=by_tm.index)
    return g, tile_r, tm_r


def apply_ratio(tab, g, tile_r, tm_r):
    idx = pd.MultiIndex.from_arrays([tab["tile"], tab["cm"]])
    r = tm_r.reindex(idx).values
    fallback = tile_r.reindex(tab["tile"]).values
    r = np.where(np.isnan(r), fallback, r)
    return np.where(np.isnan(r), g, r)


def tile_uncertainty(tab, num_col, den_col, mask, n_boot=200):
    """Relative half-width of the 80% interval of each tile ratio, by resampling years."""
    d = tab[mask].groupby(["tile", "year"])[[num_col, den_col]].sum().reset_index()
    out = {}
    for tile, g in d.groupby("tile"):
        if len(g) < 3:
            out[tile] = 0.5
            continue
        num, den = g[num_col].values, g[den_col].values
        picks = RNG.integers(0, len(g), size=(n_boot, len(g)))
        r = (num[picks].sum(1) + ALPHA) / (den[picks].sum(1) + ALPHA)
        q10, q50, q90 = np.percentile(r, [10, 50, 90])
        out[tile] = float(min((q90 - q10) / 2 / max(q50, 1e-9), 1.0))
    return pd.Series(out)


def scores(pred, obs):
    pred, obs = np.asarray(pred, float), np.asarray(obs, float)
    lp, lo = np.log1p(pred), np.log1p(obs)
    ss = ((lo - lo.mean()) ** 2).sum()
    return {
        "r2_log": float(1 - ((lp - lo) ** 2).sum() / ss) if ss > 0 else None,
        "corr": float(np.corrcoef(pred, obs)[0, 1]) if len(obs) > 2 else None,
        "mae": float(np.abs(pred - obs).mean()),
        "bias_pct": float((pred.sum() - obs.sum()) / max(obs.sum(), 1) * 100),
        "n": int(len(obs)),
    }


def choose_threshold(df):
    """Pick the FRP cut that makes VIIRS-in-1-km-bins behave most like MODIS."""
    base, _, _ = build_table(df, "eq0")
    rows = []
    for t in C.FRP_THRESHOLDS:
        tab, _, _ = build_table(df, f"eq{t}")
        m = tab["t_on"] & tab["a_on"] & tab["Veq"].notna()
        d = tab[m].groupby(["tile", "mi"])[["T", "A", "Veq"]].sum()
        M = d["T"] + d["A"]
        ok = (M + d["Veq"]) > 0
        lr = np.log((M[ok] + 1) / (d["Veq"][ok] + 1))
        rows.append({
            "frp_mw": t,
            "corr_log": float(np.corrcoef(np.log1p(M[ok]), np.log1p(d["Veq"][ok]))[0, 1]),
            "ratio_spread": float(lr.std()),
            "modis_per_viirs": float(M.sum() / max(d["Veq"].sum(), 1)),
        })
    table = pd.DataFrame(rows)
    # most similar behaviour = highest correlation, then most stable ratio
    best = table.sort_values(["corr_log", "ratio_spread"], ascending=[False, True]).iloc[0]
    return int(best["frp_mw"]), table


def main():
    df = load_agg()
    has_viirs = df["sat"].isin(C.VIIRS_SATS).any()
    if has_viirs:
        thr, thr_table = choose_threshold(df)
    else:
        thr, thr_table = 0, pd.DataFrame()
        print("No VIIRS data yet: building a MODIS-only record.", flush=True)
    tab, n_months, viirs = build_table(df, f"eq{thr}")
    report = {"frp_threshold_mw": thr, "threshold_table": thr_table.to_dict("records")}

    # 1. Terra-only months -> Terra+Aqua equivalent
    both = tab["t_on"] & tab["a_on"]
    tab["TA"] = tab["T"] + tab["A"]
    g_k, tile_k, tm_k = fit_ratio(tab, "TA", "T", both)
    k = apply_ratio(tab, g_k, tile_k, tm_k)
    g_ka, tile_ka, tm_ka = fit_ratio(tab, "TA", "A", both)
    ka = apply_ratio(tab, g_ka, tile_ka, tm_ka)
    terra_only = tab["t_on"] & ~tab["a_on"]
    aqua_only = tab["a_on"] & ~tab["t_on"]   # e.g. after Terra retires
    tab["M"] = np.where(both, tab["TA"], np.where(terra_only, tab["T"] * k,
                        np.where(aqua_only, tab["A"] * ka, np.nan)))
    report["terra_to_terra_aqua"] = float(g_k)

    modis_on = tab["t_on"] | tab["a_on"]
    viirs_on = tab["V"].notna()
    overlap = modis_on & viirs_on & both

    if has_viirs and overlap.any():
        years = np.sort(tab.loc[overlap, "year"].unique())
        test_years = years[-TEST_YEARS:] if len(years) > TEST_YEARS + 2 else years[-1:]
        train = overlap & ~tab["year"].isin(test_years)
        test = overlap & tab["year"].isin(test_years)

        # --- validation: pretend MODIS retired before the test years ---------
        val = {"train_years": [int(y) for y in years if y not in test_years],
               "test_years": [int(y) for y in test_years]}
        g_q, tq, tmq = fit_ratio(tab, "V", "M", train)
        g_r, tr, tmr = fit_ratio(tab, "M", "Veq", train)
        q_hat = apply_ratio(tab, g_q, tq, tmq)
        r_hat = apply_ratio(tab, g_r, tr, tmr)
        tt = tab[test]
        for level, keys in (("cell_month", ["cell", "mi"]), ("tile_month", ["tile", "mi"])):
            d = tt.assign(Vp=(tt["M"] * q_hat[test]), Mp=(tt["Veq"] * r_hat[test]),
                          Mg=tt["Veq"] * g_r, Vn=tt["V_naive"]).groupby(keys)[
                ["V", "M", "Vp", "Mp", "Mg", "Vn"]].sum()
            val[level] = {
                "backcast_modis_to_viirs": scores(d["Vp"], d["V"]),
                "bridge_viirs_to_modis": scores(d["Mp"], d["M"]),
                "baseline_single_global_ratio": scores(d["Mg"], d["M"]),
                "baseline_raw_viirs_as_modis": scores(d["Vn"], d["M"]),
            }
        report["validation"] = val

        # --- final fit on every overlap year ---------------------------------
        g_q, tq, tmq = fit_ratio(tab, "V", "M", overlap)
        g_r, tr, tmr = fit_ratio(tab, "M", "Veq", overlap)
        q = apply_ratio(tab, g_q, tq, tmq)
        r = apply_ratio(tab, g_r, tr, tmr)
        w_q = tile_uncertainty(tab, "V", "M", overlap).reindex(tab["tile"]).fillna(0.5).values
        report.update(viirs_per_modis=float(g_q), modis_per_viirs_eq=float(g_r))
        # share of VIIRS detections too weak for MODIS = small fires MODIS misses
        report["small_fire_share"] = float(1 - tab.loc[overlap, "Veq"].sum()
                                           / max(tab.loc[overlap, "V"].sum(), 1))

        tab["H"] = np.where(viirs_on, tab["V"], tab["M"] * q)
        tab["Hm"] = np.where(modis_on, tab["M"], tab["Veq"] * r)
        backcast = ~viirs_on
        tab["Hlo"] = np.where(backcast, tab["H"] * (1 - w_q), tab["H"])
        tab["Hhi"] = np.where(backcast, tab["H"] * (1 + w_q), tab["H"])
        tab["q"] = q
    else:
        tab["H"] = tab["M"]
        tab["Hm"] = tab["M"]
        tab["Hlo"] = tab["Hhi"] = tab["M"]
        tab["q"] = 1.0

    # what a naive user would plot: MODIS until VIIRS appears, then every VIIRS satellite summed
    tab["naive"] = np.where(tab["V"].notna(), tab["V_naive"], tab["T"] + tab["A"])
    tab["src"] = np.select([viirs_on & modis_on, viirs_on, modis_on], [3, 2, 1], 0).astype("int8")

    keep = ["cell", "mi", "H", "Hlo", "Hhi", "Hm", "M", "V", "naive", "src", "q"]
    tab[keep].to_parquet(C.WORK / "harmonized.parquet", index=False)
    report["months"] = n_months
    report["viirs_satellites"] = {C.SAT_NAME[s]: [min(m), max(m)] for s, m in viirs.items()}
    (C.WORK / "harmonize_report.json").write_text(json.dumps(report, indent=1))
    print(json.dumps({k: v for k, v in report.items() if k != "threshold_table"}, indent=1))


if __name__ == "__main__":
    sys.exit(main())
