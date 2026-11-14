// Fire Calendar — page logic: one question, one answer, details on demand.
import * as D from "./data.js";
import * as V from "./charts.js";
import { t, lang, setLang, applyStatic } from "./i18n.js";
import { aboutHTML, modelHTML } from "./dialogs.js";

const $ = (s) => document.querySelector(s);
const fmt = (v) => Math.round(v).toLocaleString("en-US");
const SAUDI = 8;                       // the first 8 regions are in Saudi Arabia

const state = { area: null, src: null, cal: "count", tab: "history" };
let REGIONS = [];
let map, boxLayer, recurLayer, density;

// ---------------------------------------------------------------- names and small helpers
function areaName(src) {
  if (!src) return "";
  if (src.region) return t("regions")[src.region] || src.region;
  if (src.point) return `${src.point.lat.toFixed(2)}°, ${src.point.lon.toFixed(2)}° (±${src.point.km} km)`;
  const b = src.b;
  return t("areaBox", { s: b.south.toFixed(1), n: b.north.toFixed(1), w: b.west.toFixed(1), e: b.east.toFixed(1) });
}
const shortName = (n) => n.split(/[,،(]/)[0].trim();
const days = (n) => (lang() === "ar" ? (n >= 3 && n <= 10 ? `${n} أيام` : `${n} يوماً`) : `${n} day${n === 1 ? "" : "s"}`);

function monthStats(H) {
  const byMonth = Array.from({ length: 12 }, () => []);
  for (let mi = 0; mi < H.length; mi++) byMonth[D.ym(mi).month].push(H[mi]);
  return { median: byMonth.map((v) => D.median(v)), all: Array.from(H) };
}

// 0..4 from where a monthly count sits among all months of the area's record
function levelOf(value, allMonths) {
  if (value < 0.5) return 0;
  const below = allMonths.filter((v) => v < value).length / Math.max(allMonths.length, 1);
  return below < 0.4 ? 0 : below < 0.7 ? 1 : below < 0.9 ? 2 : below < 0.97 ? 3 : 4;
}

// Where the next month falls in the area's usual fire year
function seasonState(sea, firstMonth) {
  const recent = sea.years.filter((d) => d.onset != null).slice(-10);
  if (recent.length < 3) return null;
  const onset = D.median(recent.map((d) => d.onset)), end = D.median(recent.map((d) => d.end));
  const d0 = ((firstMonth - sea.start + 12) % 12) * 30.44;
  if (d0 < onset) return { kind: "before", days: Math.round(onset - d0), onset, end };
  if (d0 <= end) return { kind: "during", onset, end };
  return { kind: "after", days: Math.round(onset + 365 - d0), onset, end };
}

function nextMonths(H, outlook) {
  const last = D.ym(D.meta().months - 1), st = monthStats(H);
  return outlook.map((m, k) => {
    const mo = (last.month + 1 + k) % 12;
    // a handful of fires (under 10) is never "high", whatever the area's history
    const lvl = m < 10 ? Math.min(levelOf(m, st.all), 1) : levelOf(m, st.all);
    return { m: mo, year: last.year + Math.floor((last.month + 1 + k) / 12), exp: m, usual: st.median[mo], lvl };
  });
}

const FLAME = "M12 2c.8 3.6 5.6 5.7 5.6 11.4A5.6 5.6 0 0 1 6.4 13.4c0-2.9 1.6-4.6 2.6-6.2.2 1.9 1 3 2.1 3.3-.3-3 .1-5.6.9-8.5z";
const flame = (cls = "") => `<svg viewBox="0 0 24 24" class="flame ${cls}" aria-hidden="true"><path d="${FLAME}"/></svg>`;
const meter = (lvl) => `<span class="meter" aria-label="${t("levels")[lvl]}">${[0, 1, 2, 3, 4].map((i) => flame(i <= lvl ? "on" : "off")).join("")}</span>`;

// ---------------------------------------------------------------- the map
function initMap(overview) {
  map = L.map("map", { worldCopyJump: true, minZoom: 2, scrollWheelZoom: false }).setView([20, 30], 2);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
    attribution: "Basemap &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors", maxZoom: 10,
  }).addTo(map);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 10, pane: "shadowPane",
  }).addTo(map);
  const top = D.quantile(overview.total, 0.995);
  const densityColor = V.colorScale(top);
  const whenColor = (m) => V.d3.interpolateSinebow((m + 0.5) / 12);
  const weight = (v) => Math.min(1, Math.log(Math.max(v, 1)) / Math.log(Math.max(top, 2)));
  const Density = L.Layer.extend({
    onAdd(m) {
      this._c = L.DomUtil.create("canvas", "density");
      m.getPanes().overlayPane.appendChild(this._c);
      m.on("moveend zoomend resize", this._project, this);
      this._project();
    },
    onRemove(m) { this._c.remove(); m.off("moveend zoomend resize", this._project, this); },
    _project() {
      const size = map.getSize(), deg = D.meta().cell_deg;
      L.DomUtil.setPosition(this._c, map.containerPointToLayerPoint([0, 0]));
      this._c.width = size.x * devicePixelRatio; this._c.height = size.y * devicePixelRatio;
      this._c.style.width = `${size.x}px`; this._c.style.height = `${size.y}px`;
      this._rects = [];
      overview.cells.forEach((cell, i) => {
        const p = D.cellCenter(cell);
        const a = map.latLngToContainerPoint([p.lat + deg / 2, p.lon - deg / 2]);
        const b = map.latLngToContainerPoint([p.lat - deg / 2, p.lon + deg / 2]);
        if (b.x < 0 || a.x > size.x || b.y < 0 || a.y > size.y) return;
        this._rects.push([a.x, a.y, Math.max(1, b.x - a.x), Math.max(1, b.y - a.y), i]);
      });
      this.paint();
    },
    paint() {
      const ctx = this._c.getContext("2d");
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      ctx.clearRect(0, 0, this._c.width, this._c.height);
      const wave = mapState.waveMonth;
      for (const [x, y, w, h, i] of this._rects) {
        if (mapState.mode === "amount") { ctx.globalAlpha = 0.9; ctx.fillStyle = densityColor(overview.total[i]); }
        else {
          const pk = overview.peak[i];
          ctx.fillStyle = whenColor(pk);
          const base = 0.3 + 0.7 * weight(overview.total[i]);
          ctx.globalAlpha = wave == null ? base : pk === wave ? 1 : 0.06;
        }
        ctx.fillRect(x, y, w, h);
      }
      ctx.globalAlpha = 1;
    },
  });
  density = new Density().addTo(map);
  fillWhenLegend();
  enableDrawing();
}

function fillWhenLegend() {
  $("#whenLegend").innerHTML = t("monthsLong").map((_, m) =>
    `<span><i style="background:${V.d3.interpolateSinebow((m + 0.5) / 12)}"></i>${t("months")[m]}</span>`).join("");
}

const mapState = { mode: "amount", waveMonth: null, timer: null };
function setMapMode(mode) {
  mapState.mode = mode;
  document.querySelectorAll("[data-map]").forEach((b) => b.classList.toggle("on", b.dataset.map === mode));
  $("#whenLegend").hidden = mode !== "when";
  $("#hint").textContent = t(mode === "when" ? "mapHintWhen" : "mapHint");
  density?.paint();
}
function toggleWave() {
  if (mapState.timer) { stopWave(); return; }
  setMapMode("when");
  map.setView([12, 20], 2);
  $("#wave").textContent = t("waveStop");
  $("#mapMonth").hidden = false;
  let m = 0;
  const step = () => { mapState.waveMonth = m; $("#mapMonth").textContent = t("monthsLong")[m]; density.paint(); m = (m + 1) % 12; };
  step();
  mapState.timer = setInterval(step, 900);
}
function stopWave() {
  clearInterval(mapState.timer); mapState.timer = null; mapState.waveMonth = null;
  $("#wave").textContent = t("waveBtn");
  $("#mapMonth").hidden = true;
  density?.paint();
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
    choose({ b: { south: bb.getSouth(), north: bb.getNorth(), west: bb.getWest(), east: bb.getEast() } });
  });
}

function showBox(b) {
  boxLayer?.remove();
  boxLayer = L.rectangle([[b.south, b.west], [b.north, b.east]], { className: "aoi" }).addTo(map);
}

// ---------------------------------------------------------------- choose an area
async function choose(src, { scroll = true } = {}) {
  showBox(src.b);
  $("#answer").hidden = false;
  $("#areaName").textContent = areaName(src);
  $("#areaMeta").textContent = t("loading");
  if (scroll) $("#answer").scrollIntoView({ behavior: "smooth", block: "start" });
  const area = await D.selectArea(src.b);
  state.area = area; state.src = src;
  if (src.region) $("#preset").value = src.region;
  render();
}

// ---------------------------------------------------------------- the answer
function render() {
  const a = state.area;
  if (!a) return;
  const meta = D.meta(), last = meta.months - 1;
  const total = a.H.reduce((s, v) => s + v, 0);
  const name = areaName(state.src);
  $("#areaName").textContent = name;
  $("#areaMeta").textContent = t("areaMeta", { cells: a.cells.length, from: D.ym(0).year });
  const sea = D.seasons(Array.from(a.H));
  renderForecast(a, sea, name);
  renderVerdict(a, sea, total);
  renderHistory(a, sea, total, name);
  renderTrust(a);
  renderExpert(a, sea, total);
}

function renderForecast(a, sea, name) {
  const last = D.ym(D.meta().months - 1);
  const months = nextMonths(a.H, a.outlook.map((o) => o.m)).map((d, k) => ({ ...d, chance: 1 - a.outlook[k].pNone }));
  const now = months[0];
  const ss = seasonState(sea, now.m);
  let season = "";
  if (ss?.kind === "before") season = `${t("seasonIn", { d: days(ss.days) })} · ${t("prepareBy", { date: D.dayToDate(Math.max(0, ss.onset - 14), sea.start) })}`;
  else if (ss?.kind === "during") season = t("seasonOn", { date: D.dayToDate(ss.end, sea.start) });
  else if (ss?.kind === "after" && now.exp > 2 * Math.max(now.usual, 1) && now.lvl >= 2) season = t("seasonLate");
  else if (ss?.kind === "after") season = t("seasonOff", { date: D.dayToDate(ss.onset, sea.start) });
  const L = t("monthsLong"), S = t("months");
  const card = $("#forecastCard");
  card.className = `wx lvl${now.lvl}`;
  card.innerHTML = `
    <div class="wx-top">
      <div>
        <p class="wx-place">${shortName(name)}</p>
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
        <span class="wx-dname">${S[d.m]}</span>${meter(d.lvl)}
        <span class="wx-dnum">${fmt(d.exp)}</span>
        <span class="wx-dchance">${d.chance > 0.99 ? t("chanceOver99") : `${Math.round(d.chance * 100)}% ${t("chance")}`}</span>
      </div>`).join("")}
    </div>`;
  $("#saveCard").onclick = saveCard;
}

function renderVerdict(a, sea, total) {
  const el = $("#verdict");
  if (total < 30) {
    el.className = "card verdict v-calm";
    el.innerHTML = `<h3>${t("littleTitle")}</h3><p>${t("littleText")}</p>`;
    return;
  }
  const v = D.verdict(Array.from(a.H));
  const L = t("monthsLong"), mName = L[v.month], yr = D.ym(v.mi).year;
  const cmp = v.med > 0 ? (v.ratio >= 1 ? t("timesUsual", { x: v.ratio.toFixed(1), month: mName }) : t("pctUsual", { x: Math.round(v.ratio * 100), month: mName }))
    : t("usuallyNone", { month: mName });
  const rank = t("rankHigher", { k: v.higher, n: v.years }) + (v.lastTime ? t("lastTime", { y: v.lastTime }) : v.cur > 0 && v.higher === v.years ? t("highest") : "");
  const recent = sea.years.filter((d) => d.onset != null).slice(-10);
  const onset = D.median(recent.map((d) => d.onset));
  el.className = `card verdict v-${v.level}`;
  el.innerHTML = `
    <span class="badge b-${v.level}">${t("verdictWords")[v.level]}</span>
    <p class="verdict-line">${t("verdictLine", { month: mName, year: yr, n: fmt(v.cur), cmp, rank })}</p>
    ${recent.length >= 3 ? `<p class="prevent">🛡️ ${t("prevention", { a: D.dayToDate(Math.max(0, onset - 42), sea.start), b: D.dayToDate(Math.max(0, onset - 14), sea.start) })}</p>` : ""}`;
}

function renderHistory(a, sea, total, name) {
  const last = D.meta().months - 1;
  V.rings("#rings", Array.from(a.H), { outlook: a.outlook, title: shortName(name), highlight: last, ref: a.H });
  V.legend("#ringLegend", V.rankScale(a.H).ticks, "count");
  const hi = sea.clim.indexOf(Math.max(...sea.clim)), lo = sea.clim.indexOf(Math.min(...sea.clim));
  $("#ringsMeans").innerHTML = total < 30 ? t("ringsMeansFew") : t("ringsMeans", { area: shortName(name), hi: t("monthsLong")[hi], lo: t("monthsLong")[lo] });
  V.outlookChart("#outlook", a.outlook, monthStats(a.H).median);
  const fr = D.meta().forecast?.holdout?.lead_1;
  if (fr) {
    const sk = fr.skill_vs_best_baseline_deviance_pct;
    const s = sk >= 0 ? t("outlookBetter", { p: sk.toFixed(0) }) : t("outlookNotBetter");
    $("#outlookNote").innerHTML = `${t("outlookTested", { y: D.meta().forecast.test_year, s })} <button class="linklike" data-open="model">${t("modelCard")}</button>`;
  } else $("#outlookNote").textContent = t("outlookPlain");
  const tr = D.trend(sea.years.map((d) => ({ x: d.year, y: d.onset })));
  V.seasonChart("#season", sea, tr);
  $("#seasonNote").textContent = seasonText(sea, tr);
  const cal = V.calendar("#calendar", Array.from(a.H), { mode: state.cal, highlight: last, ref: a.H });
  V.legend("#calLegend", cal.ticks, state.cal);
}

function renderTrust(a) {
  $("#glasses").innerHTML = t("glasses").map((g) => `<li>${g}</li>`).join("");
  V.beforeAfter("#areaBA", { raw: Array.from(a.naive), harm: Array.from(a.H), ref: a.H, outlook: a.outlook,
    title: shortName(areaName(state.src)), highlight: D.meta().months - 1, size: 420 });
  V.record("#record", a);
  $("#recordNote").textContent = recordText(a);
}

function renderExpert(a, sea, total) {
  const meta = D.meta();
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
  const jump = (arr) => { const b = avg(arr, Math.max(0, firstV - 36), firstV), c = avg(arr, firstV, Math.min(meta.months, firstV + 36)); return b ? (c / b - 1) * 100 : 0; };
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
  // large samples make tiny wobbles "significant"; only a clear excess counts
  if (chi < 16.8 || pct < 15) return t("weekNone");
  return t("weekYes", { p: pct.toFixed(0), day: t("days")[hi] });
}

// ---------------------------------------------------------------- readiness list
function renderReady() {
  const last = D.ym(D.meta().months - 1);
  const rows = REGIONS.map((r, i) => {
    const nm = nextMonths(r.H, r.out || [0, 0, 0])[0];
    const sea = D.seasons(r.H);
    const ss = seasonState(sea, nm.m);
    const ratio = nm.exp / Math.max(nm.usual, 1);
    let season = "–";
    if (ss?.kind === "before") season = t("seasonShortBefore", { d: days(ss.days) });
    else if (ss?.kind === "during") season = t("seasonShortOn");
    else if (ss?.kind === "after") season = nm.lvl >= 2 && ratio > 2 ? t("seasonShortLate") : t("seasonShortOff");
    return { ...r, i, nm, ratio, season };
  });
  const order = (list) => list.sort((p, q) => q.nm.lvl - p.nm.lvl || q.ratio - p.ratio);
  const L = t("monthsLong");
  const table = (title, list) => `
    <div class="ready-group">
      <h3>${title}</h3>
      <div class="ready-head">${t("readyCols").map((c) => `<span>${c}</span>`).join("")}<span></span></div>
      ${order(list).map((r, k) => `
        <div class="ready-row lvl${r.nm.lvl}">
          <span class="ready-name"><b class="rank">${k + 1}</b>${t("regions")[r.id]}</span>
          <span>${meter(r.nm.lvl)} <small>${t("levels")[r.nm.lvl]}</small></span>
          <span class="numcell">${fmt(r.nm.exp)}${r.ratio >= 1.5 && r.nm.exp >= 3 ? ` <em class="up">×${r.ratio.toFixed(1)}</em>` : ""}</span>
          <span class="numcell muted">${fmt(r.nm.usual)}</span>
          <span class="muted">${r.season}</span>
          <span><button class="btn btn-outline btn-sm" data-region="${r.id}">${t("readyOpen")}</button></span>
        </div>`).join("")}
    </div>`;
  const when = `${L[(last.month + 1) % 12]} ${last.year + (last.month === 11 ? 1 : 0)}`;
  // the three areas that need attention first, as large cards
  const top = order([...rows]).slice(0, 3);
  $("#top3").innerHTML = `<h3>${t("top3Title")} · <span class="muted">${when}</span></h3><div class="top3-grid">${top.map((r, k) => `
    <article class="top-card lvl${r.nm.lvl}">
      <div class="top-head"><b class="rank">${k + 1}</b><span class="badge b-lvl">${t("levels")[r.nm.lvl]}</span></div>
      <h4>${t("regions")[r.id]}</h4>
      <p class="top-num"><b>${fmt(r.nm.exp)}</b> <span>${t("expectedWord")}</span></p>
      <p class="muted small">${t("usualWord")}: ${fmt(r.nm.usual)} · ${r.season}</p>
      <button class="btn btn-primary btn-sm" data-region="${r.id}">${t("readyOpen")}</button>
    </article>`).join("")}</div>`;
  $("#readyList").innerHTML = table(t("groupSaudi"), rows.slice(0, SAUDI)) + table(t("groupWorld"), rows.slice(SAUDI));
  document.querySelectorAll("[data-region]").forEach((b) => b.onclick = () => openRegion(b.dataset.region));
}

function openRegion(id, opts) {
  const r = REGIONS.find((x) => x.id === id);
  if (r) choose({ region: id, b: r.b }, opts);
}

// ---------------------------------------------------------------- trust section (whole Earth)
const EVENTS = { 2000: "ev2000", 2002: "ev2002", 2012: "ev2012", 2018: "ev2018", 2026: "ev2026" };
const hero = { slider: null, growing: false, counted: false };
function drawHero(upto) {
  const w = D.meta().world;
  hero.slider = V.beforeAfter("#heroBA", { raw: w.naive, harm: w.H, ref: w.H, outlook: w.outlook, title: t("earth"),
    highlight: D.meta().months - 1, upto, size: 460 });
}
function countUp(el, to, fmtFn, ms = 1400) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = fmtFn(to); return; }
  const t0 = performance.now();
  const tick = (now) => { const k = Math.min(1, (now - t0) / ms), e = 1 - (1 - k) ** 3; el.textContent = fmtFn(to * e); if (k < 1) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}
function heroStats() {
  const v = D.meta().harmonize?.validation?.tile_month;
  if (!v || hero.counted) return;
  hero.counted = true;
  countUp($("#statRaw"), v.baseline_raw_viirs_as_modis.bias_pct, (x) => `+${Math.round(x)}%`);
  countUp($("#statFix"), Math.abs(v.bridge_viirs_to_modis.bias_pct), (x) => `${x.toFixed(1)}%`, 1800);
}
async function grow() {
  if (hero.growing) return;
  hero.growing = true; $("#grow").disabled = true;
  const years = D.grid(D.meta().world.H).years, cap = $("#growCaption");
  for (let k = 1; k <= years.length; k++) {
    drawHero(k); hero.slider.set(100);
    const ev = EVENTS[years[k - 1]];
    if (ev) { cap.innerHTML = `<b>${years[k - 1]}</b> · ${t(ev)}`; cap.classList.add("flash"); }
    await new Promise((r) => setTimeout(r, ev ? 1700 : 260));
    cap.classList.remove("flash");
  }
  cap.innerHTML = t("evRepair");
  for (let p = 100; p >= 0; p -= 2) { hero.slider.set(p); await new Promise((r) => setTimeout(r, 30)); }
  await new Promise((r) => setTimeout(r, 900));
  for (let p = 0; p <= 50; p += 2) { hero.slider.set(p); await new Promise((r) => setTimeout(r, 25)); }
  cap.innerHTML = t("evDone");
  hero.growing = false; $("#grow").disabled = false;
}

// ---------------------------------------------------------------- dialogs, downloads, images
function openSheet(id) {
  const d = $(`#${id}`);
  d.innerHTML = id === "about" ? aboutHTML(D.meta()) : modelHTML(D.meta());
  d.showModal();
  d.querySelector(".close")?.addEventListener("click", () => d.close());
}
function download(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, "-").replace(/^-|-$/g, "") || "area";
const fileName = () => state.src?.region || slug(areaName(state.src));
function monthRange() {
  const from = +$("#from").value, to = +$("#to").value;
  let a = 0, b = D.meta().months - 1;
  for (let mi = 0; mi < D.meta().months; mi++) { const y = D.ym(mi).year; if (y < from) a = mi + 1; if (y <= to) b = mi; }
  return [a, b];
}
async function saveCard() {
  const card = $("#forecastCard");
  const css = await (await fetch("css/app.css")).text();
  const w = card.offsetWidth, h = card.offsetHeight, scale = 2;
  const clone = card.cloneNode(true);
  clone.querySelector(".wx-save")?.remove();
  const html = `<div xmlns="http://www.w3.org/1999/xhtml" dir="${document.documentElement.dir}" lang="${lang()}"><style>${css}</style>${clone.outerHTML}</div>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%">${html}</foreignObject></svg>`;
  const img = new Image();
  img.onload = () => {
    const c = Object.assign(document.createElement("canvas"), { width: w * scale, height: h * scale });
    const ctx = c.getContext("2d"); ctx.scale(scale, scale); ctx.drawImage(img, 0, 0);
    c.toBlob((b) => { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `fire-forecast-${fileName()}.png`; a.click(); });
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
function ringsPNG() {
  const svg = $("#rings svg");
  const clone = svg.cloneNode(true);
  const css = getComputedStyle(document.documentElement);
  clone.querySelectorAll("[fill='var(--empty)']").forEach((n) => n.setAttribute("fill", css.getPropertyValue("--empty").trim()));
  clone.querySelectorAll("text").forEach((tx) => { tx.setAttribute("fill", "#1E2722"); tx.setAttribute("font-family", "'IBM Plex Sans Arabic', sans-serif"); tx.setAttribute("font-size", tx.classList.contains("ring-centre") ? "16" : "11"); });
  const vb = svg.viewBox.baseVal, scale = 3;
  const canvas = Object.assign(document.createElement("canvas"), { width: vb.width * scale, height: (vb.height + 40) * scale });
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0, vb.width * scale, vb.height * scale);
    const caption = `${t("title")} · ${areaName(state.src)} · NASA FIRMS MODIS + VIIRS`;
    ctx.fillStyle = "#1E2722"; ctx.direction = document.documentElement.dir; ctx.textAlign = "center";
    let px = 13 * scale;
    do { ctx.font = `${px}px 'IBM Plex Sans Arabic', sans-serif`; px -= scale; } while (ctx.measureText(caption).width > canvas.width - 24 * scale && px > 6 * scale);
    ctx.fillText(caption, canvas.width / 2, (vb.height + 24) * scale);
    canvas.toBlob((b) => { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `fire-calendar-${fileName()}.png`; a.click(); });
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(clone));
}

// ---------------------------------------------------------------- start
function fillPresets() {
  const sel = $("#preset"), cur = sel.value;
  sel.innerHTML = "";
  sel.add(new Option(t("choosePlace"), ""));
  const groups = [[t("groupSaudi"), REGIONS.slice(0, SAUDI)], [t("groupWorld"), REGIONS.slice(SAUDI)]];
  for (const [label, list] of groups) {
    const og = document.createElement("optgroup"); og.label = label;
    list.forEach((r) => og.appendChild(new Option(t("regions")[r.id], r.id)));
    sel.appendChild(og);
  }
  sel.value = cur;
  $("#quick").innerHTML = ["asir", "madinah", "kalimantan"].map((id) => `<button class="chip" data-region="${id}">${t("regions")[id]}</button>`).join("");
  document.querySelectorAll("#quick [data-region]").forEach((b) => b.onclick = () => openRegion(b.dataset.region));
}
function fillGlassesWorld() { $("#glassesWorld").innerHTML = t("glasses").map((g) => `<li>${g}</li>`).join(""); }

// hero steps and footer team, both translated
const STEP_ICONS = [
  "M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12zm0-9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z",
  "M4 19h16M6 16V9m4 7V5m4 11v-5m4 5V8",
  "M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3zm-3 9 2 2 4-4",
];
function fillExtras() {
  $("#steps3").innerHTML = t("steps3").map(([h, d], i) => `<li><span class="st-ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${STEP_ICONS[i]}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span><b>${h}</b><small>${d}</small></span></li>`).join("");
  $("#teamList").innerHTML = t("team").map((m) => `<li>${m}</li>`).join("");
}

// numbers count up the first time the strip comes into view
function countStats() {
  document.querySelectorAll("[data-count]").forEach((el) => {
    const to = +el.dataset.count, dec = +(el.dataset.dec || 0), suf = el.dataset.suffix || "";
    countUp(el, to, (x) => (dec ? x.toFixed(dec) : Math.round(x).toLocaleString("en-US")) + suf, 1600);
  });
}

// fade sections in as they arrive, and mark the nav link of the section in view
function motion() {
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    e.target.classList.add("in");
    if (e.target.classList.contains("stats") && !e.target.dataset.done) { e.target.dataset.done = 1; countStats(); }
    io.unobserve(e.target);
  }), { threshold: 0.15 });
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
  const links = [...document.querySelectorAll(".nav a")];
  const spy = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) links.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === `#${e.target.id}`));
  }), { rootMargin: "-45% 0px -50% 0px" });
  ["area", "ready", "world", "trust"].forEach((id) => spy.observe(document.getElementById(id)));
  const bar = $(".topbar");
  addEventListener("scroll", () => bar.classList.toggle("scrolled", scrollY > 40), { passive: true });
}

function applyLanguage() {
  applyStatic();
  fillPresets(); fillGlassesWorld(); fillExtras(); renderReady(); fillWhenLegend();
  if (!hero.growing) drawHero();
  $("#wave").textContent = t(mapState.timer ? "waveStop" : "waveBtn");
  $("#hint").textContent = t(mapState.mode === "when" ? "mapHintWhen" : "mapHint");
  render();
  const open = document.querySelector("dialog[open]");
  if (open) openSheet(open.id);
}

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== tab));
}

async function start() {
  applyStatic();
  await D.loadMeta();
  REGIONS = await (await fetch("data/regions.json")).json();
  fillPresets(); fillGlassesWorld(); fillExtras(); renderReady(); drawHero(); motion();
  $("#preset").onchange = (e) => { if (e.target.value) openRegion(e.target.value); };
  $("#grow").onclick = grow;
  $("#lang").onclick = () => { setLang(lang() === "ar" ? "en" : "ar"); applyLanguage(); };
  document.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => setTab(b.dataset.tab));
  document.querySelectorAll("[data-cal]").forEach((b) => b.onclick = () => {
    state.cal = b.dataset.cal; document.querySelectorAll("[data-cal]").forEach((x) => x.classList.toggle("on", x === b)); render();
  });
  document.addEventListener("click", (e) => { const tg = e.target.closest("[data-open]"); if (tg) openSheet(tg.dataset.open); });
  $("#dlMonthly").onclick = () => download(`fire-calendar-${fileName()}-monthly.csv`, D.toCSV(state.area, areaName(state.src)));
  $("#dlCells").onclick = () => { const [a, b] = monthRange(); download(`fire-calendar-${fileName()}-cells.csv`, D.cellsCSV(state.area, a, b)); };
  $("#dlRings").onclick = ringsPNG;
  new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && heroStats()), { threshold: 0.3 }).observe($("#trust"));

  const overview = await D.loadOverview();
  initMap(overview);
  document.querySelectorAll("[data-map]").forEach((b) => b.onclick = () => { stopWave(); setMapMode(b.dataset.map); });
  $("#wave").onclick = toggleWave;
  $("#go").onclick = () => {
    const lat = +$("#lat").value, lon = +$("#lon").value, km = +$("#rad").value || 50;
    if (!$("#lat").value || !$("#lon").value || Math.abs(lat) > 90 || Math.abs(lon) > 180) { $("#hint").textContent = t("badCoords"); return; }
    const dLat = km / 111, dLon = km / (111 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
    choose({ point: { lat, lon, km }, b: { south: lat - dLat, north: lat + dLat, west: lon - dLon, east: lon + dLon } });
  };
  // link options: ?area=asir opens an area, &noscroll keeps the page at the top, &map=when starts the map in "When"
  const qs = new URLSearchParams(location.search);
  const want = qs.get("area");
  const alias = { "asir-saudi-arabia": "asir", "kalimantan-indonesia": "kalimantan" };
  if (qs.get("map") === "when") setMapMode("when");
  if (want) openRegion(alias[want] || want, { scroll: !qs.has("noscroll") });
}

start().catch((e) => { console.error(e); $("#hint").textContent = t("loadFail"); });
