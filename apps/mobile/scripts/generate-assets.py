"""
Generates the app's icon and splash assets.

They are generated rather than checked in as opaque binaries so the brand
colour lives in exactly one place — change `BRAND` and re-run. The mark is a
shield with a tick, matching the `shield-checkmark` glyph the login screen
already uses: this product's pitch is child safety, so the icon says safety
rather than "school".

    python scripts/generate-assets.py
"""

from PIL import Image, ImageDraw

BRAND = (99, 102, 241)      # brand-500, same value as the web app's --brand-500
DARK = (67, 56, 202)        # brand-700, for the icon's gradient
WHITE = (255, 255, 255, 255)

OUT = "assets"


def shield_outline(cx, cy, w, h, steps=140):
    """
    Half-width taper down to a point.

    `1 - t**2.4` keeps the shoulders wide and pulls the taper in late, which is
    what makes it read as a shield rather than a spade or a triangle.
    """
    top = cy - h / 2
    pts_right, pts_left = [], []

    for i in range(steps + 1):
        t = i / steps
        half = (w / 2) * (1 - t**2.4)
        y = top + h * t
        pts_right.append((cx + half, y))
        pts_left.append((cx - half, y))

    # Round the top corners by insetting the first few rows.
    return pts_right + list(reversed(pts_left))


def draw_shield(size, fill, scale=0.66, supersample=4):
    """Anti-aliased by drawing large and downsampling — PIL has no AA polygons."""
    s = size * supersample
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    w = s * scale
    h = w * 1.18
    cx, cy = s / 2, s / 2 + h * 0.02

    d.polygon(shield_outline(cx, cy, w, h), fill=fill)

    # Tick, drawn as two thick rounded strokes.
    lw = int(w * 0.115)
    x0, y0 = cx - w * 0.235, cy - h * 0.03
    x1, y1 = cx - w * 0.055, cy + h * 0.15
    x2, y2 = cx + w * 0.255, cy - h * 0.20

    hole = (BRAND[0], BRAND[1], BRAND[2], 255)
    d.line([(x0, y0), (x1, y1)], fill=hole, width=lw, joint="curve")
    d.line([(x1, y1), (x2, y2)], fill=hole, width=lw, joint="curve")
    for (px, py) in ((x0, y0), (x1, y1), (x2, y2)):
        r = lw / 2
        d.ellipse([px - r, py - r, px + r, py + r], fill=hole)

    return img.resize((size, size), Image.LANCZOS)


def vertical_gradient(size, top, bottom):
    img = Image.new("RGB", (1, size))
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / max(1, size - 1)
        d.point(
            (0, y),
            fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)),
        )
    return img.resize((size, size), Image.BILINEAR)


def main():
    # Splash: transparent so expo-splash-screen composites it over the
    # configured background colour.
    draw_shield(512, WHITE).save(f"{OUT}/splash-icon.png")

    # App icon: opaque, gradient ground. Stores reject alpha in iOS icons.
    icon = vertical_gradient(1024, DARK, BRAND).convert("RGBA")
    icon.alpha_composite(draw_shield(1024, WHITE, scale=0.56))
    icon.convert("RGB").save(f"{OUT}/icon.png")

    # Adaptive icon foreground: Android masks it to a circle and crops ~25%,
    # so the mark has to sit well inside the safe zone.
    fg = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    fg.alpha_composite(draw_shield(1024, WHITE, scale=0.42))
    fg.save(f"{OUT}/adaptive-icon.png")

    # Notification icon: Android renders it as a silhouette, so shape is all
    # that survives — no tick, or it fills in solid.
    notif = Image.new("RGBA", (192, 192), (0, 0, 0, 0))
    d = ImageDraw.Draw(notif)
    w = 192 * 0.62
    h = w * 1.18
    d.polygon(shield_outline(96, 96 + h * 0.02, w, h), fill=WHITE)
    notif.save(f"{OUT}/notification-icon.png")

    print("wrote:", ", ".join(
        ["splash-icon.png", "icon.png", "adaptive-icon.png", "notification-icon.png"]
    ))


if __name__ == "__main__":
    main()
