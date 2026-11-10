"""Unit tests: every animation, motion, effect, background and text feature, measured on real pixels."""
import os, sys, unittest
sys.path.insert(0, os.path.dirname(__file__))
from _util import *  # noqa
import engine

START, AD = 1.0, 1.0   # entrance window used by the animation tests


class EntranceAnimations(unittest.TestCase):
    def layer(self, anim, **kw):
        return rect(**{"in": anim, "start": START, "anim_dur": AD, **kw})

    def test_every_entrance_hidden_before_start_and_exact_after(self):
        ref = frame([rect()], 3.5)
        for anim in engine.ANIMS_IN:
            with self.subTest(anim=anim):
                before = frame([self.layer(anim)], START - 0.4)
                self.assertIsNone(ink(before), "layer visible before its start time")
                after = frame([self.layer(anim)], START + AD + 0.2)
                self.assertTrue(same(after, ref), "animation does not settle on the final pose")

    def test_every_entrance_is_in_motion_midway(self):
        ref = frame([rect()], 3.5)
        for anim in engine.ANIMS_IN:
            if anim == "none":
                continue
            with self.subTest(anim=anim):
                mid = frame([self.layer(anim)], START + AD * 0.4)
                self.assertFalse(same(mid, ref), "no visible change midway through the entrance")

    def test_fade_is_monotonic(self):
        vals = [lum(frame([self.layer("fade")], START + AD * p)) for p in (0.1, 0.3, 0.5, 0.7, 0.95)]
        self.assertEqual(vals, sorted(vals)); self.assertGreater(vals[-1], vals[0] * 2)

    def test_slide_directions(self):
        fin = centre(ink(frame([rect()], 3.5)))
        def pos(anim, p): return centre(ink(frame([self.layer(anim)], START + AD * p), thresh=5))
        up = [pos("slide-up", p)[1] for p in (0.3, 0.6, 0.9)]
        self.assertTrue(up[0] > up[1] > up[2] >= fin[1] - 1, f"slide-up should rise to the final spot: {up}")
        down = [pos("slide-down", p)[1] for p in (0.3, 0.6, 0.9)]
        self.assertTrue(down[0] < down[1] < down[2] <= fin[1] + 1, down)
        left = [pos("slide-left", p)[0] for p in (0.3, 0.6, 0.9)]
        self.assertTrue(left[0] > left[1] > left[2] >= fin[0] - 1, left)
        right = [pos("slide-right", p)[0] for p in (0.3, 0.6, 0.9)]
        self.assertTrue(right[0] < right[1] < right[2] <= fin[0] + 1, right)

    def test_zoom_and_pop_scale(self):
        fin = size(ink(frame([rect()], 3.5)))
        z = [size(ink(frame([self.layer("zoom")], START + AD * p), thresh=5))[0] for p in (0.3, 0.6, 0.9)]
        self.assertTrue(z[0] < z[1] < z[2] <= fin[0] + 1, z)
        pops = [size(ink(frame([self.layer("pop")], START + AD * p / 20), thresh=5))[0] for p in range(1, 21)]
        self.assertGreater(max(pops), fin[0] * 1.02, "pop should overshoot the final size")
        self.assertLessEqual(abs(pops[-1] - fin[0]), 2)

    def test_wipe_reveals_left_to_right_with_fixed_left_edge(self):
        fin = ink(frame([rect()], 3.5))
        widths, lefts = [], []
        for p in (0.2, 0.4, 0.6, 0.8):
            bb = ink(frame([self.layer("wipe", ease="linear")], START + AD * p))
            widths.append(bb[2] - bb[0]); lefts.append(bb[0])
        self.assertTrue(all(a < b for a, b in zip(widths, widths[1:])), widths)
        self.assertTrue(all(abs(l - fin[0]) <= 1 for l in lefts), lefts)

    def test_linear_wipe_is_proportional(self):
        full = size(ink(frame([rect()], 3.5)))[0]
        for p in (0.25, 0.5, 0.75):
            got = size(ink(frame([self.layer("wipe", ease="linear")], START + AD * p)))[0] / full
            self.assertAlmostEqual(got, p, delta=0.04)

    def test_default_ease_is_ease_out(self):
        full = size(ink(frame([rect()], 3.5)))[0]
        got = size(ink(frame([self.layer("wipe")], START + AD * 0.25)))[0] / full
        self.assertGreater(got, 0.25 + 0.2)  # ease-out is front-loaded


class ExitAnimations(unittest.TestCase):
    def layer(self, anim):
        return rect(**{"out": anim, "end": 3.0, "anim_dur": 1.0})

    def test_exit_settles_hidden_and_does_not_start_early(self):
        ref = frame([rect()], 1.0)
        for anim in ("fade", "zoom", "slide-down"):
            with self.subTest(anim=anim):
                self.assertTrue(same(frame([self.layer(anim)], 1.0), ref))
                self.assertFalse(same(frame([self.layer(anim)], 2.6), ref))
                gone = frame([self.layer(anim)], 3.0)
                self.assertTrue(ink(gone) is None or lum(gone) < 3, "layer still visible at its end time")
                self.assertIsNone(ink(frame([self.layer(anim)], 3.2)))

    def test_exit_directions(self):
        fin = centre(ink(frame([rect()], 1.0)))
        self.assertGreater(centre(ink(frame([self.layer("slide-down")], 2.7), thresh=5))[1], fin[1])
        self.assertLess(size(ink(frame([self.layer("zoom")], 2.7), thresh=5))[0], size(ink(frame([rect()], 1.0)))[0])

    def test_start_and_end_window(self):
        for t, visible in ((0.5, False), (1.5, True), (2.9, True), (3.5, False)):
            bb = ink(frame([rect(start=1.0, end=3.0)], t))
            self.assertEqual(bb is not None, visible, t)

    def test_enter_and_exit_combine(self):
        l = rect(**{"in": "fade", "out": "fade", "start": 0.0, "end": 4.0, "anim_dur": 1.0})
        a, b, c = lum(frame([l], 0.4)), lum(frame([l], 2.0)), lum(frame([l], 3.6))
        self.assertTrue(a < b and c < b)


class MotionAndTransforms(unittest.TestCase):
    def test_drift_moves_linearly_over_the_scene(self):
        l = rect(motion={"dx": 0.2, "dy": -0.1})
        c0 = centre(ink(frame([l], 0.0)))
        c1 = centre(ink(frame([l], 2.0)))     # half-way through a 4 s scene
        self.assertAlmostEqual(c1[0] - c0[0], 0.1 * W, delta=2)
        self.assertAlmostEqual(c1[1] - c0[1], -0.05 * H, delta=2)

    def test_push_in_scales(self):
        l = rect(motion={"scale": 0.5})
        w0 = size(ink(frame([l], 0.0)))[0]; w2 = size(ink(frame([l], 2.0)))[0]
        self.assertAlmostEqual(w2 / w0, 1.25, delta=0.03)

    def test_opacity(self):
        px = frame([rect(opacity=0.5)], 1.0).getpixel((100, 100))
        self.assertTrue(all(abs(v - 128) <= 4 for v in px), px)

    def test_rotate_swaps_extents(self):
        wide = rect(w=0.5, h=0.2)
        a = size(ink(frame([wide], 1.0))); b = size(ink(frame([dict(wide, rotate=90)], 1.0)))
        self.assertTrue(a[0] > a[1] * 2 and b[1] > b[0] * 2, (a, b))

    def test_position_fractions(self):
        c = centre(ink(frame([rect(x=0.25, y=0.75)], 1.0)))
        self.assertAlmostEqual(c[0], 0.25 * W, delta=1.5); self.assertAlmostEqual(c[1], 0.75 * H, delta=1.5)

    def test_layers_stack_in_order(self):
        top = frame([rect(color="#ff0000"), rect(color="#0000ff", w=0.2, h=0.2)], 1.0)
        self.assertEqual(top.getpixel((100, 100)), (0, 0, 255)); self.assertEqual(top.getpixel((70, 100)), (255, 0, 0))


class ShapeEffects(unittest.TestCase):
    def test_circle_and_rounded_corners(self):
        sq = frame([rect()], 1.0); circ = frame([rect(shape="circle", w=0.4)], 1.0)
        rnd = frame([rect(shape="rounded", radius=1)], 1.0)
        corner = (62, 62)   # just inside the square's corner
        self.assertEqual(sq.getpixel(corner), (255, 255, 255))
        self.assertEqual(circ.getpixel(corner), BLACK); self.assertEqual(rnd.getpixel(corner), BLACK)
        self.assertEqual(circ.getpixel((100, 100)), (255, 255, 255))

    def test_shapes_are_antialiased(self):
        circ = frame([rect(shape="circle", w=0.5)], 1.0)
        mids = [p for p in circ.getdata() if 30 < p[0] < 225]
        self.assertGreater(len(mids), 20, "circle edge is jagged (no anti-aliasing)")

    def test_blur_makes_a_soft_glow(self):
        sharp = frame([rect(shape="circle", w=0.4)], 1.0); glow = frame([rect(shape="circle", w=0.4, blur=0.05)], 1.0)
        self.assertGreater(size(ink(glow, thresh=6))[0], size(ink(sharp, thresh=6))[0])
        self.assertGreater(len([p for p in glow.getdata() if 20 < p[0] < 235]), len([p for p in sharp.getdata() if 20 < p[0] < 235]) * 3)

    def test_shadow_darkens_below_the_shape(self):
        grey = {"type": "color", "color": "#808080"}
        kw = dict(bg=grey, w=800, h=800)   # shadows scale with the canvas; judge them at a real-ish size
        no = frame([rect(w=0.3, h=0.3)], 1.0, **kw); sh = frame([rect(w=0.3, h=0.3, shadow=True)], 1.0, **kw)
        below = (400, 400 + int(0.15 * 800) + 6)
        self.assertLess(sh.getpixel(below)[0], no.getpixel(below)[0] - 15)

    def test_stroke_outline(self):
        im = frame([rect(color="#ff0000", stroke={"width": 0.03, "color": "#00ff00"})], 1.0)
        self.assertEqual(im.getpixel((100, 100)), (255, 0, 0))
        self.assertGreater(im.getpixel((61, 100))[1], 150)  # green rim at the left edge

    def test_colour_formats(self):
        for c, want in (("#f00", (255, 0, 0)), ("#00ff00", (0, 255, 0)), ("#0000ffff", (0, 0, 255))):
            self.assertEqual(frame([rect(color=c)], 1.0).getpixel((100, 100)), want)
        px = frame([rect(color="#ffffff80")], 1.0).getpixel((100, 100))
        self.assertTrue(all(abs(v - 128) <= 3 for v in px), px)


class TextEffects(unittest.TestCase):
    def t(self, **kw):
        d = {"type": "text", "text": "Hello world", "x": 0.5, "y": 0.5, "size": 0.12, "color": "#ffffff", "font": "sans-bold"}
        d.update(kw)
        return d

    def test_alignment_and_anchor(self):
        two = "Hi\nA longer second line"
        kw = dict(text=two, size=0.09, w=0.9)
        L = frame([self.t(align="left", **kw)], 1.0, w=400, h=300); R = frame([self.t(align="right", **kw)], 1.0, w=400, h=300)
        self.assertEqual(size(ink(L)), size(ink(R)))
        top_l, top_r = ink(L.crop((0, 0, 400, 147))), ink(R.crop((0, 0, 400, 147)))   # the short first line only
        self.assertLess(top_l[0], top_r[0] - 60, "short first line should sit left when left-aligned, right when right-aligned")
        a = ink(frame([self.t(x=0.1, anchor="left", align="left")], 1.0, w=400, h=200))
        self.assertAlmostEqual(a[0], 40, delta=3)           # ink starts exactly at x
        b = ink(frame([self.t(x=0.9, anchor="right", align="right")], 1.0, w=400, h=200))
        self.assertAlmostEqual(b[2], 360, delta=3)

    def test_size_scales_ink(self):
        small = size(ink(frame([self.t(size=0.05, w=1.0)], 1.0, w=800, h=800)))[1]; big = size(ink(frame([self.t(size=0.10, w=1.0)], 1.0, w=800, h=800)))[1]
        self.assertAlmostEqual(big / small, 2.0, delta=0.2)

    def test_wrapping_line_height_and_newlines(self):
        txt = "one two three four five six seven eight"
        wide = size(ink(frame([self.t(text=txt, w=0.95)], 1.0, w=400, h=400)))
        narrow = size(ink(frame([self.t(text=txt, w=0.3)], 1.0, w=400, h=400)))
        self.assertGreater(narrow[1], wide[1] * 1.8); self.assertLessEqual(narrow[0], 0.3 * 400 + 2)
        tight = size(ink(frame([self.t(text="a\nb\nc", line_height=1.0)], 1.0, w=400, h=400)))[1]
        loose = size(ink(frame([self.t(text="a\nb\nc", line_height=1.8)], 1.0, w=400, h=400)))[1]
        self.assertGreater(loose, tight * 1.3)

    def test_upper_option(self):
        self.assertTrue(same(frame([self.t(text="abc", upper=True)], 1.0), frame([self.t(text="ABC")], 1.0)))

    def test_long_unbroken_word_is_wrapped_inside_the_frame(self):
        bb = ink(frame([self.t(text="Supercalifragilisticexpialidocious" * 2, size=0.14, w=0.9)], 1.0, w=300, h=300))
        self.assertGreaterEqual(bb[0], 0); self.assertLessEqual(bb[2], 300)
        self.assertLessEqual(bb[2] - bb[0], 0.9 * 300 + 3)

    def test_empty_and_blank_text_do_not_crash(self):
        for txt in ("", "   ", "\n\n"):
            self.assertIsNone(ink(frame([self.t(text=txt)], 1.0)))

    def test_highlight_markup(self):
        im = frame([self.t(text="aa *bb* cc", accent="#ff0000", size=0.2)], 1.0, w=400, h=200)
        reds = [(i % 400) for i, p in enumerate(im.getdata()) if p[0] > 200 and p[1] < 60]
        whites = [(i % 400) for i, p in enumerate(im.getdata()) if p[0] > 200 and p[1] > 200]
        self.assertTrue(reds and whites)
        self.assertTrue(min(whites) < min(reds) < max(reds) < max(whites), "highlighted word should sit between the others")

    def test_unbalanced_markup_is_tolerated(self):
        self.assertIsNotNone(ink(frame([self.t(text="a *b c", accent="#ff0000")], 1.0)))

    def test_box_stroke_and_shadow(self):
        boxed = frame([self.t(box={"color": "#ff0000", "opacity": 1, "pad": 0.05})], 1.0, w=400, h=200)
        bb = ink(boxed, thresh=60)
        self.assertEqual(boxed.getpixel((bb[0] + 3, 100))[0] > 150, True, "box colour missing behind text")
        plain = size(ink(frame([self.t()], 1.0, w=400, h=200)))
        self.assertGreater(size(bb)[0], plain[0] + 10)
        base = size(ink(frame([self.t()], 1.0, w=400, h=200)))
        stroked = size(ink(frame([self.t(stroke={"width": 0.01, "color": "#00ff00"})], 1.0, w=400, h=200)))
        self.assertGreater(stroked[0], base[0])
        grey = {"type": "color", "color": "#808080"}
        sh = frame([self.t(shadow=True, color="#ffffff")], 1.0, bg=grey, w=400, h=200)
        self.assertLess(min(p[0] for p in sh.getdata()), 110, "no dark shadow pixels on a grey background")

    def test_font_choices_render_differently_and_unknown_font_falls_back(self):
        a = frame([self.t(font="sans-bold")], 1.0); b = frame([self.t(font="serif-bold")], 1.0)
        self.assertFalse(same(a, b))
        self.assertIsNotNone(ink(frame([self.t(font="does-not-exist.ttf")], 1.0)))


class Backgrounds(unittest.TestCase):
    def grad(self, **kw):
        return {"type": "gradient", "colors": ["#000000", "#ffffff"], **kw}

    def test_gradient_angles(self):
        r = frame([], 1.0, bg=self.grad(angle=90)); self.assertLess(r.getpixel((5, 100))[0], r.getpixel((195, 100))[0] - 150)
        d = frame([], 1.0, bg=self.grad(angle=180)); self.assertLess(d.getpixel((100, 5))[0], d.getpixel((100, 195))[0] - 150)
        u = frame([], 1.0, bg=self.grad(angle=0)); self.assertGreater(u.getpixel((100, 5))[0], u.getpixel((100, 195))[0] + 150)

    def test_three_stop_gradient_hits_middle_colour(self):
        g = frame([], 1.0, bg={"type": "gradient", "colors": ["#000000", "#ff0000", "#000000"], "angle": 180})
        self.assertGreater(g.getpixel((100, 100))[0], 220); self.assertLess(g.getpixel((100, 3))[0], 30)

    def test_gradient_drift_animates(self):
        bg = self.grad(angle=90, drift=90)
        self.assertFalse(same(frame([], 0.1, bg=bg), frame([], 3.5, bg=bg)))
        self.assertTrue(same(frame([], 0.1, bg=self.grad(angle=90)), frame([], 3.5, bg=self.grad(angle=90))))

    def test_vignette_darkens_corners_not_centre(self):
        flat = {"type": "color", "color": "#808080"}
        v = frame([], 1.0, bg=dict(flat, vignette=0.8)); n = frame([], 1.0, bg=flat)
        self.assertLess(v.getpixel((2, 2))[0], n.getpixel((2, 2))[0] - 25)
        self.assertAlmostEqual(v.getpixel((100, 100))[0], n.getpixel((100, 100))[0], delta=3)

    def test_solid_colour_exact(self):
        self.assertEqual(frame([], 1.0, bg={"type": "color", "color": "#336699"}).getpixel((10, 10)), (0x33, 0x66, 0x99))


class ImageAssets(unittest.TestCase):
    NAME = "ms_test_noise.png"

    @classmethod
    def setUpClass(cls):
        import random
        random.seed(1)
        im = Image.new("RGB", (400, 300))
        px = im.load()
        for y in range(300):
            for x in range(400):
                px[x, y] = (x * 255 // 400, y * 255 // 300, (x * y) % 255)
        engine.ASSETS.mkdir(exist_ok=True); im.save(engine.ASSETS / cls.NAME)

    @classmethod
    def tearDownClass(cls):
        (engine.ASSETS / cls.NAME).unlink(missing_ok=True)

    def bg(self, **kw):
        return {"type": "image", "asset": self.NAME, **kw}

    def test_cover_fit_fills_every_aspect(self):
        for w, h in ((200, 400), (400, 200), (200, 200)):
            im = frame([], 1.0, bg=self.bg(), w=w, h=h)
            self.assertEqual(im.size, (w, h)); self.assertIsNone(None if ink(im, BLACK, 5) else 1)

    def test_kenburns_zooms_over_time_and_dim_darkens(self):
        bg = self.bg(kenburns=0.3)
        a, b = frame([], 0.0, bg=bg), frame([], 3.9, bg=bg)
        self.assertGreater(mad(a, b), 4)
        self.assertLess(lum(frame([], 1.0, bg=self.bg(dim=0.6))), lum(frame([], 1.0, bg=self.bg())) * 0.5)

    def test_focus_moves_the_crop(self):
        a = frame([], 1.0, bg=self.bg(kenburns=0.4, focus_x=0.0), w=200, h=200); b = frame([], 1.0, bg=self.bg(kenburns=0.4, focus_x=1.0), w=200, h=200)
        self.assertFalse(same(a, b))

    def test_image_layer_radius_width_and_crop_fill(self):
        l = {"type": "image", "asset": self.NAME, "x": 0.5, "y": 0.5, "w": 0.5}
        base = frame([l], 1.0)
        self.assertAlmostEqual(size(ink(base))[0], 100, delta=2)
        self.assertEqual(frame([dict(l, radius=0.5)], 1.0).getpixel((52, 62)), BLACK)   # rounded corner clipped
        filled = size(ink(frame([dict(l, w=0.5, h=0.25)], 1.0)))
        self.assertAlmostEqual(filled[1], 50, delta=2)

    def test_missing_or_blank_asset(self):
        with self.assertRaises(engine.SpecError):
            frame([{"type": "image", "asset": "nope.png"}], 1.0)
        self.assertIsNone(ink(frame([{"type": "image", "asset": ""}], 1.0)))      # "$logo" with no logo set


if __name__ == "__main__":
    unittest.main()
