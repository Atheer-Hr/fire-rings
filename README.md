# Fire Calendar — from firefighting to fire-readiness

NASA Space Apps Challenge 2026 · *Harmonization of MODIS and VIIRS Hot Spots* · team ASR Space, Madinah.

Fire Calendar harmonizes 25 years of NASA FIRMS active-fire hotspots (MODIS 2000–, VIIRS 2012–) into one
consistent record, shows it as a burning activity calendar ("Fire Rings": one ring per year, one slice
per month), says in plain words whether the latest month is normal, and gives a machine-learning
outlook for the next three months.

## Layout

```
pipeline/   Python data pipeline (pandas, numpy, scikit-learn)
  config.py      paths, grid, satellites
  ingest.py      FIRMS zips/CSVs -> clean detection tables
  aggregate.py   static-source (gas flare) removal, 0.25 deg cell x month counts
  harmonize.py   Terra/Aqua, multi-VIIRS and MODIS<->VIIRS bridges + validation
  forecast.py    gradient-boosting outlook (1-3 months) + blind test on the last full year
  export.py      small JSON files for the website
  run_all.py     all stages in order
site/       static website (Leaflet + D3, no build step)
```

## Run

1. Download FIRMS data into `~/Downloads` (or set `FIRE_RINGS_RAW`):
   * country yearly summaries: <https://firms.modaps.eosdis.nasa.gov/country/> (MODIS and VIIRS)
   * archive requests: <https://firms.modaps.eosdis.nasa.gov/download/>
2. Optional: save NOAA CPC `oni.ascii.txt` to `data/` to add the El Niño index to the model.
3. `python pipeline/run_all.py` (working files go to `C:\firms-data\work`, override with `FIRE_RINGS_WORK`).
4. Serve the site: `python -m http.server 8765 --directory site` and open <http://localhost:8765>.

## Method in short

* **Clean:** keep nominal/high confidence; drop FIRMS static sources (type 1–3) and ~1 km spots hot in
  4+ months of a year in 3+ years (gas flares labelled as vegetation), widened by one bin.
* **Terra → Terra+Aqua:** Terra-only months (before mid-2002) scaled by the learned ratio.
* **One VIIRS satellite equivalent:** VIIRS counts averaged over the satellites flying that month.
* **Bridges:** physical (VIIRS pixels merged to 1 km per overpass, weak bins below an FRP cut chosen from
  the data dropped) and statistical (ratio per 5° tile and calendar month with shrinkage; year-bootstrap
  uncertainty). Record shown in VIIRS detail; MODIS back-cast before VIIRS.
* **Validation:** bridges fitted on early overlap years, tested on the last four.
* **Outlook:** HistGradientBoosting (Poisson mean, 10/90% quantiles, fire/no-fire classifier) on
  leakage-free features; blind test on the last full year against climatology, last year and persistence.

## Acknowledgement

We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management
System (FIRMS) (https://earthdata.nasa.gov/firms), part of NASA's Land, Atmosphere Near real-time
Capability for Earth observations (LANCE) (https://earthdata.nasa.gov/lance) and NASA's Earth Science
Data and Information System (ESDIS).
