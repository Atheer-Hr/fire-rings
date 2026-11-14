"""Stage 1: read FIRMS downloads (country-yearly zips, archive zips or plain CSVs)
and write compact detection tables, one parquet per satellite, year and source.

Run:  python pipeline/ingest.py
"""
import io
import json
import os
import sys
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

import config as C

COLS = ["latitude", "longitude", "acq_date", "acq_time", "satellite",
        "instrument", "confidence", "frp", "daynight", "type"]

SAT_ALIASES = {
    "terra": "Terra", "t": "Terra",
    "aqua": "Aqua", "a": "Aqua",
    "n": "SNPP", "npp": "SNPP", "snpp": "SNPP", "suomi npp": "SNPP", "suomi-npp": "SNPP",
    "n20": "NOAA20", "1": "NOAA20", "noaa-20": "NOAA20", "noaa20": "NOAA20", "j1": "NOAA20",
    "n21": "NOAA21", "2": "NOAA21", "noaa-21": "NOAA21", "noaa21": "NOAA21", "j2": "NOAA21",
}


def sat_from_name(name):
    n = name.lower()
    if "modis" in n or "m-c61" in n or "_m6" in n:
        return None  # Terra/Aqua comes from the rows themselves
    if any(k in n for k in ("noaa-21", "noaa21", "j2v", "jpss2")):
        return "NOAA21"
    if any(k in n for k in ("noaa-20", "noaa20", "j1v", "jpss1")):
        return "NOAA20"
    if any(k in n for k in ("snpp", "suomi", "npp", "sv-c2")):
        return "SNPP"
    return None


def clean(df, hint):
    df = df[[c for c in COLS if c in df.columns]].copy()
    sat = df["satellite"].astype(str).str.strip().str.lower().map(SAT_ALIASES)
    if hint:
        sat = sat.fillna(hint)
    df["sat"] = sat.map(C.SAT)
    df = df[df["sat"].notna()]

    is_modis = df["sat"].isin(C.MODIS_SATS)
    conf = df["confidence"].astype(str).str.strip().str.lower()
    num = pd.to_numeric(conf, errors="coerce")
    # MODIS: drop low confidence (<30). VIIRS: drop 'l' (low).
    conf_ok = np.where(is_modis, num.fillna(0) >= 30, conf.isin(["n", "h", "nominal", "high"]))

    date = pd.to_datetime(df["acq_date"], errors="coerce")
    out = pd.DataFrame({
        "lat": df["latitude"].astype("float32"),
        "lon": df["longitude"].astype("float32"),
        "ymd": (date.dt.year * 10000 + date.dt.month * 100 + date.dt.day).astype("Int32"),
        "hhmm": pd.to_numeric(df["acq_time"], errors="coerce").astype("Int16"),
        "sat": df["sat"].astype("int8"),
        "conf_ok": conf_ok,
        "frp": pd.to_numeric(df["frp"], errors="coerce").astype("float32"),
        "day": (df["daynight"].astype(str).str.upper() == "D"),
        # 'type' only exists in standard (archived) data; -1 = unknown (near-real-time)
        "type": pd.to_numeric(df["type"], errors="coerce").fillna(-1).astype("int8")
        if "type" in df.columns else np.int8(-1),
    })
    return out.dropna(subset=["ymd", "lat", "lon"])


def iter_csvs(path):
    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as z:
            for name in z.namelist():
                if name.lower().endswith(".csv"):
                    with z.open(name) as f:
                        yield name, f.read()
    elif path.suffix.lower() == ".csv":
        yield path.name, path.read_bytes()


def ingest_file(path):
    file_hint = sat_from_name(path.name)
    parts = {}
    for name, raw in iter_csvs(path):
        hint = sat_from_name(name) or file_hint
        try:
            # read only the columns we use; the pyarrow reader is several times faster
            header = raw[:raw.find(b"\n")].decode().strip().split(",")
            use = [c for c in header if c in COLS]
            df = pd.read_csv(io.BytesIO(raw), usecols=use, engine="pyarrow",
                             dtype={"confidence": str, "satellite": str, "acq_time": str})
        except (pd.errors.EmptyDataError, ValueError):
            continue
        if df.empty or "latitude" not in df.columns:
            continue
        out = clean(df, hint)
        out["year"] = (out["ymd"] // 10000).astype("int16")
        for (sat, year), g in out.groupby(["sat", "year"]):
            parts.setdefault((int(sat), int(year)), []).append(g.drop(columns="year"))
    n = 0
    for (sat, year), frames in parts.items():
        d = C.POINTS / C.SAT_NAME[sat] / str(year)
        d.mkdir(parents=True, exist_ok=True)
        df = pd.concat(frames, ignore_index=True)
        df.to_parquet(d / f"{path.stem}.parquet", index=False)
        n += len(df)
    return n


def find_inputs():
    pats = ("modis_*.zip", "viirs*.zip", "DL_FIRE_*.zip", "fire_archive_*.csv", "fire_nrt_*.csv",
            "fire_*.zip", "*_all_countries.zip")
    seen = {}
    for d in C.RAW_DIRS:
        for pat in pats:
            for p in d.glob(pat):
                seen[p.resolve()] = p
    return sorted(seen.values())


def work(p):
    try:
        return p, ingest_file(p)
    except zipfile.BadZipFile:
        return p, None


def main():
    from concurrent.futures import ProcessPoolExecutor
    manifest_path = C.WORK / "ingested.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    todo = [p for p in find_inputs() if manifest.get(p.name) != f"{p.name}:{p.stat().st_size}"]
    workers = int(os.environ.get("FIRE_RINGS_WORKERS", "2"))  # each VIIRS year needs ~2-3 GB RAM
    with ProcessPoolExecutor(workers) as pool:
        for p, n in pool.map(work, todo):
            if n is None:
                print(f"skip {p.name}: still downloading or damaged", flush=True)
                continue
            manifest[p.name] = f"{p.name}:{p.stat().st_size}"
            manifest_path.write_text(json.dumps(manifest, indent=1))
            print(f"{p.name}: {n:,} detections", flush=True)


if __name__ == "__main__":
    sys.exit(main())
