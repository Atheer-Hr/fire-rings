"""Shared settings for the Fire Rings data pipeline.

Raw FIRMS downloads are large, so they live outside OneDrive. Set FIRE_RINGS_RAW
and FIRE_RINGS_WORK to override the defaults.
"""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIRS = [Path(p) for p in os.environ.get(
    "FIRE_RINGS_RAW", str(Path.home() / "Downloads")).split(os.pathsep)]
WORK = Path(os.environ.get("FIRE_RINGS_WORK", r"C:\firms-data\work"))
SITE_DATA = ROOT / "site" / "data"

POINTS = WORK / "points"      # cleaned detections, one folder per satellite/year
AGG = WORK / "agg"            # cell x month counts per satellite/year
MODEL = WORK / "model"

# Analysis grid: 0.25 degree cells (~28 km at the equator).
CELL = 0.25
NCOLS = int(360 / CELL)
NROWS = int(180 / CELL)
# Fine bins used to mimic a MODIS 1 km pixel and to find static heat sources.
FINE = 0.01
FINE_COLS = int(360 / FINE)

# Month index 0 = November 2000, the first full month of MODIS Terra data.
START_YEAR, START_MONTH = 2000, 11

# Satellite codes used everywhere in the pipeline.
SAT = {"Terra": 0, "Aqua": 1, "SNPP": 2, "NOAA20": 3, "NOAA21": 4}
SAT_NAME = {v: k for k, v in SAT.items()}
MODIS_SATS = (SAT["Terra"], SAT["Aqua"])
VIIRS_SATS = (SAT["SNPP"], SAT["NOAA20"], SAT["NOAA21"])

# FRP thresholds (MW) tried when making VIIRS "see like MODIS".
FRP_THRESHOLDS = [0, 2, 4, 6, 8, 10, 12, 15, 20]

# Tiles the website loads on demand.
TILE_DEG = 5


def month_index(year, month):
    return (year - START_YEAR) * 12 + (month - START_MONTH)


def month_of(mi):
    m0 = START_MONTH - 1 + mi
    return START_YEAR + m0 // 12, m0 % 12 + 1


for d in (WORK, POINTS, AGG, MODEL, SITE_DATA):
    d.mkdir(parents=True, exist_ok=True)
