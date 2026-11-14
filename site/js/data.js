// Loading tiles and turning a selected area into monthly series and statistics.
import { t, lang } from "./i18n.js";
export const monthsShort = () => t("months");
export const monthsLong = () => t("monthsLong");

let META = null;
const tileCache = new Map();

export async function loadMeta() {
  META = await (await fetch("data/meta.json")).json();
  return META;
}
export const meta = () => META;

export async function loadOverview() {
  return (await fetch("data/overview.json")).json();
}

// month index -> {year, month(0-11)}
export function ym(mi) {
  const m0 = META.start[1] - 1 + mi;
  return { year: META.start[0] + Math.floor(m0 / 12), month: m0 % 12 };
}
export const label = (mi) => { const d = ym(mi); return `${monthsShort()[d.month]} ${d.year}`; };

export function cellCenter(cell) {
  const n = META.ncols, deg = META.cell_deg;
  const row = Math.floor(cell / n), col = cell % n;
  return { lat: (row + 0.5) * deg - 90, lon: (col + 0.5) * deg - 180 };
}

function tilesFor(b) {
  const k = META.tile_deg, nt = 360 / k;
  const ids = [];
  for (let r = Math.floor((b.south + 90) / k); r <= Math.floor((b.north + 90 - 1e-9) / k); r++)
    for (let c = Math.floor((b.west + 180) / k); c <= Math.floor((b.east + 180 - 1e-9) / k); c++)
      ids.push(r * nt + c);
  const have = new Set(META.tiles);
  return ids.filter((t) => have.has(t));
}

// Series are stored as "1,,,4" (empty = 0) to keep the files small.
const unpack = (s) => s.split(",").map((x) => (x ? +x : 0));

async function tile(id) {
  if (!tileCache.has(id)) tileCache.set(id, fetch(`data/tiles/${id}.json`).then((r) => r.json()).then((t) => {
    for (const k of ["H", "M", "V", "naive"]) t[k] = t[k].map(unpack);
    return t;
  }));
  return tileCache.get(id);
}

// Sum every cell whose centre lies in the box.
export async function selectArea(b) {
  const n = META.months;
  const sum = { H: new Float64Array(n), M: new Float64Array(n), V: new Float64Array(n),
    naive: new Float64Array(n), unc: new Float64Array(n) };
  const outlook = [0, 1, 2].map(() => ({ m: 0, lo: 0, hi: 0, pNone: 1 }));
  const wd = new Float64Array(7);
  const cells = [];
  for (const id of tilesFor(b)) {
    const t = await tile(id);
    t.cells.forEach((cell, i) => {
      const c = cellCenter(cell);
      if (c.lat < b.south || c.lat > b.north || c.lon < b.west || c.lon > b.east) return;
      for (let m = 0; m < n; m++) {
        sum.H[m] += t.H[i][m]; sum.M[m] += t.M[i][m]; sum.V[m] += t.V[i][m];
        sum.naive[m] += t.naive[i][m];
        if (META.source_by_month[m] < 2) sum.unc[m] += t.H[i][m] * t.w[i];
      }
      if (t.outlook) for (let L = 0; L < 3; L++) {
        const [m, lo, hi, p] = t.outlook[L];
        outlook[L].m += m[i]; outlook[L].lo += lo[i]; outlook[L].hi += hi[i];
        outlook[L].pNone *= 1 - Math.min(Math.max(p[i], 0), 1);
      }
      if (t.wd) t.wd[i].forEach((v, d) => (wd[d] += v));
      cells.push({ cell, ...c, H: t.H[i] });
    });
  }
  return { ...sum, outlook, wd, cells, box: b };
}

// ---------------------------------------------------------------- statistics
const median = (a) => { const s = [...a].sort((x, y) => x - y); const k = s.length;
  return k ? (k % 2 ? s[(k - 1) / 2] : (s[k / 2 - 1] + s[k / 2]) / 2) : 0; };
const quantile = (a, q) => { const s = [...a].sort((x, y) => x - y); if (!s.length) return 0;
  const p = (s.length - 1) * q, lo = Math.floor(p); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (p - lo); };
export { median, quantile };

// year x month grid (rows = years). Missing months are null.
export function grid(series) {
  const first = ym(0), last = ym(META.months - 1);
  const years = [];
  for (let y = first.year; y <= last.year; y++) years.push(y);
  const rows = years.map(() => new Array(12).fill(null));
  for (let mi = 0; mi < META.months; mi++) {
    const d = ym(mi); rows[d.year - first.year][d.month] = series[mi];
  }
  return { years, rows };
}

// How does the latest month compare with the same month in earlier years?
export function verdict(series, mi = META.months - 1) {
  const cur = series[mi], { month } = ym(mi);
  const past = [];
  for (let k = mi - 12; k >= 0; k -= 12) past.push(series[k]);
  const med = median(past), p25 = quantile(past, 0.25), p75 = quantile(past, 0.75), p90 = quantile(past, 0.9);
  const higher = past.filter((v) => cur > v).length;
  const ratio = med > 0 ? cur / med : cur > 0 ? Infinity : 1;
  let level = "normal";
  if (past.length >= 3) {
    if (cur > p90 && cur >= 3) level = "extreme";
    else if (cur > p75 && cur >= 2) level = "above";
    else if (cur < p25) level = "below";
  }
  const maxYear = past.length ? Math.max(...past) : 0;
  let lastTime = null;
  if (cur > 0) for (let k = mi - 12; k >= 0; k -= 12) if (series[k] >= cur) { lastTime = ym(k).year; break; }
  return { mi, month, cur, med, p25, p75, p90, ratio, level, higher, years: past.length, lastTime, maxYear };
}

// Season timing per "fire year". The fire year starts at the quietest calendar month,
// so a season that crosses New Year (common in the tropics) is not split in two.
export function seasons(series) {
  const clim = new Array(12).fill(0);
  for (let mi = 0; mi < META.months; mi++) clim[ym(mi).month] += series[mi];
  const total = clim.reduce((a, b) => a + b, 0);
  // quietest 3-month window decides where the fire year starts
  let start = 0, best = Infinity;
  for (let m = 0; m < 12; m++) {
    const s = clim[m] + clim[(m + 1) % 12] + clim[(m + 2) % 12];
    if (s < best) { best = s; start = (m + 1) % 12; }
  }
  const out = [];
  for (let mi = 0; mi + 11 < META.months; mi++) {
    if (ym(mi).month !== start) continue;
    const vals = series.slice(mi, mi + 12);
    const sum = vals.reduce((a, b) => a + b, 0);
    if (sum < 10) { out.push({ year: ym(mi).year, sum, onset: null, peak: null, end: null }); continue; }
    const at = (frac) => { // day of fire year when the cumulative share reaches frac
      let acc = 0;
      for (let k = 0; k < 12; k++) {
        if (acc + vals[k] >= frac * sum) return (k + (frac * sum - acc) / Math.max(vals[k], 1e-9)) * 30.44;
        acc += vals[k];
      }
      return 365;
    };
    out.push({ year: ym(mi).year, sum, onset: at(0.1), center: at(0.5), end: at(0.9),
      peak: vals.indexOf(Math.max(...vals)), length: at(0.9) - at(0.1) });
  }
  return { start, clim, total, years: out };
}

// Robust trend (Theil-Sen) in days per decade.
export function trend(points) {
  const p = points.filter((d) => d.y != null);
  if (p.length < 6) return null;
  const slopes = [];
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++)
    if (p[j].x !== p[i].x) slopes.push((p[j].y - p[i].y) / (p[j].x - p[i].x));
  const s = median(slopes);
  const b = median(p.map((d) => d.y - s * d.x));
  return { slope: s, intercept: b, perDecade: s * 10 };
}

// Day-of-fire-year -> readable date
export function dayToDate(day, startMonth) {
  const m = (startMonth + Math.floor(day / 30.44)) % 12;
  const d = Math.min(28, Math.max(1, Math.round((day % 30.44) + 1)));
  return lang() === "ar" ? `${d} ${monthsLong()[m]}` : `${monthsLong()[m]} ${d}`;
}

// Cells that burn in the area's peak month year after year.
export function recurring(area, peakMonth) {
  return area.cells.map((c) => {
    let yrs = 0, hit = 0;
    for (let mi = 0; mi < META.months; mi++) if (ym(mi).month === peakMonth) { yrs++; if (c.H[mi] > 0) hit++; }
    return { ...c, share: yrs ? hit / yrs : 0 };
  });
}

export function toCSV(area, name) {
  const rows = [["year", "month", "harmonized_hotspots", "harmonized_low", "harmonized_high",
    "modis_terra_aqua", "viirs_per_satellite", "naive_stitched", "record_source"]];
  const src = ["none", "MODIS", "VIIRS", "MODIS+VIIRS"];
  for (let mi = 0; mi < META.months; mi++) {
    const d = ym(mi);
    rows.push([d.year, d.month + 1, area.H[mi].toFixed(0), (area.H[mi] - area.unc[mi]).toFixed(0),
      (area.H[mi] + area.unc[mi]).toFixed(0), area.M[mi].toFixed(0), area.V[mi].toFixed(0),
      area.naive[mi].toFixed(0), src[META.source_by_month[mi]]]);
  }
  return `# Fire Calendar - ${name}\n# Area: ${JSON.stringify(area.box)}\n# Source: NASA FIRMS MODIS C6.1 and VIIRS 375 m active fires, corrected (harmonized) by Fire Calendar\n`
    + rows.map((r) => r.join(",")).join("\n");
}

export function cellsCSV(area, from, to) {
  const rows = [["cell_lat", "cell_lon", "year", "month", "harmonized_hotspots"]];
  for (const c of area.cells) for (let mi = from; mi <= to; mi++) if (c.H[mi] > 0) {
    const d = ym(mi); rows.push([c.lat.toFixed(3), c.lon.toFixed(3), d.year, d.month + 1, c.H[mi]]);
  }
  return rows.map((r) => r.join(",")).join("\n");
}
