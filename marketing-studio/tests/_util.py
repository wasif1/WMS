"""Shared helpers for the render tests (pixel measurements on tiny frames)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from PIL import Image, ImageChops

import engine

W = H = 200
BLACK = (0, 0, 0)


def spec(layers, bg=None, dur=4.0, w=W, h=H, **kw):
    s = {"name": "t", "width": w, "height": h, "fps": 10, "transition": {"type": "none"},
         "scenes": [{"duration": dur, "background": bg or {"type": "color", "color": "#000000"}, "layers": layers}]}
    s.update(kw)
    return s


def frame(layers, t, **kw):
    return engine.Composer(spec(layers, **kw)).frame(t)


def rect(**kw):
    d = {"type": "shape", "shape": "rect", "x": 0.5, "y": 0.5, "w": 0.4, "h": 0.4, "color": "#ffffff"}
    d.update(kw)
    return d


def ink(img, bg=BLACK, thresh=24):
    """Bounding box of everything that differs from a flat background colour."""
    solid = Image.new("RGB", img.size, bg)
    diff = ImageChops.difference(img, solid).convert("L").point(lambda v: 255 if v > thresh else 0)
    return diff.getbbox()


def centre(bb):
    return ((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2)


def size(bb):
    return (bb[2] - bb[0], bb[3] - bb[1])


def lum(img):
    return sum(img.convert("L").getdata()) / (img.width * img.height)


def same(a, b):
    return a.tobytes() == b.tobytes()


def mad(a, b):
    """Mean absolute pixel difference (0..255)."""
    d = ImageChops.difference(a.convert("RGB"), b.convert("RGB")).convert("L")
    return sum(d.getdata()) / (a.width * a.height)
