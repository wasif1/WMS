"""Rendering engine for Marketing Studio.

A *spec* (plain JSON) describes scenes made of layers. Every position and size is
a fraction of the canvas, so the same spec renders cleanly at any resolution.
Frames are drawn with Pillow and piped to ffmpeg for video. Nothing here talks to
the network.
"""
from __future__ import annotations

import json
import math
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
FONTS = ROOT / "fonts"
OUTPUTS = ROOT / "outputs"
PROJECTS = ROOT / "projects"
TEMPLATES = ROOT / "templates"

# --------------------------------------------------------------------------- presets
# kind: video / image / both. Sizes are the commonly requested social + ad sizes.
PRESETS = [
    {"id": "reels", "label": "Reels / TikTok / Shorts 9:16", "w": 1080, "h": 1920, "kind": "both"},
    {"id": "story", "label": "Story 9:16 (safe-zone aware)", "w": 1080, "h": 1920, "kind": "both"},
    {"id": "portrait", "label": "Instagram / Facebook feed 4:5", "w": 1080, "h": 1350, "kind": "both"},
    {"id": "square", "label": "Square 1:1", "w": 1080, "h": 1080, "kind": "both"},
    {"id": "landscape", "label": "YouTube / web 16:9 (1080p)", "w": 1920, "h": 1080, "kind": "both"},
    {"id": "hd720", "label": "720p 16:9 (small file)", "w": 1280, "h": 720, "kind": "both"},
    {"id": "uhd4k", "label": "4K 16:9", "w": 3840, "h": 2160, "kind": "both"},
    {"id": "fb_link", "label": "Facebook link ad 1.91:1", "w": 1200, "h": 628, "kind": "both"},
    {"id": "linkedin", "label": "LinkedIn post 1.91:1", "w": 1200, "h": 628, "kind": "both"},
    {"id": "x_post", "label": "X / Twitter post 16:9", "w": 1600, "h": 900, "kind": "both"},
    {"id": "pinterest", "label": "Pinterest pin 2:3", "w": 1000, "h": 1500, "kind": "both"},
    {"id": "yt_thumb", "label": "YouTube thumbnail", "w": 1280, "h": 720, "kind": "image"},
    {"id": "fb_cover", "label": "Facebook cover", "w": 820, "h": 312, "kind": "image"},
    {"id": "ad_mrec", "label": "Display ad 300x250", "w": 300, "h": 250, "kind": "image"},
    {"id": "ad_leader", "label": "Display ad 728x90", "w": 728, "h": 90, "kind": "image"},
    {"id": "ad_sky", "label": "Display ad 160x600", "w": 160, "h": 600, "kind": "image"},
    {"id": "ad_half", "label": "Display ad 300x600", "w": 300, "h": 600, "kind": "image"},
]
PRESET_BY_ID = {p["id"]: p for p in PRESETS}

MAX_EDGE = 4096
# H.264 quality ladder: (crf, x264 preset)
QUALITY = {"standard": (23, "veryfast"), "hd": (18, "medium"), "ultra": (14, "slow")}
ANIMS_IN = ("none", "fade", "slide-up", "slide-down", "slide-left", "slide-right", "zoom", "pop", "wipe")
ANIMS_OUT = ("none", "fade", "slide-down", "zoom")
TRANSITIONS = ("none", "fade", "slide-left", "slide-up")


class SpecError(ValueError):
    """The spec (or a request about it) is invalid. Message is user-facing."""


class Cancelled(Exception):
    pass


# --------------------------------------------------------------------------- helpers
def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def num(v, default, lo, hi, name="value"):
    if v is None:
        return default
    try:
        x = float(v)
    except (TypeError, ValueError):
        raise SpecError(f"{name} must be a number, got {v!r}")
    if math.isnan(x) or math.isinf(x):
        raise SpecError(f"{name} must be finite")
    return clamp(x, lo, hi)


def slug(text: str) -> str:
    s = re.sub(r"[^A-Za-z0-9_-]+", "-", str(text)).strip("-")
    return (s or "untitled")[:60]


def parse_color(value, default=(0, 0, 0, 255)):
    if value is None:
        return default
    if isinstance(value, (list, tuple)) and 3 <= len(value) <= 4:
        v = [int(clamp(c, 0, 255)) for c in value]
        return tuple(v + [255] * (4 - len(v)))
    s = str(value).strip().lstrip("#")
    if re.fullmatch(r"[0-9a-fA-F]{3}", s):
        s = "".join(c * 2 for c in s)
    if re.fullmatch(r"[0-9a-fA-F]{6}", s):
        s += "ff"
    if not re.fullmatch(r"[0-9a-fA-F]{8}", s):
        raise SpecError(f"Bad colour {value!r}; use #rgb, #rrggbb or #rrggbbaa")
    return tuple(int(s[i:i + 2], 16) for i in range(0, 8, 2))


def with_opacity(rgba, opacity):
    return (rgba[0], rgba[1], rgba[2], int(rgba[3] * clamp(opacity, 0, 1)))


def ease_out(p):
    return 1 - (1 - p) ** 3


def ease_in_out(p):
    return p * p * (3 - 2 * p)


def ease_out_back(p):
    c1, c3 = 1.70158, 2.70158
    return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2


# --------------------------------------------------------------------------- assets
def asset_path(name: str) -> Path:
    """Resolve an asset name to a file inside assets/. Rejects traversal."""
    if not name or not isinstance(name, str):
        raise SpecError("Missing asset name")
    base = ASSETS.resolve()
    p = (base / name).resolve()
    if base not in p.parents:
        raise SpecError(f"Asset {name!r} is outside the assets folder")
    if not p.is_file():
        raise SpecError(f"Asset not found: {name!r} (put it in marketing-studio/assets/)")
    return p


@lru_cache(maxsize=32)
def _load_image_cached(path: str, mtime: float) -> Image.Image:
    try:
        im = Image.open(path)
        im = ImageOps.exif_transpose(im)
        return im.convert("RGBA")
    except Exception as e:  # corrupt / unsupported
        raise SpecError(f"Cannot read image {Path(path).name}: {e}")


def load_image(name: str) -> Image.Image:
    p = asset_path(name)
    return _load_image_cached(str(p), p.stat().st_mtime)


_FONT_ALIASES = {
    "sans": ["Inter-Regular.otf", "DejaVuSans.ttf", "LiberationSans-Regular.ttf", "Arial.ttf", "arial.ttf", "Helvetica.ttc", "FreeSans.ttf"],
    "sans-bold": ["Inter-Bold.otf", "DejaVuSans-Bold.ttf", "LiberationSans-Bold.ttf", "Arial Bold.ttf", "arialbd.ttf", "FreeSansBold.ttf"],
    "serif": ["DejaVuSerif.ttf", "LiberationSerif-Regular.ttf", "Times New Roman.ttf", "times.ttf", "FreeSerif.ttf"],
    "serif-bold": ["DejaVuSerif-Bold.ttf", "LiberationSerif-Bold.ttf", "Times New Roman Bold.ttf", "timesbd.ttf", "FreeSerifBold.ttf"],
    "mono": ["DejaVuSansMono.ttf", "LiberationMono-Regular.ttf", "Courier New.ttf", "cour.ttf", "FreeMono.ttf"],
}
FONT_CHOICES = list(_FONT_ALIASES)
_font_index_lock = threading.Lock()
_font_index: dict[str, str] | None = None


def _build_font_index() -> dict[str, str]:
    global _font_index
    with _font_index_lock:
        if _font_index is None:
            idx: dict[str, str] = {}
            dirs = [FONTS, Path("/usr/share/fonts"), Path("/usr/local/share/fonts"),
                    Path("/Library/Fonts"), Path("/System/Library/Fonts"),
                    Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts",
                    Path.home() / ".fonts", Path.home() / "Library/Fonts"]
            for d in dirs:  # earlier dirs win (our own fonts/ folder first)
                if not d.is_dir():
                    continue
                for dp, _dn, fns in os.walk(d):
                    for fn in fns:
                        if fn.lower().endswith((".ttf", ".otf", ".ttc")):
                            idx.setdefault(fn.lower(), os.path.join(dp, fn))
            _font_index = idx
        return _font_index


_RTL_RE = re.compile("[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]")
_SCRIPT_FONTS = {  # (detector, regular candidates, bold candidates) for scripts the Latin fonts lack
    "arabic": (re.compile("[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]"),
               ["NotoNaskhArabic-Regular.ttf", "NotoSansArabic-Regular.ttf", "Amiri-Regular.ttf", "NotoNastaliqUrdu-Regular.ttf", "Lateef.ttf", "DejaVuSans.ttf", "Tahoma.ttf", "arial.ttf", "FreeSerif.ttf"],
               ["NotoNaskhArabic-Bold.ttf", "NotoSansArabic-Bold.ttf", "Amiri-Bold.ttf", "NotoNastaliqUrdu-Bold.ttf", "DejaVuSans-Bold.ttf", "Tahomabd.ttf", "arialbd.ttf", "FreeSerifBold.ttf"]),
    "hebrew": (re.compile("[\u0590-\u05ff]"), ["DejaVuSans.ttf", "FreeSerif.ttf", "arial.ttf"], ["DejaVuSans-Bold.ttf", "FreeSerifBold.ttf", "arialbd.ttf"]),
    "devanagari": (re.compile("[\u0900-\u097f]"), ["NotoSansDevanagari-Regular.ttf", "Mangal.ttf", "FreeSerif.ttf", "Lohit-Devanagari.ttf"],
                   ["NotoSansDevanagari-Bold.ttf", "Mangalb.ttf", "FreeSerifBold.ttf", "Lohit-Devanagari.ttf"]),
}


def is_rtl(text: str) -> bool:
    return bool(_RTL_RE.search(text or ""))


def _glyph_sig(f, ch: str) -> bytes:
    im = Image.new("L", (96, 96), 0)
    ImageDraw.Draw(im).text((8, 8), ch, font=f, fill=255)
    return im.tobytes()


@lru_cache(maxsize=8192)
def _has_glyph(path: str, ch: str) -> bool:
    """True if the font really draws `ch` (differs from the font's own missing-glyph box and is not blank)."""
    try:
        f = ImageFont.truetype(path, 40)
        sig = _glyph_sig(f, ch)
        if not any(sig):
            return False
        return sig not in {_glyph_sig(f, bad) for bad in ("\uffff", "\U0010ffff", "\ufdd0")}
    except Exception:
        return True


def missing_glyphs(font, text: str) -> set[str]:
    """Characters in `text` that `font` cannot draw (shown as empty boxes). Spaces/newlines/markup ignored."""
    path = getattr(font, "path", None)
    if not path:
        return set()
    return {c for c in set(text) if not c.isspace() and c != "*" and not _has_glyph(str(path), c)}


def pick_font(name: str, px: int, text: str):
    """Font for this text: the requested one, or - for the built-in Latin aliases - a fallback that covers
    Arabic/Urdu/Hebrew/Devanagari (first installed candidate that has every glyph; explicit font files are respected)."""
    if name in _FONT_ALIASES:
        idx = _build_font_index()
        for rx, regular, bold in _SCRIPT_FONTS.values():
            if rx.search(text):
                need = {c for c in text if not c.isspace() and c != "*"}
                best, best_miss = None, None
                for cand in (bold if name.endswith("bold") else regular):
                    path = idx.get(cand.lower())
                    if not path:
                        continue
                    miss = sum(1 for c in need if not _has_glyph(path, c))
                    if best is None or miss < best_miss:
                        best, best_miss = cand, miss
                    if miss == 0:
                        break
                if best:
                    return get_font(best, px)
    return get_font(name, px)


def user_fonts() -> list[str]:
    if not FONTS.is_dir():
        return []
    return sorted(p.name for p in FONTS.rglob("*") if p.suffix.lower() in (".ttf", ".otf"))


@lru_cache(maxsize=64)
def get_font(name: str, px: int):
    idx = _build_font_index()
    for cand in _FONT_ALIASES.get(name, [name]):
        path = idx.get(cand.lower())
        if path:
            try:
                return ImageFont.truetype(path, px)
            except OSError:
                continue
    return ImageFont.load_default(size=px)


# --------------------------------------------------------------------------- spec
def _even(v: int) -> int:
    return int(v) - (int(v) % 2)


def normalize(spec) -> dict:
    """Validate and fill defaults. Returns a new dict; input is not modified."""
    if not isinstance(spec, dict):
        raise SpecError("Spec must be a JSON object")
    s = json.loads(json.dumps(spec))
    if '"$' in json.dumps(s) or "{{brand." in json.dumps(s):
        import brand as _brand  # lazy: brand.py imports engine
        s = _brand.apply_tokens(s)
    s["name"] = str(s.get("name") or "untitled")[:80]
    s["width"] = _even(num(s.get("width"), 1080, 64, MAX_EDGE, "width"))
    s["height"] = _even(num(s.get("height"), 1920, 64, MAX_EDGE, "height"))
    s["fps"] = int(num(s.get("fps"), 30, 1, 60, "fps"))
    scenes = s.get("scenes")
    if not isinstance(scenes, list) or not scenes:
        raise SpecError("Spec needs at least one scene")
    if len(scenes) > 60:
        raise SpecError("Too many scenes (max 60)")
    for i, sc in enumerate(scenes):
        if not isinstance(sc, dict):
            raise SpecError(f"Scene {i + 1} must be an object")
        sc["duration"] = num(sc.get("duration"), 3, 0.5, 120, f"scene {i + 1} duration")
        sc.setdefault("background", {"type": "color", "color": "#111111"})
        layers = sc.setdefault("layers", [])
        if not isinstance(layers, list) or len(layers) > 100:
            raise SpecError(f"Scene {i + 1}: layers must be a list (max 100)")
        for j, L in enumerate(layers):
            if not isinstance(L, dict) or L.get("type") not in ("text", "image", "shape"):
                raise SpecError(f"Scene {i + 1} layer {j + 1}: type must be text, image or shape")
            for key, allowed in (("in", ANIMS_IN), ("out", ANIMS_OUT)):
                if L.get(key, "none") not in allowed:
                    raise SpecError(f"Scene {i + 1} layer {j + 1}: '{key}' must be one of {', '.join(allowed)}")
    tr = s.get("transition") or {}
    ttype = tr.get("type", "fade" if len(scenes) > 1 else "none")
    if ttype not in TRANSITIONS:
        raise SpecError(f"transition.type must be one of {', '.join(TRANSITIONS)}")
    tdur = num(tr.get("duration"), 0.5, 0.1, 3, "transition.duration")
    tdur = min(tdur, min(sc["duration"] for sc in scenes) * 0.8)
    s["transition"] = {"type": ttype, "duration": 0.0 if ttype == "none" else tdur}
    return s


# --------------------------------------------------------------------------- drawing
def make_gradient(W, H, colors, angle, g=128) -> Image.Image:
    """CSS-style linear gradient (0deg = up, 90deg = right, 180deg = down)."""
    stops = [parse_color(c) for c in (colors or ["#000000", "#ffffff"])]
    if len(stops) < 2:
        stops = stops * 2
    a = math.radians(angle)
    dx, dy = math.sin(a), -math.cos(a)
    length = abs(W * dx) + abs(H * dy) or 1
    small = Image.new("RGB", (g, g))
    px = small.load()
    seg = len(stops) - 1
    for j in range(g):
        py = (j + 0.5) / g * H - H / 2
        for i in range(g):
            pxx = (i + 0.5) / g * W - W / 2
            t = clamp((pxx * dx + py * dy) / length + 0.5, 0, 1) * seg
            k = min(int(t), seg - 1)
            f = t - k
            c0, c1 = stops[k], stops[k + 1]
            px[i, j] = tuple(int(c0[n] + (c1[n] - c0[n]) * f) for n in range(3))
    return small.resize((W, H), Image.BICUBIC)


def _tokens(para):
    """Split a paragraph into [word, accent, space_before]; *like this* marks accent words."""
    out, space = [], False
    for i, seg in enumerate(para.split("*")):
        for part in re.findall(r"\s+|\S+", seg):
            if part.isspace():
                space = True
            else:
                out.append([part, i % 2 == 1, space or not out])
                space = False
    return out


def _layout(text, font, maxw, probe):
    """Greedy word wrap. Returns [(units, width, rtl)], a unit being tokens that must not be split."""
    space_w = probe.textlength(" ", font=font)
    lines = []
    for para in text.split("\n"):
        units = []
        for t in _tokens(para):
            if t[2] or not units:
                units.append([t])
            else:
                units[-1].append(t)
        rtl = is_rtl(para)
        if not rtl:  # a single word wider than the line is broken into pieces instead of running off the frame
            wide = []
            for u in units:
                if len(u) == 1 and probe.textlength(u[0][0], font=font) > maxw:
                    piece = ""
                    for ch in u[0][0]:
                        if piece and probe.textlength(piece + ch, font=font) > maxw:
                            wide.append([[piece, u[0][1], True]])
                            piece = ch
                        else:
                            piece += ch
                    wide.append([[piece, u[0][1], True]])
                else:
                    wide.append(u)
            units = wide
        cur, curw = [], 0.0
        for u in units:
            uw = sum(probe.textlength(t[0], font=font) for t in u)
            add = uw + (space_w if cur else 0)
            if cur and curw + add > maxw:
                lines.append((cur, curw, rtl))
                cur, curw = [u], uw
            else:
                cur.append(u)
                curw += add
        lines.append((cur, curw, rtl))
    return lines


def _round_mask(size, radius):
    w, h = size
    r = int(clamp(radius, 0, 0.5) * min(w, h))
    scale = 3
    m = Image.new("L", (w * scale, h * scale), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, w * scale - 1, h * scale - 1), radius=r * scale, fill=255)
    return m.resize((w, h), Image.LANCZOS)


def _drop_shadow(sprite: Image.Image, m: int) -> Image.Image:
    blur = max(2, int(m * 0.012))
    off = max(2, int(m * 0.008))
    pad = blur * 3 + off
    big = Image.new("RGBA", (sprite.width + pad * 2, sprite.height + pad * 2), (0, 0, 0, 0))
    sh = Image.new("RGBA", big.size, (0, 0, 0, 0))
    black = Image.new("RGBA", sprite.size, (0, 0, 0, 140))
    sh.paste(black, (pad, pad + off), sprite.getchannel("A"))
    sh = sh.filter(ImageFilter.GaussianBlur(blur))
    big = Image.alpha_composite(big, sh)
    big.alpha_composite(sprite, (pad, pad))
    return big


class SceneRenderer:
    def __init__(self, scene: dict, W: int, H: int):
        self.scene, self.W, self.H = scene, W, H
        self.dur = scene["duration"]
        self._bg = None
        self._sprites: dict[int, Image.Image | None] = {}
        self._insets: dict[int, int] = {}
        self._last_inset = 0
        self.collect = False          # QA: record where each layer was drawn
        self.boxes: list[dict] = []

    # ---- background
    def _build_bg(self):
        bg = self.scene.get("background") or {}
        W, H = self.W, self.H
        kind = bg.get("type", "color")
        if kind == "gradient":
            base = make_gradient(W, H, bg.get("colors"), num(bg.get("angle"), 160, -360, 360, "angle"))
        elif kind == "image":
            src = load_image(bg.get("asset"))
            base = src
            kb = num(bg.get("kenburns"), 0.0, 0, 0.5, "kenburns")
            cover = max(W / src.width, H / src.height)
            want = cover * (1 + kb) * 1.5  # pre-shrink huge photos once
            if want < 1:
                base = src.resize((max(1, int(src.width * want)), max(1, int(src.height * want))), Image.LANCZOS)
            # flatten transparency onto black
            flat = Image.new("RGB", base.size, (0, 0, 0))
            flat.paste(base, mask=base.getchannel("A"))
            base = flat
        else:
            base = Image.new("RGB", (W, H), parse_color(bg.get("color", "#111111"))[:3])
        dim = num(bg.get("dim"), 0, 0, 0.9, "dim")
        vig = num(bg.get("vignette"), 0, 0, 0.9, "vignette")
        mask = None
        if vig:
            mask = Image.radial_gradient("L").resize((W, H), Image.BICUBIC).point([int(max(0, i - 70) * vig * 1.4) for i in range(256)])
        self._bg = (kind, base, dim, mask)

    def _bg_frame(self, t):
        if self._bg is None:
            self._build_bg()
        kind, base, dim, vmask = self._bg
        W, H = self.W, self.H
        bgs = self.scene.get("background") or {}
        if kind == "gradient" and bgs.get("drift"):
            ang = num(bgs.get("angle"), 160, -360, 360, "angle") + num(bgs["drift"], 0, -720, 720, "drift") * clamp(t / self.dur, 0, 1)
            frame = make_gradient(W, H, bgs.get("colors"), ang, g=48)
        elif kind == "image":
            kb = num((self.scene.get("background") or {}).get("kenburns"), 0.0, 0, 0.5, "kenburns")
            z = 1 + kb * clamp(t / self.dur, 0, 1)
            sc = max(W / base.width, H / base.height) * z
            vw, vh = W / sc, H / sc
            fx = num((self.scene["background"]).get("focus_x"), 0.5, 0, 1, "focus_x")
            fy = num((self.scene["background"]).get("focus_y"), 0.5, 0, 1, "focus_y")
            l = (base.width - vw) * fx
            tp = (base.height - vh) * fy
            frame = base.resize((W, H), Image.BILINEAR, box=(l, tp, l + vw, tp + vh))
        else:
            frame = base.copy()
        if dim:
            frame = Image.blend(frame, Image.new("RGB", frame.size, (0, 0, 0)), dim)
        if vmask is not None:
            frame.paste((0, 0, 0), mask=vmask)
        return frame

    # ---- layer sprites
    def _sprite(self, idx, L):
        if idx not in self._sprites:
            kind = L["type"]
            self._last_inset = 0
            sp = {"text": self._text, "image": self._image, "shape": self._shape}[kind](L)
            self._insets[idx] = self._last_inset
            if sp is not None and L.get("rotate"):
                self._insets[idx] = 0
                sp = sp.rotate(num(L["rotate"], 0, -360, 360, "rotate"), expand=True, resample=Image.BICUBIC)
            self._sprites[idx] = sp
        return self._sprites[idx]

    def _text(self, L):
        W, H = self.W, self.H
        m = min(W, H)
        text = str(L.get("text", ""))
        if L.get("upper"):
            text = text.upper()
        if not text.strip():
            return None
        px = max(8, int(num(L.get("size"), 0.07, 0.005, 1, "size") * m))
        font = pick_font(str(L.get("font", "sans-bold")), px, text)
        maxw = int(num(L.get("w"), 0.84, 0.05, 1, "w") * W)
        probe = ImageDraw.Draw(Image.new("L", (1, 1)))
        lines = _layout(text, font, maxw, probe)
        step = int(px * num(L.get("line_height"), 1.2, 0.8, 3, "line_height"))
        align = L.get("align", "center") if L.get("align") in ("left", "center", "right") else "center"
        stroke = L.get("stroke") or {}
        sw = int(num(stroke.get("width"), 0, 0, 0.05, "stroke.width") * m)
        asc, desc = font.getmetrics()
        block_w = max(ln[1] for ln in lines)
        tw = int(math.ceil(block_w)) + 2 * sw
        th = (len(lines) - 1) * step + asc + desc + 2 * sw
        space_w = probe.textlength(" ", font=font)
        color = parse_color(L.get("color", "#ffffff"))
        accent = parse_color(L["accent"]) if L.get("accent") else color
        box = L.get("box") if isinstance(L.get("box"), dict) else None
        bpad = int(num(box.get("pad"), 0.03, 0, 0.3, "box.pad") * m) if box else 0
        margin = int(px * 0.5) if L.get("shadow") else 3
        cw, ch = tw + 2 * (bpad + margin), th + 2 * (bpad + margin)
        sprite = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
        ox, oy = margin + bpad + sw, margin + bpad + sw

        def paint(img, dx, dy, col, acc, scol):
            d = ImageDraw.Draw(img)
            for k, (units, lw, rtl) in enumerate(lines):
                x = ox + dx + {"left": 0, "center": (block_w - lw) / 2, "right": block_w - lw}[align]
                y = oy + dy + k * step
                if rtl:  # words run right-to-left; each word is shaped by raqm
                    xr = x + lw
                    for u in units:  # logical order: the first word is the rightmost
                        uw = sum(probe.textlength(t[0], font=font) for t in u)
                        xx = xr - uw
                        for tok in u:
                            d.text((xx, y), tok[0], font=font, fill=acc if tok[1] else col, anchor="la",
                                   stroke_width=sw, stroke_fill=scol)
                            xx += probe.textlength(tok[0], font=font)
                        xr -= uw + space_w
                    continue
                for ui, u in enumerate(units):
                    if ui:
                        x += space_w
                    for tok in u:
                        d.text((x, y), tok[0], font=font, fill=acc if tok[1] else col, anchor="la",
                               stroke_width=sw, stroke_fill=scol)
                        x += probe.textlength(tok[0], font=font)

        if box:
            col = with_opacity(parse_color(box.get("color", "#000000")), num(box.get("opacity"), 0.6, 0, 1, "box.opacity"))
            r = int(num(box.get("radius"), 0.25, 0, 1, "box.radius") * min(cw - 2 * margin, ch - 2 * margin) / 2)
            ImageDraw.Draw(sprite).rounded_rectangle((margin, margin, cw - margin - 1, ch - margin - 1), radius=r, fill=col)
        if L.get("shadow"):
            sh = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
            off = max(2, int(px * 0.06))
            dark = (0, 0, 0, 170)
            paint(sh, off, off, dark, dark, dark)
            sprite = Image.alpha_composite(sprite, sh.filter(ImageFilter.GaussianBlur(max(1, px * 0.06))))
        paint(sprite, 0, 0, color, accent, parse_color(stroke.get("color", "#000000")))
        self._last_inset = ox  # where the ink starts inside the sprite, so anchor "left" lines up with the ink
        return sprite

    def _image(self, L):
        W, H = self.W, self.H
        if not L.get("asset"):
            return None  # e.g. "$logo" when the brand has no logo yet
        src = load_image(L.get("asset"))
        tw = max(1, int(num(L.get("w"), 0.5, 0.01, 4, "w") * W))
        if L.get("h") is not None:  # fixed box -> cover crop
            th = max(1, int(num(L["h"], 0.3, 0.01, 4, "h") * H))
            im = ImageOps.fit(src, (tw, th), Image.LANCZOS)
        else:
            th = max(1, int(src.height * tw / src.width))
            im = src.resize((tw, th), Image.LANCZOS)
        radius = num(L.get("radius"), 0, 0, 0.5, "radius")
        if radius:
            a = im.getchannel("A")
            from PIL import ImageChops
            im.putalpha(ImageChops.multiply(a, _round_mask(im.size, radius)))
        if L.get("shadow"):
            im = _drop_shadow(im, min(W, H))
        return im

    def _shape(self, L):
        W, H = self.W, self.H
        kind = L.get("shape", "rect")
        if kind not in ("rect", "rounded", "circle"):
            raise SpecError("shape must be rect, rounded or circle")
        w = max(1, int(num(L.get("w"), 0.5, 0.001, 4, "w") * W))
        h = w if kind == "circle" else max(1, int(num(L.get("h"), 0.1, 0.001, 4, "h") * H))
        k = 2 if w * h < 4_000_000 else 1  # supersample for smooth edges
        fill = parse_color(L.get("color", "#ffffff"))
        im = Image.new("RGBA", (w * k, h * k), fill[:3] + (0,))
        d = ImageDraw.Draw(im)
        stroke = L.get("stroke") or {}
        sw = int(num(stroke.get("width"), 0, 0, 0.05, "stroke.width") * min(W, H) * k)
        kw = dict(fill=fill, outline=parse_color(stroke.get("color", "#ffffff")) if sw else None, width=sw)
        box = (0, 0, w * k - 1, h * k - 1)
        if kind == "circle":
            d.ellipse(box, **kw)
        elif kind == "rounded":
            d.rounded_rectangle(box, radius=int(num(L.get("radius"), 0.3, 0, 1, "radius") * min(w, h) * k / 2), **kw)
        else:
            d.rectangle(box, **kw)
        if k > 1:
            im = im.resize((w, h), Image.LANCZOS)
        blur = num(L.get("blur"), 0, 0, 0.5, "blur")
        if blur:  # soft glow
            r = max(1, int(blur * min(W, H)))
            big = Image.new("RGBA", (w + 6 * r, h + 6 * r), fill[:3] + (0,))
            big.paste(im, (3 * r, 3 * r))
            im = big.filter(ImageFilter.GaussianBlur(r))
        if L.get("shadow"):
            im = _drop_shadow(im, min(W, H))
        return im

    # ---- animation
    def _anim(self, L, t):
        W, H = self.W, self.H
        start = num(L.get("start"), 0, 0, 1e4, "start")
        end = num(L.get("end"), self.dur, 0, 1e4, "end")
        ad = num(L.get("anim_dur"), 0.5, 0.05, 120, "anim_dur")
        alpha, scale, dx, dy = num(L.get("opacity"), 1, 0, 1, "opacity"), 1.0, 0.0, 0.0
        p = clamp((t - start) / ad, 0, 1)
        e = p if L.get("ease") == "linear" else ease_out(p)
        wipe = None
        kind = L.get("in", "none")
        if kind == "fade":
            alpha *= p
        elif kind == "slide-up":
            dy, alpha = (1 - e) * 0.1 * H, alpha * p
        elif kind == "slide-down":
            dy, alpha = -(1 - e) * 0.1 * H, alpha * p
        elif kind == "slide-left":
            dx, alpha = (1 - e) * 0.1 * W, alpha * p
        elif kind == "slide-right":
            dx, alpha = -(1 - e) * 0.1 * W, alpha * p
        elif kind == "zoom":
            scale, alpha = 0.6 + 0.4 * e, alpha * p
        elif kind == "pop":
            scale, alpha = max(0.01, ease_out_back(p)), alpha * min(1, p * 3)
        elif kind == "wipe":
            wipe = e
        q = ease_out(clamp((end - t) / ad, 0, 1))
        kind = L.get("out", "none")
        if kind == "fade":
            alpha *= q
        elif kind == "zoom":
            scale, alpha = scale * (0.6 + 0.4 * q), alpha * q
        elif kind == "slide-down":
            dy, alpha = dy + (1 - q) * 0.1 * H, alpha * q
        return alpha, scale, dx, dy, wipe

    # ---- compose
    def render(self, t: float) -> Image.Image:
        frame = self._bg_frame(t)
        self.boxes = []
        W, H = self.W, self.H
        for idx, L in enumerate(self.scene.get("layers", [])):
            start = num(L.get("start"), 0, 0, 1e4, "start")
            end = num(L.get("end"), self.dur, 0, 1e4, "end")
            if t < start or t > end:
                continue
            sp = self._sprite(idx, L)
            if sp is None:
                continue
            alpha, scale, dx, dy, wipe = self._anim(L, t)
            mo = L.get("motion")
            if isinstance(mo, dict):  # slow continuous drift / push-in over the scene
                q = clamp(t / self.dur, 0, 1)
                dx += num(mo.get("dx"), 0, -3, 3, "motion.dx") * W * q
                dy += num(mo.get("dy"), 0, -3, 3, "motion.dy") * H * q
                scale *= 1 + num(mo.get("scale"), 0, -0.9, 3, "motion.scale") * q
            if alpha <= 0.002 or (wipe is not None and wipe <= 0.002):
                continue
            full_w = sp.width
            if wipe is not None and wipe < 0.998:
                sp = sp.crop((0, 0, max(1, int(full_w * wipe)), sp.height))
            if abs(scale - 1) > 0.002:
                sp = sp.resize((max(1, int(sp.width * scale)), max(1, int(sp.height * scale))), Image.BILINEAR)
                full_w = int(full_w * scale)
            if alpha < 0.998:
                sp = sp.copy()
                sp.putalpha(sp.getchannel("A").point([int(i * alpha) for i in range(256)]))
            cx = num(L.get("x"), 0.5, -2, 3, "x") * W + dx
            cy = num(L.get("y"), 0.5, -2, 3, "y") * H + dy
            anchor = L.get("anchor", "center")
            inset = self._insets.get(idx, 0)
            if anchor == "left":      # x is the left edge of the ink (independent of how wide the text measures)
                px0 = int(cx - inset)
            elif anchor == "right":
                px0 = int(cx - full_w + inset)
            else:
                px0 = int(cx - full_w / 2)
            py0 = int(cy - sp.height / 2)
            frame.paste(sp, (px0, py0), sp)
            if self.collect:
                ink = sp.getchannel("A").point(lambda v: 255 if v > 40 else 0).getbbox()
                if ink:
                    self.boxes.append({"idx": idx, "type": L["type"], "layer": L,
                                       "box": (px0 + ink[0], py0 + ink[1], px0 + ink[2], py0 + ink[3])})
        return frame

    def poster_time(self) -> float:
        """Time at which every layer's entrance animation has finished (ignores scene-long progress bars)."""
        t = 0.0
        for L in self.scene.get("layers", []):
            ad = num(L.get("anim_dur"), 0.5, 0.05, 120) if L.get("in", "none") != "none" else 0
            if ad >= 0.8 * self.dur:
                continue
            t = max(t, num(L.get("start"), 0, 0, 1e4) + ad)
        return min(t + 0.05, self.dur - 0.01)


class Composer:
    """Whole timeline: scenes + transitions at a given pixel size."""

    def __init__(self, spec: dict, W: int | None = None, H: int | None = None):
        self.spec = normalize(spec)
        self.W = _even(W or self.spec["width"])
        self.H = _even(H or self.spec["height"])
        self.scenes = [SceneRenderer(sc, self.W, self.H) for sc in self.spec["scenes"]]
        tr = self.spec["transition"]
        self.ttype, self.tdur = tr["type"], tr["duration"]
        self.starts, t = [], 0.0
        for i, r in enumerate(self.scenes):
            self.starts.append(t)
            t += r.dur - (self.tdur if i < len(self.scenes) - 1 else 0)
        last = len(self.scenes) - 1
        self.total = self.starts[last] + self.scenes[last].dur

    def poster_global(self, i: int) -> float:
        """Global time showing scene i fully built and outside any transition overlap."""
        r, n = self.scenes[i], len(self.scenes)
        lo = (self.tdur + 0.05) if i > 0 else 0.0
        hi = r.dur - (self.tdur if i < n - 1 else 0) - 0.02
        return self.starts[i] + clamp(r.poster_time(), min(lo, hi), max(lo, hi))

    def frame(self, t: float) -> Image.Image:
        t = clamp(t, 0, self.total - 1e-4)
        active = [i for i, r in enumerate(self.scenes) if self.starts[i] <= t < self.starts[i] + r.dur]
        if len(active) == 1:
            i = active[0]
            return self.scenes[i].render(t - self.starts[i])
        a, b = active[0], active[1]
        fa = self.scenes[a].render(t - self.starts[a])
        fb = self.scenes[b].render(t - self.starts[b])
        p = ease_in_out(clamp((t - self.starts[b]) / self.tdur, 0, 1))
        if self.ttype == "fade":
            return Image.blend(fa, fb, p)
        out = Image.new("RGB", fa.size)
        if self.ttype == "slide-left":
            off = int(p * self.W)
            out.paste(fa, (-off, 0))
            out.paste(fb, (self.W - off, 0))
        else:  # slide-up
            off = int(p * self.H)
            out.paste(fa, (0, -off))
            out.paste(fb, (0, self.H - off))
        return out


# --------------------------------------------------------------------------- export
def ffmpeg_bin() -> str | None:
    return os.environ.get("FFMPEG_BIN") or shutil.which("ffmpeg")


def environment_report() -> dict:
    ff = ffmpeg_bin()
    h264 = False
    if ff:
        try:
            out = subprocess.run([ff, "-hide_banner", "-encoders"], capture_output=True, text=True, timeout=15).stdout
            h264 = "libx264" in out
        except Exception:
            pass
    return {"ffmpeg": ff, "libx264": h264, "pillow": Image.__version__, "fonts": user_fonts()}


def resolve_target(t) -> tuple[int, int, str]:
    """Target is a preset id string, 'WxH' string, or {'w','h'} / {'preset'} dict."""
    if isinstance(t, dict):
        if t.get("preset"):
            t = t["preset"]
        else:
            w, h = int(num(t.get("w"), 0, 64, MAX_EDGE, "w")), int(num(t.get("h"), 0, 64, MAX_EDGE, "h"))
            return _even(w), _even(h), f"{w}x{h}"
    if isinstance(t, str):
        if t in PRESET_BY_ID:
            p = PRESET_BY_ID[t]
            return p["w"], p["h"], p["id"]
        m = re.fullmatch(r"(\d{2,4})x(\d{2,4})", t)
        if m:
            w, h = int(m[1]), int(m[2])
            if 64 <= w <= MAX_EDGE and 64 <= h <= MAX_EDGE:
                return _even(w), _even(h), f"{w}x{h}"
    raise SpecError(f"Unknown size {t!r}. Use a preset id ({', '.join(PRESET_BY_ID)}) or WxH like 1080x1350")


def _out_name(spec_name, label, w, h, suffix, ext):
    return f"{slug(spec_name)}_{label}_{w}x{h}{suffix}_{time.strftime('%H%M%S')}.{ext}"


def render_video(spec, out_path: Path, W, H, fps=None, fmt="mp4", progress=None, cancel=None, audio=True, quality="hd"):
    ff = ffmpeg_bin()
    if not ff or not shutil.which(ff):
        raise SpecError("ffmpeg not found. Install it (see README) or set FFMPEG_BIN. Image export still works without it.")
    comp = Composer(spec, W, H)
    fps = int(num(fps, comp.spec["fps"], 1, 60, "fps"))
    total = comp.total
    n = max(1, math.ceil(total * fps))
    cmd = [ff, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
           "-s", f"{comp.W}x{comp.H}", "-r", str(fps), "-i", "-"]
    music = comp.spec.get("audio") if (audio and fmt == "mp4") else None
    if music:
        ap = asset_path(music.get("asset"))
        cmd += ["-stream_loop", "-1", "-i", str(ap)]
        fo = min(num(music.get("fade_out"), 1.0, 0, 10, "audio.fade_out"), total)
        af = f"volume={num(music.get('volume'), 0.8, 0, 2, 'audio.volume')}"
        if fo:
            af += f",afade=t=out:st={max(0, total - fo):.3f}:d={fo:.3f}"
        cmd += ["-map", "0:v", "-map", "1:a", "-af", af, "-c:a", "aac", "-b:a", "192k"]
    if fmt == "gif":
        gw = min(comp.W, 640) // 2 * 2
        gfps = min(fps, 15)
        cmd += ["-vf", f"fps={gfps},scale={gw}:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5",
                "-loop", "0"]
    else:
        crf, preset = QUALITY.get(quality, QUALITY["hd"])
        cmd += ["-c:v", "libx264", "-preset", preset, "-crf", str(crf), "-profile:v", "high", "-pix_fmt", "yuv420p",
                "-movflags", "+faststart"]
    cmd += ["-t", f"{total:.3f}", str(out_path)]
    err = tempfile.TemporaryFile()
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=err)
    try:
        for i in range(n):
            if cancel and cancel.is_set():
                raise Cancelled()
            proc.stdin.write(comp.frame(i / fps).tobytes())
            if progress:
                progress((i + 1) / n)
        proc.stdin.close()
        rc = proc.wait()
    except BrokenPipeError as e:  # ffmpeg died early; surface its message
        proc.kill()
        proc.wait()
        out_path.unlink(missing_ok=True)
        err.seek(0)
        raise SpecError(f"ffmpeg failed: {err.read().decode(errors='replace')[-400:] or e}")
    except BaseException:  # Cancelled, SpecError from a bad layer, Ctrl+C ...
        proc.kill()
        proc.wait()
        out_path.unlink(missing_ok=True)
        raise
    finally:
        err.close()
    if rc != 0:
        out_path.unlink(missing_ok=True)
        raise SpecError("ffmpeg exited with an error; check that the audio asset is a valid audio file")
    return out_path


def render_images(spec, out_dir: Path, W, H, label, scene=None, fmt="png"):
    comp = Composer(spec, W, H)
    idxs = range(len(comp.scenes)) if scene is None else [int(scene)]
    files = []
    for i in idxs:
        if not 0 <= i < len(comp.scenes):
            raise SpecError(f"Scene {i + 1} does not exist")
        r = comp.scenes[i]
        img = r.render(r.poster_time())
        name = _out_name(comp.spec["name"], label, comp.W, comp.H, f"_s{i + 1}", "jpg" if fmt == "jpg" else "png")
        path = out_dir / name
        if fmt == "jpg":
            img.save(path, quality=92, subsampling=0)
        else:
            img.save(path, optimize=True)
        files.append(path)
    return files


def export(spec, targets, fmt="mp4", fps=None, scene=None, out_dir: Path = OUTPUTS,
           progress=None, cancel=None, quality="hd") -> list[Path]:
    """Render `spec` for every target. Returns the files written."""
    if fmt not in ("mp4", "gif", "png", "jpg"):
        raise SpecError("format must be mp4, gif, png or jpg")
    if quality not in QUALITY:
        raise SpecError("quality must be standard, hd or ultra")
    spec = normalize(spec)  # fail fast; also resolves brand tokens
    if not targets:
        raise SpecError("Pick at least one output size")
    out_dir.mkdir(parents=True, exist_ok=True)
    files: list[Path] = []
    resolved = [resolve_target(t) for t in targets]
    for k, (w, h, label) in enumerate(resolved):
        def sub(p, k=k):
            if progress:
                progress((k + p) / len(resolved))
        name = _out_name(spec.get("name", "untitled"), label, w, h, "", fmt)
        if fmt in ("mp4", "gif"):
            files.append(render_video(spec, out_dir / name, w, h, fps, fmt, sub, cancel, quality=quality))
        else:
            files += render_images(spec, out_dir, w, h, label, scene, fmt)
            sub(1.0)
    return files
