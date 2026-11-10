"""Unit tests: real ffmpeg exports measured with ffprobe (skipped when ffmpeg is not installed)."""
import json, os, shutil, subprocess, sys, tempfile, threading, unittest
from pathlib import Path
sys.path.insert(0, os.path.dirname(__file__))
from _util import *  # noqa
import engine

FF = engine.ffmpeg_bin()
HAVE = bool(FF) and bool(shutil.which("ffprobe"))


def probe(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
                         capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def demo_spec(**kw):
    s = {"name": "vid", "width": 320, "height": 568, "fps": 24, "transition": {"type": "fade", "duration": 0.5},
         "scenes": [
             {"duration": 1.5, "background": {"type": "gradient", "colors": ["#ff3d00", "#7c3aed"], "angle": 160, "drift": 30},
              "layers": [{"type": "text", "text": "Hello *world*", "size": 0.1, "color": "#fff", "accent": "#fbbf24", "in": "pop", "shadow": True}]},
             {"duration": 1.5, "background": {"type": "color", "color": "#0f172a"},
              "layers": [{"type": "shape", "shape": "circle", "w": 0.4, "color": "#fbbf24", "in": "zoom"}]}]}
    s.update(kw)
    return s


@unittest.skipUnless(HAVE, "ffmpeg/ffprobe not installed")
class VideoExport(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(); cls.dir = Path(cls.tmp.name)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def render(self, spec, name="o.mp4", **kw):
        return engine.render_video(spec, self.dir / name, spec["width"], spec["height"], **kw)

    def test_mp4_is_social_ready(self):
        spec = demo_spec(); out = self.render(spec)
        info = probe(out); v = next(s for s in info["streams"] if s["codec_type"] == "video")
        total = engine.Composer(spec).total
        self.assertEqual((v["codec_name"], v["pix_fmt"], v["profile"]), ("h264", "yuv420p", "High"))
        self.assertEqual((v["width"], v["height"]), (320, 568)); self.assertEqual(v["width"] % 2 + v["height"] % 2, 0)
        self.assertAlmostEqual(float(info["format"]["duration"]), total, delta=0.12)
        self.assertEqual(int(v["nb_frames"]), int(round(total * 24)))
        self.assertEqual(v["r_frame_rate"], "24/1")
        head = out.read_bytes()[:200000]
        self.assertTrue(head.find(b"moov") != -1 and head.find(b"moov") < (head.find(b"mdat") if head.find(b"mdat") != -1 else 10**9),
                        "moov atom must come first (faststart) so it plays while uploading")

    def test_frame_rates(self):
        for fps in (24, 30, 60):
            spec = demo_spec(fps=fps); out = self.render(spec, f"f{fps}.mp4")
            v = next(s for s in probe(out)["streams"] if s["codec_type"] == "video")
            self.assertEqual(int(v["nb_frames"]), int(round(engine.Composer(spec).total * fps)), fps)

    def test_odd_canvas_is_made_even(self):
        spec = demo_spec(width=321, height=569); out = self.render(spec, "odd.mp4")
        v = next(s for s in probe(out)["streams"] if s["codec_type"] == "video")
        self.assertEqual((v["width"] % 2, v["height"] % 2), (0, 0))

    def test_every_size_preset_exports(self):
        for pid in ("reels", "portrait", "square", "landscape", "fb_link", "pinterest"):
            w, h, label = engine.resolve_target(pid)
            f = engine.export(demo_spec(scenes=demo_spec()["scenes"][:1]), [{"w": w // 6, "h": h // 6}], "mp4", out_dir=self.dir)[0]
            self.assertGreater(f.stat().st_size, 1000, pid)

    def test_music_is_muxed_looped_trimmed_and_faded(self):
        name = "ms_test_tone.wav"
        subprocess.run([FF, "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", str(engine.ASSETS / name)], check=True)
        try:
            spec = demo_spec(audio={"asset": name, "volume": 0.5, "fade_out": 1.0}); out = self.render(spec, "a.mp4")
            info = probe(out); kinds = [s["codec_type"] for s in info["streams"]]
            self.assertIn("audio", kinds)
            total = engine.Composer(spec).total
            a = next(s for s in info["streams"] if s["codec_type"] == "audio")
            self.assertEqual(a["codec_name"], "aac"); self.assertAlmostEqual(float(info["format"]["duration"]), total, delta=0.15)  # 1 s tone looped to 2.5 s
            vol = subprocess.run([FF, "-i", str(out), "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True).stderr
            self.assertIn("mean_volume", vol)
            self.assertNotIn("mean_volume: -91", vol)
            tail = subprocess.run([FF, "-ss", str(total - 0.2), "-i", str(out), "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True).stderr
            head = subprocess.run([FF, "-t", "0.5", "-i", str(out), "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True).stderr
            g = lambda s: float(s.split("mean_volume:")[1].split("dB")[0])
            self.assertLess(g(tail), g(head) - 6, "music should fade out at the end")
        finally:
            (engine.ASSETS / name).unlink(missing_ok=True)

    def test_bad_audio_file_gives_a_clear_error(self):
        name = "ms_test_bad.mp3"; (engine.ASSETS / name).write_bytes(b"not audio at all")
        try:
            with self.assertRaises(engine.SpecError):
                self.render(demo_spec(audio={"asset": name}), "bad.mp4")
            self.assertFalse((self.dir / "bad.mp4").exists(), "partial file left behind")
        finally:
            (engine.ASSETS / name).unlink(missing_ok=True)

    def test_gif_export(self):
        out = self.render(demo_spec(), "g.gif", fmt="gif")
        self.assertEqual(out.read_bytes()[:6], b"GIF89a")
        with Image.open(out) as im:
            self.assertGreater(im.n_frames, 10); self.assertLessEqual(im.width, 640)

    def test_quality_ladder_trades_size_for_fidelity(self):
        import random
        random.seed(5)
        noise = Image.frombytes("RGB", (256, 256), bytes(random.getrandbits(8) for _ in range(256 * 256 * 3)))
        name = "ms_test_noise_q.png"; noise.save(engine.ASSETS / name)
        try:
            spec = demo_spec(scenes=[{"duration": 1.0, "background": {"type": "image", "asset": name, "kenburns": 0.3}, "layers": []}])
            sizes = {q: self.render(spec, f"q_{q}.mp4", quality=q).stat().st_size for q in ("standard", "hd", "ultra")}
            self.assertLess(sizes["standard"], sizes["hd"]); self.assertLess(sizes["hd"], sizes["ultra"])
        finally:
            (engine.ASSETS / name).unlink(missing_ok=True)

    def test_cancel_stops_and_removes_the_partial_file(self):
        ev = threading.Event(); calls = []
        def prog(p):
            calls.append(p)
            if p > 0.3: ev.set()
        with self.assertRaises(engine.Cancelled):
            self.render(demo_spec(), "c.mp4", progress=prog, cancel=ev)
        self.assertFalse((self.dir / "c.mp4").exists()); self.assertTrue(0.3 < calls[-1] < 0.6)

    def test_progress_is_monotonic_and_reaches_one(self):
        seen = []; self.render(demo_spec(), "p.mp4", progress=seen.append)
        self.assertEqual(seen, sorted(seen)); self.assertAlmostEqual(seen[-1], 1.0)

    def test_rendering_is_deterministic(self):
        a, b = engine.Composer(demo_spec()), engine.Composer(demo_spec())
        for t in (0.0, 0.7, 1.4, 2.0, 2.9):
            self.assertTrue(same(a.frame(t), b.frame(t)), t)

    def test_missing_ffmpeg_is_reported_clearly(self):
        old = os.environ.get("FFMPEG_BIN"); os.environ["FFMPEG_BIN"] = "/definitely/not/ffmpeg"
        try:
            with self.assertRaises(engine.SpecError) as cm:
                self.render(demo_spec(), "x.mp4")
            self.assertIn("ffmpeg", str(cm.exception))
        finally:
            if old is None: os.environ.pop("FFMPEG_BIN", None)
            else: os.environ["FFMPEG_BIN"] = old

    def test_images_export_png_and_jpg_at_exact_size(self):
        for fmt in ("png", "jpg"):
            fs = engine.export(demo_spec(), [{"w": 300, "h": 250}], fmt, out_dir=self.dir)
            self.assertEqual(len(fs), 2)
            for f in fs:
                with Image.open(f) as im:
                    self.assertEqual(im.size, (300, 250)); self.assertEqual(im.format, "PNG" if fmt == "png" else "JPEG")


if __name__ == "__main__":
    unittest.main()
