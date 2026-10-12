# Finds where free-standing logos/mascots fit on a cover without covering the subject.
# Usage: python3 src/place.py <cover image> <object-position> <size px> [<size px> ...]
# Prints JSON: [{"side": "left"|"right", "top": px}, ...] for the 1080x900 photo area.
import json, re, sys
from PIL import Image, ImageFilter
from rembg import new_session, remove

W, H = 1080, 900
src, pos, sizes = sys.argv[1], sys.argv[2], [int(x) for x in sys.argv[3:]]

def axis(v, default):
    v = v.strip()
    return {"left": 0, "top": 0, "center": 50, "right": 100, "bottom": 100}.get(v, float(v.rstrip("%")) if v.endswith("%") else default)

parts = (pos or "center 30%").split()
px = axis(parts[0], 50); py = axis(parts[1] if len(parts) > 1 else "center", 50)

img = Image.open(src).convert("RGB")
mask = remove(img, session=new_session("u2net"), only_mask=True)
# Same crop the browser does with object-fit: cover + object-position.
s = max(W / img.width, H / img.height)
mw, mh = round(img.width * s), round(img.height * s)
mask = mask.resize((mw, mh))
ox, oy = round((mw - W) * px / 100), round((mh - H) * py / 100)
mask = mask.crop((ox, oy, ox + W, oy + H)).point(lambda a: 255 if a > 40 else 0)
# Grow the subject a little so thin arms, hands and held objects count as taken.
mask = mask.filter(ImageFilter.MaxFilter(41))

def overlap(x, y, w):
    box = mask.crop((x, y, x + w, y + w))
    return sum(box.histogram()[255:]) / (w * w)

used, out = [], []
for w in sizes:
    best = None
    for side in ("left", "right"):
        x = 40 if side == "left" else W - 40 - w
        start = 180 if side == "left" else 130  # keep clear of the nf corner mark
        for top in range(start, H - w - 60 + 1, 30):
            if any(u[0] == side and abs(u[1] - top) < w for u in used):
                continue
            score = overlap(x, top, w) + (top - start) / 6000  # empty first, then higher
            if best is None or score < best[0]:
                best = (score, side, top)
    used.append((best[1], best[2]))
    out.append({"side": best[1], "top": best[2]})
print(json.dumps(out))
