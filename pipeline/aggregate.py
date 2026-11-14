"""Stage 2: remove static heat sources and count detections per 0.25 deg cell and month.

Static sources (gas flares, industry, volcanoes) are found two ways:
  * FIRMS marks some of them (type 1/2/3) in standard-processing data;
  * many are still labelled type 0, so a ~1 km bin that is hot in 4+ separate
    months of a year, in 3+ different years, is treated as static too.
Flagged bins are widened by one bin in every direction because geolocation
jitters by about a pixel.

For VIIRS we also build the "seen through MODIS eyes" count: VIIRS 375 m pixels
are merged into ~1 km bins per overpass, their FRP is summed, and only bins
above an FRP threshold are counted. The threshold is chosen in harmonize.py.

Run:  python pipeline/aggregate.py
"""
import os
import sys

import numpy as np
import pandas as pd

import config as C


def load_points(sat_name, year):
    d = C.POINTS / sat_name / str(year)
    files = sorted(d.glob("*.parquet"))
    if not files:
        return None
    df = pd.concat([pd.read_parquet(f) for f in files], ignore_index=True)
    # Country-yearly and archive downloads can overlap: keep one copy.
    return df.drop_duplicates(subset=["lat", "lon", "ymd", "hhmm", "sat"])


def add_keys(df):
    df = df.copy()
    y =(df["ymd"] // 10000).astype("int32")
    m = (df["ymd"] // 100 % 100).astype("int32")
    df["mi"] = ((y - C.START_YEAR) * 12 + (m - C.START_MONTH)).astype("int16")
    row = np.clip(((df["lat"] + 90) / C.CELL).astype("int32"), 0, C.NROWS - 1)
    col = np.clip(((df["lon"] + 180) / C.CELL).astype("int32"), 0, C.NCOLS - 1)
    df["cell"] = (row * C.NCOLS + col).astype("int32")
    frow = ((df["lat"] + 90) / C.FINE).astype("int64")
    fcol = ((df["lon"] + 180) / C.FINE).astype("int64")
    df["fine"] = frow * C.FINE_COLS + fcol
    return df


def sat_years():
    for sat_dir in sorted(C.POINTS.iterdir()):
        if sat_dir.is_dir():
            for ydir in sorted(sat_dir.iterdir()):
                if ydir.is_dir() and any(ydir.glob("*.parquet")):
                    yield sat_dir.name, int(ydir.name)


def scan_one(args):
    sat_name, year = args
    df = load_points(sat_name, year)
    df = add_keys(df[df["conf_ok"]])
    marked = df.loc[df["type"].isin([1, 2, 3]), "fine"].unique()
    g = df.groupby("fine").agg(months=("mi", "nunique"), days=("ymd", "nunique"))
    busy = g.index[g["months"] >= 4].values
    # A new flare or plant is caught in its first year too: a vegetation fire does not keep the
    # same ~1 km spot hot on 30+ days spread over 4+ months (near-real-time data has no type).
    hot = g.index[(g["months"] >= 4) & (g["days"] >= 30)].values
    print(f"static scan {sat_name} {year}: {len(busy):,} busy, {len(hot):,} hot all year, {len(marked):,} marked", flush=True)
    return pd.concat([pd.DataFrame({"fine": busy, "year": year, "kind": 0}),
                      pd.DataFrame({"fine": marked, "year": year, "kind": 1}),
                      pd.DataFrame({"fine": hot, "year": year, "kind": 2})])


def pool():
    from concurrent.futures import ProcessPoolExecutor
    return ProcessPoolExecutor(int(os.environ.get("FIRE_RINGS_WORKERS", "2")))


def scan_static():
    """Collect, per year, ~1 km bins that look like permanent heat sources."""
    with pool() as p:
        rows = list(p.map(scan_one, list(sat_years())))
    s = pd.concat(rows, ignore_index=True)
    busy_years = s[s.kind == 0].groupby("fine")["year"].nunique()
    static = set(busy_years[busy_years >= 3].index) | set(s.loc[s.kind.isin([1, 2]), "fine"])
    static = np.array(sorted(static), dtype="int64")
    # widen by one bin in every direction
    r, c = static // C.FINE_COLS, static % C.FINE_COLS
    grown = [((r + dr) * C.FINE_COLS + (c + dc)) for dr in (-1, 0, 1) for dc in (-1, 0, 1)]
    static = np.unique(np.concatenate(grown))
    pd.DataFrame({"fine": static}).to_parquet(C.AGG / "static_bins.parquet", index=False)
    print(f"static bins (widened): {len(static):,}", flush=True)
    return static


def aggregate_year(sat_name, year, static):
    df = load_points(sat_name, year)
    df = add_keys(df[df["conf_ok"] & df["type"].isin([0, -1])])
    before = len(df)
    df = df[~np.isin(df["fine"].values, static)]
    sat = C.SAT[sat_name]

    g = df.groupby(["cell", "mi"])
    out = g.size().rename("n").to_frame()
    out["n_day"] = g["day"].sum()
    out["frp"] = g["frp"].sum()

    if sat in C.VIIRS_SATS:
        # merge 375 m pixels into ~1 km bins per overpass (date + day/night)
        b = (df.groupby(["fine", "ymd", "day"], sort=False)
               .agg(cell=("cell", "first"), mi=("mi", "first"), frp=("frp", "sum"))
               .reset_index())
        for t in C.FRP_THRESHOLDS:
            out[f"eq{t}"] = b[b["frp"] >= t].groupby(["cell", "mi"]).size()
        out = out.fillna(0)

    out = out.reset_index()
    for c in out.columns:
        if c not in ("cell", "mi", "frp"):
            out[c] = out[c].astype("int32")
    out.to_parquet(C.AGG / f"{sat_name}_{year}.parquet", index=False)
    # remember the last observed day so an unfinished month can be dropped later
    (C.AGG / f"lastday_{sat_name}_{year}.txt").write_text(str(int(df["ymd"].max())) if len(df) else "0")

    # weekday counts per cell, for the "human fingerprint"
    wd = pd.to_datetime(df["ymd"].astype(str), format="%Y%m%d").dt.dayofweek
    w = df.assign(wd=wd.values).groupby(["cell", "wd"]).size().unstack(fill_value=0)
    w.columns = [f"wd{c}" for c in w.columns]
    w.reset_index().to_parquet(C.AGG / f"weekday_{sat_name}_{year}.parquet", index=False)
    print(f"{sat_name} {year}: {before:,} -> {len(df):,} after static filter, "
          f"{len(out):,} cell-months", flush=True)


def agg_one(args):
    aggregate_year(*args)


def main():
    static = scan_static()
    with pool() as p:
        list(p.map(agg_one, [(s, y, static) for s, y in sat_years()]))


if __name__ == "__main__":
    sys.exit(main())
