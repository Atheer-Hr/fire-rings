# Space Apps project page — text to paste

Copy each block into the matching field of the project submission form. All of it is in English, as the rules require.
Field names may differ slightly on the form; match by meaning.

---

## Project name

Fire Calendar

---

## High-level project summary (short)

Satellites have mapped Earth's fires since 2000, but the record is split between MODIS and VIIRS, which cannot be compared directly. Read naively, the record exaggerates burning by over 700% once VIIRS arrives. And MODIS is retiring: Suomi NPP stopped delivering data in November 2026. Fire Calendar harmonizes 25 years of NASA FIRMS hotspots into one consistent record, cutting that error to about 2% in a blind test. It turns the record into a burning activity calendar anyone can read: "Fire Calendar", drawn like tree rings, plus a weather-style Fire Forecast. For any area on Earth it says whether this season is normal, when the season usually starts, and what the next three months look like. The tool moves fire managers from firefighting to fire-readiness.

---

## Link to project demo

(paste the YouTube / Google Drive link to the 30-second video here — set it to public)

## Link to final project

https://atheer-hr.github.io/fire-rings

(Arabic interface: https://atheer-hr.github.io/fire-rings/?lang=ar · Source code: https://github.com/Atheer-Hr/fire-rings)

---

## Detailed project description

**The problem.** Fire managers need two answers every year: *when does our fire season start?* and *is what we see now normal or dangerous?* Both depend on comparing today with the past, and NASA's satellite fire record is split. MODIS (Terra 2000, Aqua 2002) detects fires at 1 km. VIIRS (Suomi NPP 2012, NOAA-20 2018, NOAA-21 2023) detects them at 375 m and catches far smaller fires. More than half (56%) of VIIRS detections are fires too small for MODIS to see. Put side by side, burning appears to explode after 2012. The Earth did not change; the camera did. With MODIS near the end of its life and Suomi NPP data delivery stopped in November 2026, 25 years of history risk becoming impossible to compare with the future.

**What Fire Calendar does.**

1. **Cleans the record.** It keeps nominal and high confidence detections only, and removes gas flares, industry and volcanoes. That includes sources NASA marks and those it labels as vegetation: any ~1 km spot that is hot in 4+ months of a year, in 3+ years, is treated as a permanent heat source. This matters in places like Saudi Arabia, where oil-field flares are recorded as fires.

2. **Makes every year comparable.** It fixes three breaks in the record:
   * Terra-only months before Aqua joined in 2002 are scaled to Terra+Aqua.
   * VIIRS counts are averaged per satellite, so a new satellite is not a new trend.
   * Two bridges link MODIS and VIIRS, fitted on the 14 years both sensors fly (2012–2025):
     * **Physical bridge.** VIIRS pixels are merged into 1 km bins per overpass, and bins weaker than MODIS can detect are dropped. The best cut, 4 MW, is chosen from the data.
     * **Statistical bridge.** A ratio for each 5° region and calendar month, shrunk toward the regional value when fires are few, with uncertainty from resampling years.

   The record is shown in VIIRS detail, with MODIS back-cast before 2012 and an uncertainty band.

3. **Proves it.** We pretend MODIS retired early: the bridges are fitted on 2012–2021 only and must rebuild 2022–2025 blind.
   * At region-month level, the bridge reaches R² = 0.95 (log scale) with a +2.2% total bias.
   * One global ratio reaches 0.92.
   * Using raw VIIRS as if it were MODIS reaches 0.23, with a +718% bias.

4. **Tells the story first.** The site opens with the problem rather than a dashboard. Earth's own Fire Calendar sit under a before/after handle the reader drags: on one side the record as published, glowing falsely after 2012, and on the other the repaired record. A "watch the record grow" button replays 2000–2026 ring by ring, naming each satellite change, and then repairs the record in front of the reader. A "When" map colours every place by the month it burns most, and a "fire wave" animates the burning season travelling around the planet.

5. **Reads it for people.** Choose an area on the map (draw a box, type coordinates, or pick a place), and Fire Calendar shows:
   * **Fire Forecast.** A weather-app card with the expected hotspots next month, a five-flame risk level, a countdown to the fire season and a "prepare by" date.
   * **Is this normal?** The latest month compared with the median of the same month in earlier years, in one plain sentence ("13× the usual October, highest since 2015").
   * **Fire Calendar.** The burning activity calendar drawn as tree rings: one ring per year, one slice per month, plus a dashed outer ring for the outlook. A before/after handle shows the raw record next to the harmonized one. Colours are relative to the area, so quiet regions show their own peaks.
   * **Calendar grid.** Colour-blind-safe colours, with a "compared with usual" mode.
   * **Season shift.** Season start, length and trend across 25 years.
   * **Repeat-burn hotspots.** Places that burn in the same month nearly every year, usually planned burning, so prevention teams know where to go.
   * **Human fingerprint.** Weekly rhythms in burning. Nature has no weekends.
   * **Downloads.** CSV of the harmonized monthly record and of hotspots by cell, plus a PNG of the rings.

6. **Looks ahead with machine learning.** Gradient-boosted trees (Poisson loss for counts, 10/90% quantile models for a range, and a fire / no-fire classifier) forecast every active 25 km cell 1–3 months ahead. They use only information available on the day of the forecast. Tested blind on 2025, a year the model never saw:
   * The error is 41% lower than the best simple method (the average of earlier years) one month ahead, and 29% lower three months ahead.
   * The fire / no-fire classifier reaches AUC 0.92.

   We forecast *critical periods*, not single ignitions, because most fires are lit by people.

**What it found.**
* **Kalimantan, Indonesia.** October 2026 recorded 13× the usual October, the highest since 2015. The fire season now starts about 10 days earlier and lasts about 23 days longer than in 2001–2010.
* **Raw versus harmonized.** In the raw record, burning jumps +335% (Kalimantan) and +504% (Asir, Saudi Arabia) when VIIRS arrives. The harmonized record barely moves.
* **Asir, Saudi Arabia.** Detections are 31% higher on Thursdays, the start of the Saudi weekend. It is a hint of human-caused fire that awareness campaigns can target. With only ~4,000 detections it is an indicator, not proof.

**Who it is for.** Civil defence and firefighters planning crews and aircraft, land managers and afforestation programmes such as the Saudi Green Initiative protecting new trees, health authorities warning before the smoke season, and scientists who need an honest long-term record.

**Impact.** The UN Environment Programme calls on governments to move fire spending from response to prevention and preparedness. Preparedness needs to know *when* and *where*, and that needs a record that does not break every time a satellite retires. Fire Calendar works for any area on Earth, needs no expert to read, runs in a browser and is open source.

**Tools.** Python (pandas, NumPy, scikit-learn) for the pipeline. A static website with Leaflet and D3, in English and Arabic, hosted on GitHub Pages.

---

## NASA data

* **NASA FIRMS** (Fire Information for Resource Management System), active fire / hotspot data: https://firms.modaps.eosdis.nasa.gov/
  * MODIS Collection 6.1 active fires (Terra and Aqua), country yearly summaries 2000–2025.
  * VIIRS 375 m active fires, Suomi NPP 2012–2025 and NOAA-20 2018–2025, country yearly summaries.
  * VIIRS NOAA-20 archive and near-real-time data, 1 January – 14 November 2026, from the FIRMS archive download tool.
* NASA Earthdata blog, "Transitioning from Suomi NPP VIIRS & OMPS: What FIRMS Users Need to Know" (2026). Used for the sensor-retirement context.

We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS) (https://earthdata.nasa.gov/firms), part of NASA's Land, Atmosphere Near real-time Capability for Earth observations (LANCE) (https://earthdata.nasa.gov/lance) and NASA's Earth Science Data and Information System (ESDIS).

---

## Space agency partner & other data

* Basemap tiles: Esri World Dark Gray Canvas (Esri, HERE, Garmin, © OpenStreetMap contributors).
* No other datasets are used; every number in the tool comes from NASA FIRMS.

---

## Use of artificial intelligence

* **In the product.** Gradient-boosted tree models from scikit-learn produce the 1–3 month fire outlook. They were trained only on harmonized NASA FIRMS data and tested blind on 2025 against simple baselines. The results, including where the model does not beat a baseline, are published in the app's "Model card".
* **In building it.** The team used an AI coding assistant (Claude, by Anthropic) to help write and review the data pipeline, the website code and the English/Arabic text. The team directed the idea, the design and the scientific choices, checked the results, and is responsible for the submission.

---

## References

1. Giglio, L., Schroeder, W., & Justice, C. O. (2016). The collection 6 MODIS active fire detection algorithm and fire products. *Remote Sensing of Environment*, 178, 31–41.
2. Schroeder, W., Oliva, P., Giglio, L., & Csiszar, I. A. (2014). The New VIIRS 375 m active fire detection data product: Algorithm description and initial assessment. *Remote Sensing of Environment*, 143, 85–96.
3. NASA FIRMS: https://firms.modaps.eosdis.nasa.gov/
4. NASA Earthdata, Transitioning from Suomi NPP VIIRS & OMPS: https://www.earthdata.nasa.gov/news/blog/transitioning-from-suomi-npp-viirs-omps-what-firms-users-need-know
5. UNEP & GRID-Arendal (2022). *Spreading like Wildfire: The Rising Threat of Extraordinary Landscape Fires*.
6. Saudi Green Initiative: https://www.greeninitiatives.gov.sa/
7. Software: pandas, NumPy, scikit-learn, PyArrow (Python); Leaflet 1.9.4; D3 7.9.0; Google Fonts (Inter, Fraunces, IBM Plex Sans Arabic).
8. Source code: https://github.com/Atheer-Hr/fire-rings

---

## Tags

#wildfire #MODIS #VIIRS #FIRMS #harmonization #machinelearning #earlywarning #SaudiGreenInitiative #dataviz
