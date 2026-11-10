#!/usr/bin/env python3
"""Marketing Studio: offline video + image generator for social and ad creatives.

    python studio.py serve                       # open the editor at http://127.0.0.1:8765
    python studio.py render spec.json -p reels -p square
    python studio.py image  spec.json -p portrait --scene 1
    python studio.py presets | check | validate spec.json

Runs entirely on your machine (stdlib server + Pillow + ffmpeg). No API keys, no network.
"""
from __future__ import annotations

import argparse
import io
import json
import mimetypes
import re
import sys
import tempfile
import threading
import time
import uuid
import zipfile
import webbrowser
from collections import OrderedDict
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

import brand as brandmod
import bulk
import engine
import generator
from engine import ASSETS, FONTS, OUTPUTS, PROJECTS, ROOT, TEMPLATES, SpecError

STATIC = ROOT / "static"
MAX_BODY = 4 * 1024 * 1024          # JSON bodies
MAX_UPLOAD = 300 * 1024 * 1024      # asset uploads
ASSET_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".mp3", ".wav", ".m4a", ".aac", ".ogg"}
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.\-]{0,80}$")


# --------------------------------------------------------------------------- jobs
class Job:
    """A background task. `fn(job)` does the work, sets job.files / job.warnings and updates job.progress."""

    def __init__(self, fn):
        self.id = uuid.uuid4().hex[:10]
        self.fn = fn
        self.status, self.progress, self.error = "queued", 0.0, None
        self.files: list[Path] = []
        self.warnings: list[str] = []
        self.cancel = threading.Event()

    def to_json(self):
        rel = lambda f: f.relative_to(OUTPUTS).as_posix()
        return {"id": self.id, "status": self.status, "progress": round(self.progress, 3), "error": self.error,
                "warnings": self.warnings, "zip": f"/api/jobs/{self.id}/zip" if len(self.files) > 1 else None,
                "outputs": [{"file": f.name, "url": "/outputs/" + rel(f)} for f in self.files]}


JOBS: "OrderedDict[str, Job]" = OrderedDict()
RENDER_LOCK = threading.Lock()  # one export at a time keeps the machine responsive


def run_job(job: Job):
    with RENDER_LOCK:
        if job.cancel.is_set():
            job.status = "cancelled"
            return
        job.status = "running"
        try:
            job.fn(job)
            job.progress, job.status = 1.0, "done"
        except engine.Cancelled:
            job.status = "cancelled"
        except SpecError as e:
            job.status, job.error = "error", str(e)
        except Exception as e:  # never kill the worker silently
            job.status, job.error = "error", f"Unexpected error: {e}"


def start_job(fn) -> Job:
    job = Job(fn)
    JOBS[job.id] = job
    while len(JOBS) > 50:
        JOBS.popitem(last=False)
    threading.Thread(target=run_job, args=(job,), daemon=True).start()
    return job


LIB_EXT = {".png": "image", ".jpg": "image", ".mp4": "video", ".gif": "image"}
LIB_ZIPS: dict[str, tuple[Path, float]] = {}   # download token -> (zip file, created)


def library_items():
    out = []
    if OUTPUTS.is_dir():
        for f in OUTPUTS.rglob("*"):
            if f.is_file() and f.suffix.lower() in LIB_EXT:
                st = f.stat()
                rel = f.relative_to(OUTPUTS).as_posix()
                out.append({"file": rel, "name": f.name, "folder": rel.rsplit("/", 1)[0] if "/" in rel else "",
                            "kind": "video" if f.suffix.lower() == ".mp4" else "image", "ext": f.suffix.lower()[1:],
                            "size": st.st_size, "mtime": int(st.st_mtime), "url": "/outputs/" + rel})
    out.sort(key=lambda i: i["mtime"], reverse=True)
    return out[:1000]


def library_files(files):
    """Resolve requested library paths safely (inside outputs/ only)."""
    base = OUTPUTS.resolve()
    if not isinstance(files, list) or not files:
        raise SpecError("Select at least one file")
    if len(files) > 2000:
        raise SpecError("Too many files for one zip (max 2000)")
    paths = []
    for rel in files:
        p = (base / str(rel)).resolve()
        if base in p.parents and p.is_file() and p.suffix.lower() in LIB_EXT:
            paths.append(p)
    if not paths:
        raise SpecError("Those files no longer exist")
    return paths


def make_library_zip(paths) -> str:
    now = time.time()
    for tok, (f, ts) in list(LIB_ZIPS.items()):   # drop stale temp zips
        if now - ts > 900:
            f.unlink(missing_ok=True)
            LIB_ZIPS.pop(tok, None)
    d = Path(tempfile.mkdtemp(prefix="msz_"))
    zf = d / f"creatives-{time.strftime('%Y%m%d-%H%M%S')}.zip"
    base = OUTPUTS.resolve()
    with zipfile.ZipFile(zf, "w", zipfile.ZIP_STORED) as z:   # media is already compressed
        for p in paths:
            z.write(p, p.relative_to(base).as_posix())
    tok = uuid.uuid4().hex
    LIB_ZIPS[tok] = (zf, now)
    return tok


def _progress(job):
    return lambda p: setattr(job, "progress", p)


def _named_spec(name):
    """Load a saved project or bundled template by name (or raise)."""
    for base in (PROJECTS, TEMPLATES):
        f = base / f"{Path(str(name)).name}.json"
        if f.is_file():
            return json.loads(f.read_text("utf-8"))
    raise SpecError(f"No project or template named {name!r}")


def _size(v):
    if v is None:
        return (1080, 1920)
    w, h, _ = engine.resolve_target(v)
    return (w, h)


def do_generate(b):
    spec, meta = generator.generate(
        b.get("text"), kind=b.get("kind") or "video", theme=b.get("theme") or None,
        brand=b.get("brand_name") or None, brand_override=b.get("brand") or None, size=_size(b.get("size")),
        cta=b.get("cta"), url=b.get("url"), images=b.get("images") or [], music=b.get("music") or None,
        target=b.get("target") or None, logo=b.get("logo", True), name=b.get("name") or None)
    comp = engine.Composer(spec, 270, 480)
    scenes = [{"start": round(comp.starts[i], 3), "end": round(comp.starts[i] + r.dur, 3),
               "poster": round(comp.poster_global(i), 3)} for i, r in enumerate(comp.scenes)]
    return {"spec": spec, "meta": meta, "timeline": {"total": round(comp.total, 3), "scenes": scenes}}


# --------------------------------------------------------------------------- preview cache
_preview_cache: "OrderedDict[str, engine.Composer]" = OrderedDict()
_preview_lock = threading.Lock()


def preview_jpeg(spec, t, max_edge):
    norm = engine.normalize(spec)
    scale = min(1.0, max_edge / max(norm["width"], norm["height"]))
    W, H = int(norm["width"] * scale) // 2 * 2 or 2, int(norm["height"] * scale) // 2 * 2 or 2
    key = json.dumps(norm, sort_keys=True) + f"{W}x{H}"
    with _preview_lock:
        comp = _preview_cache.pop(key, None)
        if comp is None:
            comp = engine.Composer(norm, W, H)
        _preview_cache[key] = comp
        while len(_preview_cache) > 6:
            _preview_cache.popitem(last=False)
        img = comp.frame(t)
        total = comp.total
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=85)
    return buf.getvalue(), total


# --------------------------------------------------------------------------- http
class Handler(BaseHTTPRequestHandler):
    server_version = "MarketingStudio/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        if "--quiet" not in sys.argv:
            sys.stderr.write("  %s\n" % (fmt % args))

    # -- plumbing
    def _host_ok(self):
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]").lower()
        return host in ("127.0.0.1", "localhost", "::1")

    def _origin_ok(self):
        origin = self.headers.get("Origin")
        if not origin:
            return True
        p = urlparse(origin)
        return (p.hostname or "").lower() in ("127.0.0.1", "localhost", "::1") and p.port == self.server.server_port

    def _send(self, code, body=b"", ctype="application/json", extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if self.close_connection:
            self.send_header("Connection", "close")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj).encode())

    def _err(self, code, msg):
        if self.command in ("POST", "PUT", "DELETE"):
            self.close_connection = True  # request body may be unread; don't parse it as the next request
        self._json({"error": msg}, code)

    def _body(self, limit=MAX_BODY):
        n = int(self.headers.get("Content-Length") or 0)
        if n > limit:
            raise SpecError(f"Request too large (limit {limit // (1024 * 1024)} MB)")
        return self.rfile.read(n)

    def _json_body(self):
        try:
            return json.loads(self._body() or b"{}")
        except json.JSONDecodeError:
            raise SpecError("Request body is not valid JSON")

    def _file(self, path: Path, download=False):
        try:
            size = path.stat().st_size
        except OSError:
            return self._err(404, "Not found")
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        start, end, code = 0, size - 1, 200
        rng = self.headers.get("Range")
        m = re.fullmatch(r"bytes=(\d*)-(\d*)", rng or "")
        if m and (m[1] or m[2]):
            if m[1]:
                start = int(m[1])
                end = int(m[2]) if m[2] else size - 1
            else:
                start = max(0, size - int(m[2]))
            end = min(end, size - 1)
            if start > end:
                return self._send(416, b"", extra={"Content-Range": f"bytes */{size}"})
            code = 206
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("X-Content-Type-Options", "nosniff")
        if code == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        if download:
            self.send_header("Content-Disposition", f'attachment; filename="{path.name}"')
        self.end_headers()
        if self.command == "HEAD":
            return
        with open(path, "rb") as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = f.read(min(1 << 20, left))
                if not chunk:
                    break
                self.wfile.write(chunk)
                left -= len(chunk)

    @staticmethod
    def _safe_in(base: Path, rel: str):
        base = base.resolve()
        p = (base / unquote(rel)).resolve()
        return p if (base in p.parents and p.is_file()) else None

    def _guard(self, mutating):
        if not self._host_ok():
            self._err(403, "Bad Host header")
            return False
        if mutating and not self._origin_ok():
            self._err(403, "Cross-origin request blocked")
            return False
        return True

    # -- routing
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if not self._guard(False):
            return
        path = urlparse(self.path).path
        try:
            if path in ("/", "/index.html"):
                return self._file(STATIC / "index.html")
            if path.startswith("/static/"):
                f = self._safe_in(STATIC, path[8:])
                return self._file(f) if f else self._err(404, "Not found")
            if path.startswith("/assets/"):
                f = self._safe_in(ASSETS, path[8:])
                return self._file(f) if f else self._err(404, "Not found")
            if path.startswith("/outputs/"):
                f = self._safe_in(OUTPUTS, path[9:])
                return self._file(f, download="download" in self.path) if f else self._err(404, "Not found")
            if path == "/api/info":
                return self._json({"presets": engine.PRESETS, "fonts": engine.FONT_CHOICES + engine.user_fonts(),
                                   "anims_in": engine.ANIMS_IN, "anims_out": engine.ANIMS_OUT,
                                   "transitions": engine.TRANSITIONS, "env": engine.environment_report(),
                                   "qualities": list(engine.QUALITY), "brand": brandmod.load(), "brand_name": brandmod.active_name()})
            if path == "/api/brands":
                return self._json({"brands": brandmod.list_brands(), "active": brandmod.active_name()})
            m = re.fullmatch(r"/api/brands/([^/]+)", path)
            if m and m[1] != "active":
                name = unquote(m[1])
                return self._json({"name": name, "brand": brandmod.load(name), "exists": name in brandmod.list_brands()})
            if path == "/api/themes":
                return self._json({"themes": generator.theme_cards(brandmod.load()), "options": generator.THEME_OPTIONS})
            if path == "/api/library":
                items = library_items()
                return self._json({"items": items, "total_size": sum(i["size"] for i in items)})
            m = re.fullmatch(r"/api/library/download/([0-9a-f]{32})", path)
            if m:
                ent = LIB_ZIPS.get(m[1])
                if not ent or not ent[0].is_file():
                    return self._err(404, "This download expired; press the button again")
                return self._file(ent[0], download=True)
            if path == "/api/sample.csv":
                return self._send(200, bulk.SAMPLE_CSV.encode(), "text/csv", {"Content-Disposition": 'attachment; filename="sample-bulk.csv"'})
            m = re.fullmatch(r"/api/jobs/([0-9a-f]+)/zip", path)
            if m:
                job = JOBS.get(m[1])
                if not job or not job.files:
                    return self._err(404, "Nothing to download")
                buf = io.BytesIO()
                with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:
                    for f in job.files:
                        z.write(f, f.relative_to(OUTPUTS).as_posix())
                return self._send(200, buf.getvalue(), "application/zip", {"Content-Disposition": f'attachment; filename="creatives-{job.id}.zip"'})
            if path == "/editor":
                return self._file(STATIC / "editor.html")
            if path == "/api/assets":
                items = sorted(p.name for p in ASSETS.iterdir() if p.is_file() and p.suffix.lower() in ASSET_EXT) if ASSETS.is_dir() else []
                return self._json({"assets": items})
            if path == "/api/projects":
                return self._json({"projects": sorted(p.stem for p in PROJECTS.glob("*.json"))})
            if path == "/api/templates":
                return self._json({"templates": sorted(p.stem for p in TEMPLATES.glob("*.json"))})
            m = re.fullmatch(r"/api/(projects|templates)/([^/]+)", path)
            if m:
                base = PROJECTS if m[1] == "projects" else TEMPLATES
                f = self._safe_in(base, unquote(m[2]) + ".json")
                return self._json(json.loads(f.read_text("utf-8"))) if f else self._err(404, "Not found")
            m = re.fullmatch(r"/api/jobs/([0-9a-f]+)", path)
            if m:
                job = JOBS.get(m[1])
                return self._json(job.to_json()) if job else self._err(404, "Unknown job")
            self._err(404, "Not found")
        except SpecError as e:
            self._err(400, str(e))
        except Exception as e:
            self._err(500, f"Server error: {e}")

    def do_POST(self):
        if not self._guard(True):
            return
        path = urlparse(self.path).path
        try:
            if path == "/api/preview":
                b = self._json_body()
                data, total = preview_jpeg(b.get("spec"), float(b.get("t") or 0),
                                           int(engine.num(b.get("max_edge"), 640, 100, 1600, "max_edge")))
                return self._send(200, data, "image/jpeg", {"X-Total-Duration": f"{total:.3f}",
                                                            "Access-Control-Expose-Headers": "X-Total-Duration"})
            if path == "/api/validate":
                n = engine.normalize(self._json_body().get("spec"))
                c = engine.Composer(n)
                return self._json({"ok": True, "duration": round(c.total, 3)})
            if path == "/api/library/zip":
                b = self._json_body()
                files = [i["file"] for i in library_items()] if b.get("all") else b.get("files")
                paths = library_files(files)
                tok = make_library_zip(paths)
                return self._json({"url": f"/api/library/download/{tok}", "count": len(paths)})
            if path == "/api/library/delete":
                paths = library_files(self._json_body().get("files"))
                for p in paths:
                    p.unlink()
                    if p.parent != OUTPUTS.resolve() and not any(p.parent.iterdir()):
                        p.parent.rmdir()   # tidy empty bulk_* folders
                return self._json({"deleted": len(paths)})
            if path == "/api/generate":
                return self._json(do_generate(self._json_body()))
            if path == "/api/themes":
                b = self._json_body()
                return self._json({"themes": generator.theme_cards(brandmod.load(b.get("brand_name") or None, b.get("brand"))),
                                   "options": generator.THEME_OPTIONS})
            if path == "/api/brands/active":
                brandmod.set_active(str(self._json_body().get("name", "")))
                return self._json({"active": brandmod.active_name()})
            if path == "/api/bulk/preview":
                b = self._json_body()
                cols, rows = bulk.parse_csv(b.get("csv"))
                need = []
                if b.get("mode") == "template" and b.get("template"):
                    need = sorted(bulk.placeholders(_named_spec(b["template"])))
                return self._json({"columns": cols, "count": len(rows), "sample": rows[:5], "needs": need,
                                   "missing": [n for n in need if n not in cols]})
            if path == "/api/bulk":
                b = self._json_body()
                _cols, rows = bulk.parse_csv(b.get("csv"))
                mode = b.get("mode") or "generate"
                if mode not in ("generate", "template"):
                    raise SpecError("mode must be generate or template")
                targets = b.get("targets") or []
                for t in targets:
                    engine.resolve_target(t)
                if not targets:
                    raise SpecError("Pick at least one output size")
                fmt, quality = b.get("format", "mp4"), b.get("quality", "hd")
                if fmt not in ("mp4", "gif", "png", "jpg") or quality not in engine.QUALITY:
                    raise SpecError("Bad format or quality")
                tpl = _named_spec(b["template"]) if mode == "template" else None

                def work(job):
                    files, errs, _ = bulk.run_bulk(rows, mode, targets, fmt, quality, template=tpl, theme=b.get("theme") or None,
                                                   kind=b.get("kind") or "video", brand=b.get("brand_name") or None,
                                                   images=b.get("images") or None, music=b.get("music") or None,
                                                   target=b.get("target") or None, progress=_progress(job), cancel=job.cancel)
                    job.files, job.warnings = files, errs
                    if not files:
                        raise SpecError("Nothing was rendered. " + " | ".join(errs[:3]))
                return self._json(start_job(work).to_json(), 202)
            if path == "/api/render":
                b = self._json_body()
                spec = b.get("spec")
                engine.normalize(spec)
                targets, fmt, quality = b.get("targets") or [], b.get("format", "mp4"), b.get("quality", "hd")
                for t in targets:
                    engine.resolve_target(t)
                if fmt not in ("mp4", "gif", "png", "jpg"):
                    raise SpecError("format must be mp4, gif, png or jpg")
                if quality not in engine.QUALITY:
                    raise SpecError("quality must be standard, hd or ultra")
                if not targets:
                    raise SpecError("Pick at least one output size")

                def work(job):
                    job.files = engine.export(spec, targets, fmt, b.get("fps"), b.get("scene"), progress=_progress(job),
                                              cancel=job.cancel, quality=quality)
                return self._json(start_job(work).to_json(), 202)
            m = re.fullmatch(r"/api/jobs/([0-9a-f]+)/cancel", path)
            if m:
                job = JOBS.get(m[1])
                if not job:
                    return self._err(404, "Unknown job")
                job.cancel.set()
                return self._json(job.to_json())
            self._err(404, "Not found")
        except SpecError as e:
            self._err(400, str(e))
        except Exception as e:
            self._err(500, f"Server error: {e}")

    def do_PUT(self):
        if not self._guard(True):
            return
        path = urlparse(self.path).path
        try:
            m = re.fullmatch(r"/api/projects/([^/]+)", path)
            if m:
                name = unquote(m[1])
                if not re.fullmatch(r"[A-Za-z0-9_-]{1,60}", name):
                    raise SpecError("Project names: letters, numbers, - and _ only")
                spec = self._json_body()
                engine.normalize(spec)
                PROJECTS.mkdir(exist_ok=True)
                (PROJECTS / f"{name}.json").write_text(json.dumps(spec, indent=2), "utf-8")
                return self._json({"saved": name})
            m = re.fullmatch(r"/api/brands/([^/]+)", path)
            if m:
                return self._json({"saved": brandmod.save(unquote(m[1]), self._json_body())})
            m = re.fullmatch(r"/api/fonts/([^/]+)", path)
            if m:
                name = Path(unquote(m[1])).name
                if not NAME_RE.match(name) or Path(name).suffix.lower() not in (".ttf", ".otf"):
                    raise SpecError("Fonts must be .ttf or .otf files")
                data = self._body(25 * 1024 * 1024)
                if data[:4] not in (b"\x00\x01\x00\x00", b"OTTO", b"true"):
                    raise SpecError("That file does not look like a TrueType/OpenType font")
                FONTS.mkdir(exist_ok=True)
                (FONTS / name).write_bytes(data)
                engine._font_index = None
                engine.get_font.cache_clear()
                return self._json({"saved": name})
            m = re.fullmatch(r"/api/assets/([^/]+)", path)
            if m:
                name = Path(unquote(m[1])).name
                if not NAME_RE.match(name) or Path(name).suffix.lower() not in ASSET_EXT:
                    raise SpecError(f"Unsupported file name/type. Allowed: {', '.join(sorted(ASSET_EXT))}")
                data = self._body(MAX_UPLOAD)
                ASSETS.mkdir(exist_ok=True)
                (ASSETS / name).write_bytes(data)
                return self._json({"saved": name})
            self._err(404, "Not found")
        except SpecError as e:
            self._err(400, str(e))
        except Exception as e:
            self._err(500, f"Server error: {e}")

    def do_DELETE(self):
        if not self._guard(True):
            return
        path = urlparse(self.path).path
        m = re.fullmatch(r"/api/(assets|projects|outputs|brands)/([^/]+)", path)
        if not m:
            return self._err(404, "Not found")
        base = {"assets": ASSETS, "projects": PROJECTS, "outputs": OUTPUTS, "brands": brandmod.BRANDS}[m[1]]
        name = unquote(m[2])
        if m[1] in ("projects", "brands"):
            name += ".json"
        f = self._safe_in(base, name)
        if not f:
            return self._err(404, "Not found")
        f.unlink()
        self._json({"deleted": name})


# --------------------------------------------------------------------------- cli
def load_spec(path: str) -> dict:
    try:
        return json.loads(Path(path).read_text("utf-8"))
    except FileNotFoundError:
        raise SpecError(f"File not found: {path}")
    except json.JSONDecodeError as e:
        raise SpecError(f"{path} is not valid JSON: {e}")


def cmd_serve(a):
    for d in (ASSETS, PROJECTS, OUTPUTS):
        d.mkdir(exist_ok=True)
    try:
        srv = ThreadingHTTPServer((a.host, a.port), Handler)
    except OSError as e:
        sys.exit(f"Cannot listen on {a.host}:{a.port} ({e}). Try --port 8766")
    url = f"http://{'127.0.0.1' if a.host in ('0.0.0.0', '') else a.host}:{srv.server_port}"
    print(f"Marketing Studio running at {url}  (Ctrl+C to stop)")
    rep = engine.environment_report()
    if not rep["ffmpeg"]:
        print("  ! ffmpeg not found: images work, video export needs ffmpeg (see README)")
    if a.host not in ("127.0.0.1", "localhost", "::1"):
        print("  ! Listening beyond localhost: only do this on a trusted network.")
    if not a.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


def _cli_progress():
    last = [-1]

    def f(p):
        pct = int(p * 100) // 5 * 5
        if pct != last[0]:
            last[0] = pct
            print(f"\r  {pct:3d}%", end="", file=sys.stderr, flush=True)
    return f


def _targets(a):
    t = list(a.preset or []) + list(a.size or [])
    return t or ["reels"]


def cmd_render(a, fmt=None):
    spec = load_spec(a.spec)
    fmt = fmt or a.format
    files = engine.export(spec, _targets(a), fmt, a.fps, getattr(a, "scene", None), quality=getattr(a, "quality", "hd"),
                          progress=_cli_progress())
    print(file=sys.stderr)
    for f in files:
        print(f)


def cmd_image(a):
    a.scene = None if a.scene is None else a.scene - 1
    cmd_render(a, fmt=a.format if a.format in ("png", "jpg") else "png")


def _read_text(arg: str) -> str:
    if arg.startswith("@"):
        try:
            return Path(arg[1:]).read_text("utf-8")
        except OSError as e:
            raise SpecError(f"Cannot read {arg[1:]}: {e}")
    return arg


def cmd_make(a):
    first = engine.resolve_target(_targets(a)[0])
    spec, meta = generator.generate(_read_text(a.text), kind=a.kind, theme=a.theme, brand=a.brand, size=(first[0], first[1]),
                                    cta=a.cta, url=a.url, images=a.image, music=a.music, target=a.length, logo=not a.no_logo,
                                    name=a.name)
    for w in meta["warnings"]:
        print("warning:", w, file=sys.stderr)
    if a.save:
        Path(a.save).parent.mkdir(parents=True, exist_ok=True)
        Path(a.save).write_text(json.dumps(spec, indent=2), "utf-8")
        print(f"saved {a.save}", file=sys.stderr)
    if a.no_render:
        return
    fmt = a.format or ("mp4" if a.kind == "video" else "png")
    files = engine.export(spec, _targets(a), fmt, a.fps, None, quality=a.quality,
                          progress=_cli_progress())
    print(file=sys.stderr)
    for f in files:
        print(f)


def cmd_bulk(a):
    _cols, rows = bulk.parse_csv(Path(a.csv).read_text("utf-8-sig") if Path(a.csv).is_file() else (_ for _ in ()).throw(SpecError(f"File not found: {a.csv}")))
    mode = "template" if a.template else "generate"
    tpl = None
    if a.template:
        tpl = json.loads(Path(a.template).read_text("utf-8")) if Path(a.template).is_file() else _named_spec(a.template)
    files, errs, out_dir = bulk.run_bulk(rows, mode, _targets(a), a.format, a.quality, template=tpl, theme=a.theme, kind=a.kind,
                                         brand=a.brand, images=a.image, music=a.music, target=a.length, fps=a.fps,
                                         progress=_cli_progress())
    print(file=sys.stderr)
    for f in files:
        print(f)
    for e in errs:
        print("skipped:", e, file=sys.stderr)
    if not files:
        sys.exit(1)


def cmd_brand(a):
    if a.action == "list":
        act = brandmod.active_name()
        for n in brandmod.list_brands() or ["(none saved yet; the editor's Brand tab creates one)"]:
            print(("* " if n == act else "  ") + n)
    elif a.action == "use":
        brandmod.set_active(a.name)
        print("active brand:", a.name)
    else:
        print(json.dumps(brandmod.load(a.name), indent=2))


def cmd_presets(_a):
    for p in engine.PRESETS:
        print(f"{p['id']:<10} {p['w']:>4}x{p['h']:<4} {p['kind']:<6} {p['label']}")


def cmd_check(_a):
    r = engine.environment_report()
    print(f"Pillow  : {r['pillow']}\nffmpeg  : {r['ffmpeg'] or 'NOT FOUND'}\nlibx264 : {r['libx264']}")
    sys.exit(0 if r["ffmpeg"] and r["libx264"] else 1)


def cmd_validate(a):
    c = engine.Composer(load_spec(a.spec))
    print(f"OK: {len(c.scenes)} scene(s), {c.total:.2f}s at {c.W}x{c.H}")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve", help="start the local editor")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8765)
    s.add_argument("--no-browser", action="store_true")
    s.add_argument("--quiet", action="store_true")
    s.set_defaults(fn=cmd_serve)
    for name, fn, help_ in (("render", cmd_render, "render a spec to mp4/gif (or images)"),
                            ("image", cmd_image, "export still images from a spec")):
        r = sub.add_parser(name, help=help_)
        r.add_argument("spec")
        r.add_argument("-p", "--preset", action="append", help="preset id (repeatable); see `presets`")
        r.add_argument("--size", action="append", help="custom WxH (repeatable)")
        r.add_argument("-f", "--format", default="mp4" if name == "render" else "png")
        r.add_argument("--fps", type=int)
        r.add_argument("-q", "--quality", default="hd", choices=list(engine.QUALITY))
        if name == "image":
            r.add_argument("--scene", type=int, help="1-based scene number (default: all)")
        r.set_defaults(fn=fn)
    mk = sub.add_parser("make", help="generate a themed video/image from a sentence, paragraph or script (or @file.txt)")
    mk.add_argument("text")
    mk.add_argument("-k", "--kind", default="video", choices=["video", "image", "carousel"])
    mk.add_argument("-t", "--theme", choices=list(generator.THEMES))
    mk.add_argument("-b", "--brand", help="brand profile name (default: active)")
    mk.add_argument("-p", "--preset", action="append")
    mk.add_argument("--size", action="append")
    mk.add_argument("-f", "--format")
    mk.add_argument("-q", "--quality", default="hd", choices=list(engine.QUALITY))
    mk.add_argument("--cta")
    mk.add_argument("--url")
    mk.add_argument("--image", action="append", help="asset file name (repeatable, applied to scenes in order)")
    mk.add_argument("--music")
    mk.add_argument("--length", type=float, help="target length in seconds")
    mk.add_argument("--name")
    mk.add_argument("--fps", type=int)
    mk.add_argument("--no-logo", action="store_true")
    mk.add_argument("--save", help="also save the generated spec JSON here (open it in the editor later)")
    mk.add_argument("--no-render", action="store_true")
    mk.set_defaults(fn=cmd_make)
    bk = sub.add_parser("bulk", help="one creative per CSV row")
    bk.add_argument("csv")
    bk.add_argument("--template", help="project/template name or JSON path with {{column}} placeholders (default: generate from script column)")
    bk.add_argument("-k", "--kind", default="video", choices=["video", "image", "carousel"])
    bk.add_argument("-t", "--theme", choices=list(generator.THEMES))
    bk.add_argument("-b", "--brand")
    bk.add_argument("-p", "--preset", action="append")
    bk.add_argument("--size", action="append")
    bk.add_argument("-f", "--format", default="mp4")
    bk.add_argument("-q", "--quality", default="hd", choices=list(engine.QUALITY))
    bk.add_argument("--image", action="append")
    bk.add_argument("--music")
    bk.add_argument("--length", type=float)
    bk.add_argument("--fps", type=int)
    bk.set_defaults(fn=cmd_bulk)
    br = sub.add_parser("brand", help="list / show / switch brand profiles")
    br.add_argument("action", choices=["list", "show", "use"])
    br.add_argument("name", nargs="?")
    br.set_defaults(fn=cmd_brand)
    sub.add_parser("presets", help="list size presets").set_defaults(fn=cmd_presets)
    sub.add_parser("check", help="verify ffmpeg/Pillow").set_defaults(fn=cmd_check)
    v = sub.add_parser("validate", help="validate a spec")
    v.add_argument("spec")
    v.set_defaults(fn=cmd_validate)
    a = ap.parse_args(argv)
    try:
        a.fn(a)
    except SpecError as e:
        sys.exit(f"Error: {e}")


if __name__ == "__main__":
    main()
