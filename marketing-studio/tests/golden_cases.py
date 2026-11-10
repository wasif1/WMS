"""Font-independent visual cases used for golden-image regression (shapes, gradients, motion, transitions).
Text is deliberately excluded here: fonts differ between machines. Text layout is covered by the audit matrix."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from _util import *  # noqa
import engine

TILE = 96


def comp(layers, bg=None, dur=4.0, **kw):
    return engine.Composer(spec(layers, bg=bg, dur=dur, w=TILE, h=TILE, **kw))


def two(ttype, colors=("#e11d48", "#2563eb")):
    return engine.Composer({"name": "t", "width": TILE, "height": TILE, "fps": 10, "transition": {"type": ttype, "duration": 1.0},
                            "scenes": [{"duration": 3, "background": {"type": "color", "color": c}, "layers": [
                                {"type": "shape", "shape": "circle", "x": 0.3, "y": 0.5, "w": 0.25, "color": "#ffffff", "in": "zoom", "start": 0.2}]} for c in colors]})


def cases():
    """name -> list of (Composer, time)."""
    shape = lambda **k: rect(**{"x": .5, "y": .5, "w": .5, "h": .3, "color": "#fbbf24", **k})
    grad = lambda a, **k: {"type": "gradient", "colors": ["#ff3d00", "#7c3aed"], "angle": a, **k}
    return {
        "gradient_angles": [(comp([], grad(a)), 1.0) for a in (0, 90, 160, 270)],
        "gradient_three_stop_drift": [(comp([], {"type": "gradient", "colors": ["#0f172a", "#6d28d9", "#fbbf24"], "angle": 120, "drift": 60}), t) for t in (0.0, 2.0, 3.9)],
        "entrances": [(comp([shape(**{"in": a, "start": .5, "anim_dur": 1.0})]), .5 + .35) for a in ("fade", "slide-up", "slide-left", "zoom", "pop", "wipe")],
        "entrance_progress_slide_up": [(comp([shape(**{"in": "slide-up", "start": .5, "anim_dur": 1.0})]), .5 + p) for p in (0.0, .2, .5, 1.0)],
        "exits": [(comp([shape(**{"out": a, "end": 3.0, "anim_dur": 1.0})]), 2.6) for a in ("fade", "zoom", "slide-down")],
        "motion_push_drift": [(comp([shape(motion={"dx": .3, "dy": -.2, "scale": .5})]), t) for t in (0.0, 2.0, 3.99)],
        "shape_styles": [(comp([shape(shape=s, **k)]), 1.0) for s, k in (("rect", {}), ("rounded", {"radius": .6}), ("circle", {"w": .5}), ("circle", {"w": .5, "blur": .06}),
                                                                       ("rounded", {"shadow": True}), ("rect", {"stroke": {"width": .03, "color": "#ffffff"}}))],
        "backgrounds_fx": [(comp([], {"type": "color", "color": "#808080", "vignette": v}), 1.0) for v in (0, .4, .8)],
        "wipe_linear_progress_bar": [(comp([shape(h=.04, y=.9, w=.8, **{"in": "wipe", "ease": "linear", "anim_dur": 4.0})]), t) for t in (0.5, 1.5, 2.5, 3.5)],
        "opacity_rotate_layers": [(comp([shape(color="#ef4444", rotate=r, opacity=o), shape(color="#3b82f6", w=.2, h=.2, x=.7, y=.3)]), 1.0) for r, o in ((0, 1), (30, .6), (90, 1), (-45, .4))],
        "transition_fade": [(two("fade"), t) for t in (1.5, 2.0, 2.5, 2.9)],
        "transition_slide_left": [(two("slide-left"), t) for t in (1.5, 2.0, 2.5, 2.9)],
        "transition_slide_up": [(two("slide-up"), t) for t in (1.5, 2.0, 2.5, 2.9)],
    }


def montage(items):
    sheet = Image.new("RGB", (TILE * len(items), TILE))
    for i, (c, t) in enumerate(items):
        sheet.paste(c.frame(t), (TILE * i, 0))
    return sheet
