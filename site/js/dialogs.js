// "How it works" and "Model card" pages, in English and Arabic.
import * as D from "./data.js";
import { lang } from "./i18n.js";

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

export function aboutHTML(meta) {
  const h = meta.harmonize || {}, tr = h.validation?.train_years || [], te = h.validation?.test_years || [];
  const span = `${D.label(0)} – ${D.label(meta.months - 1)}`;
  if (lang() === "ar") return `<button class="close" aria-label="إغلاق">×</button>
  <h2>كيف يعمل تقويم الحرائق</h2>
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
  <h2>How Fire Calendar works</h2>
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

export function modelHTML(meta) {
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

