"""CSV bulk generation: one creative per row.

Two modes
  generate  each row is a script (columns: script|text|headline[,subtitle], theme, cta, url, image,
            music, kind, name) -> the generator builds a themed video/image from it
  template  a saved spec containing {{column}} placeholders is filled from each row
"""
from __future__ import annotations

import csv
import io
import re
import time
from pathlib import Path

import brand as brandmod
import engine
import generator
from engine import SpecError

MAX_ROWS = 200
SAMPLE_CSV = (
    "name,script,theme,cta,url\n"
    '"summer-sale","Summer sale: save *40%* on every plan this week only.",bold,Shop now,yourbrand.com\n'
    '"new-feature","Meet Smart Reports.\nSee what is working in one tap.\nNo spreadsheets. No guesswork.",minimal,Try it free,yourbrand.com/reports\n'
    '"testimonial","""Best decision we made all year."" - Priya, Founder",elegant,Read the story,yourbrand.com/stories\n'
)


def parse_csv(text: str) -> tuple[list[str], list[dict]]:
    text = (text or "").lstrip("﻿").strip()
    if not text:
        raise SpecError("The CSV is empty")
    header = text.split("\n", 1)[0]
    delim = max(",;\t", key=header.count)  # comma unless the header clearly uses ; or tab
    rdr = csv.DictReader(io.StringIO(text), delimiter=delim)
    cols = [c.strip().lower() for c in (rdr.fieldnames or []) if c and c.strip()]
    if not cols:
        raise SpecError("CSV needs a header row, e.g. name,script,theme,cta,url")
    rows = []
    for r in rdr:
        row = {(k or "").strip().lower(): (v or "").strip() for k, v in r.items() if k}
        if any(row.values()):
            rows.append(row)
    if not rows:
        raise SpecError("The CSV has a header but no data rows")
    if len(rows) > MAX_ROWS:
        raise SpecError(f"Too many rows ({len(rows)}); the limit is {MAX_ROWS} per batch")
    return cols, rows


def placeholders(obj) -> set[str]:
    found: set[str] = set()

    def walk(v):
        if isinstance(v, str):
            found.update(m for m in re.findall(r"\{\{\s*([\w.]+)\s*\}\}", v) if not m.startswith("brand."))
        elif isinstance(v, list):
            [walk(x) for x in v]
        elif isinstance(v, dict):
            [walk(x) for x in v.values()]

    walk(obj)
    return found


def fill(obj, row: dict):
    def sub(m):
        k = m[1].lower()
        if k.startswith("brand."):
            return m[0]
        if k not in row:
            raise SpecError(f"Template needs a CSV column named '{k}'")
        return row[k]

    def walk(v):
        if isinstance(v, str):
            return re.sub(r"\{\{\s*([\w.]+)\s*\}\}", sub, v) if "{{" in v else v
        if isinstance(v, list):
            return [walk(x) for x in v]
        if isinstance(v, dict):
            return {k: walk(x) for k, x in v.items()}
        return v

    return walk(obj)


def row_to_spec(row: dict, idx: int, mode: str, template=None, *, theme=None, size=(1080, 1920), kind="video",
                brand=None, images=None, music=None, target=None):
    name = row.get("name") or f"row{idx + 1}"
    if mode == "template":
        if not isinstance(template, dict):
            raise SpecError("Pick a template or project that contains {{placeholders}}")
        spec = fill(template, row)
        spec["name"] = name
        return spec
    text = row.get("script") or row.get("text") or row.get("headline") or ""
    if row.get("headline") and row.get("subtitle") and not (row.get("script") or row.get("text")):
        text = f"{row['headline']} | {row['subtitle']}"
    if not text:
        raise SpecError("needs a 'script' (or 'text' / 'headline') column value")
    imgs = [x.strip() for x in re.split(r"[;|]", row.get("image") or row.get("images") or "") if x.strip()] or images
    spec, _ = generator.generate(
        text, kind=row.get("kind") or kind, theme=row.get("theme") or theme, brand=brand, size=size,
        cta=row["cta"] if "cta" in row and row["cta"] != "" else None,
        url=row["url"] if "url" in row and row["url"] != "" else None,
        images=imgs, music=row.get("music") or music, target=target, name=name)
    return spec


def run_bulk(rows, mode, targets, fmt, quality="hd", *, template=None, theme=None, kind="video", brand=None,
             images=None, music=None, target=None, fps=None, out_root: Path = engine.OUTPUTS, progress=None, cancel=None):
    """Render every row. Row-level failures are collected, the rest of the batch continues."""
    if not rows:
        raise SpecError("No rows to render")
    first = engine.resolve_target(targets[0] if targets else "reels")
    stamp = time.strftime("%Y%m%d-%H%M%S")
    out_dir = out_root / f"bulk_{stamp}"
    files, errors = [], []
    for i, row in enumerate(rows):
        if cancel and cancel.is_set():
            raise engine.Cancelled()
        try:
            spec = row_to_spec(row, i, mode, template, theme=theme, size=(first[0], first[1]), kind=kind,
                               brand=brand, images=images, music=music, target=target)
            row_kind = row.get("kind") or kind
            row_fmt = fmt if row_kind == "video" or fmt in ("png", "jpg") else "png"
            if row_kind != "video" and fmt in ("mp4", "gif"):
                row_fmt = "png"
            files += engine.export(spec, targets, row_fmt, fps, None, out_dir=out_dir, quality=quality,
                                   cancel=cancel, progress=(lambda p, i=i: progress and progress((i + p) / len(rows))))
        except engine.Cancelled:
            raise
        except SpecError as e:
            errors.append(f"Row {i + 2} ({row.get('name') or 'unnamed'}): {e}")
        if progress:
            progress((i + 1) / len(rows))
    return files, errors, out_dir
