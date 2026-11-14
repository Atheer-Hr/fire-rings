# Fire Calendar — prompt for an AI video designer

Copy everything between the two lines into the AI video tool (Runway, Sora, Veo, Kling, Pika, CapCut AI…).
Shots marked **[SCREEN]** are real screen recordings of the live site; do not let the AI redraw them.

---

## MASTER PROMPT

You are a creative video director. Make a **30-second** explainer video (hard limit: 30 seconds, required by NASA Space Apps) for a project called **Fire Calendar**, by team ASR Space from Madinah, Saudi Arabia.

**The idea in one line:** Trees record their age in rings; the Earth records its fires. NASA satellites have recorded every fire on Earth since 2000, but the record was written by two different cameras (MODIS and VIIRS) that cannot be compared, so the raw record exaggerates fire by 718%. Fire Calendar repairs the record (error down to 2%) and turns it into a fire calendar anyone can read, like a weather forecast.

**Style**
- Cinematic, warm, and hopeful, not scary.
- Dark charcoal background (#14110f) with glowing fire colours (deep purple → crimson → orange → pale yellow, like the "inferno" palette). Accent orange #f98e09.
- One visual metaphor carries the whole film: **a tree trunk's growth rings become rings of fire**, one ring per year and one slice per month.
- Clean modern typography (Inter for English, IBM Plex Sans Arabic for Arabic). Large on-screen numbers.
- Smooth match-cuts: tree rings → fire rings → the Earth → the website.
- Format 16:9, 1080p. Burned-in **English subtitles** on every line, because the narration is in Arabic.
- Music: soft, rising ambient piano or strings, royalty-free only. A short swell at the "repair" moment.
- Do NOT invent numbers, logos or interface screens. Use only the numbers below and the real screen recordings.

**Numbers you may show (all real):**
- 25 years of NASA satellite fire records (2000–2026)
- 2 sensors: MODIS (1 km) and VIIRS (375 m)
- Raw record exaggerates fire by **+718%**; Fire Calendar error **2%** (tested on 4 years it never saw)
- **56%** of fires seen by VIIRS are too small for MODIS
- ML outlook: **41%** lower error than the best simple method

**Shot list (30 s)**

| Time | Shot | On screen | Arabic narration | English subtitle |
|---|---|---|---|---|
| 0:00–0:04 | **[AI]** Macro shot of a freshly cut tree trunk, sunlight on the growth rings; slow push-in. The rings begin to glow orange like embers. | — | الشجرة تسجّل عمرها في حلقات… | Trees record their age in rings… |
| 0:04–0:08 | **[AI]** The glowing rings dissolve into Earth seen from space at night; tiny fire dots sparkle across Africa and Asia; two satellites cross the frame (one older, one sleeker). | "2000 → 2026" | …والأرض تسجّل حرائقها. أقمار ناسا تراقبها منذ 25 سنة. | …and the Earth records its fires. NASA satellites have watched for 25 years. |
| 0:08–0:13 | **[SCREEN]** The site's opening section: press "Watch the record grow"; the rings grow and, at 2012, the outer rings flare bright yellow. Overlay a big red **+718%** with a strike-through. | +718% | لكن كاميرتين مختلفتين… فالسجل يبالغ في الحرائق سبعة أضعاف. | But two different cameras made the record exaggerate fire seven-fold. |
| 0:13–0:18 | **[SCREEN]** The white line sweeps across the rings and the false glow calms into even colours. Overlay a big green **2%**. Music swell. | 2% | تقويم الحرائق يُصلح السجل… والخطأ اثنان بالمئة فقط. | Fire Calendar repairs the record — error down to 2%. |
| 0:18–0:23 | **[SCREEN]** The map switches to "When" and the "Fire wave" plays: colours travel around the planet month by month. | — | لكل مكان على الأرض تقويم نار خاص به… | Every place on Earth has its own fire calendar… |
| 0:23–0:27 | **[SCREEN]** Click "Asir, Saudi Arabia": the weather-style Fire Forecast card appears with flames and the season countdown. | — | …فتعرف: هل الموسم طبيعي؟ ومتى تستعد؟ | …is this season normal, and when should we get ready? |
| 0:27–0:30 | **[AI + text]** A small young tree growing on a desert hillside at sunrise (protecting new trees); end card on dark background. | **Fire Calendar** · From firefighting to fire-readiness · atheer-hr.github.io/fire-rings · Team ASR Space · NASA Space Apps 2026 | تقويم الحرائق… من الإطفاء إلى الاستعداد. | Fire Calendar — from firefighting to fire-readiness. |

**Generation prompts for the AI shots**

1. *Tree rings to embers (0:00–0:04):* "Extreme macro shot of a freshly cut tree trunk cross-section, warm golden light, slow dolly-in; the concentric growth rings begin to glow from within like orange embers, sparks drifting, shallow depth of field, cinematic, dark background, 4 seconds."
2. *Earth at night (0:04–0:08):* "Earth from space at night, slow rotation over Africa and the Middle East, thousands of tiny orange fire points twinkling on the land, two satellites gliding across the frame, one older and boxy, one sleek and modern, cinematic, realistic, 4 seconds."
3. *Hope ending (0:27–0:30):* "A small young acacia tree planted on a rocky desert hillside in Saudi Arabia at sunrise, warm light, gentle breeze, hopeful mood, slow push-in, 3 seconds."

**Editing notes**
- Keep text on screen at least 1.5 seconds; never more than 8 words per subtitle line.
- Match-cut the tree rings (shot 1) to the website's rings (shot 3) for the "aha" moment.
- Total length must not exceed 30.0 seconds.

---

## Recording the [SCREEN] shots (for the team)

- Open https://atheer-hr.github.io/fire-rings/?lang=ar (Arabic interface) or without `?lang=ar` (English), on a full-screen desktop browser.
- Record with Windows **Win + Alt + R** or **Clipchamp → Record screen**.
- Record each shot separately, about 6–8 seconds each, so the editor can trim:
  1. Press "▶ Watch the record grow" and record the whole animation (about 20 s). The editor uses the 2012 flare and the repair sweep.
  2. Map → "When" → "▶ Fire wave".
  3. Choose "Asir, Saudi Arabia" and scroll slightly to the Fire Forecast card.
