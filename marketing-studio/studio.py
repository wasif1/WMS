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
import threading
import time
import uuid
import webbrowser
from collections import OrderedDict
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

import engine
from engine import ASSETS, OUTPUTS, PROJECTS, ROOT, TEMPLATES, SpecError

STATIC = ROOT / "static"
MAX_BODY = 4 * 1024 * 1024          # JSON bodies
MAX_UPLOAD = 300 * 1024 * 1024      # asset uploads
ASSET_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".mp3", ".wav", ".m4a", ".aac", ".ogg"}
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.\-]{0,80}$")


# --------------------------------------------------------------------------- jobs
class Job:
    def __init__(self, spec, targets, fmt, fps, scene):
        self.id = uuid.uuid4().hex[:10]
        self.spec, self.targets, self.fmt, self.fps, self.scene = spec, targets, fmt, fps, scene
        self.status, self.progress, self.error = "queued", 0.0, None
        self.files: list[Path] = []
        self.cancel = threading.Event()

    def to_json(self):
        return {"id": self.id, "status": self.status, "progress": round(self.progress, 3), "error": self.error,
                "outputs": [{"file": f.name, "url": "/outputs/" + f.name} for f in self.files]}


JOBS: "OrderedDict[str, Job]" = OrderedDict()
RENDER_LOCK = threading.Lock()  # one export at a time keeps the machine responsive


def run_job(job: Job):
    with RENDER_LOCK:
        if job.cancel.is_set():
            job.status = "cancelled"
            return
        job.status = "running"
        try:
            job.files = engine.export(job.spec, job.targets, job.fmt, job.fps, job.scene,
                                      progress=lambda p: setattr(job, "progress", p), cancel=job.cancel)
            job.progress, job.status = 1.0, "done"
        except engine.Cancelled:
            job.status = "cancelled"
        except SpecError as e:
            job.status, job.error = "error", str(e)
        except Exception as e:  # never kill the worker silently
            job.status, job.error = "error", f"Unexpected error: {e}"


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
                                   "transitions": engine.TRANSITIONS, "env": engine.environment_report()})
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
            if path == "/api/render":
                b = self._json_body()
                engine.normalize(b.get("spec"))
                for t in b.get("targets") or []:
                    engine.resolve_target(t)
                job = Job(b["spec"], b.get("targets") or [], b.get("format", "mp4"), b.get("fps"), b.get("scene"))
                if job.fmt not in ("mp4", "gif", "png", "jpg"):
                    raise SpecError("format must be mp4, gif, png or jpg")
                if not job.targets:
                    raise SpecError("Pick at least one output size")
                JOBS[job.id] = job
                while len(JOBS) > 50:
                    JOBS.popitem(last=False)
                threading.Thread(target=run_job, args=(job,), daemon=True).start()
                return self._json(job.to_json(), 202)
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
        m = re.fullmatch(r"/api/(assets|projects|outputs)/([^/]+)", path)
        if not m:
            return self._err(404, "Not found")
        base = {"assets": ASSETS, "projects": PROJECTS, "outputs": OUTPUTS}[m[1]]
        name = unquote(m[2])
        if m[1] == "projects":
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


def _targets(a):
    t = list(a.preset or []) + list(a.size or [])
    return t or ["reels"]


def cmd_render(a, fmt=None):
    spec = load_spec(a.spec)
    fmt = fmt or a.format
    files = engine.export(spec, _targets(a), fmt, a.fps, getattr(a, "scene", None),
                          progress=lambda p: print(f"\r  {p * 100:5.1f}%", end="", file=sys.stderr))
    print(file=sys.stderr)
    for f in files:
        print(f)


def cmd_image(a):
    a.scene = None if a.scene is None else a.scene - 1
    cmd_render(a, fmt=a.format if a.format in ("png", "jpg") else "png")


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
        if name == "image":
            r.add_argument("--scene", type=int, help="1-based scene number (default: all)")
        r.set_defaults(fn=fn)
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
