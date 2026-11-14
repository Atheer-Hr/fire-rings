"""Draw the site's hero background: every fire cell on Earth glowing on a dark night map.

Run after export.py:  python pipeline/hero_image.py   ->  site/img/hero-fire.jpg
"""
import json
import math
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ov = json.loads((ROOT / "site" / "data" / "overview.json").read_text())

LAT_TOP, LAT_BOT = 72, -48          # crop the poles
W = 1440                            # one pixel per 0.25 degree cell
H = int((LAT_TOP - LAT_BOT) / 0.25)
INF = [(0, (0, 0, 4)), (.13, (31, 12, 72)), (.25, (85, 15, 109)), (.38, (136, 34, 106)), (.5, (186, 54, 85)),
       (.63, (227, 89, 51)), (.75, (249, 140, 10)), (.88, (249, 201, 50)), (1, (252, 255, 164))]


def inferno(t):
    t = max(0.0, min(1.0, t))
    for (a, ca), (b, cb) in zip(INF, INF[1:]):
        if t <= b:
            k = (t - a) / (b - a)
            return tuple(int(ca[i] + (cb[i] - ca[i]) * k) for i in range(3))
    return INF[-1][1]


BG = (14, 11, 10)
img = Image.new("RGB", (W, H), BG)
px = img.load()
top = sorted(ov["total"])[int(len(ov["total"]) * 0.995)]
for cell, tot in zip(ov["cells"], ov["total"]):
    r, c = divmod(cell, 1440)
    lat = (r + 0.5) * 0.25 - 90
    if not (LAT_BOT < lat < LAT_TOP) or tot < 1:
        continue
    t = math.log(max(tot, 1)) / math.log(top)
    col = inferno(0.25 + 0.75 * t)
    a = 0.35 + 0.65 * min(t, 1)
    px[c, int((LAT_TOP - lat) / 0.25)] = tuple(int(BG[i] + (col[i] - BG[i]) * a) for i in range(3))

big = img.resize((W * 2, H * 2), Image.BICUBIC)
glow = big.filter(ImageFilter.GaussianBlur(10))
out = Image.blend(glow, big, 0.6)
# lift the glow so fire regions bloom on the dark background
out = Image.eval(out, lambda v: min(255, int(v * 1.25)))
(ROOT / "site" / "img").mkdir(exist_ok=True)
out.save(ROOT / "site" / "img" / "hero-fire.jpg", quality=82, optimize=True, progressive=True)
print("hero image", out.size)
