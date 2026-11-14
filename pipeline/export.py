"""Stage 5: write the small files the website reads.

site/data/meta.json      record span, sensor timeline, method and model reports
site/data/overview.json  one entry per active cell for the world map
site/data/tiles/*.json   5 x 5 deg tiles with monthly series, outlook and weekday counts

Run:  python pipeline/export.py
"""
import json
import shutil
import sys

import numpy as np
import pandas as pd

import config as C


def r(x, nd=0):
    return np.round(np.nan_to_num(np.asarray(x, dtype="float64")), nd)


def main():
    h = pd.read_parquet(C.WORK / "harmonized.parquet")
    n_months = int(h["mi"].max()) + 1
    hrep = json.loads((C.WORK / "harmonize_report.json").read_text())
    frep_path = C.WORK / "forecast_report.json"
    frep = json.loads(frep_path.read_text()) if frep_path.exists() else {}

    # sensor timeline: which source fed the record each month
    src = h.groupby("mi")["src"].max().reindex(range(n_months), fill_value=0)

    cells = np.sort(h["cell"].unique())
    pos = {c: i for i, c in enumerate(cells)}
    ci = h["cell"].map(pos).values
    mats = {}
    for col in ("H", "M", "V", "naive"):
        m = np.zeros((len(cells), n_months), "float32")
        m[ci, h["mi"].values] = np.nan_to_num(h[col].values)
        mats[col] = m
    # relative uncertainty of back-cast months, one number per cell
    bc = h[h["H"] > 0]
    w = ((bc["Hhi"] - bc["H"]) / bc["H"]).groupby(bc["cell"]).max()
    w = w.reindex(cells).fillna(0).values

    out_path = C.WORK / "outlook.parquet"
    outlook = pd.read_parquet(out_path).set_index("cell") if out_path.exists() else None

    wd_frames = [pd.read_parquet(f) for f in C.AGG.glob("weekday_*.parquet")]
    wd = (pd.concat(wd_frames).groupby("cell").sum() if wd_frames else pd.DataFrame())

    tiles_dir = C.SITE_DATA / "tiles"
    if tiles_dir.exists():
        shutil.rmtree(tiles_dir)
    tiles_dir.mkdir(parents=True)
    k = int(C.TILE_DEG / C.CELL)
    tile_id = (cells // C.NCOLS // k) * (C.NCOLS // k) + (cells % C.NCOLS // k)
    tile_list = []
    for t in np.unique(tile_id):
        idx = np.flatnonzero(tile_id == t)
        doc = {"cells": cells[idx].tolist()}
        for col in ("H", "M", "V", "naive"):
            # most months have no fire: write "1,,,4" instead of "1,0,0,4"
            doc[col] = [",".join(str(v) if v else "" for v in row)
                        for row in r(mats[col][idx]).astype(int).tolist()]
        doc["w"] = r(w[idx], 2).tolist()
        if outlook is not None:
            o = outlook.reindex(cells[idx])
            doc["outlook"] = [[r(o[f"{p}{lead}"].values, 2 if p == "p" else 1).tolist()
                               for p in ("m", "lo", "hi", "p")] for lead in (1, 2, 3)]
        if len(wd):
            wv = wd.reindex(cells[idx]).fillna(0)
            doc["wd"] = wv[[f"wd{d}" for d in range(7) if f"wd{d}" in wv]].astype(int).values.tolist()
        (tiles_dir / f"{t}.json").write_text(json.dumps(doc, separators=(",", ":")))
        tile_list.append(int(t))

    tot = mats["H"].sum(1)
    peak = mats["H"].reshape(len(cells), -1)
    # peak calendar month (0=Jan) over the whole record
    cal = np.zeros((len(cells), 12), "float32")
    for mi in range(n_months):
        cal[:, (C.START_MONTH - 1 + mi) % 12] += mats["H"][:, mi]
    overview = {"cells": cells.tolist(), "total": r(tot).astype(int).tolist(),
                "peak": cal.argmax(1).tolist()}
    (C.SITE_DATA / "overview.json").write_text(json.dumps(overview, separators=(",", ":")))

    # whole-Earth record for the opening story
    world = {col: r(mats[col].sum(0)).astype(int).tolist() for col in ("H", "M", "V", "naive")}
    backcast = (src.values < 2)
    world["unc"] = r((mats["H"] * w[:, None]).sum(0) * backcast).astype(int).tolist()
    if outlook is not None:
        world["outlook"] = [{"m": float(outlook[f"m{L}"].sum()), "lo": float(outlook[f"lo{L}"].sum()),
                             "hi": float(outlook[f"hi{L}"].sum())} for L in (1, 2, 3)]

    y0, m0 = C.month_of(0)
    y1, m1 = C.month_of(n_months - 1)
    meta = {
        "start": [y0, m0], "end": [y1, m1], "months": n_months,
        "cell_deg": C.CELL, "tile_deg": C.TILE_DEG, "ncols": C.NCOLS,
        "tiles": tile_list, "source_by_month": src.astype(int).tolist(),
        "harmonize": hrep, "forecast": frep, "world": world,
    }
    (C.SITE_DATA / "meta.json").write_text(json.dumps(meta, indent=1))
    size = sum(f.stat().st_size for f in C.SITE_DATA.rglob("*.json")) / 1e6
    print(f"{len(cells):,} cells, {len(tile_list)} tiles, {size:.1f} MB written to {C.SITE_DATA}")


if __name__ == "__main__":
    sys.exit(main())
