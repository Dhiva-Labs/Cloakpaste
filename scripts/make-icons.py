"""Draws the PasteGuard icon: a black tile with a highlighter-yellow redaction bar."""
from PIL import Image, ImageDraw

INK, HI, PAPER = (22, 21, 19, 255), (242, 194, 0, 255), (255, 253, 247, 255)

def icon(size):
    s = size * 8  # supersample, then downscale for smooth edges
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=INK)
    # three text lines, the middle one redacted
    pad = int(s * 0.2)
    h = int(s * 0.12)
    gap = int(s * 0.1)
    y = int(s * 0.25)
    d.rounded_rectangle([pad, y, s - pad, y + h], radius=h // 2, fill=PAPER)
    y += h + gap
    d.rounded_rectangle([pad, y - int(h * 0.25), s - pad, y + int(h * 1.25)], radius=int(h * 0.4), fill=HI)
    y += h + gap
    d.rounded_rectangle([pad, y, int(s * 0.62), y + h], radius=h // 2, fill=PAPER)
    return im.resize((size, size), Image.LANCZOS)

for n in (16, 32, 48, 128):
    icon(n).save(f"icons/icon{n}.png")
print("icons written")
