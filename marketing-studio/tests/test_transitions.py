"""Unit tests: scene timeline and every transition, measured with solid-colour scenes."""
import math, os, sys, unittest
sys.path.insert(0, os.path.dirname(__file__))
from _util import *  # noqa
import engine

RED, BLUE, GREEN = "#ff0000", "#0000ff", "#00ff00"


def scenes(colors, dur=3.0, ttype="fade", tdur=1.0, w=200, h=100, layers=None):
    return {"name": "t", "width": w, "height": h, "fps": 10, "transition": {"type": ttype, "duration": tdur},
            "scenes": [{"duration": dur if not isinstance(dur, list) else dur[i], "background": {"type": "color", "color": c},
                        "layers": (layers or {}).get(i, [])} for i, c in enumerate(colors)]}


class Timeline(unittest.TestCase):
    def test_total_duration_math(self):
        for n in (1, 2, 3, 5):
            for tdur in (0.4, 1.0):
                c = engine.Composer(scenes([RED] * n, dur=3.0, tdur=tdur))
                self.assertAlmostEqual(c.total, 3.0 * n - (n - 1) * tdur if n > 1 else 3.0, places=6)
                self.assertEqual(len(c.starts), n)
                self.assertTrue(all(abs(c.starts[i + 1] - c.starts[i] - (3.0 - tdur)) < 1e-9 for i in range(n - 1)))

    def test_none_is_a_hard_cut_with_no_overlap(self):
        c = engine.Composer(scenes([RED, BLUE], ttype="none"))
        self.assertAlmostEqual(c.total, 6.0)
        self.assertEqual(c.frame(2.99).getpixel((5, 5)), (255, 0, 0)); self.assertEqual(c.frame(3.01).getpixel((5, 5)), (0, 0, 255))

    def test_transition_is_capped_to_80_percent_of_shortest_scene(self):
        n = engine.normalize(scenes([RED, BLUE], dur=[1.0, 5.0], tdur=3.0))
        self.assertAlmostEqual(n["transition"]["duration"], 0.8)

    def test_single_scene_ignores_transition(self):
        c = engine.Composer(scenes([RED], ttype="slide-left", tdur=1.0))
        self.assertAlmostEqual(c.total, 3.0); self.assertEqual(c.frame(2.9).getpixel((5, 5)), (255, 0, 0))

    def test_time_outside_range_is_clamped(self):
        c = engine.Composer(scenes([RED, BLUE]))
        self.assertEqual(c.frame(-5).getpixel((5, 5)), (255, 0, 0)); self.assertEqual(c.frame(999).getpixel((5, 5)), (0, 0, 255))

    def test_every_frame_of_a_long_timeline_renders(self):
        c = engine.Composer(scenes([RED, GREEN, BLUE], dur=1.0, tdur=0.4, w=64, h=64))
        for i in range(int(c.total * 30) + 3):
            self.assertEqual(c.frame(i / 30).size, (64, 64))


class Fade(unittest.TestCase):
    def setUp(self):
        self.c = engine.Composer(scenes([RED, BLUE], ttype="fade"))      # overlap = 2.0 .. 3.0

    def test_endpoints_are_pure_scenes(self):
        self.assertEqual(self.c.frame(1.99).getpixel((50, 50)), (255, 0, 0))
        self.assertEqual(self.c.frame(2.0).getpixel((50, 50)), (255, 0, 0))
        self.assertEqual(self.c.frame(3.2).getpixel((50, 50)), (0, 0, 255))

    def test_midpoint_is_an_even_blend(self):
        r, g, b = self.c.frame(2.5).getpixel((50, 50))
        self.assertAlmostEqual(r, 127, delta=3); self.assertEqual(g, 0); self.assertAlmostEqual(b, 128, delta=3)

    def test_blend_is_smooth_and_monotonic(self):
        blues = [self.c.frame(2.0 + i / 10).getpixel((50, 50))[2] for i in range(0, 11)]
        self.assertEqual(blues, sorted(blues)); self.assertEqual(blues[0], 0); self.assertEqual(blues[-1], 255)
        steps = [b - a for a, b in zip(blues, blues[1:])]
        self.assertLess(max(steps), 80, "fade jumps too abruptly")
        self.assertGreater(steps[0], -1)

    def test_it_is_eased_not_linear(self):
        quarter = self.c.frame(2.25).getpixel((50, 50))[2]
        self.assertLess(quarter, 255 * 0.25 - 5)   # smoothstep starts slower than linear


class Slides(unittest.TestCase):
    def boundary(self, im, axis):
        px = [im.getpixel((i, 50) if axis == "x" else (100, i))[2] for i in range(im.width if axis == "x" else im.height)]
        return next((i for i, v in enumerate(px) if v > 128), len(px))

    def test_slide_left_pushes_scene_a_out(self):
        c = engine.Composer(scenes([RED, BLUE], ttype="slide-left"))
        self.assertEqual(c.frame(2.0).getpixel((100, 50)), (255, 0, 0))
        mid = c.frame(2.5)
        self.assertEqual(mid.getpixel((10, 50)), (255, 0, 0)); self.assertEqual(mid.getpixel((190, 50)), (0, 0, 255))
        self.assertAlmostEqual(self.boundary(mid, "x"), 100, delta=2)            # eased midpoint = half way
        edges = [self.boundary(c.frame(2.0 + i / 10), "x") for i in range(1, 10)]
        self.assertEqual(edges, sorted(edges, reverse=True), "blue edge should move left")
        self.assertEqual(c.frame(3.2).getpixel((10, 50)), (0, 0, 255))

    def test_slide_up(self):
        c = engine.Composer(scenes([RED, BLUE], ttype="slide-up"))
        mid = c.frame(2.5)
        self.assertEqual(mid.getpixel((100, 5)), (255, 0, 0)); self.assertEqual(mid.getpixel((100, 95)), (0, 0, 255))
        self.assertAlmostEqual(self.boundary(mid, "y"), 50, delta=2)
        edges = [self.boundary(c.frame(2.0 + i / 10), "y") for i in range(1, 10)]
        self.assertEqual(edges, sorted(edges, reverse=True))

    def test_no_black_gap_during_slides(self):
        for kind in ("slide-left", "slide-up"):
            c = engine.Composer(scenes([RED, BLUE], ttype=kind))
            for i in range(0, 11):
                im = c.frame(2.0 + i / 10)
                dark = [p for p in im.getdata() if p == (0, 0, 0)]
                self.assertFalse(dark, f"{kind}: black pixels visible at {i / 10}")


class LayersDuringTransitions(unittest.TestCase):
    def test_incoming_scene_layers_animate_during_the_overlap(self):
        pop = {"type": "shape", "shape": "rect", "w": 0.5, "h": 0.5, "color": "#ffffff", "in": "fade", "start": 0.0, "anim_dur": 1.0}
        c = engine.Composer(scenes([RED, BLUE], ttype="none", dur=2.0, layers={1: [pop]}))
        a, b = c.frame(2.1).getpixel((100, 50)), c.frame(2.9).getpixel((100, 50))
        self.assertTrue(b[0] > a[0] + 50, "incoming scene's layer should fade in from its own start")

    def test_outgoing_layers_keep_playing(self):
        moving = {"type": "shape", "shape": "rect", "w": 0.2, "h": 0.6, "x": 0.2, "color": "#ffffff", "motion": {"dx": 0.5}}
        c = engine.Composer(scenes([RED, BLUE], ttype="fade", layers={0: [moving]}))
        xs = []
        for t in (0.5, 1.5, 2.2):
            bb = ink(c.frame(t), bg=(255, 0, 0), thresh=60)
            xs.append(None if bb is None else (bb[0] + bb[2]) / 2)
        self.assertTrue(xs[0] < xs[1] < xs[2])


class ExportFrameCounts(unittest.TestCase):
    def test_frame_count_matches_duration_times_fps(self):
        for fps in (24, 30, 60):
            c = engine.Composer(scenes([RED, BLUE], tdur=0.5))
            self.assertEqual(math.ceil(c.total * fps), int(5.5 * fps))


if __name__ == "__main__":
    unittest.main()
