# Removes the background of an image and trims the empty border.
# Usage: python3 src/cutout.py <in> <out.png>
import sys
from PIL import Image
from rembg import new_session, remove

src, dst = sys.argv[1], sys.argv[2]
img = Image.open(src).convert("RGBA")
out = remove(img, session=new_session("u2net"), post_process_mask=True)
box = out.getchannel("A").point(lambda a: 255 if a > 20 else 0).getbbox()
if box:
    out = out.crop(box)
out.save(dst)
