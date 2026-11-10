"""Turn a sentence, paragraph or script into a themed, animated spec.

Fully offline and deterministic (no AI service): the text is split into scenes, each scene gets
a layout (hook / point / quote / call-to-action / poster), brand colours are mapped to readable
palettes, text is auto-fitted, and the theme decides animation, transitions and decoration.
"""
from __future__ import annotations

import math
import re

from PIL import Image, ImageDraw

import brand as brandmod
import engine
from engine import SpecError, get_font

# --------------------------------------------------------------------------- colour maths
def _rgb(h):
    return engine.parse_color(h)[:3]


def _hex(c):
    return "#%02x%02x%02x" % tuple(int(max(0, min(255, round(v)))) for v in c)


def _lin(v):
    v /= 255
    return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4


def lum(c):
    r, g, b = (_lin(v) for v in c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def shade(c, amt):  # amt > 0 lighten, < 0 darken
    return mix(c, (255, 255, 255), amt) if amt > 0 else mix(c, (0, 0, 0), -amt)


def pal(B):
    return {k: _rgb(B["colors"][k]) for k in brandmod.COLOR_KEYS}


def best_text(bg, B):
    p = pal(B)
    cands = [p["light"], p["dark"], (255, 255, 255), (17, 17, 17)]
    for c in cands:
        if contrast(c, bg) >= 4.5:
            return c
    return max(cands, key=lambda c: contrast(c, bg))


def recipe(kind, B):
    """Background + readable text colours for one scene, derived from the brand colours."""
    p = pal(B)
    P, S, A, D, Lt = (p[k] for k in ("primary", "secondary", "accent", "dark", "light"))
    bg1, bg2, ang = {
        "primary": (P, shade(P, -0.38), 160), "duo": (P, S, 150), "secondary": (S, shade(S, -0.38), 160),
        "accent": (A, shade(A, -0.3), 160), "dark": (D, mix(D, P, 0.28), 165), "light": (Lt, mix(Lt, P, 0.12), 180),
    }[kind]
    mid = mix(bg1, bg2, 0.5)
    text = best_text(mid, B)
    hl = next((c for c in (A, P, S, D, Lt, (255, 255, 255), (17, 17, 17))
               if contrast(c, mid) >= 3 and contrast(c, text) >= 1.6), text)
    sub = next((c for c in (mix(text, mid, k) for k in (0.3, 0.2, 0.12, 0.05)) if contrast(c, mid) >= 4.5), text)
    btn = next((c for c in (A, P, S) if contrast(c, mid) >= 2.2 and kind != "accent"), D if kind == "accent" else text)
    return {"bg1": _hex(bg1), "bg2": _hex(bg2), "angle": ang, "text": _hex(text), "sub": _hex(sub), "hl": _hex(hl),
            "btn": _hex(btn), "btn_text": _hex(best_text(btn, B)), "dark": lum(mid) < 0.4}


# --------------------------------------------------------------------------- themes
ANIM_STYLES = {  # title anim, body anim, duration
    "calm": ("fade", "fade", 0.9), "smooth": ("slide-up", "slide-up", 0.7),
    "dynamic": ("zoom", "slide-up", 0.6), "punchy": ("pop", "slide-left", 0.5)}
MOTION = {"still": (0.0, 0), "subtle": (0.03, 15), "dynamic": (0.06, 40)}  # headline push-in, gradient drift deg

THEMES = {
    "bold": {"name": "Bold Ad", "desc": "Big uppercase headlines, punchy pops, progress bar",
             "bg": ["primary", "dark", "duo", "dark"], "cta_bg": "duo", "upper": True, "align": "center", "anim": "punchy",
             "transition": "slide-left", "tdur": 0.45, "shadow": True, "bar": True, "progress": True, "deco": "circles",
             "vignette": 0.0, "motion": "dynamic", "hfont": "sans-bold", "bfont": "sans"},
    "minimal": {"name": "Clean Minimal", "desc": "Light, airy, left-aligned with thin accents",
                "bg": ["light"], "cta_bg": "light", "upper": False, "align": "left", "anim": "smooth",
                "transition": "fade", "tdur": 0.6, "shadow": False, "bar": True, "progress": False, "deco": "none",
                "vignette": 0.0, "motion": "subtle", "hfont": "sans-bold", "bfont": "sans"},
    "elegant": {"name": "Elegant Serif", "desc": "Dark, serif type, slow fades, cinematic vignette",
                "bg": ["dark"], "cta_bg": "dark", "upper": False, "align": "center", "anim": "calm",
                "transition": "fade", "tdur": 0.9, "shadow": False, "bar": True, "progress": False, "deco": "lines",
                "vignette": 0.35, "motion": "subtle", "hfont": "serif-bold", "bfont": "serif"},
    "neon": {"name": "Neon Night", "desc": "Dark with glowing colour, energetic zooms",
             "bg": ["dark"], "cta_bg": "dark", "upper": True, "align": "center", "anim": "dynamic",
             "transition": "slide-up", "tdur": 0.5, "shadow": False, "bar": True, "progress": True, "deco": "glow",
             "vignette": 0.0, "motion": "dynamic", "hfont": "sans-bold", "bfont": "sans"},
    "corporate": {"name": "Corporate", "desc": "Trustworthy, left-aligned, light and dark scenes",
                  "bg": ["light", "dark", "light", "primary"], "cta_bg": "primary", "upper": False, "align": "left",
                  "anim": "smooth", "transition": "slide-left", "tdur": 0.5, "shadow": False, "bar": True,
                  "progress": False, "deco": "lines", "vignette": 0.0, "motion": "subtle", "hfont": "sans-bold",
                  "bfont": "sans"},
    "playful": {"name": "Playful", "desc": "Bright colour blocks, bouncy pops",
                "bg": ["accent", "primary", "secondary", "accent"], "cta_bg": "primary", "upper": False,
                "align": "center", "anim": "punchy", "transition": "slide-up", "tdur": 0.45, "shadow": False,
                "bar": False, "progress": True, "deco": "circles", "vignette": 0.0, "motion": "dynamic",
                "hfont": "sans-bold", "bfont": "sans"},
}
BG_CHOICES = ("primary", "duo", "secondary", "accent", "dark", "light")
THEME_OPTIONS = {  # what the Brand page lets people customise ("my theme")
    "upper": [True, False], "align": ["center", "left"], "anim": list(ANIM_STYLES),
    "transition": list(engine.TRANSITIONS), "motion": list(MOTION), "deco": ["none", "circles", "glow", "lines"],
    "bar": [True, False], "progress": [True, False], "shadow": [True, False], "bg_style": ["theme", *BG_CHOICES, "alternate"]}


def resolve_theme(theme_id, B):
    """Built-in theme + the brand's own overrides = the theme to follow."""
    ov = dict(B.get("theme") or {})
    tid = theme_id or ov.get("base") or "bold"
    if tid not in THEMES:
        raise SpecError(f"Unknown theme {tid!r}. Choose one of: {', '.join(THEMES)}")
    T = dict(THEMES[tid], id=tid)
    if not theme_id or theme_id == ov.get("base"):  # explicit pick of another theme ignores overrides
        for k, v in ov.items():
            if k == "bg_style":
                if v == "alternate":
                    T["bg"] = ["primary", "dark", "duo", "light"]
                elif v in BG_CHOICES:
                    T["bg"] = [v]
            elif k in THEME_OPTIONS and k != "bg_style" and v in THEME_OPTIONS[k]:
                T[k] = v
    return T


def theme_cards(B):
    out = []
    for tid, T in THEMES.items():
        r = recipe(T["bg"][0], B)
        out.append({"id": tid, "name": T["name"], "desc": T["desc"], "bg1": r["bg1"], "bg2": r["bg2"],
                    "text": r["text"], "hl": r["hl"]})
    return out


# --------------------------------------------------------------------------- script parsing
_DIRECTIVE = re.compile(r"^(cta|url|link|title|headline cta)\s*:\s*(.+)$", re.I)
_IMG = re.compile(r"\[\s*img\s*:\s*([^\]]+?)\s*\]", re.I)
_DUR = re.compile(r"\[\s*dur\s*:\s*([\d.]+)\s*s?\s*\]", re.I)
_NUM = re.compile(r"(?<![\w*])([$€£₹]?\d[\d,.]*\s?(?:%|k|K|m|M|x|X)?)(?![\w*])")


def _words(t):
    return len(re.findall(r"\S+", t.replace("*", "")))


def _chunks(text, max_words=16, min_words=5):
    sents = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s.strip()]
    pieces = []
    for s in sents:  # break very long sentences on commas / dashes / semicolons
        if _words(s) <= 22:
            pieces.append(s)
            continue
        parts, cur = re.split(r"(?<=[,;:])\s+|\s[—–-]\s", s), ""
        for p in parts:
            if cur and _words(cur + " " + p) > max_words:
                pieces.append(cur)
                cur = p
            else:
                cur = f"{cur} {p}".strip()
        if cur:
            pieces.append(cur)
    out, cur = [], ""
    for p in pieces:
        joined = _words(cur + " " + p) if cur else 0
        if cur and joined > max_words and (_words(cur) >= min_words or joined > 22):
            out.append(cur)
            cur = p
        else:
            cur = f"{cur} {p}".strip()
    if cur:
        out.append(cur)
    return out


def parse_script(text: str, max_scenes=14):
    meta = {"cta": None, "url": None, "title": None, "warnings": []}
    lines = []
    for raw in str(text or "").replace("\r", "").split("\n"):
        line = raw.strip()
        m = _DIRECTIVE.match(line)
        if m:
            k = m[1].lower()
            meta["cta_headline" if k == "headline cta" else {"link": "url"}.get(k, k)] = m[2].strip()
        else:
            lines.append(line)
    while lines and not lines[0]:
        lines.pop(0)
    while lines and not lines[-1]:
        lines.pop()
    if not lines:
        raise SpecError("Type or paste some text first")
    nonempty = [l for l in lines if l]
    blocks: list[str] = []
    if "" in lines and len(nonempty) > 1:                      # paragraphs
        cur: list[str] = []
        for l in lines + [""]:
            if l:
                cur.append(l)
            elif cur:
                blocks.append("\n".join(cur))
                cur = []
    elif len(nonempty) > 1:                                    # one line = one scene
        blocks = nonempty
    else:                                                      # single block of prose
        blocks = _chunks(nonempty[0])
    items = []
    for b in blocks:
        parts = [b] if (b.count("\n") and _words(b) <= 18) else (_chunks(b) if _words(b) > 22 else [b])
        for part in parts:
            it = {"img": None, "dur": None, "num": None, "sub": None, "bullet": False}
            mi = _IMG.search(part)
            if mi:
                it["img"] = mi[1]
                part = _IMG.sub("", part)
            md = _DUR.search(part)
            if md:
                it["dur"] = float(md[1])
                part = _DUR.sub("", part)
            part = part.strip()
            mn = re.match(r"^(\d{1,2})[.)]\s+(.*)$", part, re.S)
            if mn:
                it["num"], part = int(mn[1]), mn[2]
            elif re.match(r"^[-•]\s+|^\*\s+", part):
                it["bullet"], part = True, re.sub(r"^[-•*]\s+", "", part)
            part = re.sub(r"^#+\s*", "", part)
            if " | " in part:
                part, sub = part.split(" | ", 1)
                it["sub"] = sub.strip()
            if re.match(r"^[“\"].+[”\"]", part.strip()):
                it["quote"] = True
                part = part.strip()
                mq = re.match(r"^[“\"](.+?)[”\"]\s*(?:[—–-]+\s*(.+))?$", part, re.S)
                if mq:
                    part, it["author"] = mq[1].strip(), (mq[2] or "").strip()
            it["text"] = part.strip()
            if it["text"]:
                items.append(it)
    if len(items) > max_scenes:
        meta["warnings"].append(f"Script has {len(items)} parts; only the first {max_scenes} are used.")
        items = items[:max_scenes]
    return items, meta


def highlight_numbers(text):
    if "*" in text:
        return text
    return _NUM.sub(lambda m: f"*{m[1].strip()}*" if len(m[1].strip()) > 0 and any(c.isdigit() for c in m[1]) else m[0], text)


# --------------------------------------------------------------------------- text fitting
def _measure(text, font_key, w_frac, W, H, size, upper, line_height):
    m = min(W, H)
    probe = ImageDraw.Draw(Image.new("L", (1, 1)))
    t = text.upper() if upper else text
    px = max(8, int(size * m))
    font = engine.pick_font(font_key, px, t)
    lines = engine._layout(t, font, int(w_frac * W), probe)
    bh = ((len(lines) - 1) * int(px * line_height) + sum(font.getmetrics())) / H
    bw = max(ln[1] for ln in lines)
    longest = max((probe.textlength(w.replace("*", ""), font=font) for w in t.split()), default=0)
    return lines, bh, bw, longest


def fit(text, font_key, w_frac, W, H, max_size, min_size, max_lines, upper=False, line_height=1.18, max_h=0.5):
    """Largest font size (between max and min) where the text fits the box. If even the minimum does not fit, the
    text is shortened with an ellipsis (returned under "text") rather than shrunk until unreadable."""
    def ok(size, txt):
        lines, bh, bw, longest = _measure(txt, font_key, w_frac, W, H, size, upper, line_height)
        res = {"size": round(size, 4), "lines": len(lines), "h": bh, "w": bw / W}
        return (len(lines) <= max_lines and bh <= max_h and bw <= w_frac * W * 1.001 and longest <= w_frac * W * 1.001), res

    size = max_size
    while True:
        good, res = ok(size, text)
        if good:
            return res
        if size <= min_size:
            break
        size = max(min_size, size - 0.004)
    words = text.split(" ")
    while len(words) > 1:
        words.pop()
        cand = " ".join(words).rstrip(" ,;:-—.\n")
        if cand.count("*") % 2:
            cand += "*"
        cand += "…"
        good, res = ok(min_size, cand)
        if good:
            return dict(res, text=cand)
    return res


def _fit(ctx, text, *a, **k):
    r = fit(text, *a, **k)
    if "text" in r:
        snippet = text.replace("*", "").replace("\n", " ")
        ctx.warnings.append(f'Shortened to fit: "{snippet[:30]}{"…" if len(snippet) > 30 else ""}"')
    return r


# --------------------------------------------------------------------------- scene building
class Ctx:
    def __init__(self, W, H, B, T, kind, logo, cta, url, n_scenes, cta_headline=None):
        self.W, self.H, self.B, self.T, self.kind = W, H, B, T, kind
        self.land = W > H * 1.15
        self.n, self.logo, self.cta, self.url, self.cta_headline = n_scenes, logo, cta, url, cta_headline
        self.warnings: list[str] = []
        fh, fb = B["fonts"]["heading"], B["fonts"]["body"]
        self.hfont = T["hfont"] if fh == "auto" else fh
        self.bfont = T["bfont"] if fb == "auto" else fb
        self.title_in, self.body_in, self.adur = ANIM_STYLES[T["anim"]]
        self.push, self.drift = MOTION[T["motion"]]
        self.left = T["align"] == "left"
        self.margin = 0.08 if not self.land else 0.07
        self.wfrac = 0.8 if not self.land else 0.7
        if self.left and self.title_in == "slide-up":
            self.title_in = "slide-right"

    def x_for(self, wfrac):
        return round(self.margin + wfrac / 2, 4) if self.left else 0.5


def _text(ctx, text, y, fit_, color, accent, font, **kw):
    d = {"type": "text", "text": fit_.get("text", text), "x": ctx.margin if ctx.left else 0.5, "y": round(y, 4), "size": fit_["size"],
         "w": ctx.wfrac, "color": color, "accent": accent, "font": font,
         "align": "left" if ctx.left else "center"}
    if ctx.left:
        d["anchor"] = "left"
    d.update(kw)
    return d


def _bar(ctx, y, color, start, w=0.14, h=0.008):
    return {"type": "shape", "shape": "rect", "x": ctx.x_for(w), "y": round(y, 4), "w": w, "h": h if not ctx.land else h * 1.4,
            "color": color, "in": "wipe", "start": start, "anim_dur": 0.5}


def _deco(ctx, r):
    kind = ctx.T["deco"]
    B = ctx.B
    if kind == "circles":
        return [{"type": "shape", "shape": "circle", "x": 0.98, "y": 0.04, "w": 0.7 if not ctx.land else 0.4, "color": r["hl"], "opacity": 0.13,
                 "in": "zoom", "anim_dur": 1.0, "motion": {"dx": -0.03, "dy": 0.02}},
                {"type": "shape", "shape": "circle", "x": 0.02, "y": 0.97, "w": 0.5 if not ctx.land else 0.28, "color": r["btn"], "opacity": 0.12,
                 "in": "zoom", "anim_dur": 1.2, "motion": {"dx": 0.03, "dy": -0.02}}]
    if kind == "glow":
        return [{"type": "shape", "shape": "circle", "x": 0.12, "y": 0.18, "w": 0.8 if not ctx.land else 0.5, "color": B["colors"]["primary"], "opacity": 0.55, "blur": 0.09,
                 "in": "fade", "anim_dur": 1.2, "motion": {"dx": 0.06, "dy": 0.03}},
                {"type": "shape", "shape": "circle", "x": 0.9, "y": 0.85, "w": 0.8 if not ctx.land else 0.5, "color": B["colors"]["secondary"], "opacity": 0.5, "blur": 0.09,
                 "in": "fade", "anim_dur": 1.2, "motion": {"dx": -0.06, "dy": -0.03}}]
    if kind == "lines":
        return [{"type": "shape", "shape": "rect", "x": 0.5, "y": 0.1, "w": 1 - 2 * ctx.margin, "h": 0.0018, "color": r["hl"], "opacity": 0.6, "in": "wipe", "anim_dur": 0.9},
                {"type": "shape", "shape": "rect", "x": 0.5, "y": 0.9, "w": 1 - 2 * ctx.margin, "h": 0.0018, "color": r["hl"], "opacity": 0.6, "in": "wipe", "anim_dur": 0.9, "start": 0.2}]
    return []


def _logo(ctx, x, y, w, **kw):
    d = {"type": "image", "asset": ctx.logo, "x": x, "y": y, "w": w, "in": "fade", "anim_dur": 0.7}
    d.update(kw)
    return d


def _progress(ctx, i, dur, color):
    n = ctx.n
    if not ctx.T["progress"] or ctx.kind != "video" or n < 2 or n > 10:
        return []
    gap, total = 0.012, 1 - 2 * ctx.margin
    w = (total - gap * (n - 1)) / n
    y = 0.045 if not ctx.land else 0.06
    out = []
    for j in range(n):
        x = ctx.margin + j * (w + gap) + w / 2
        out.append({"type": "shape", "shape": "rect", "x": round(x, 4), "y": y, "w": round(w, 4), "h": 0.006, "color": color, "opacity": 0.28})
        if j < i:
            out.append({"type": "shape", "shape": "rect", "x": round(x, 4), "y": y, "w": round(w, 4), "h": 0.006, "color": color, "opacity": 0.95})
        elif j == i:
            out.append({"type": "shape", "shape": "rect", "x": round(x, 4), "y": y, "w": round(w, 4), "h": 0.006, "color": color, "opacity": 0.95,
                        "in": "wipe", "ease": "linear", "anim_dur": dur})
    return out


def _watermark(ctx):
    wm = ctx.B["watermark"]
    if not ctx.logo or wm["position"] == "none":
        return []
    yy = 0.1 if not ctx.land else 0.1
    pos = {"top-left": (0.04 + wm["size"] / 2, yy), "top-right": (0.96 - wm["size"] / 2, yy), "top-center": (0.5, yy),
           "bottom-left": (0.04 + wm["size"] / 2, 0.93), "bottom-right": (0.96 - wm["size"] / 2, 0.93)}[wm["position"]]
    return [_logo(ctx, round(pos[0], 4), pos[1], wm["size"], opacity=0.9, start=0.3)]


def _background(ctx, r, item, scene_dur, i):
    if item.get("img"):
        bg = {"type": "image", "asset": item["img"], "kenburns": 0.12 if i % 2 == 0 else 0.08,
              "focus_x": 0.5, "focus_y": 0.5, "dim": 0.5}
    else:
        bg = {"type": "gradient", "colors": [r["bg1"], r["bg2"]], "angle": r["angle"]}
        if ctx.drift:
            bg["drift"] = ctx.drift * (1 if i % 2 == 0 else -1)
    if ctx.T["vignette"]:
        bg["vignette"] = ctx.T["vignette"]
    return bg


def build_scene(ctx, i, item, role, bgkind, dur):
    T, B = ctx.T, ctx.B
    r = recipe(bgkind, B)
    if item.get("img"):  # photo background: force readable light text
        r = dict(r, text="#ffffff", sub="#e5e7eb", dark=True)
        r["hl"] = _hex(next((c for c in (_rgb(B["colors"]["accent"]), _rgb(B["colors"]["primary"]), _rgb(B["colors"]["secondary"]))
                             if contrast(c, (40, 40, 40)) >= 4), (255, 255, 255)))
    layers = _deco(ctx, r) if not item.get("img") and not (role == "poster" and T["deco"] == "lines") else []
    push = {"motion": {"scale": ctx.push}} if ctx.push else {}
    text = item["text"]
    up = T["upper"] and role != "quote"
    ltxt = highlight_numbers(text) if role != "quote" else text
    land = ctx.land
    cy0 = 0.47 if not land else 0.5
    kw_t = {"shadow": (T["shadow"] and lum(_rgb(r["text"])) > 0.5) or bool(item.get("img")), "upper": up, "in": ctx.title_in, "anim_dur": ctx.adur}

    if role == "cta":
        has_head = bool(ltxt)
        head = _fit(ctx, ltxt, ctx.hfont, ctx.wfrac, ctx.W, ctx.H, 0.1, 0.05, 3, up) if has_head else None
        by = 0.6 if has_head else 0.52
        if ctx.logo:
            layers.append(_logo(ctx, 0.5, 0.2 if not land else 0.22, 0.4 if not land else 0.2, start=0.1))
        if has_head:
            layers.append(_text(ctx, ltxt, 0.40 if not land else 0.42, dict(head, w=head["w"]), r["text"], r["hl"], ctx.hfont,
                                **dict(kw_t, start=0.2)) | {"x": 0.5, "align": "center", "anchor": "center"})
        label = ctx.cta or "Learn more"
        bw = 0.64 if not land else 0.36
        lf = _fit(ctx, label, ctx.hfont, bw * 0.82, ctx.W, ctx.H, 0.05, 0.03, 1, up)
        layers.append({"type": "shape", "shape": "rounded", "x": 0.5, "y": by, "w": bw, "h": 0.085 if not land else 0.12, "radius": 1,
                       "color": r["btn"], "shadow": True, "in": "pop", "start": 0.55, "anim_dur": 0.6})
        layers.append({"type": "text", "text": lf.get("text", label), "x": 0.5, "y": by, "size": lf["size"], "w": bw * 0.84, "color": r["btn_text"],
                       "font": ctx.hfont, "upper": up, "in": "fade", "start": 0.75, "anim_dur": 0.4})
        if ctx.url:
            uf = _fit(ctx, ctx.url, ctx.bfont, 0.8, ctx.W, ctx.H, 0.045, 0.03, 1)
            layers.append({"type": "text", "text": uf.get("text", ctx.url), "x": 0.5, "y": by + (0.1 if not land else 0.14), "size": uf["size"], "w": 0.8,
                           "color": r["sub"], "font": ctx.bfont, "in": "fade", "start": 1.0})
    elif role == "poster":
        tall = ctx.H / ctx.W >= 1.7
        by = 0.72 if tall else (0.8 if not land else 0.82)
        bh_ = 0.075 if not land else 0.11
        url_y = by + (0.085 if tall else 0.1 if not land else 0.12)
        top = 0.2 if ctx.logo else 0.12
        if not land:
            top = max(top, 0.17)
        bottom = (by - bh_ / 2 - 0.04) if ctx.cta else ((url_y - 0.05) if ctx.url else 0.9)
        avail = bottom - top
        has_sub = bool(item.get("sub"))
        head = _fit(ctx, ltxt, ctx.hfont, ctx.wfrac, ctx.W, ctx.H, 0.13, 0.05, 5 if not land else 3, up, max_h=avail * (0.62 if has_sub else 1.0))
        sf = None
        if has_sub:
            sf = _fit(ctx, item["sub"], ctx.bfont, ctx.wfrac, ctx.W, ctx.H, 0.05, 0.028, 4, False, max_h=max(0.05, avail - head["h"] - 0.07))
        total = head["h"] + (0.035 if T["bar"] else 0) + ((sf["h"] + 0.02) if sf else 0)
        y0 = top + max(0.0, (avail - total) / 2)
        cy = y0 + head["h"] / 2
        if ctx.logo:
            layers.append(_logo(ctx, 0.5 if not ctx.left else ctx.margin + 0.14, 0.09, 0.28 if not land else 0.16, start=0.1))
        layers.append(_text(ctx, ltxt, cy, head, r["text"], r["hl"], ctx.hfont, **kw_t))
        yb = y0 + head["h"]
        if T["bar"]:
            yb += 0.02
            layers.append(_bar(ctx, yb, r["hl"], 0.5))
            yb += 0.015
        if sf:
            layers.append(_text(ctx, item["sub"], yb + 0.028 + sf["h"] / 2, sf, r["sub"], r["hl"], ctx.bfont, **{"in": ctx.body_in, "start": 0.7}))
        if ctx.cta:
            bw = 0.56 if not land else 0.3
            lf = _fit(ctx, ctx.cta, ctx.hfont, bw * 0.82, ctx.W, ctx.H, 0.045, 0.03, 1, up)
            bx = 0.5 if not ctx.left else ctx.margin + bw / 2
            layers.append({"type": "shape", "shape": "rounded", "x": bx, "y": by, "w": bw, "h": bh_, "radius": 1,
                           "color": r["btn"], "shadow": True, "in": "pop", "start": 0.9})
            layers.append({"type": "text", "text": lf.get("text", ctx.cta), "x": bx, "y": by, "size": lf["size"],
                           "w": bw * 0.84, "color": r["btn_text"], "font": ctx.hfont, "upper": up, "in": "fade", "start": 1.1})
        if ctx.url:
            uf = _fit(ctx, ctx.url, ctx.bfont, 0.8, ctx.W, ctx.H, 0.04, 0.03, 1)
            layers.append(dict({"type": "text", "text": uf.get("text", ctx.url), "x": 0.5, "y": url_y,
                                "size": uf["size"], "w": 0.8, "color": r["sub"], "font": ctx.bfont, "in": "fade", "start": 1.3},
                               **({"x": ctx.margin, "anchor": "left", "align": "left"} if ctx.left else {})))
    elif role == "quote":
        qf = _fit(ctx, text, "serif" if "serif" not in ctx.hfont else ctx.hfont, ctx.wfrac, ctx.W, ctx.H, 0.075, 0.034, 7, False, 1.3, 0.5)
        layers.append({"type": "text", "text": "“", "x": ctx.x_for(0.1), "y": 0.24 if not land else 0.2, "size": 0.2, "color": r["hl"],
                       "font": "serif-bold", "in": "fade", "anim_dur": 0.8, "align": "left" if ctx.left else "center", "w": 0.3})
        layers.append(_text(ctx, text, cy0 + 0.02, qf, r["text"], r["hl"], "serif", **{"in": "slide-up", "start": 0.35, "anim_dur": 0.8, "line_height": 1.3, "shadow": bool(item.get("img"))}))
        if item.get("author"):
            layers.append(_bar(ctx, cy0 + 0.02 + qf["h"] / 2 + 0.04, r["hl"], 1.0, 0.1, 0.004))
            af = _fit(ctx, item["author"], ctx.bfont, 0.7, ctx.W, ctx.H, 0.04, 0.025, 2, upper=True)
            layers.append(_text(ctx, item["author"], cy0 + 0.02 + qf["h"] / 2 + 0.09, af, r["sub"], r["hl"], ctx.bfont, **{"in": "fade", "start": 1.3, "upper": True}))
    else:  # hook / point
        is_hook = role == "hook"
        numbered = item.get("num") is not None
        chip = (0.13 if not land else 0.1) if numbered else 0.0
        top = (0.18 if not land else 0.14) + (chip + 0.04 if numbered else (0.04 if (T["bar"] and not is_hook) else 0))
        bottom = 0.84 if not land else 0.86
        avail = bottom - top
        has_sub = bool(item.get("sub"))
        head = _fit(ctx, ltxt, ctx.hfont, ctx.wfrac, ctx.W, ctx.H, 0.13 if is_hook else 0.095, 0.045,
                    5 if not land else 3, up, max_h=avail * (0.65 if has_sub else 1.0))
        sf = None
        if has_sub:
            sf = _fit(ctx, item["sub"], ctx.bfont, ctx.wfrac, ctx.W, ctx.H, 0.05, 0.028, 4, False,
                      max_h=max(0.05, avail - head["h"] - 0.09))
        bar_gap = 0.035 if (T["bar"] and is_hook) else 0.0
        total = head["h"] + bar_gap + ((sf["h"] + 0.03) if sf else 0)
        y0 = top + max(0.0, (avail - total) / 2)          # centre the whole stack in the free area
        cy = y0 + head["h"] / 2
        if numbered:
            cyc = y0 - 0.03 - chip * (ctx.W / ctx.H) / 2 if not land else y0 - 0.075
            layers.append({"type": "shape", "shape": "circle", "x": ctx.x_for(chip), "y": round(cyc, 4), "w": chip, "color": r["hl"], "in": "pop", "anim_dur": 0.5})
            nf = _fit(ctx, str(item["num"]), ctx.hfont, chip * 0.8, ctx.W, ctx.H, 0.07, 0.03, 1)
            layers.append({"type": "text", "text": str(item["num"]), "x": ctx.x_for(chip), "y": round(cyc, 4), "size": nf["size"], "w": chip * 0.9,
                           "color": _hex(best_text(_rgb(r["hl"]), B)), "font": ctx.hfont, "in": "fade", "start": 0.2})
        elif T["bar"] and not is_hook:
            layers.append(_bar(ctx, y0 - 0.03, r["hl"], 0.1, 0.1))
        layers.append(_text(ctx, ltxt, cy, head, r["text"], r["hl"], ctx.hfont, **dict(kw_t, start=0.15, **push)))
        yb = y0 + head["h"]
        if bar_gap:
            yb += bar_gap
            layers.append(_bar(ctx, yb, r["hl"], 0.6))
        if sf:
            layers.append(_text(ctx, item["sub"], yb + 0.025 + sf["h"] / 2, sf, r["sub"], r["hl"], ctx.bfont,
                                **{"in": ctx.body_in, "start": 0.8, "anim_dur": ctx.adur}))

    if role not in ("hook", "cta", "poster"):
        layers += _watermark(ctx)
    elif role == "hook" and ctx.logo and ctx.n > 1:
        layers.append(_logo(ctx, 0.5 if not ctx.left else ctx.margin + 0.15, 0.12, 0.3 if not land else 0.16, start=0.05))
    layers += _progress(ctx, i, dur, r["text"]) if role != "poster" else []
    return {"duration": round(dur, 2), "background": _background(ctx, r, item, dur, i), "layers": layers}


# --------------------------------------------------------------------------- public API
def _sanitize(ctx, plan, meta):
    """Drop characters the chosen font cannot draw (emoji, missing letters) instead of exporting empty boxes."""
    removed: set[str] = set()

    def clean(txt, font):
        if not txt:
            return txt
        miss = engine.missing_glyphs(engine.pick_font(font, 40, txt), txt)
        if not miss:
            return txt
        removed.update(miss)
        return re.sub(r"[ \t]{2,}", " ", "".join(c for c in txt if c not in miss)).strip()

    for it, role in plan:
        it["text"] = clean(it["text"], ctx.hfont)
        it["sub"] = clean(it.get("sub"), ctx.bfont)
        if it.get("author"):
            it["author"] = clean(it["author"], ctx.bfont)
    ctx.cta, ctx.url = clean(ctx.cta, ctx.hfont), clean(ctx.url, ctx.bfont)
    if removed:
        meta["warnings"].append("Removed characters the font cannot draw: " + " ".join(sorted(removed)[:10])
                                + " (emoji are not supported).")
    kept = [(it, role) for it, role in plan if it["text"] or role == "cta"]
    if not kept:
        raise SpecError("After removing characters the font cannot draw there is no text left.")
    return kept


def _auto_duration(item, role):
    d = 1.4 + _words(item["text"] + " " + (item.get("sub") or "")) / 2.8
    return max(3.2 if role == "hook" else 2.6, min(7.0, d))


def generate(text, *, kind="video", theme=None, brand=None, size=(1080, 1920), cta=None, url=None, images=None,
             music=None, target=None, logo=True, name=None, fps=30, brand_override=None):
    """Return (spec, meta). kind: video | carousel | image (single poster)."""
    if kind not in ("video", "carousel", "image"):
        raise SpecError("kind must be video, carousel or image")
    B = brand if isinstance(brand, dict) and "colors" in brand else brandmod.load(brand, brand_override)
    B = brandmod.deep_merge(B, {})
    T = resolve_theme(theme, B)
    W, H = int(size[0]), int(size[1])
    items, meta = parse_script(text)
    cta = (cta if cta is not None else (meta["cta"] if meta["cta"] is not None else B["cta"])).strip()
    url = (url if url is not None else (meta["url"] if meta["url"] is not None else B["url"])).strip()
    logo_name = ""
    if logo and B.get("logo"):
        try:
            engine.asset_path(B["logo"])
            logo_name = B["logo"]
        except SpecError:
            meta["warnings"].append(f"Logo {B['logo']!r} not found in assets/; continuing without it.")
    # media
    imgs = [i for i in (images or []) if i]
    for n_, it in enumerate(items):
        if not it["img"] and imgs and kind != "image":
            it["img"] = imgs[n_ % len(imgs)]
        if it["img"]:
            engine.asset_path(it["img"])
    if kind == "image":
        head = items[0]
        subs = [head["sub"]] if head.get("sub") else []
        subs += [it["text"] for it in items[1:3]]
        poster = {"text": head["text"], "sub": " ".join(s for s in subs if s)[:220] or None, "img": (imgs[0] if imgs else head["img"]),
                  "num": None, "dur": 4}
        if poster["img"]:
            engine.asset_path(poster["img"])
        plan = [(poster, "poster")]
        ctx = Ctx(W, H, B, T, kind, logo_name, cta, url, 1)
    else:
        plan = []
        for n_, it in enumerate(items):
            role = "quote" if it.get("quote") else ("hook" if n_ == 0 else "point")
            plan.append((it, role))
        if cta or url:
            plan.append(({"text": meta.get("cta_headline") or B["tagline"] or "", "img": None, "dur": 3.4, "num": None, "sub": None}, "cta"))
        ctx = Ctx(W, H, B, T, kind, logo_name, cta, url, len(plan))
    plan = _sanitize(ctx, plan, meta)
    durs = [it["dur"] or (3.4 if role == "cta" else _auto_duration(it, role)) for it, role in plan]
    if target and len(plan) > 1:
        td = T["tdur"]
        cur = sum(durs) - td * (len(durs) - 1)
        k = max(0.6, min(2.0, float(target) / cur))
        durs = [max(2.2, d * k) for d in durs]
    scenes = []
    cyc = T["bg"]
    for i, ((it, role), d) in enumerate(zip(plan, durs)):
        bgk = T["cta_bg"] if role == "cta" else cyc[i % len(cyc)]
        scenes.append(build_scene(ctx, i, it, role, bgk, d))
    first = re.sub(r"[^A-Za-z0-9]+", "-", items[0]["text"].replace("*", ""))[:28].strip("-").lower()
    spec = {"name": engine.slug(name or meta.get("title") or first or "creative"), "width": W - W % 2, "height": H - H % 2, "fps": int(fps),
            "transition": {"type": T["transition"] if len(scenes) > 1 else "none", "duration": T["tdur"]},
            "scenes": scenes}
    if music:
        engine.asset_path(music)
        spec["audio"] = {"asset": music, "volume": 0.7, "fade_out": 1.5}
    meta["warnings"] += [w for w in dict.fromkeys(ctx.warnings)]
    meta.update({"theme": T["id"], "scenes": len(scenes), "role_list": [r for _, r in plan]})
    return spec, meta
