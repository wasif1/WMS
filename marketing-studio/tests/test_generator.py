import http.client, json, sys, tempfile, threading, time, unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import brand, bulk, engine, generator, studio


class Parse(unittest.TestCase):
    def test_single_sentence(self):
        items, _ = generator.parse_script("Summer sale: save 40% this week only.")
        self.assertEqual(len(items), 1)

    def test_paragraph_is_split_into_scenes(self):
        text = ("Meet Smart Reports. See what is working in one tap, share it with your team in seconds, "
                "and stop wasting hours in spreadsheets. Start your free trial today and see the difference.")
        items, _ = generator.parse_script(text)
        self.assertGreaterEqual(len(items), 2)
        self.assertTrue(all(len(i["text"].split()) <= 22 for i in items))

    def test_lines_directives_and_markers(self):
        items, meta = generator.parse_script(
            'Hook line\n1. First step [dur: 5]\n"Quote here" — Ana\nA | sub line [img: photo.jpg]\nCTA: Buy now\nURL: x.com')
        self.assertEqual([i["text"] for i in items], ["Hook line", "First step", "Quote here", "A"])
        self.assertEqual(items[1]["num"], 1); self.assertEqual(items[1]["dur"], 5.0)
        self.assertTrue(items[2]["quote"]); self.assertEqual(items[2]["author"], "Ana")
        self.assertEqual(items[3]["sub"], "sub line"); self.assertEqual(items[3]["img"], "photo.jpg")
        self.assertEqual((meta["cta"], meta["url"]), ("Buy now", "x.com"))

    def test_blank_lines_make_paragraph_scenes_and_empty_is_error(self):
        items, _ = generator.parse_script("One\ntwo\n\nThree")
        self.assertEqual(len(items), 2); self.assertEqual(items[0]["text"], "One\ntwo")
        with self.assertRaises(engine.SpecError):
            generator.parse_script("  \n ")

    def test_scene_cap(self):
        _, meta = generator.parse_script("\n".join(f"line {i}" for i in range(30)))
        self.assertTrue(meta["warnings"])

    def test_number_highlight(self):
        self.assertEqual(generator.highlight_numbers("Save 40% now"), "Save *40%* now")
        self.assertEqual(generator.highlight_numbers("Keep *this* only 5"), "Keep *this* only 5")


class Generate(unittest.TestCase):
    def test_every_theme_and_kind_renders_in_two_aspects(self):
        for theme in generator.THEMES:
            for kind in ("video", "image", "carousel"):
                for size in ((1080, 1920), (1920, 1080)):
                    spec, meta = generator.generate("Big *50%* sale\n1. Easy\n\"Loved it\" — Sam\nCTA: Go\nURL: a.com",
                                                    kind=kind, theme=theme, size=size)
                    c = engine.Composer(spec, size[0] // 8, size[1] // 8)
                    for r in c.scenes:
                        self.assertEqual(r.render(r.poster_time()).size, c.scenes[0].render(0).size)
                    self.assertEqual(meta["scenes"], 1 if kind == "image" else 4)

    def test_target_length_and_cta_off(self):
        s1, _ = generator.generate("a b c\nd e f\ng h i", target=10)
        c = engine.Composer(s1)
        self.assertAlmostEqual(c.total, 10, delta=3.5)
        s2, _ = generator.generate("hello world", cta="", url="")
        self.assertEqual(len(s2["scenes"]), 1)

    def test_unknown_theme_and_missing_asset(self):
        with self.assertRaises(engine.SpecError): generator.generate("x", theme="nope")
        with self.assertRaises(engine.SpecError): generator.generate("x [img: missing.png]")

    def test_contrast_is_readable_for_odd_brand_colours(self):
        for primary in ("#ffff00", "#000000", "#808080", "#ff00ff"):
            b = brand.deep_merge(brand.DEFAULT, {"colors": {"primary": primary}})
            for kind in generator.BG_CHOICES:
                r = generator.recipe(kind, b)
                mid = generator.mix(generator._rgb(r["bg1"]), generator._rgb(r["bg2"]), .5)
                self.assertGreaterEqual(generator.contrast(generator._rgb(r["text"]), mid), 4.0, (primary, kind))

    def test_text_fits_inside_width(self):
        f = generator.fit("A very long headline that should wrap across several lines nicely", "sans-bold", .8, 1080, 1920, .13, .045, 5)
        self.assertLessEqual(f["w"], .8 + 1e-3); self.assertLessEqual(f["lines"], 5)

    def test_my_theme_overrides(self):
        b = brand.deep_merge(brand.DEFAULT, {"theme": {"base": "minimal", "upper": True, "anim": "punchy"}})
        T = generator.resolve_theme(None, b)
        self.assertTrue(T["upper"]); self.assertEqual(T["anim"], "punchy")
        self.assertFalse(generator.resolve_theme("elegant", b)["upper"])  # explicit pick ignores overrides

    def test_rich_text_accent_color_is_drawn(self):
        spec = {"width": 400, "height": 200, "scenes": [{"duration": 1, "background": {"type": "color", "color": "#000"},
                "layers": [{"type": "text", "text": "a *b* c", "color": "#ffffff", "accent": "#ff0000", "size": .3}]}]}
        im = engine.Composer(spec).frame(0.5)
        px = set(im.getdata())
        self.assertTrue(any(p[0] > 200 and p[1] < 60 for p in px), "no accent pixels")
        self.assertTrue(any(p[0] > 200 and p[1] > 200 for p in px), "no base text pixels")


class Brand(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.orig = brand.BRANDS
        brand.BRANDS = Path(self.tmp.name)

    def tearDown(self):
        brand.BRANDS = self.orig
        self.tmp.cleanup()

    def test_save_load_active_and_validation(self):
        name = brand.save("Acme Co!", {"name": "Acme", "colors": {"primary": "#0af"}, "evil": "x"})
        self.assertEqual(name, "Acme-Co"); self.assertEqual(brand.active_name(), "Acme-Co")
        b = brand.load()
        self.assertEqual(b["colors"]["primary"], "#00aaff"); self.assertNotIn("evil", b)
        self.assertEqual(b["colors"]["secondary"], brand.DEFAULT["colors"]["secondary"])
        with self.assertRaises(engine.SpecError): brand.save("x", {"colors": {"primary": "red-ish"}})
        with self.assertRaises(engine.SpecError): brand.save("x", {"watermark": {"position": "middle"}})
        with self.assertRaises(engine.SpecError): brand.save("///", {})
        brand.delete("Acme-Co"); self.assertEqual(brand.list_brands(), [])

    def test_tokens_in_specs(self):
        brand.save("t", {"name": "T", "cta": "Go now", "colors": {"primary": "#112233"}})
        spec = {"scenes": [{"background": {"type": "color", "color": "$primary"},
                            "layers": [{"type": "text", "text": "{{brand.cta}} — $5", "color": "$light"}]}]}
        n = engine.normalize(spec)
        self.assertEqual(n["scenes"][0]["background"]["color"], "#112233")
        self.assertEqual(n["scenes"][0]["layers"][0]["text"], "Go now — $5")

    def test_brand_profile_path_is_confined(self):
        brand.save("../../evil", {"name": "x"})
        self.assertEqual(brand.list_brands(), ["evil"])
        self.assertFalse((Path(self.tmp.name).parent / "evil.json").exists())


class Bulk(unittest.TestCase):
    def test_csv_parsing(self):
        cols, rows = bulk.parse_csv(bulk.SAMPLE_CSV)
        self.assertEqual(len(rows), 3); self.assertIn("script", cols)
        self.assertEqual(rows[2]["script"], '"Best decision we made all year." - Priya, Founder')
        self.assertEqual(bulk.parse_csv("name;script\nx;hi, there")[1][0]["script"], "hi, there")
        for bad in ("", "name,script\n", "\n\n"):
            with self.assertRaises(engine.SpecError): bulk.parse_csv(bad)
        with self.assertRaises(engine.SpecError): bulk.parse_csv("a\n" + "\n".join(["x"] * 300))

    def test_template_fill_and_missing_column(self):
        tpl = {"name": "t", "scenes": [{"layers": [{"type": "text", "text": "{{headline}} {{price}}"}]}]}
        self.assertEqual(bulk.placeholders(tpl), {"headline", "price"})
        out = bulk.fill(tpl, {"headline": "Hi", "price": "$9"})
        self.assertEqual(out["scenes"][0]["layers"][0]["text"], "Hi $9")
        with self.assertRaises(engine.SpecError): bulk.fill(tpl, {"headline": "Hi"})

    def test_run_bulk_images_with_row_errors_continuing(self):
        rows = [{"name": "a", "script": "Hello *world*"}, {"name": "bad", "script": ""},
                {"name": "c", "script": "Another one", "theme": "elegant"}, {"name": "d", "script": "x", "theme": "nope"}]
        with tempfile.TemporaryDirectory() as d:
            files, errs, out = bulk.run_bulk(rows, "generate", ["300x250"], "png", kind="image", out_root=Path(d))
            self.assertEqual(len(files), 2); self.assertEqual(len(errs), 2)
            self.assertTrue(all(out in f.parents for f in files))
            self.assertIn("Row 3", errs[0])


class Api(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.orig = brand.BRANDS
        brand.BRANDS = Path(cls.tmp.name)
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), studio.Handler)
        cls.port = cls.srv.server_port
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown(); brand.BRANDS = cls.orig; cls.tmp.cleanup()

    def req(self, method, path, body=None, raw=False):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=60)
        c.request(method, path, json.dumps(body) if body is not None else None, {"Host": f"127.0.0.1:{self.port}"})
        r = c.getresponse(); data = r.read()
        return r.status, (data if raw else json.loads(data or b"{}"))

    def test_pages(self):
        self.assertEqual(self.req("GET", "/", raw=True)[0], 200)
        self.assertEqual(self.req("GET", "/editor", raw=True)[0], 200)
        s, b = self.req("GET", "/api/themes"); self.assertEqual(len(b["themes"]), 6)
        self.assertEqual(self.req("GET", "/api/sample.csv", raw=True)[0], 200)

    def test_generate_and_errors(self):
        s, b = self.req("POST", "/api/generate", {"text": "Hello *world*\nSecond", "size": "square", "theme": "neon"})
        self.assertEqual(s, 200); self.assertEqual(len(b["timeline"]["scenes"]), 3)
        self.assertEqual(self.req("POST", "/api/generate", {"text": ""})[0], 400)
        self.assertEqual(self.req("POST", "/api/generate", {"text": "x", "theme": "zzz"})[0], 400)
        self.assertEqual(self.req("POST", "/api/generate", {"text": "x", "size": "huge"})[0], 400)

    def test_brand_crud_and_unsaved_override_preview(self):
        s, b = self.req("PUT", "/api/brands/My-Brand", {"name": "My Brand", "colors": {"primary": "#0a7"}})
        self.assertEqual((s, b["saved"]), (200, "My-Brand"))
        self.assertEqual(self.req("POST", "/api/brands/active", {"name": "My-Brand"})[0], 200)
        self.assertEqual(self.req("GET", "/api/brands")[1]["active"], "My-Brand")
        s, b = self.req("POST", "/api/generate", {"text": "Hi", "brand": {"colors": {"primary": "#ff0000"}}, "size": "square"})
        self.assertEqual(s, 200)
        self.assertEqual(self.req("PUT", "/api/brands/x", {"colors": {"primary": "nope"}})[0], 400)
        self.assertEqual(self.req("DELETE", "/api/brands/My-Brand")[0], 200)
        self.assertEqual(self.req("POST", "/api/brands/active", {"name": "ghost"})[0], 400)

    def test_font_upload_rejects_non_fonts(self):
        c = http.client.HTTPConnection("127.0.0.1", self.port)
        c.request("PUT", "/api/fonts/fake.ttf", b"not a font", {"Host": f"127.0.0.1:{self.port}"})
        self.assertEqual(c.getresponse().status, 400)

    def test_bulk_job_with_zip(self):
        csv_text = "name,script\none,Hello\ntwo,World\n"
        self.assertEqual(self.req("POST", "/api/bulk/preview", {"csv": csv_text})[1]["count"], 2)
        s, b = self.req("POST", "/api/bulk", {"csv": csv_text, "mode": "generate", "targets": ["300x250"], "format": "png", "kind": "image"})
        self.assertEqual(s, 202)
        for _ in range(200):
            j = self.req("GET", f"/api/jobs/{b['id']}")[1]
            if j["status"] in ("done", "error"): break
            time.sleep(0.1)
        self.assertEqual(j["status"], "done", j); self.assertEqual(len(j["outputs"]), 2); self.assertTrue(j["zip"])
        s, z = self.req("GET", j["zip"], raw=True); self.assertEqual((s, z[:2]), (200, b"PK"))
        for o in j["outputs"]:
            f = engine.OUTPUTS / o["url"][len("/outputs/"):]; self.assertTrue(f.exists())
        import shutil; shutil.rmtree((engine.OUTPUTS / j["outputs"][0]["url"][len("/outputs/"):]).parent)
        self.assertEqual(self.req("POST", "/api/bulk", {"csv": csv_text, "targets": []})[0], 400)
        self.assertEqual(self.req("POST", "/api/bulk", {"csv": csv_text, "mode": "template", "template": "../x", "targets": ["square"]})[0], 400)

    def test_library_list_zip_delete_and_confinement(self):
        import zipfile, io
        d = engine.OUTPUTS / "bulk_libtest"; d.mkdir(parents=True, exist_ok=True)
        (d / "a.png").write_bytes(b"x" * 10); (d / "b.mp4").write_bytes(b"y" * 20)
        try:
            items = self.req("GET", "/api/library")[1]["items"]
            mine = [i for i in items if i["folder"] == "bulk_libtest"]
            self.assertEqual(sorted(i["kind"] for i in mine), ["image", "video"])
            s, r = self.req("POST", "/api/library/zip", {"files": [i["file"] for i in mine]})
            self.assertEqual((s, r["count"]), (200, 2))
            s, z = self.req("GET", r["url"], raw=True)
            self.assertEqual(sorted(zipfile.ZipFile(io.BytesIO(z)).namelist()), ["bulk_libtest/a.png", "bulk_libtest/b.mp4"])
            s, r = self.req("POST", "/api/library/zip", {"all": True}); self.assertEqual(s, 200)
            # traversal / non-media / unknown tokens are rejected
            self.assertEqual(self.req("POST", "/api/library/zip", {"files": ["../studio.py"]})[0], 400)
            self.assertEqual(self.req("POST", "/api/library/zip", {"files": []})[0], 400)
            self.assertEqual(self.req("POST", "/api/library/delete", {"files": ["../studio.py"]})[0], 400)
            self.assertTrue((engine.ROOT / "studio.py").exists())
            self.assertEqual(self.req("GET", "/api/library/download/" + "0" * 32, raw=True)[0], 404)
            self.assertEqual(self.req("POST", "/api/library/delete", {"files": ["bulk_libtest/a.png", "bulk_libtest/b.mp4"]})[1]["deleted"], 2)
            self.assertFalse(d.exists())  # emptied bulk folder removed
        finally:
            import shutil; shutil.rmtree(d, ignore_errors=True)

    def test_render_quality_validation(self):
        spec = self.req("POST", "/api/generate", {"text": "Hi", "size": "square"})[1]["spec"]
        self.assertEqual(self.req("POST", "/api/render", {"spec": spec, "targets": ["square"], "format": "mp4", "quality": "insane"})[0], 400)


if __name__ == "__main__":
    unittest.main()
