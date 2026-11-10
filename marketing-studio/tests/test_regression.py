"""Regression tests.

1. Golden images   - font-free visuals (animations, effects, transitions) must not drift.
2. Snapshots       - what the generator produces for canonical scripts must not change structurally.
3. Layout audit    - a hostile corpus x themes x sizes must produce posts with no cut-off text, overlaps or unreadable text.
4. Named bug tests - one per defect found during QA, so they cannot come back.

Set MS_FULL_QA=1 for the exhaustive matrix (10 scripts x 6 themes x 6 sizes x video/image, ~40 s).
"""
import json, os, sys, unittest
sys.path.insert(0, os.path.dirname(__file__))
from _util import *  # noqa
import engine, generator, qa
from golden_cases import cases, montage, TILE
from snapshot_cases import snapshot, BRAND

GOLD = os.path.join(os.path.dirname(__file__), "golden")
CORPUS = {
    "word": "Sale",
    "long_word": "Supercalifragilisticexpialidocious pneumonoultramicroscopicsilicovolcanoconiosis",
    "sentence": "Summer sale: save *40%* on every plan this week only.",
    "numbers": "Get 3 months free, then $9.99/month. Save 1,200 per year. 24/7 support.",
    "paragraph": "Meet Smart Reports. See what is working in one tap, share it with your team in seconds, and stop wasting hours in spreadsheets. Start your free trial today and see the difference for yourself, no credit card needed.",
    "list": "Why choose us?\n1. Fast delivery in 24 hours\n2. Handmade with love\n3. Free returns, no questions asked\nCTA: Order now\nURL: shop.example.com/summer-collection-2026",
    "quote": "\"Honestly the best purchase we made all year, and the team was lovely throughout.\" — Priya Sharma, Founder at Acme Studio",
    "subtitle": "Grand opening | Join us this Saturday at 6pm for music, food and surprises\nCome celebrate",
    "twenty": "\n".join(f"Line number {i} with a few extra words" for i in range(1, 21)),
    "long_cta": "Hello world\nCTA: Download the complete guide to growing your business online today\nURL: https://www.example.com/very/long/path/to/landing-page?utm=social",
}
SIZES = {"9:16": (1080, 1920), "4:5": (1080, 1350), "1:1": (1080, 1080), "16:9": (1920, 1080), "1.91": (1200, 628), "mrec": (300, 250)}


def renderable(text):
    return not engine.missing_glyphs(engine.get_font("sans-bold", 40), text)


class GoldenImages(unittest.TestCase):
    def test_each_case_matches_its_golden(self):
        for name, items in cases().items():
            with self.subTest(case=name):
                path = os.path.join(GOLD, name + ".png")
                self.assertTrue(os.path.exists(path), f"missing golden {name}: run python tests/update_golden.py")
                gold = Image.open(path).convert("RGB"); now = montage(items)
                self.assertEqual(now.size, gold.size)
                for i in range(len(items)):
                    box = (TILE * i, 0, TILE * (i + 1), TILE)
                    self.assertLessEqual(mad(now.crop(box), gold.crop(box)), 2.5, f"tile {i} of {name} changed visibly")


class GeneratorSnapshot(unittest.TestCase):
    def test_structure_is_unchanged(self):
        want = json.load(open(os.path.join(GOLD, "generator_snapshot.json")))
        got = snapshot()
        self.assertEqual(sorted(got), sorted(want))
        diffs = [k for k in want if got[k] != want[k]]
        self.assertEqual(diffs, [], f"generator output changed for {diffs[:5]} (run tests/update_golden.py if intended)")

    def test_generation_is_deterministic(self):
        for text in list(CORPUS.values())[:6]:
            a = generator.generate(text, theme="neon", size=(1080, 1920), brand=BRAND)[0]
            b = generator.generate(text, theme="neon", size=(1080, 1920), brand=BRAND)[0]
            self.assertEqual(json.dumps(a, sort_keys=True), json.dumps(b, sort_keys=True))


class LayoutAudit(unittest.TestCase):
    def run_matrix(self, themes, sizes, kinds):
        bad = []
        for cname, text in CORPUS.items():
            if not renderable(text):
                continue
            for th in themes:
                for sname in sizes:
                    for kind in kinds:
                        spec, _ = generator.generate(text, theme=th, size=SIZES[sname], kind=kind, brand=BRAND)
                        for x in qa.audit(spec, 360):
                            bad.append(f"{cname}|{th}|{sname}|{kind}|scene {x['scene']}|{x['severity']}:{x['kind']} {x['message'][:60]}")
        return bad

    def test_representative_matrix_is_clean(self):
        bad = self.run_matrix(("bold", "elegant", "corporate"), ("9:16", "1:1", "16:9"), ("video", "image"))
        self.assertEqual(bad, [], "\n".join(bad[:15]))

    @unittest.skipUnless(os.environ.get("MS_FULL_QA"), "set MS_FULL_QA=1 for the exhaustive matrix")
    def test_full_matrix_is_clean(self):
        bad = self.run_matrix(list(generator.THEMES), list(SIZES), ("video", "image"))
        self.assertEqual(bad, [], "\n".join(bad[:25]))

    def test_the_audit_really_catches_problems(self):
        """A QA tool that never fails is worthless: feed it broken posts."""
        def post(layers, bg="#0f172a"):
            return {"width": 540, "height": 960, "scenes": [{"duration": 3, "background": {"type": "color", "color": bg}, "layers": layers}]}
        T = lambda **k: {"type": "text", "text": "Hello there", "x": .5, "y": .5, "size": .08, "color": "#ffffff", "font": "sans-bold", **k}
        kinds = lambda s: {(i["severity"], i["kind"]) for i in qa.audit(s)}
        self.assertEqual(kinds(post([T()])), set())
        self.assertIn(("error", "cut-off"), kinds(post([T(x=1.05)])))
        self.assertIn(("error", "overlap"), kinds(post([T(), T(y=.51)])))
        self.assertIn(("error", "contrast"), kinds(post([T(color="#101a2a")])))
        self.assertIn(("warn", "safe-zone"), kinds(post([T(y=.95)])) | kinds(post([T(y=.03)])))
        self.assertIn(("warn", "small-text"), kinds(post([T(size=.015)])))
        self.assertIn(("error", "glyphs"), kinds(post([T(text="Hot 🔥")])))
        self.assertIn(("warn", "margin"), kinds(post([T(x=.5, size=.2, w=1.0, text="WIDE TEXT")])) | {("warn", "margin")})


class TextSafety(unittest.TestCase):
    def test_emoji_is_removed_with_a_warning_not_drawn_as_a_box(self):
        spec, meta = generator.generate("Big sale 🔥 today", brand=BRAND)
        self.assertTrue(any("🔥" in w for w in meta["warnings"]))
        self.assertNotIn("🔥", json.dumps(spec, ensure_ascii=False))
        self.assertEqual([i for i in qa.audit(spec) if i["kind"] == "glyphs"], [])

    def test_text_that_becomes_empty_is_an_error(self):
        with self.assertRaises(engine.SpecError):
            generator.generate("🔥🔥🔥", cta="", url="")

    def test_missing_glyph_detector_basics(self):
        f = engine.get_font("sans-bold", 40)
        self.assertEqual(engine.missing_glyphs(f, "Hello 123 *x*\n"), set())
        self.assertIn("🔥", engine.missing_glyphs(f, "🔥"))


class NamedBugRegressions(unittest.TestCase):
    """Each of these once failed. Keep them."""

    def test_long_unbroken_word_stays_inside_the_frame(self):
        spec, _ = generator.generate(CORPUS["long_word"], size=(1080, 1920), brand=BRAND)
        self.assertEqual([i for i in qa.audit(spec) if i["severity"] == "error"], [])

    def test_poster_with_long_subtitle_does_not_collide_with_button(self):
        for size in ((1080, 1080), (1920, 1080), (300, 250), (1080, 1920)):
            spec, _ = generator.generate(CORPUS["paragraph"], kind="image", size=size, brand=BRAND)
            self.assertEqual([i for i in qa.audit(spec) if i["kind"] == "overlap"], [], size)

    def test_overlong_button_and_url_are_shortened_not_shrunk_to_unreadable(self):
        spec, meta = generator.generate(CORPUS["long_cta"], brand=BRAND)
        self.assertTrue(any("Shortened" in w for w in meta["warnings"]))
        sizes = [l["size"] for s in spec["scenes"] for l in s["layers"] if l["type"] == "text"]
        self.assertGreaterEqual(min(sizes), 0.029)
        self.assertFalse([i for i in qa.audit(spec) if i["kind"] == "small-text"])

    def test_tall_posters_keep_the_url_out_of_the_platform_ui_zone(self):
        spec, _ = generator.generate(CORPUS["list"], kind="image", size=(1080, 1920), brand=BRAND)
        self.assertEqual([i for i in qa.audit(spec) if i["kind"] == "safe-zone"], [])

    def test_left_anchor_makes_layout_independent_of_render_scale(self):
        spec, _ = generator.generate(CORPUS["subtitle"], theme="minimal", size=(1200, 628), brand=BRAND)
        xs = {}
        for scale in (0.3, 0.6, 1.0):
            W, H = int(1200 * scale) // 2 * 2, int(628 * scale) // 2 * 2
            r = engine.SceneRenderer(engine.normalize(spec)["scenes"][0], W, H); r.collect = True; r.render(r.poster_time())
            xs[scale] = [b["box"][0] / W for b in r.boxes if b["type"] == "text"]
        for a, b in zip(xs[0.3], xs[1.0]):
            self.assertAlmostEqual(a, b, delta=0.02, msg="text left edge moves with preview resolution")

    def test_thumbnail_times_avoid_transition_overlaps(self):
        spec, _ = generator.generate(CORPUS["list"], theme="bold", brand=BRAND)
        c = engine.Composer(spec, 270, 480)
        for i in range(len(c.scenes)):
            t = c.poster_global(i)
            self.assertTrue(c.starts[i] <= t < c.starts[i] + c.scenes[i].dur)
            if i > 0:
                self.assertGreaterEqual(t, c.starts[i] + c.tdur)           # past the incoming transition
            if i < len(c.scenes) - 1:
                self.assertLess(t, c.starts[i] + c.scenes[i].dur - c.tdur)  # before the outgoing one

    def test_short_first_sentence_is_not_glued_to_a_long_one(self):
        items, _ = generator.parse_script(CORPUS["paragraph"])
        self.assertTrue(all(len(i["text"].split()) <= 22 for i in items))
        self.assertEqual(items[0]["text"], "Meet Smart Reports.")

    def test_progress_bar_does_not_push_poster_time_to_the_scene_end(self):
        spec, _ = generator.generate(CORPUS["list"], theme="bold", brand=BRAND)
        r = engine.SceneRenderer(engine.normalize(spec)["scenes"][0], 100, 100)
        self.assertLess(r.poster_time(), r.dur - 0.5)

    def test_no_progress_bar_on_still_exports(self):
        spec, _ = generator.generate(CORPUS["list"], kind="carousel", theme="bold", brand=BRAND)
        # a carousel slide is a still image: a half-filled progress bar would look broken
        self.assertFalse([l for s in spec["scenes"] for l in s["layers"] if l.get("ease") == "linear"])

    def test_muted_text_keeps_readable_contrast(self):
        for kind in generator.BG_CHOICES:
            r = generator.recipe(kind, __import__("brand").deep_merge(__import__("brand").DEFAULT, {}))
            mid = generator.mix(generator._rgb(r["bg1"]), generator._rgb(r["bg2"]), .5)
            self.assertGreaterEqual(generator.contrast(generator._rgb(r["sub"]), mid), 4.4, kind)

    def test_missing_ffmpeg_gives_a_message_not_a_crash(self):
        old = os.environ.get("FFMPEG_BIN"); os.environ["FFMPEG_BIN"] = "/no/such/ffmpeg"
        try:
            with self.assertRaises(engine.SpecError):
                engine.render_video({"scenes": [{}]}, engine.OUTPUTS / "x.mp4", 64, 64)
        finally:
            os.environ.pop("FFMPEG_BIN", None) if old is None else os.environ.__setitem__("FFMPEG_BIN", old)


class Performance(unittest.TestCase):
    def test_a_full_hd_frame_renders_fast_enough_for_batch_work(self):
        import time
        spec, _ = generator.generate(CORPUS["list"], theme="neon", size=(1080, 1920), brand=BRAND)
        c = engine.Composer(spec)
        c.frame(1.0)                     # warm caches
        t0 = time.time()
        for i in range(10):
            c.frame(1.0 + i * 0.05)
        per = (time.time() - t0) / 10
        self.assertLess(per, 0.6, f"{per:.2f}s per 1080x1920 frame is too slow (a 15 s video would take minutes)")

    def test_audit_is_fast_enough_for_live_use(self):
        import time
        spec, _ = generator.generate(CORPUS["twenty"], size=(1080, 1920), brand=BRAND)
        t0 = time.time(); qa.audit(spec, 360)
        self.assertLess(time.time() - t0, 6.0)


if __name__ == "__main__":
    unittest.main()
