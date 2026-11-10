import http.client, json, sys, tempfile, threading, unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import engine, studio

SPEC = {"name": "t", "width": 540, "height": 960, "fps": 10,
        "transition": {"type": "fade", "duration": 0.4},
        "scenes": [
            {"duration": 1, "background": {"type": "gradient", "colors": ["#f00", "#00f"], "angle": 90},
             "layers": [{"type": "text", "text": "Hi there", "in": "pop", "shadow": True, "box": {}},
                        {"type": "shape", "shape": "circle", "w": 0.2, "y": 0.2, "shadow": True}]},
            {"duration": 1, "background": {"type": "color", "color": "#123456"}, "layers": []}]}


class Engine(unittest.TestCase):
    def test_normalize_rejects_bad_specs(self):
        for bad in ([], {"scenes": []}, {"scenes": [{"layers": [{"type": "video"}]}]},
                    {"scenes": [{"layers": [{"type": "text", "in": "spin"}]}]},
                    {"width": "abc", "scenes": [{}]}):
            with self.assertRaises(engine.SpecError):
                engine.normalize(bad)

    def test_dimensions_forced_even(self):
        n = engine.normalize({"width": 1081, "height": 801, "scenes": [{}]})
        self.assertEqual((n["width"], n["height"]), (1080, 800))

    def test_frames_and_timeline(self):
        c = engine.Composer(SPEC, 270, 480)
        self.assertAlmostEqual(c.total, 1.6)
        for t in (0, 0.5, 0.8, 1.0, 1.59, 99):
            self.assertEqual(c.frame(t).size, (270, 480))

    def test_bad_colour_is_a_spec_error(self):
        s = json.loads(json.dumps(SPEC)); s["scenes"][0]["layers"][0]["color"] = "nope"
        with self.assertRaises(engine.SpecError):
            engine.Composer(s, 100, 100).frame(0.5)

    def test_asset_traversal_blocked(self):
        for name in ("../studio.py", "/etc/passwd", "..\\x", ""):
            with self.assertRaises(engine.SpecError):
                engine.asset_path(name)

    def test_targets(self):
        self.assertEqual(engine.resolve_target("square"), (1080, 1080, "square"))
        self.assertEqual(engine.resolve_target("1080x1350")[:2], (1080, 1350))
        for bad in ("nope", "99999x10", {"w": 10, "h": 10}):
            try:
                engine.resolve_target(bad)
            except engine.SpecError:
                continue
            if bad == {"w": 10, "h": 10}:  # clamped up to the minimum rather than rejected
                continue
            self.fail(bad)

    def test_image_and_video_export(self):
        with tempfile.TemporaryDirectory() as d:
            files = engine.export(SPEC, ["square", "ad_leader"], "png", out_dir=Path(d))
            self.assertEqual(len(files), 4)  # 2 sizes x 2 scenes
            self.assertEqual(len(engine.export(SPEC, ["300x250"], "jpg", scene=0, out_dir=Path(d))), 1)
            if engine.ffmpeg_bin():
                out = engine.export(SPEC, ["300x250"], "mp4", out_dir=Path(d))[0]
                self.assertGreater(out.stat().st_size, 1000)
                gif = engine.export(SPEC, ["300x250"], "gif", out_dir=Path(d))[0]
                self.assertEqual(gif.read_bytes()[:3], b"GIF")

    def test_cancel(self):
        import threading as th
        ev = th.Event(); ev.set()
        if engine.ffmpeg_bin():
            with tempfile.TemporaryDirectory() as d, self.assertRaises(engine.Cancelled):
                engine.export(SPEC, ["300x250"], "mp4", out_dir=Path(d), cancel=ev)
                
class Server(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), studio.Handler)
        cls.port = cls.srv.server_port
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def req(self, method, path, body=None, headers=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        h = {"Host": f"127.0.0.1:{self.port}"}; h.update(headers or {})
        data = json.dumps(body) if isinstance(body, (dict, list)) else body
        c.request(method, path, data, h)
        r = c.getresponse(); return r.status, r.read()

    def test_index_and_info(self):
        self.assertEqual(self.req("GET", "/")[0], 200)
        s, b = self.req("GET", "/api/info")
        self.assertEqual(s, 200); self.assertTrue(json.loads(b)["presets"])

    def test_preview(self):
        s, b = self.req("POST", "/api/preview", {"spec": SPEC, "t": 0.5, "max_edge": 200})
        self.assertEqual((s, b[:2]), (200, b"\xff\xd8"))
        self.assertEqual(self.req("POST", "/api/preview", {"spec": {"scenes": []}})[0], 400)

    def test_dns_rebinding_and_csrf_blocked(self):
        self.assertEqual(self.req("GET", "/api/info", headers={"Host": "evil.example"})[0], 403)
        self.assertEqual(self.req("POST", "/api/validate", {"spec": SPEC}, {"Origin": "http://evil.example"})[0], 403)
        self.assertEqual(self.req("POST", "/api/validate", {"spec": SPEC}, {"Origin": f"http://localhost:{self.port}"})[0], 200)

    def test_path_traversal_blocked(self):
        for p in ("/static/../studio.py", "/static/%2e%2e/studio.py", "/assets/..%2fstudio.py",
                  "/outputs/%2e%2e%2fstudio.py", "/api/projects/..%2fstudio"):
            self.assertEqual(self.req("GET", p)[0], 404, p)
        self.assertEqual(self.req("DELETE", "/api/assets/..%2fstudio.py")[0], 404)

    def test_upload_rules(self):
        self.assertEqual(self.req("PUT", "/api/assets/evil.exe", b"x")[0], 400)
        # a traversal-looking name is reduced to its basename and stays inside assets/
        self.assertEqual(self.req("PUT", "/api/assets/..%2fms_test_tmp.png", b"x")[0], 200)
        self.assertTrue((engine.ASSETS / "ms_test_tmp.png").exists())
        self.assertFalse((engine.ROOT.parent / "ms_test_tmp.png").exists())
        (engine.ASSETS / "ms_test_tmp.png").unlink()

    def test_render_job_roundtrip(self):
        import time
        s, b = self.req("POST", "/api/render", {"spec": SPEC, "targets": ["300x250"], "format": "png", "scene": 0})
        self.assertEqual(s, 202); jid = json.loads(b)["id"]
        for _ in range(100):
            j = json.loads(self.req("GET", f"/api/jobs/{jid}")[1])
            if j["status"] in ("done", "error"): break
            time.sleep(0.1)
        self.assertEqual(j["status"], "done", j)
        f = engine.OUTPUTS / j["outputs"][0]["file"]
        self.assertTrue(f.exists()); f.unlink()
        self.assertEqual(self.req("POST", "/api/render", {"spec": SPEC, "targets": [], "format": "png"})[0], 400)

if __name__ == "__main__":
    unittest.main()
