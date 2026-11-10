"""Structural snapshot of what the generator produces for canonical scripts (font-independent facts only)."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import generator

SCRIPTS = {
    "one_sentence": "Summer sale: save *40%* on every plan this week only.",
    "paragraph": "Meet Smart Reports. See what is working in one tap, share it with your team in seconds, and stop wasting hours in spreadsheets. Start your free trial today and see the difference.",
    "script": "Tired of boring posts?\nMake scroll-stopping videos in *2 minutes*.\n1. Paste your script\n2. Pick your brand theme\n3. Export in HD\nCTA: Try it free\nURL: yourbrand.com",
    "quote": "\"Best decision we made all year.\" — Priya, Founder",
    "subtitle": "Grand opening | Join us Saturday at 6pm\nCome celebrate",
}
BRAND = {"name": "Snap", "tagline": "Made simple", "logo": "", "cta": "Shop now", "url": "snap.example.com",
         "colors": {"primary": "#ff6a1a", "secondary": "#6d28d9", "accent": "#fbbf24", "dark": "#0f172a", "light": "#f8fafc"},
         "fonts": {"heading": "auto", "body": "auto"}, "watermark": {"position": "none", "size": 0.16}, "theme": {"base": "bold"}}


def snapshot():
    out = {}
    for sname, text in SCRIPTS.items():
        for theme in generator.THEMES:
            for kind in ("video", "image"):
                spec, meta = generator.generate(text, theme=theme, kind=kind, size=(1080, 1920), brand=BRAND)
                out[f"{sname}|{theme}|{kind}"] = {
                    "roles": meta["role_list"], "transition": [spec["transition"]["type"], spec["transition"]["duration"]],
                    "durations": [round(s["duration"], 1) for s in spec["scenes"]],
                    "layers": [[l["type"] + (":" + l.get("in", "-") if l["type"] == "text" else "") for l in s["layers"]] for s in spec["scenes"]],
                    "backgrounds": [s["background"]["colors"] if s["background"]["type"] == "gradient" else s["background"]["type"] for s in spec["scenes"]],
                }
    return out
