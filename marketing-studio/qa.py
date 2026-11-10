"""Layout audit: catches what makes a post look amateur before you export it.

For every scene it renders the finished frame and checks that text is not cut off, text blocks do not
collide, text has enough contrast against whatever is behind it, text stays out of the platform UI zones
on 9:16 formats, and type is not tiny. Used by the editor (live "quality check"), the CLI and the tests.
"""
from __future__ import annotations

import engine
import generator
from engine import Composer, SceneRenderer, num


def _area(b):
    return max(0, b[2] - b[0]) * max(0, b[3] - b[1])


def _inter(a, b):
    return _area((max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])))


def _mean_rgb(img, box):
    box = tuple(int(v) for v in box)
    if _area(box) < 4:
        return (0, 0, 0)
    return img.crop(box).resize((1, 1), engine.Image.BOX).getpixel((0, 0))[:3]


def audit(spec: dict, max_edge: int = 480) -> list[dict]:
    """Return a list of {scene, severity: error|warn, kind, message}. Empty list = looks good."""
    norm = engine.normalize(spec)
    scale = min(1.0, max_edge / max(norm["width"], norm["height"]))
    W, H = int(norm["width"] * scale) // 2 * 2, int(norm["height"] * scale) // 2 * 2
    comp = Composer(norm, W, H)
    portrait_tall = norm["height"] / norm["width"] >= 1.7
    issues: list[dict] = []

    def add(i, sev, kind, msg):
        issues.append({"scene": i + 1, "severity": sev, "kind": kind, "message": msg})

    for i, r in enumerate(comp.scenes):
        r.collect = True
        t = r.poster_time()
        frame = r.render(t)
        boxes = list(r.boxes)
        r.collect = False
        texts = [b for b in boxes if b["type"] == "text"]
        notext = SceneRenderer(dict(r.scene, layers=[l for l in r.scene["layers"] if l["type"] != "text"]), W, H).render(t)

        for b in boxes:
            x0, y0, x1, y1 = b["box"]
            if b["type"] == "shape":
                continue
            m = 0.025
            if x0 < -1 or y0 < -1 or x1 > W + 1 or y1 > H + 1:
                add(i, "error", "cut-off", f"{_label(b)} runs outside the frame")
            elif b["type"] == "text" and (x0 < m * W or x1 > (1 - m) * W or y0 < m * H or y1 > (1 - m) * H):
                add(i, "warn", "margin", f"{_label(b)} is very close to the edge")

        for b in texts:
            L = b["layer"]
            x0, y0, x1, y1 = b["box"]
            if num(L.get("size"), 0.07, 0, 1) < 0.022:
                add(i, "warn", "small-text", f"{_label(b)} is very small and hard to read on a phone")
            raw = str(L.get("text", ""))
            raw = raw.upper() if L.get("upper") else raw
            miss = engine.missing_glyphs(engine.pick_font(str(L.get("font", "sans-bold")), 40, raw), raw)
            if miss:
                shown = "".join(sorted(miss))[:8]
                emoji = any(ord(c) > 0x1F000 for c in miss)
                add(i, "error", "glyphs", f"{_label(b)} contains characters the font cannot draw ({shown})"
                    + ("; emoji are not supported, use shapes or images" if emoji else "; add a font that supports your language in Brand > Fonts"))
            bg = _mean_rgb(notext, b["box"])
            try:
                fg = engine.parse_color(L.get("color", "#ffffff"))[:3]
            except engine.SpecError:
                continue
            cr = generator.contrast(fg, bg)
            if cr < 2.0:
                add(i, "error", "contrast", f"{_label(b)} is almost invisible against the background (contrast {cr:.1f}:1)")
            elif cr < 3.0:
                add(i, "warn", "contrast", f"{_label(b)} has low contrast (contrast {cr:.1f}:1)")
            if "*" in str(L.get("text", "")) and L.get("accent"):
                try:
                    cr2 = generator.contrast(engine.parse_color(L["accent"])[:3], bg)
                    if cr2 < 2.0:
                        add(i, "warn", "contrast", f"Highlighted words in {_label(b)} are hard to see (contrast {cr2:.1f}:1)")
                except engine.SpecError:
                    pass
            if portrait_tall and (y0 < 0.08 * H or y1 > 0.88 * H):
                add(i, "warn", "safe-zone", f"{_label(b)} sits where Reels/Stories/TikTok buttons and captions cover the screen")

        real = [b for b in texts if len(str(b["layer"].get("text", "")).strip()) > 2]
        for a in range(len(real)):
            for c in range(a + 1, len(real)):
                ia = _inter(real[a]["box"], real[c]["box"])
                if ia > 0.06 * min(_area(real[a]["box"]), _area(real[c]["box"])):
                    add(i, "error", "overlap", f"{_label(real[a])} overlaps {_label(real[c])}")
    return issues


def _label(b):
    L = b["layer"]
    if b["type"] == "text":
        txt = str(L.get("text", "")).replace("\n", " ").replace("*", "")
        return f'Text "{txt[:28]}{"…" if len(txt) > 28 else ""}"'
    return "Logo/image" if b["type"] == "image" else "Shape"


def summary(issues: list[dict]) -> str:
    if not issues:
        return "Looks good: no layout problems found."
    return "\n".join(f"  scene {x['scene']}: [{x['severity']}] {x['message']}" for x in issues)
