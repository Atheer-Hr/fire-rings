import * as D from "./data.js";
import * as V from "./charts.js";
import { t, lang, setLang, applyStatic } from "./i18n.js";

const $ = (s) => document.querySelector(s);
const fmt = (v) => Math.round(v).toLocaleString("en-US");
const PRESETS = [
  { id: "asir-saudi-arabia", b: { south: 17.3, north: 20.6, west: 41.4, east: 44.2 } },
  { id: "al-baha-taif-saudi-arabia", b: { south: 19.6, north: 21.6, west: 40.6, east: 42.0 } },
  { id: "kalimantan-indonesia", b: { south: -4.2, north: 4.4, west: 108.6, east: 119.0 } },
  { id: "punjab-haryana-india", b: { south: 28.4, north: 32.6, west: 73.8, east: 77.6 } },
  { id: "northern-australia", b: { south: -17.5, north: -11.0, west: 129.0, east: 137.0 } },
  { id: "northern-algeria", b: { south: 34.6, north: 37.2, west: 2.0, east: 8.7 } },
  { id: "california-usa", b: { south: 32.5, north: 42.0, west: -124.5, east: -114.1 } },
  { id: "amazon-brazil", b: { south: -13.0, north: -3.0, west: -66.0, east: -46.0 } },
];

// An area remembers how it was chosen so its name can be shown in either language.
const state = { area: null, area2: null, src: null, src2: null, rec: "H", cal: "count", compareNext: false };
let map, boxLayer, box2Layer, recurLayer;

function areaName(src) {
  if (!src) return "";
  if (src.preset != null) return t("presets")[src.preset];
  if (src.point) return `${src.point.lat.toFixed(2)}°, ${src.point.lon.toFixed(2)}° (±${src.point.km} km)`;
  const b = src.b;
  return t("areaBox", { s: b.south.toFixed(1), n: b.north.toFixed(1), w: b.west.toFixed(1), e: b.east.toFixed(1) });
}
const shortName = (n) => n.split(/[,،(]/)[0].trim();
// "23 days" / Arabic counted noun: 3–10 أيام, otherwise يوماً
const days = (n) => (lang() === "ar" ? (n >= 3 && n <= 10 ? `${n} أيام` : `${n} يوماً`) : `${n} day${n === 1 ? "" : "s"}`);

// ---------------------------------------------------------------- map
function initMap(overview) {
  map = L.map("map", { worldCopyJump: true, minZoom: 2 }).setView([20, 30], 2);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
    attribution: "Basemap &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors", maxZoom: 10,
  }).addTo(map);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 10, pane: "shadowPane",
  }).addTo(map);
  const densityColor = V.colorScale(D.quantile(overview.total, 0.995));
  // world fire density on a canvas: tens of thousands of cells are too many for SVG markers
  const Density = L.Layer.extend({
    onAdd(m) {
      this._c = L.DomUtil.create("canvas", "density");
      m.getPanes().overlayPane.appendChild(this._c);
      m.on("moveend zoomend resize", this._draw, this);
      this._draw();
    },
    onRemove(m) { this._c.remove(); m.off("moveend zoomend resize", this._draw, this); },
    _draw() {
      const size = map.getSize(), c = this._c;
      L.DomUtil.setPosition(c, map.containerPointToLayerPoint([0, 0]));
      c.width = size.x * devicePixelRatio; c.height = size.y * devicePixelRatio;
      c.style.width = `${size.x}px`; c.style.height = `${size.y}px`;
      const ctx = c.getContext("2d");
      ctx.scale(devicePixelRatio, devicePixelRatio);
      const deg = D.meta().cell_deg;
      overview.cells.forEach((cell, i) => {
        const p = D.cellCenter(cell);
        const a = map.latLngToContainerPoint([p.lat + deg / 2, p.lon - deg / 2]);
        const b = map.latLngToContainerPoint([p.lat - deg / 2, p.lon + deg / 2]);
        if (b.x < 0 || a.x > size.x || b.y < 0 || a.y > size.y) return;
        ctx.fillStyle = densityColor(overview.total[i]);
        ctx.fillRect(a.x, a.y, Math.max(1, b.x - a.x), Math.max(1, b.y - a.y));
      });
    },
  });
  new Density().addTo(map);
  enableDrawing();
}

function enableDrawing() {
  let start = null, rect = null, armed = false;
  $("#draw").onclick = () => { armed = true; map.dragging.disable(); $("#map").classList.add("drawing"); $("#hint").textContent = t("drawHint"); };
  map.on("mousedown", (e) => { if (!armed) return; start = e.latlng; rect = L.rectangle([start, start], { className: "draw-box" }).addTo(map); });
  map.on("mousemove", (e) => { if (start && rect) rect.setBounds([start, e.latlng]); });
  map.on("mouseup", (e) => {
    if (!start) return;
    const bb = L.latLngBounds(start, e.latlng);
    rect.remove(); start = null; armed = false; map.dragging.enable(); $("#map").classList.remove("drawing");
    if (Math.abs(bb.getNorth() - bb.getSouth()) < 0.2 || Math.abs(bb.getEast() - bb.getWest()) < 0.2) { $("#hint").textContent = t("tooSmall"); return; }
    const b = { south: bb.getSouth(), north: bb.getNorth(), west: bb.getWest(), east: bb.getEast() };
    choose({ b });
  });
}

function showBox(b, second) {
  const layer = L.rectangle([[b.south, b.west], [b.north, b.east]], { className: second ? "aoi aoi2" : "aoi" }).addTo(map);
  if (second) { box2Layer?.remove(); box2Layer = layer; } else { boxLayer?.remove(); boxLayer = layer; box2Layer?.remove(); box2Layer = null; }
  map.fitBounds(layer.getBounds(), { padding: [30, 30], maxZoom: 7 });
}

async function choose(src) {
  const second = state.compareNext && state.area;
  state.compareNext = false;
  $("#compare").classList.remove("on");
  showBox(src.b, second);
  $("#hint").textContent = t("loading");
  const area = await D.selectArea(src.b);
  if (second) { state.area2 = area; state.src2 = src; } else { state.area = area; state.src = src; state.area2 = null; state.src2 = null; }
  $("#hint").textContent = t("cellsSelected", { n: area.cells.length });
  render();
}

// ---------------------------------------------------------------- statistics helpers
function monthStats(a) {
  const n = D.meta().months;
  const byMonth = Array.from({ length: 12 }, () => []);
  for (let mi = 0; mi < n; mi++) byMonth[D.ym(mi).month].push(a.H[mi]);
  return { median: byMonth.map((v) => D.median(v)), all: Array.from(a.H) };
}

function seasonState(sea, firstMonth) {
  const recent = sea.years.filter((d) => d.onset != null).slice(-10);
  if (recent.length < 3) return null;
  const onset = D.median(recent.map((d) => d.onset)), end = D.median(recent.map((d) => d.end));
  const d0 = ((firstMonth - sea.start + 12) % 12) * 30.44;   // first day of the outlook, in fire-year days
  if (d0 < onset) return { kind: "before", days: Math.round(onset - d0), onset, end };
  if (d0 <= end) return { kind: "during", onset, end };
  return { kind: "after", days: Math.round(onset + 365 - d0), onset, end };
}

// 0..4 from where the expected count sits among all months of the record
function levelOf(value, allMonths) {
  if (value < 0.5) return 0;
  const below = allMonths.filter((v) => v < value).length / Math.max(allMonths.length, 1);
  return below < 0.4 ? 0 : below < 0.7 ? 1 : below < 0.9 ? 2 : below < 0.97 ? 3 : 4;
}

const FLAME = "M12 2c.8 3.6 5.6 5.7 5.6 11.4A5.6 5.6 0 0 1 6.4 13.4c0-2.9 1.6-4.6 2.6-6.2.2 1.9 1 3 2.1 3.3-.3-3 .1-5.6.9-8.5z";
const flame = (cls = "") => `<svg viewBox="0 0 24 24" class="flame ${cls}" aria-hidden="true"><path d="${FLAME}"/></svg>`;
const meter = (lvl) => `<span class="meter" aria-label="${t("levels")[lvl]}">${[0, 1, 2, 3, 4].map((i) => flame(i <= lvl ? "on" : "off")).join("")}</span>`;

// ---------------------------------------------------------------- Fire Forecast card
function renderForecast(a, sea) {
  const meta = D.meta(), last = D.ym(meta.months - 1);
  const stats = monthStats(a);
  const months = a.outlook.map((o, k) => {
    const m = (last.month + 1 + k) % 12;
    const year = last.year + Math.floor((last.month + 1 + k) / 12);
    return { m, year, exp: o.m, chance: 1 - o.pNone, lvl: levelOf(o.m, stats.all), usual: stats.median[m] };
  });
  const now = months[0];
  const ss = seasonState(sea, now.m);
  let season = "";
  if (ss?.kind === "before") season = `${t("seasonIn", { d: days(ss.days) })} · ${t("prepareBy", { date: D.dayToDate(Math.max(0, ss.onset - 14), sea.start) })}`;
  else if (ss?.kind === "during") season = t("seasonOn", { date: D.dayToDate(ss.end, sea.start) });
  else if (ss?.kind === "after" && now.exp > 2 * Math.max(now.usual, 1) && now.lvl >= 2) season = t("seasonLate");
  else if (ss?.kind === "after") season = t("seasonOff", { date: D.dayToDate(ss.onset, sea.start) });
  const L = t("monthsLong"), S = t("months");
  $("#forecastCard").className = `wx lvl${now.lvl}`;
  $("#forecastCard").innerHTML = `
    <div class="wx-top">
      <div>
        <p class="wx-place">${shortName(areaName(state.src))}</p>
        <p class="wx-sub">${t("fireForecast")} · ${t("issued", { month: `${L[now.m]} ${now.year}`, last: `${S[last.month]} ${last.year}` })}</p>
      </div>
      <button class="wx-save" id="saveCard" title="${t("shareImage")}" aria-label="${t("shareImage")}">⤓</button>
    </div>
    <div class="wx-main">
      <div class="wx-icon">${flame("big")}</div>
      <div class="wx-num">${fmt(now.exp)}</div>
      <div class="wx-cond">
        <b>${t("levels")[now.lvl]}</b>
        <span>${t("expectedIn", { month: L[now.m] })}</span>
        <span>${t("usualFor", { month: L[now.m], n: fmt(now.usual) })}</span>
      </div>
    </div>
    ${season ? `<p class="wx-season">⏳ ${season}</p>` : ""}
    <div class="wx-days">
      ${months.map((d) => `<div class="wx-day">
        <span class="wx-dname">${S[d.m]}</span>
        ${meter(d.lvl)}
        <span class="wx-dnum">${fmt(d.exp)}</span>
        <span class="wx-dchance">${d.chance > 0.99 ? "&gt;99" : Math.round(d.chance * 100)}% ${t("chance")}</span>
      </div>`).join("")}
    </div>`;
  $("#saveCard").onclick = saveCard;
}

async function saveCard() {
  const card = $("#forecastCard");
  const css = await (await fetch("css/app.css")).text();
  const w = card.offsetWidth, h = card.offsetHeight, scale = 2;
  const clone = card.cloneNode(true);
  clone.querySelector(".wx-save")?.remove();
  const html = `<div xmlns="http://www.w3.org/1999/xhtml" dir="${document.documentElement.dir}" lang="${lang()}" class="export-root"><style>${css}</style>${clone.outerHTML}</div>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%">${html}</foreignObject></svg>`;
  const img = new Image();
  img.onload = () => {
    const c = Object.assign(document.createElement("canvas"), { width: w * scale, height: h * scale });
    const ctx = c.getContext("2d"); ctx.scale(scale, scale); ctx.drawImage(img, 0, 0);
    c.toBlob((b) => { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `fire-forecast-${slug(shortName(areaName(state.src)))}.png`; a.click(); });
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

// ---------------------------------------------------------------- report
function render() {
  const a = state.area;
  if (!a) return;
  $("#empty").hidden = true; $("#content").hidden = false;
  const meta = D.meta(), last = meta.months - 1;
  const total = a.H.reduce((s, v) => s + v, 0);
  const name = areaName(state.src), name2 = areaName(state.src2);
  $("#areaName").textContent = name + (state.area2 ? `  ·  ${name2}` : "");
  $("#areaMeta").textContent = t("areaMeta", { cells: a.cells.length, total: fmt(total), from: D.label(0), to: D.label(last) });

  const series = state.rec === "H" ? a.H : a.naive;
  const sea = D.seasons(Array.from(a.H));
  renderForecast(a, sea);
  renderVerdict(a, sea, total);

  V.rings("#rings", Array.from(series), { outlook: state.rec === "H" ? a.outlook : null, title: shortName(name), highlight: last });
  const two = !!state.area2;
  $("#rings2").hidden = !two;
  $("#ringsWrap").classList.toggle("pair", two);
  if (two) V.rings("#rings2", Array.from(state.rec === "H" ? state.area2.H : state.area2.naive),
    { outlook: state.rec === "H" ? state.area2.outlook : null, title: shortName(name2), highlight: last });
  V.legend("#ringLegend", Math.max(...series), "count");
  $("#recNote").innerHTML = state.rec === "H" ? t("ringsNoteH") : t("ringsNoteRaw");

  const cal = V.calendar("#calendar", Array.from(series), { mode: state.cal, highlight: last });
  V.legend("#calLegend", cal.max, state.cal);

  V.outlookChart("#outlook", a.outlook, monthStats(a).median);
  const fr = meta.forecast?.holdout?.lead_1;
  if (fr) {
    const sk = fr.skill_vs_best_baseline_deviance_pct, b = baselineName(fr.best_baseline_deviance);
    const s = sk >= 0 ? t("outlookBetter", { p: sk.toFixed(0), b }) : t("outlookNotBetter", { b });
    $("#outlookNote").innerHTML = `${t("outlookTested", { y: meta.forecast.test_year, s })} <button class="link" data-open="model">${t("modelCard")}</button>`;
  } else $("#outlookNote").textContent = t("outlookPlain");

  const tr = D.trend(sea.years.map((d) => ({ x: d.year, y: d.onset })));
  V.seasonChart("#season", sea, tr);
  $("#seasonNote").textContent = seasonText(sea, tr);

  V.record("#record", a);
  $("#recordNote").textContent = recordText(a);

  const peak = sea.clim.indexOf(Math.max(...sea.clim));
  const rec = D.recurring(a, peak);
  recurLayer?.remove();
  recurLayer = L.layerGroup(rec.filter((c) => c.share >= 0.75).map((c) => {
    const d = meta.cell_deg / 2;
    return L.rectangle([[c.lat - d, c.lon - d], [c.lat + d, c.lon + d]], { className: "recur", weight: 1, fillOpacity: 0.1 + 0.4 * c.share })
      .bindTooltip(t("recurTip", { month: t("monthsLong")[peak], p: (c.share * 100).toFixed(0) }));
  })).addTo(map);
  $("#recurNote").innerHTML = total < 30 ? t("recurFew")
    : t("recurText", { k: rec.filter((c) => c.share >= 0.75).length, n: rec.length, month: t("monthsLong")[peak] });

  V.weekdayChart("#weekday", a.wd);
  $("#weekNote").textContent = weekdayText(a.wd);

  const years = [...new Set(Array.from({ length: meta.months }, (_, mi) => D.ym(mi).year))];
  for (const id of ["#from", "#to"]) { const sel = $(id); if (!sel.options.length) years.forEach((y) => sel.add(new Option(y, y))); }
  if (!$("#from").dataset.set) { $("#from").value = years[0]; $("#to").value = years.at(-1); $("#from").dataset.set = 1; }
}

function baselineName(en) {
  if (lang() !== "ar") return en.toLowerCase();
  return { "Average of earlier years": "متوسط السنوات السابقة", "Median of earlier years": "وسيط السنوات السابقة",
    "Same month last year": "نفس الشهر من السنة الماضية", "This month repeats": "تكرار الشهر الحالي" }[en] || en;
}

function renderVerdict(a, sea, total) {
  const v = D.verdict(Array.from(a.H));
  const L = t("monthsLong"), mName = L[v.month], yr = D.ym(v.mi).year;
  const el = $("#verdict");
  if (total < 30) {
    el.className = "card verdict v-calm";
    el.innerHTML = `<p class="tag">${t("littleTag")}</p><h3>${t("littleTitle", { a: D.ym(0).year, b: yr })}</h3><p>${t("littleText")}</p>`;
    return;
  }
  const cmp = v.med > 0 ? (v.ratio >= 1 ? t("timesUsual", { x: v.ratio.toFixed(1), month: mName }) : t("pctUsual", { x: Math.round(v.ratio * 100), month: mName }))
    : t("usuallyNone", { month: mName });
  const outTotal = a.outlook.reduce((s, x) => s + x.m, 0);
  const pk = a.outlook.reduce((best, x, k) => (x.m > best.m ? { m: x.m, k } : best), { m: -1, k: 0 });
  const recent = sea.years.filter((d) => d.onset != null).slice(-10);
  const onset = D.median(recent.map((d) => d.onset));
  el.className = `card verdict v-${v.level}`;
  el.innerHTML = `
    <p class="tag">${t("latestMonth", { month: mName, year: yr })}</p>
    <h3>${t("verdictWords")[v.level]}</h3>
    <p class="big">${t("hotspotsDash", { n: fmt(v.cur), cmp })}</p>
    <p>${t("higherThan", { k: v.higher, n: v.years, month: mName })}${v.lastTime ? t("lastTime", { y: v.lastTime }) : v.cur > 0 && v.higher === v.years ? t("highest") : ""}</p>
    <p>${t("nextThree", { n: fmt(outTotal), peak: pk.m > 0 ? t("mostIn", { m: L[(v.month + 1 + pk.k) % 12] }) : "" })}</p>
    ${recent.length >= 3 ? `<p>${t("prevention", { start: D.dayToDate(onset, sea.start), a: D.dayToDate(Math.max(0, onset - 42), sea.start), b: D.dayToDate(Math.max(0, onset - 14), sea.start) })}</p>` : ""}`;
}

function seasonText(sea, tr) {
  const ys = sea.years.filter((d) => d.onset != null);
  if (ys.length < 8) return t("seasonFew");
  const early = ys.slice(0, 10), late = ys.slice(-10);
  const diff = D.median(late.map((d) => d.onset)) - D.median(early.map((d) => d.onset));
  const lenDiff = D.median(late.map((d) => d.length)) - D.median(early.map((d) => d.length));
  const span = `${early[0].year}–${early.at(-1).year}`;
  let s = Math.abs(diff) < 7 ? t("seasonSame", { span }) : t("seasonShift", { d: days(Math.round(Math.abs(diff))), dir: t(diff < 0 ? "earlier" : "later"), span });
  if (Math.abs(lenDiff) >= 10) s += t("seasonLen", { d: days(Math.round(Math.abs(lenDiff))), dir: t(lenDiff > 0 ? "longer" : "shorter") });
  if (tr) s += t("trendTxt", { v: `${tr.perDecade > 0 ? "+" : ""}${tr.perDecade.toFixed(0)}` });
  return s;
}

function recordText(a) {
  const meta = D.meta();
  const firstV = meta.source_by_month.findIndex((s) => s >= 2);
  if (firstV < 0) return t("recordOne");
  const avg = (arr, from, to) => { let s = 0, n = 0; for (let i = from; i < to; i++) { s += arr[i]; n++; } return n ? (s / n) * 12 : 0; };
  const span = 36;
  const jump = (arr) => { const b = avg(arr, Math.max(0, firstV - span), firstV), c = avg(arr, firstV, Math.min(meta.months, firstV + span)); return b ? (c / b - 1) * 100 : 0; };
  const sg = (x) => { const r = Math.round(x); return `${r > 0 ? "+" : ""}${r === 0 ? 0 : r}%`; };
  return t("recordJump", { r: sg(jump(a.naive)), h: sg(jump(a.H)) });
}

function weekdayText(wd) {
  const n = wd.reduce((s, v) => s + v, 0);
  if (n < 300) return t("weekFew");
  const exp = n / 7;
  const chi = wd.reduce((s, v) => s + (v - exp) ** 2 / exp, 0);
  const hi = wd.indexOf(Math.max(...wd));
  const pct = (wd[hi] / exp - 1) * 100;
  // With millions of detections any wobble is "significant", and fires burn for days, so
  // detections are not independent. Only a large, clear excess counts as a weekly rhythm.
  if (chi < 16.8 || pct < 15) return t("weekNone");
  return t("weekYes", { p: pct.toFixed(0), day: t("days")[hi] });
}

// ---------------------------------------------------------------- dialogs
function openSheet(id) {
  const meta = D.meta(), d = $(`#${id}`);
  d.innerHTML = id === "about" ? aboutHTML(meta) : modelHTML(meta);
  d.showModal();
  d.querySelector(".close")?.addEventListener("click", () => d.close());
}
const pct = (x) => (x == null ? "–" : `${(x * 100).toFixed(0)}%`);
const num = (x, d = 2) => (x == null ? "–" : x.toFixed(d));

function validationTable(h) {
  const val = h.validation?.tile_month;
  if (!val) return `<p class='muted'>${lang() === "ar" ? "يظهر الاختبار بعد معالجة بيانات VIIRS." : "Validation appears once VIIRS data is processed."}</p>`;
  const ar = lang() === "ar";
  const row = (name, r) => `<tr><td>${name}</td><td>${num(r.r2_log)}</td><td>${num(r.bias_pct, 1)}%</td></tr>`;
  return `<table><tr><th>${ar ? "اختبار على مستوى المنطقة والشهر" : "Region-month test"}</th><th>R² (log)</th><th>${ar ? "الانحياز" : "Bias"}</th></tr>
    ${row(ar ? "MODIS ← تفاصيل VIIRS (استرجاع الماضي)" : "MODIS → VIIRS detail (back-cast)", val.backcast_modis_to_viirs)}
    ${row(ar ? "VIIRS ← بعين MODIS (الجسر)" : "VIIRS → MODIS eyes (bridge)", val.bridge_viirs_to_modis)}
    ${row(ar ? "مقارنة: نسبة عالمية واحدة" : "Baseline: one global ratio", val.baseline_single_global_ratio)}
    ${row(ar ? "مقارنة: VIIRS الخام كأنه MODIS" : "Baseline: raw VIIRS used as MODIS", val.baseline_raw_viirs_as_modis)}</table>`;
}

function aboutHTML(meta) {
  const h = meta.harmonize || {}, tr = h.validation?.train_years || [], te = h.validation?.test_years || [];
  const span = `${D.label(0)} – ${D.label(meta.months - 1)}`;
  if (lang() === "ar") return `<button class="close" aria-label="إغلاق">×</button>
  <h2>كيف تعمل حلقات النار</h2>
  <p class="lead">الأقمار الصناعية تراقب حرائق الأرض منذ 2000، لكن السجل كتبته كاميرات مختلفة. MODIS (على Terra منذ 2000 وAqua منذ 2002) يرى الحرائق بدقة 1 كم. وVIIRS (على Suomi NPP منذ 2012 وNOAA-20 منذ 2018 وNOAA-21 منذ 2023) يرى بدقة 375 م ويلتقط حرائق أصغر بكثير. إذا وُضعا جنباً إلى جنب يبدو أن الحرائق انفجرت بعد 2012، لكن الأرض لم تتغير، الكاميرا هي التي تغيرت. وMODIS في نهاية عمره، وتوقف تسليم بيانات Suomi NPP في نوفمبر 2026، فبدون جسر لا يمكن مقارنة 25 سنة من التاريخ بالمستقبل.</p>
  <h3>١ · التنظيف</h3>
  <p>نُبقي الرصدات ذات الثقة المتوسطة والعالية فقط. ونحذف شعلات الغاز والمصانع والبراكين، سواء التي تحددها ناسا أو التي تصنّفها خطأً كنبات: أي بقعة بحجم ~1 كم تبقى ساخنة 4 أشهر أو أكثر في السنة، لمدة 3 سنوات أو أكثر، تُعامل كمصدر حرارة دائم.</p>
  <h3>٢ · جعل كل السنوات قابلة للمقارنة</h3>
  <ul>
    <li><b>MODIS يكسب قمراً ثانياً في 2002.</b> أشهر Terra وحده تُعدَّل بنسبة (Terra+Aqua)/Terra المتعلَّمة من السنوات اللاحقة.</li>
    <li><b>VIIRS يطير على قمر إلى ثلاثة أقمار.</b> نأخذ متوسط كل قمر، فالقمر الجديد ليس اتجاهاً جديداً.</li>
    <li><b>VIIRS يرى حرائق أصغر.</b> جسران يُدرَّبان على السنوات التي يعمل فيها الحسّاسان معاً. <i>فيزيائي:</i> نجمع بكسلات VIIRS في مربعات 1 كم لكل مرور، ونحذف الأضعف مما يستطيع MODIS رؤيته (أفضل حد: ${h.frp_threshold_mw ?? "–"} ميغاواط). <i>إحصائي:</i> نسبة لكل منطقة 5° ولكل شهر، تُسحب نحو قيمة المنطقة الأكبر حين تقل الحرائق.</li>
  </ul>
  <p>السجل معروض بتفاصيل VIIRS: أعداد VIIRS الحقيقية حيث يوجد، وMODIS محوَّلاً لتفاصيل VIIRS قبل ذلك، مع ظل لهامش الثقة. ${h.small_fire_share != null ? `نحو <b>${pct(h.small_fire_share)}</b> من رصدات VIIRS حرائق أصغر من أن يراها MODIS.` : ""}</p>
  <h3>٣ · الإثبات</h3>
  <p>نتظاهر أن MODIS توقف مبكراً: نُدرّب الجسرين على ${tr[0] ?? ""}–${tr.at(-1) ?? ""} فقط، ثم نعيد بناء ${te.join("، ")} دون أن نراها.</p>
  ${validationTable(h)}
  <h3>٤ · القراءة</h3>
  <p>التقويم يقارن كل شهر بوسيط نفس الشهر في السنوات السابقة. بداية الموسم هي اليوم الذي تحدث فيه 10% من حرائق السنة، والسنة تبدأ من أهدأ شهر في المنطقة، حتى لا تنقسم المواسم التي تعبر رأس السنة.</p>
  <h3>ما لا ندّعيه</h3>
  <p>لا نتنبأ بمكان أو لحظة اشتعال حريق معين، فأغلب الحرائق يشعلها الإنسان. نحن نتنبأ <i>بالفترات الحرجة</i>: متى يأتي موسم الخطر، وهل هذه السنة غير عادية.</p>
  <p class="small muted">البيانات: ناسا FIRMS (MODIS الإصدار 6.1، وVIIRS بدقة 375 م). السجل: ${span}.</p>`;
  return `<button class="close" aria-label="Close">×</button>
  <h2>How Fire Rings works</h2>
  <p class="lead">Satellites have watched Earth's fires since 2000, but the record was written by different cameras. MODIS (Terra 2000, Aqua 2002) sees fires at 1 km. VIIRS (Suomi NPP 2012, NOAA-20 2018, NOAA-21 2023) sees at 375 m and catches far smaller fires. Put side by side, the record seems to explode after 2012 — but the Earth did not change, the camera did. MODIS is near the end of its life and Suomi NPP stopped delivering data in November 2026, so without a bridge, 25 years of history cannot be compared with the future.</p>
  <h3>1 · Clean</h3>
  <p>Only nominal and high confidence detections are kept. Gas flares, factories and volcanoes are removed — both those NASA marks and those it labels as vegetation: any ~1 km spot that is hot in 4+ months of a year, in 3+ years, is treated as a permanent heat source.</p>
  <h3>2 · Make every year comparable</h3>
  <ul>
    <li><b>MODIS gains a second satellite in 2002.</b> Terra-only months are scaled by the Terra+Aqua/Terra ratio learned from later years.</li>
    <li><b>VIIRS flies on one to three satellites.</b> VIIRS counts are averaged per satellite, so a new satellite is not a new trend.</li>
    <li><b>VIIRS sees smaller fires.</b> Two bridges are fitted on the years both sensors fly. <i>Physical:</i> VIIRS pixels are merged into 1 km bins per overpass and bins weaker than MODIS can detect are dropped (best cut: ${h.frp_threshold_mw ?? "–"} MW). <i>Statistical:</i> a ratio per 5° region and calendar month, pulled toward the regional value when fires are few.</li>
  </ul>
  <p>The record is shown in VIIRS detail: real VIIRS counts where VIIRS exists, MODIS scaled to VIIRS detail before that, with an uncertainty band from resampling years. ${h.small_fire_share != null ? `About <b>${pct(h.small_fire_share)}</b> of VIIRS detections are fires too small for MODIS.` : ""}</p>
  <h3>3 · Prove it</h3>
  <p>We pretend MODIS retired early: the bridges are fitted on ${tr[0] ?? ""}–${tr.at(-1) ?? ""} only, then rebuild ${te.join(", ")} without peeking.</p>
  ${validationTable(h)}
  <h3>4 · Read it</h3>
  <p>The calendar compares each month with the median of the same month in earlier years. Season start is the day 10% of a fire year's hotspots have occurred; the fire year starts at the area's quietest month, so tropical seasons that cross New Year stay whole.</p>
  <h3>What we do not claim</h3>
  <p>We do not predict where or when a single fire will ignite — most fires are lit by people. We forecast <i>critical periods</i>: when the risk season comes and whether this year is unusual.</p>
  <p class="small muted">Data: NASA FIRMS (MODIS C6.1, VIIRS 375 m). Record: ${span}.</p>`;
}

function modelHTML(meta) {
  const f = meta.forecast || {}, h = f.holdout, ar = lang() === "ar";
  const rows = h ? [1, 2, 3].map((L) => {
    const r = h[`lead_${L}`];
    return `<tr><td>${L}</td><td><b>${num(r.ml.poisson_deviance)}</b></td><td>${num(r.climatology.poisson_deviance)}</td><td>${num(r.climatology_median?.poisson_deviance)}</td><td>${num(r.last_year.poisson_deviance)}</td><td>${num(r.persistence.poisson_deviance)}</td><td>${num(r.ml.auc)}</td><td>${num(r.brier_skill_vs_climatology)}</td><td>${pct(r.range_coverage_80)}</td></tr>`;
  }).join("") : "";
  const head = ar
    ? "<tr><th>أشهر للأمام</th><th>النموذج</th><th>متوسط الماضي</th><th>وسيط الماضي</th><th>السنة الماضية</th><th>تكرار الشهر</th><th>AUC</th><th>مهارة Brier</th><th>إصابة مدى 80%</th></tr>"
    : "<tr><th>Months ahead</th><th>ML</th><th>Past average</th><th>Past median</th><th>Last year</th><th>This month repeats</th><th>AUC</th><th>Brier skill</th><th>80% range hit</th></tr>";
  const imp = h?.feature_importance ? `<h3>${ar ? "أكثر الإشارات فائدة" : "Most useful signals"}</h3><ol>${h.feature_importance.slice(0, 6).map((x) => `<li dir="ltr">${x.feature.replaceAll("_", " ")}</li>`).join("")}</ol>` : "";
  if (ar) return `<button class="close" aria-label="إغلاق">×</button>
  <h2>بطاقة النموذج · توقع الحرائق</h2>
  <p class="lead">أشجار قرار معززة (HistGradientBoosting من scikit-learn) تتنبأ لكل خلية نشطة بحجم 25 كم، قبل شهر إلى ثلاثة أشهر: بالعدد المتوقع لنقاط الحرائق الموحَّدة (خسارة بواسون)، وبمدى محتمل (نموذجا الكمّيتين 10% و90%)، وباحتمال حدوث أي حريق (مصنِّف).</p>
  <h3>على ماذا يعتمد</h3>
  <p>فقط على ما هو معروف يوم إصدار التوقع: تاريخ الخلية لنفس الشهر في السنوات السابقة، وآخر ثلاثة أشهر، ومدى غرابة السنة حتى الآن، والخلايا المجاورة، ومؤشر النينيو إن توفر. ${f.enso ? "مؤشر النينيو مُضمَّن." : "مؤشر النينيو غير مُضمَّن في هذه النسخة."}</p>
  <h3>اختبار أعمى على ${f.test_year ?? "آخر سنة كاملة"}</h3>
  ${h ? `<p>النموذج لم يرَ سنة ${f.test_year} أبداً. الخطأ هو انحراف بواسون لكل خلية وشهر، وهو المقياس المعتاد للأعداد (الأقل أفضل).</p><table>${head}${rows}</table>
  <p class="small muted">مهارة Brier تقارن احتمالات حريق/لا حريق بالتكرار التاريخي (فوق 0 = أفضل). والمدى المضبوط بنسبة 80% يجب أن يحتوي النتيجة نحو 80% من المرات.</p>${imp}` : "<p class='muted'>يعمل الاختبار الأعمى بعد معالجة سنوات كافية.</p>"}
  <h3>الحدود</h3>
  <p>توقعات المنطقة هي مجموع توقعات الخلايا، والمدى المعروض للمنطقة هو مجموع مديات الخلايا فهو واسع. النموذج يتعلم من الماضي ولا يعرف مصدر اشتعال جديداً أو تغييراً مفاجئاً في السياسات.</p>`;
  return `<button class="close" aria-label="Close">×</button>
  <h2>Model card · fire outlook</h2>
  <p class="lead">Gradient-boosted trees (scikit-learn HistGradientBoosting) predict, for every active 25 km cell and 1–3 months ahead: the expected number of harmonized hotspots (Poisson loss), a likely range (10% and 90% quantile models), and the chance of any fire (classifier).</p>
  <h3>What it looks at</h3>
  <p>Only information available on the day the outlook is issued: the cell's history for the target month in earlier years, the last three months, how unusual the year has been so far, neighbouring cells, and the El Niño index when available. ${f.enso ? "ENSO is included." : "ENSO is not included in this build."}</p>
  <h3>Blind test on ${f.test_year ?? "the last full year"}</h3>
  ${h ? `<p>The model never saw ${f.test_year}. Error is the Poisson deviance per cell and month, the standard score for counts (lower is better).</p><table>${head}${rows}</table>
  <p class="small muted">Brier skill compares fire / no-fire probabilities with the historical frequency (above 0 = better). A well-calibrated 80% range should contain the outcome about 80% of the time.</p>${imp}`
    : "<p class='muted'>The blind test runs once enough years are processed.</p>"}
  <h3>Limits</h3>
  <p>Area outlooks add up cell forecasts; the range shown for an area adds up cell ranges and is therefore generous. The model learns from the past and cannot know about a new ignition source or an unusual policy change.</p>`;
}

// ---------------------------------------------------------------- downloads
function download(name, text, type = "text/csv") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, "-").replace(/^-|-$/g, "") || "area";
const fileName = () => (state.src?.preset != null ? PRESETS[state.src.preset].id : slug(areaName(state.src)));

function monthRange() {
  const from = +$("#from").value, to = +$("#to").value;
  let a = 0, b = D.meta().months - 1;
  for (let mi = 0; mi < D.meta().months; mi++) { const y = D.ym(mi).year; if (y < from) a = mi + 1; if (y <= to) b = mi; }
  return [a, b];
}

function ringsPNG() {
  const svg = $("#rings svg");
  const clone = svg.cloneNode(true);
  const css = getComputedStyle(document.documentElement);
  clone.querySelectorAll("[fill='var(--empty)']").forEach((n) => n.setAttribute("fill", css.getPropertyValue("--empty").trim()));
  clone.querySelectorAll("text").forEach((tx) => { tx.setAttribute("fill", "#e9e4dc"); tx.setAttribute("font-family", "Inter, 'IBM Plex Sans Arabic', sans-serif"); tx.setAttribute("font-size", tx.classList.contains("ring-centre") ? "16" : "11"); });
  const vb = svg.viewBox.baseVal, scale = 3;
  const canvas = Object.assign(document.createElement("canvas"), { width: vb.width * scale, height: (vb.height + 40) * scale });
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#14110f"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0, vb.width * scale, vb.height * scale);
    ctx.fillStyle = "#e9e4dc"; ctx.font = `${12 * scale}px Inter, 'IBM Plex Sans Arabic', sans-serif`;
    ctx.direction = document.documentElement.dir;
    ctx.textAlign = ctx.direction === "rtl" ? "right" : "left";
    ctx.fillText(`${t("title")} · ${areaName(state.src)} · NASA FIRMS MODIS + VIIRS`, ctx.direction === "rtl" ? canvas.width - 12 * scale : 12 * scale, (vb.height + 24) * scale);
    canvas.toBlob((b) => { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `fire-rings-${fileName()}.png`; a.click(); });
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(clone));
}

// ---------------------------------------------------------------- start
function fillPresets() {
  const sel = $("#preset"), cur = sel.value;
  sel.innerHTML = "";
  sel.add(new Option(t("choosePlace"), ""));
  t("presets").forEach((name, i) => sel.add(new Option(name, i)));
  sel.value = cur;
}

function applyLanguage() {
  applyStatic();
  fillPresets();
  if (!state.area) $("#hint").textContent = t("mapHint");
  render();
  const open = document.querySelector("dialog[open]");
  if (open) openSheet(open.id);
}

async function start() {
  applyStatic();
  await D.loadMeta();
  const overview = await D.loadOverview();
  initMap(overview);
  fillPresets();
  const sel = $("#preset");
  sel.onchange = () => { if (sel.value !== "") { const i = +sel.value; choose({ preset: i, b: PRESETS[i].b }); } };

  $("#go").onclick = () => {
    const lat = +$("#lat").value, lon = +$("#lon").value, km = +$("#rad").value || 50;
    if (!$("#lat").value || !$("#lon").value || Math.abs(lat) > 90 || Math.abs(lon) > 180) { $("#hint").textContent = t("badCoords"); return; }
    const dLat = km / 111, dLon = km / (111 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
    choose({ point: { lat, lon, km }, b: { south: lat - dLat, north: lat + dLat, west: lon - dLon, east: lon + dLon } });
  };
  $("#compare").onclick = () => {
    if (!state.area) { $("#hint").textContent = t("compareFirst"); return; }
    state.compareNext = true; $("#compare").classList.add("on"); $("#hint").textContent = t("compareNow");
  };
  $("#lang").onclick = () => { setLang(lang() === "ar" ? "en" : "ar"); applyLanguage(); };
  document.querySelectorAll("[data-rec]").forEach((b) => b.onclick = () => {
    state.rec = b.dataset.rec; document.querySelectorAll("[data-rec]").forEach((x) => x.classList.toggle("on", x === b)); render();
  });
  document.querySelectorAll("[data-cal]").forEach((b) => b.onclick = () => {
    state.cal = b.dataset.cal; document.querySelectorAll("[data-cal]").forEach((x) => x.classList.toggle("on", x === b)); render();
  });
  document.addEventListener("click", (e) => { const tg = e.target.closest("[data-open]"); if (tg) openSheet(tg.dataset.open); });
  $("#dlMonthly").onclick = () => download(`fire-rings-${fileName()}-monthly.csv`, D.toCSV(state.area, areaName(state.src)));
  $("#dlCells").onclick = () => { const [a, b] = monthRange(); download(`fire-rings-${fileName()}-cells.csv`, D.cellsCSV(state.area, a, b)); };
  $("#dlRings").onclick = ringsPNG;

  const p = PRESETS.findIndex((x) => x.id === new URLSearchParams(location.search).get("area"));
  if (p >= 0) { sel.value = p; choose({ preset: p, b: PRESETS[p].b }); }
}

start().catch((e) => { console.error(e); $("#hint").textContent = t("loadFail"); });
