// Fire Rings, the calendar grid and the smaller charts. All drawn with D3.
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";
import { grid, ym, meta } from "./data.js";
import { t } from "./i18n.js";

const MON = () => t("months");
const MONL = () => t("monthsLong");
const tip = d3.select("#tooltip");
function showTip(ev, html) {
  tip.html(html).classed("on", true);
  const w = tip.node().offsetWidth, h = tip.node().offsetHeight;
  let x = ev.clientX + 14, y = ev.clientY + 14;
  if (x + w > innerWidth - 8) x = ev.clientX - w - 14;
  if (y + h > innerHeight - 8) y = ev.clientY - h - 14;
  tip.style("left", `${x}px`).style("top", `${y}px`);
}
const hideTip = () => tip.classed("on", false);

// Colour: inferno on a log scale, skipping the near-black end so "a few fires" stays visible.
export function colorScale(max) {
  const top = Math.log(Math.max(max, 2));
  return (v) => {
    if (v == null) return "transparent";
    if (v < 0.5) return "var(--empty)";
    return d3.interpolateInferno(0.18 + 0.8 * Math.min(1, Math.log(Math.max(v, 1)) / top));
  };
}

export const fmt = (v) => d3.format(",.0f")(v);
const miOf = (year, m) => (year - ym(0).year) * 12 + m - (meta().start[1] - 1);

// ------------------------------------------------------------------ Fire Rings
// Each ring is a year (oldest in the centre), each sector a month, clockwise from the top.
export function rings(el, series, opts = {}) {
  const { outlook = null, title = "", size = 460, highlight = null } = opts;
  const { years, rows } = grid(series);
  const max = d3.max(rows.flat().filter((v) => v != null)) || 1;
  const color = colorScale(max);
  const svg = d3.select(el).html("").append("svg")
    .attr("viewBox", `${-size / 2} ${-size / 2} ${size} ${size}`)
    .attr("role", "img").attr("direction", "ltr")
    .attr("aria-label", `${t("ringsTitle")} · ${title} · ${years[0]}–${years.at(-1)}`);
  const inner = size * 0.12, outer = size * 0.40;
  const ringW = (outer - inner) / (years.length + (outlook ? 1.4 : 0));
  const arc = d3.arc();
  const a = (m) => (m / 12) * 2 * Math.PI;
  const g = svg.append("g");
  rows.forEach((row, yi) => row.forEach((v, m) => {
    if (v == null) return;
    g.append("path")
      .attr("d", arc({ innerRadius: inner + yi * ringW + 0.4, outerRadius: inner + (yi + 1) * ringW - 0.4,
        startAngle: a(m) + 0.006, endAngle: a(m + 1) - 0.006 }))
      .attr("fill", color(v))
      .attr("class", highlight === miOf(years[yi], m) ? "cell now" : "cell")
      .on("mousemove", (ev) => showTip(ev, `<b>${MONL()[m]} ${years[yi]}</b><br>${fmt(v)} ${t("hotspots")}`))
      .on("mouseleave", hideTip);
  }));
  if (outlook) { // dashed outer ring: the next three months
    const r0 = inner + years.length * ringW + ringW * 0.4, r1 = r0 + ringW;
    const last = ym(meta().months - 1);
    outlook.forEach((o, k) => {
      const m = (last.month + 1 + k) % 12, yr = last.year + Math.floor((last.month + 1 + k) / 12);
      g.append("path")
        .attr("d", arc({ innerRadius: r0, outerRadius: r1, startAngle: a(m) + 0.006, endAngle: a(m + 1) - 0.006 }))
        .attr("fill", color(o.m)).attr("class", "cell forecast")
        .on("mousemove", (ev) => showTip(ev, `<b>${t("outlookWord")} · ${MONL()[m]} ${yr}</b><br>${t("expectedWord")} ${fmt(o.m)}<br>${t("rangeWord")} ${fmt(o.lo)}–${fmt(o.hi)}`))
        .on("mouseleave", hideTip);
    });
  }
  MON().forEach((name, m) => {
    const ang = a(m + 0.5) - Math.PI / 2, r = outer + size * 0.055;
    svg.append("text").attr("class", "ring-month").attr("x", Math.cos(ang) * r).attr("y", Math.sin(ang) * r)
      .attr("text-anchor", "middle").attr("dominant-baseline", "middle").text(name);
  });
  [0, Math.floor(years.length / 2), years.length - 1].forEach((yi) => {
    svg.append("text").attr("class", "ring-year").attr("x", 3).attr("y", -(inner + (yi + 0.5) * ringW))
      .attr("dominant-baseline", "middle").text(years[yi]);
  });
  svg.append("text").attr("class", "ring-centre").attr("text-anchor", "middle").attr("dy", "0.35em")
    .text(title.length > 14 ? title.slice(0, 13) + "…" : title);
  return svg.node();
}

// ------------------------------------------------------------------ calendar grid
export function calendar(el, series, opts = {}) {
  const { mode = "count", highlight = null } = opts;
  const { years, rows } = grid(series);
  const max = d3.max(rows.flat().filter((v) => v != null)) || 1;
  let color = colorScale(max);
  let shown = rows;
  if (mode === "anomaly") { // each month against that month's median over all years
    const med = d3.range(12).map((m) => d3.median(rows.map((r) => r[m]).filter((v) => v != null)) || 0);
    shown = rows.map((r) => r.map((v, m) => (v == null ? null : Math.log2((v + 1) / (med[m] + 1)))));
    const div = d3.scaleDiverging(d3.interpolatePuOr).domain([2.5, 0, -2.5]);
    color = (v) => (v == null ? "transparent" : div(Math.max(-2.5, Math.min(2.5, v))));
  }
  const cw = 34, ch = 16, left = 40, top = 22;
  const W = left + cw * 12 + 4, H = top + ch * years.length + 4;
  const svg = d3.select(el).html("").append("svg").attr("viewBox", `0 0 ${W} ${H}`)
    .attr("role", "img").attr("direction", "ltr").attr("aria-label", t("calTitle"));
  MON().forEach((m, i) => svg.append("text").attr("class", "axis").attr("x", left + i * cw + cw / 2)
    .attr("y", 14).attr("text-anchor", "middle").text(m));
  shown.forEach((row, yi) => {
    svg.append("text").attr("class", "axis").attr("x", left - 6).attr("y", top + yi * ch + ch / 2)
      .attr("text-anchor", "end").attr("dominant-baseline", "middle").text(years[yi]);
    row.forEach((v, m) => {
      if (v == null) return;
      const raw = rows[yi][m];
      svg.append("rect").attr("x", left + m * cw + 1).attr("y", top + yi * ch + 1)
        .attr("width", cw - 2).attr("height", ch - 2).attr("rx", 2)
        .attr("fill", color(v)).attr("class", highlight === miOf(years[yi], m) ? "cell now" : "cell")
        .on("mousemove", (ev) => showTip(ev, `<b>${MONL()[m]} ${years[yi]}</b><br>${fmt(raw)} ${t("hotspots")}`
          + (mode === "anomaly" ? `<br>${t("timesTip", { x: d3.format(v >= 0 ? ".1f" : ".2f")(2 ** v) })}` : "")))
        .on("mouseleave", hideTip);
    });
  });
  return { max, mode };
}

export function legend(el, max, mode = "count") {
  const w = 220, h = 34;
  const svg = d3.select(el).html("").append("svg").attr("viewBox", `0 0 ${w} ${h}`).attr("direction", "ltr");
  const id = `lg${Math.random().toString(36).slice(2)}`;
  const grad = svg.append("defs").append("linearGradient").attr("id", id);
  d3.range(0, 1.01, 0.1).forEach((k) => grad.append("stop").attr("offset", k)
    .attr("stop-color", mode === "anomaly" ? d3.interpolatePuOr(1 - k) : d3.interpolateInferno(0.18 + 0.8 * k)));
  svg.append("rect").attr("x", 4).attr("y", 4).attr("width", w - 8).attr("height", 10).attr("rx", 3).attr("fill", `url(#${id})`);
  const labels = mode === "anomaly" ? t("legendAnom") : ["1", fmt(Math.sqrt(max)), fmt(max)];
  labels.forEach((s, i) => svg.append("text").attr("class", "axis").attr("x", 4 + i * (w - 8) / 2).attr("y", 28)
    .attr("text-anchor", ["start", "middle", "end"][i]).text(s));
}

// ------------------------------------------------------------------ record chart
// Raw sensors vs the naive stitch vs the harmonized record, by year.
export function record(el, area) {
  const n = meta().months;
  const yearly = (arr) => d3.rollups(d3.range(n), (v) => d3.sum(v, (mi) => arr[mi]), (mi) => ym(mi).year)
    .filter(([y]) => d3.range(n).filter((mi) => ym(mi).year === y).length === 12);
  const series = [
    { data: yearly(area.naive), cls: "l-naive" },
    { data: yearly(area.M).filter(([, v]) => v > 0), cls: "l-modis" },
    { data: yearly(area.V).filter(([, v]) => v > 0), cls: "l-viirs" },
    { data: yearly(area.H), cls: "l-harm" },
  ];
  const lo = yearly(area.H.map((v, i) => v - area.unc[i])), hi = yearly(area.H.map((v, i) => v + area.unc[i]));
  const W = 560, H = 230, m = { l: 48, r: 10, t: 10, b: 24 };
  const all = series.flatMap((s) => s.data);
  const x = d3.scaleLinear().domain(d3.extent(all, (d) => d[0])).range([m.l, W - m.r]);
  const y = d3.scaleLinear().domain([0, d3.max(all.concat(hi), (d) => d[1]) * 1.05 || 1]).nice().range([H - m.b, m.t]);
  const svg = d3.select(el).html("").append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("direction", "ltr");
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`)
    .call(d3.axisBottom(x).ticks(8).tickFormat(d3.format("d")).tickSizeOuter(0));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`)
    .call(d3.axisLeft(y).ticks(5, "~s").tickSizeOuter(0));
  svg.append("path").attr("class", "band").attr("d", d3.area().x((d) => x(d[0])).y0((d, i) => y(lo[i][1])).y1((d) => y(d[1]))(hi));
  for (const s of series) svg.append("path").attr("class", `line ${s.cls}`)
    .attr("d", d3.line().x((d) => x(d[0])).y((d) => y(d[1]))(s.data));
  const firstV = meta().source_by_month.findIndex((v) => v >= 2);
  if (firstV > 0) {
    const yr = ym(firstV).year;
    svg.append("line").attr("class", "marker").attr("x1", x(yr)).attr("x2", x(yr)).attr("y1", m.t).attr("y2", H - m.b);
    svg.append("text").attr("class", "marker-label").attr("x", x(yr) + 4).attr("y", m.t + 10).text(t("viirsArrives"));
  }
}

// ------------------------------------------------------------------ outlook bars
export function outlookChart(el, outlook, history) {
  const last = ym(meta().months - 1);
  const items = outlook.map((o, k) => {
    const m = (last.month + 1 + k) % 12;
    return { name: MON()[m], m, ...o, usual: history[m] };
  });
  const W = 360, H = 170, mg = { l: 40, r: 10, t: 10, b: 24 };
  const x = d3.scaleBand().domain(items.map((d) => d.name)).range([mg.l, W - mg.r]).padding(0.35);
  const y = d3.scaleLinear().domain([0, d3.max(items, (d) => Math.max(d.hi, d.usual)) * 1.1 || 1]).nice().range([H - mg.b, mg.t]);
  const svg = d3.select(el).html("").append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("direction", "ltr");
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - mg.b})`).call(d3.axisBottom(x).tickSizeOuter(0));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${mg.l},0)`).call(d3.axisLeft(y).ticks(4, "~s").tickSizeOuter(0));
  const g = svg.selectAll(".ob").data(items).join("g");
  g.append("rect").attr("class", "range").attr("x", (d) => x(d.name)).attr("width", x.bandwidth())
    .attr("y", (d) => y(d.hi)).attr("height", (d) => Math.max(1, y(d.lo) - y(d.hi)));
  g.append("line").attr("class", "expected").attr("x1", (d) => x(d.name)).attr("x2", (d) => x(d.name) + x.bandwidth())
    .attr("y1", (d) => y(d.m)).attr("y2", (d) => y(d.m));
  g.append("line").attr("class", "usual").attr("x1", (d) => x(d.name) - 4).attr("x2", (d) => x(d.name) + x.bandwidth() + 4)
    .attr("y1", (d) => y(d.usual)).attr("y2", (d) => y(d.usual));
  g.on("mousemove", (ev, d) => showTip(ev, `<b>${MONL()[d.m]}</b><br>${t("expectedWord")} ${fmt(d.m)}<br>${t("rangeWord")} ${fmt(d.lo)}–${fmt(d.hi)}<br>${t("usualWord")} ${fmt(d.usual)}`))
    .on("mouseleave", hideTip);
}

// ------------------------------------------------------------------ season timing
export function seasonChart(el, seasonsData, tr) {
  const pts = seasonsData.years.filter((d) => d.onset != null);
  const W = 360, H = 170, mg = { l: 48, r: 10, t: 10, b: 24 };
  if (pts.length < 3) { d3.select(el).html(`<p class='muted'>${t("tooFewSeason")}</p>`); return; }
  const monthAt = (day) => MON()[(seasonsData.start + Math.floor(day / 30.44)) % 12];
  const x = d3.scaleLinear().domain(d3.extent(pts, (d) => d.year)).range([mg.l, W - mg.r]);
  const y = d3.scaleLinear().domain([d3.max(pts, (d) => d.end) + 10, d3.min(pts, (d) => d.onset) - 10]).range([H - mg.b, mg.t]);
  const svg = d3.select(el).html("").append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("direction", "ltr");
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - mg.b})`).call(d3.axisBottom(x).ticks(6).tickFormat(d3.format("d")).tickSizeOuter(0));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${mg.l},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat(monthAt).tickSizeOuter(0));
  svg.append("path").attr("class", "band soft").attr("d", d3.area().x((d) => x(d.year)).y0((d) => y(d.end)).y1((d) => y(d.onset))(pts));
  svg.append("path").attr("class", "line l-harm").attr("d", d3.line().x((d) => x(d.year)).y((d) => y(d.onset))(pts));
  if (tr) svg.append("line").attr("class", "trend").attr("x1", x(pts[0].year)).attr("x2", x(pts.at(-1).year))
    .attr("y1", y(tr.intercept + tr.slope * pts[0].year)).attr("y2", y(tr.intercept + tr.slope * pts.at(-1).year));
  svg.selectAll("circle").data(pts).join("circle").attr("class", "dot").attr("r", 2.6)
    .attr("cx", (d) => x(d.year)).attr("cy", (d) => y(d.onset))
    .on("mousemove", (ev, d) => showTip(ev, `<b>${d.year}</b><br>${t("seasonStartsTip", { m: monthAt(d.onset) })}<br>${fmt(d.sum)} ${t("hotspots")}`))
    .on("mouseleave", hideTip);
}

// ------------------------------------------------------------------ weekday bars
export function weekdayChart(el, wd) {
  const names = t("daysShort");
  const W = 360, H = 140, mg = { l: 36, r: 6, t: 8, b: 22 };
  const mean = d3.mean(wd) || 1;
  const vals = Array.from(wd, (v) => v / mean);
  const x = d3.scaleBand().domain(names).range([mg.l, W - mg.r]).padding(0.25);
  const y = d3.scaleLinear().domain([Math.min(0.8, d3.min(vals)), Math.max(1.2, d3.max(vals))]).range([H - mg.b, mg.t]);
  const svg = d3.select(el).html("").append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("direction", "ltr");
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - mg.b})`).call(d3.axisBottom(x).tickSizeOuter(0));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${mg.l},0)`).call(d3.axisLeft(y).ticks(4, ".1f").tickSizeOuter(0));
  svg.append("line").attr("class", "usual").attr("x1", mg.l).attr("x2", W - mg.r).attr("y1", y(1)).attr("y2", y(1));
  svg.selectAll(".wb").data(vals).join("rect").attr("class", "wbar")
    .attr("x", (d, i) => x(names[i])).attr("width", x.bandwidth())
    .attr("y", (d) => y(Math.max(d, 1))).attr("height", (d) => Math.abs(y(d) - y(1)));
}

export { d3 };
