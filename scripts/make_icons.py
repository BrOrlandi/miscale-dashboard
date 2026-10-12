"""Draws the app icons (PWA, Apple touch icon, favicon) into app/static/icons.

    pip install pillow && python -m scripts.make_icons
"""

import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "app" / "static" / "icons"
GREEN_TOP, GREEN_BOTTOM = (31, 138, 99), (15, 92, 67)
ACCENT = (31, 122, 90)
SS = 4   # supersampling for smooth edges


def draw(size: int, maskable: bool) -> Image.Image:
    s = size * SS
    img = Image.new("RGBA", (s, s))
    d = ImageDraw.Draw(img)
    # Background: vertical gradient, full bleed (rounded only for the non-maskable icon).
    bg = Image.new("RGBA", (s, s))
    bd = ImageDraw.Draw(bg)
    for y in range(s):
        k = y / s
        bd.line([(0, y), (s, y)], fill=tuple(round(a + (b - a) * k) for a, b in zip(GREEN_TOP, GREEN_BOTTOM, strict=True)))
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=0 if maskable else s * 0.22, fill=255)
    img.paste(bg, (0, 0), mask)

    # Scale platform: white rounded square, smaller on maskable icons (80% safe zone).
    side = s * (0.50 if maskable else 0.62)
    x0, y0 = (s - side) / 2, (s - side) / 2
    d.rounded_rectangle([x0, y0, x0 + side, y0 + side], radius=side * 0.2, fill=(255, 255, 255))

    # Dial: an arc with a needle, like the progress ring on the weigh-in screen.
    cx, cy, r = s / 2, y0 + side * 0.62, side * 0.32
    w = side * 0.075
    d.arc([cx - r, cy - r, cx + r, cy + r], start=200, end=340, fill=ACCENT, width=round(w))
    for ang in (200, 340):   # round caps
        a = math.radians(ang)
        px, py = cx + (r - w / 2) * math.cos(a), cy + (r - w / 2) * math.sin(a)
        d.ellipse([px - w / 2, py - w / 2, px + w / 2, py + w / 2], fill=ACCENT)
    a = math.radians(295)
    nx, ny = cx + r * 0.78 * math.cos(a), cy + r * 0.78 * math.sin(a)
    d.line([(cx, cy), (nx, ny)], fill=GREEN_BOTTOM, width=round(w * 0.7))
    hub = w * 0.75
    d.ellipse([cx - hub, cy - hub, cx + hub, cy + hub], fill=GREEN_BOTTOM)
    return img.resize((size, size), Image.LANCZOS)


def main(out: Path = OUT):
    out.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        draw(size, False).save(out / f"icon-{size}.png")
        draw(size, True).save(out / f"maskable-{size}.png")
    # iOS adds its own rounded corners and ignores transparency: full-bleed square.
    draw(180, True).convert("RGB").save(out / "apple-touch-icon.png")
    draw(64, False).save(out / "favicon.png")
    print(f"icons written to {out}")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else OUT)
