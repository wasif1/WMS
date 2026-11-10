"""Brand kit: logo, colours, fonts, default CTA/URL and the team's own theme settings.

Profiles live in brands/<name>.json (git-ignored by default, they are yours). One profile is
"active"; specs can reference it with tokens such as "$primary" or "{{brand.cta}}".
"""
from __future__ import annotations

import copy
import json
import re
from pathlib import Path

import engine
from engine import ROOT, SpecError

BRANDS = ROOT / "brands"
COLOR_KEYS = ("primary", "secondary", "accent", "dark", "light")

DEFAULT = {
    "name": "My Brand",
    "tagline": "",
    "logo": "",
    "colors": {"primary": "#ff6a1a", "secondary": "#6d28d9", "accent": "#fbbf24",
               "dark": "#0f172a", "light": "#f8fafc"},
    "fonts": {"heading": "auto", "body": "auto"},
    "cta": "Learn more",
    "url": "",
    "watermark": {"position": "top-left", "size": 0.16},
    "theme": {"base": "bold"},
}
WATERMARK_POSITIONS = ("none", "top-left", "top-right", "top-center", "bottom-left", "bottom-right")


def deep_merge(a: dict, b: dict) -> dict:
    out = copy.deepcopy(a)
    for k, v in (b or {}).items():
        out[k] = deep_merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else copy.deepcopy(v)
    return out


def slug(name: str) -> str:
    s = re.sub(r"[^A-Za-z0-9_-]+", "-", str(name)).strip("-")[:50]
    if not s:
        raise SpecError("Brand name needs letters or numbers")
    return s


def hex6(value, what="colour") -> str:
    r, g, b, _ = engine.parse_color(value)
    return f"#{r:02x}{g:02x}{b:02x}"


def clean(data: dict) -> dict:
    """Validate user input and keep only known keys."""
    if not isinstance(data, dict):
        raise SpecError("Brand must be a JSON object")
    out: dict = {}
    for k in ("name", "tagline", "cta", "url", "logo"):
        if k in data:
            out[k] = str(data[k] or "")[:120]
    if isinstance(data.get("colors"), dict):
        out["colors"] = {k: hex6(v) for k, v in data["colors"].items() if k in COLOR_KEYS and v}
    if isinstance(data.get("fonts"), dict):
        out["fonts"] = {k: str(v)[:80] for k, v in data["fonts"].items() if k in ("heading", "body") and v}
    if isinstance(data.get("watermark"), dict):
        wm = data["watermark"]
        pos = wm.get("position", "top-left")
        if pos not in WATERMARK_POSITIONS:
            raise SpecError(f"watermark.position must be one of {', '.join(WATERMARK_POSITIONS)}")
        out["watermark"] = {"position": pos, "size": engine.num(wm.get("size"), 0.16, 0.05, 0.6, "watermark.size")}
    if isinstance(data.get("theme"), dict):
        out["theme"] = {k: v for k, v in data["theme"].items()
                        if isinstance(k, str) and isinstance(v, (str, int, float, bool)) and len(str(v)) < 40}
    return out


def list_brands() -> list[str]:
    return sorted(p.stem for p in BRANDS.glob("*.json")) if BRANDS.is_dir() else []


def active_name() -> str:
    f = BRANDS / "_active.txt"
    names = list_brands()
    if f.is_file():
        n = f.read_text("utf-8").strip()
        if n in names:
            return n
    return names[0] if names else "default"


def set_active(name: str):
    if name not in list_brands():
        raise SpecError(f"Brand {name!r} does not exist")
    (BRANDS / "_active.txt").write_text(name, "utf-8")


def load(name: str | None = None, override: dict | None = None) -> dict:
    """Brand with defaults filled in. `override` (unsaved edits) is merged on top."""
    name = name or active_name()
    data: dict = {}
    f = BRANDS / f"{name}.json"
    if f.is_file():
        try:
            data = clean(json.loads(f.read_text("utf-8")))
        except (json.JSONDecodeError, SpecError):
            data = {}
    merged = deep_merge(DEFAULT, data)
    if override:
        merged = deep_merge(merged, clean(override))
    return merged


def save(name: str, data: dict) -> str:
    name = slug(name)
    BRANDS.mkdir(exist_ok=True)
    (BRANDS / f"{name}.json").write_text(json.dumps(clean(data), indent=2), "utf-8")
    if not (BRANDS / "_active.txt").exists():
        set_active(name)
    return name


def delete(name: str):
    f = BRANDS / f"{slug(name)}.json"
    if not f.is_file():
        raise SpecError("Brand not found")
    f.unlink()


def token_map(b: dict) -> dict:
    t = {f"${k}": v for k, v in b["colors"].items()}
    fh, fb = b["fonts"]["heading"], b["fonts"]["body"]
    t.update({"$font_heading": "sans-bold" if fh == "auto" else fh, "$font_body": "sans" if fb == "auto" else fb,
              "$logo": b["logo"], "$name": b["name"], "$tagline": b["tagline"], "$cta": b["cta"], "$url": b["url"]})
    return t


def apply_tokens(obj, b: dict | None = None):
    """Replace whole-string tokens ("$primary") and {{brand.x}} placeholders in a spec."""
    b = b or load()
    tm = token_map(b)
    flat = {f"brand.{k[1:]}": v for k, v in tm.items()}

    def walk(v):
        if isinstance(v, str):
            if v in tm:
                return tm[v]
            return re.sub(r"\{\{\s*(brand\.\w+)\s*\}\}", lambda m: str(flat.get(m[1], m[0])), v) if "{{" in v else v
        if isinstance(v, list):
            return [walk(x) for x in v]
        if isinstance(v, dict):
            return {k: walk(x) for k, x in v.items()}
        return v

    return walk(obj)
