# Marketing Studio

Small **offline** tool for making social-media videos, ads and images. Python + one HTML page.
Everything runs on your machine: no accounts, no API keys, no uploads.

- **Videos**: MP4 (H.264, works on Instagram/TikTok/YouTube/Meta Ads) and GIF
- **Images**: PNG / JPG stills from any scene (posts, thumbnails, display banners)
- **Many sizes at once**: design once, tick Reels 9:16 + Feed 4:5 + Square + 16:9 and render all
- **Add / remove / reorder / duplicate** scenes and layers (text, image, shape) in a live editor
- Backgrounds: colour, gradient, photo (slow-zoom + darken). Animations: fade, slide, zoom, pop. Scene transitions. Background music with fade-out
- Presets for Reels/TikTok/Shorts, Stories, Feed, YouTube (+thumbnail), Facebook/LinkedIn/X, Pinterest, 4K and standard display-ad sizes; custom WxH too

## Setup (2 minutes)
Needs Python 3.9+ and [ffmpeg](https://ffmpeg.org) (only for video/GIF; images work without it).

```bash
# ffmpeg: brew install ffmpeg | sudo apt install ffmpeg | winget install ffmpeg
./start.sh            # Windows: start.bat   (creates a venv, installs Pillow, opens the editor)
# or manually:  pip install -r requirements.txt && python studio.py serve
python studio.py check   # verify ffmpeg
```
The editor opens at http://127.0.0.1:8765 (localhost only). Drop logos, photos and music into
the editor's *Assets* panel (or straight into `assets/`); extra fonts (`.ttf/.otf`) go in `fonts/`.
Results land in `outputs/`.

## Using it with Claude (your Claude account, no API key)
Open this folder in **Claude Code** (logged in with your Claude subscription) and just ask:

> "Make a 12s Eid sale reel for my bakery: dark green, gold text, 50% off, CTA to order on WhatsApp. Export Reels + Square + Feed."

`CLAUDE.md` teaches Claude the spec format, so it writes `projects/<name>.json`, validates,
renders and checks the result with the CLI. Open the project in the editor afterwards to fine-tune.
Claude.ai chat also works: paste `CLAUDE.md` plus your brief, ask for the JSON, save it to
`projects/`, and click **Open project** in the editor.

## CLI
```bash
python studio.py presets
python studio.py render projects/x.json -p reels -p square      # videos
python studio.py render projects/x.json -f gif --size 720x720
python studio.py image  projects/x.json -p portrait --scene 1   # stills
```

## Notes
- Positions/sizes are fractions of the canvas, so one design adapts to every size. Check each
  aspect ratio's preview (change *Canvas* preset) – tall text can need a smaller size on wide formats.
- No emoji rendering. Font choices fall back to what is installed.
- Server binds to localhost, blocks foreign Host/Origin headers, and confines files to `assets/`, `outputs/`, `projects/`.
- Tests: `python -m unittest discover -s tests`

## Recommendations (what I'd add next, in priority order)
1. **Brand kit** – one file with logo, colours, fonts, default CTA/URL so every template picks them up (consistency = the biggest marketing win).
2. **Bulk/variant generation** – CSV of headlines/prices/products → one video per row; and A/B variants (different hook line or colour) for ad testing.
3. **Auto captions / subtitles** – local Whisper (`faster-whisper`) for word-by-word captions on talking-head clips; most Reels are watched muted.
4. **Video clip layers** – overlay or cut in your own footage (ffmpeg), with trim and zoom-to-fill/blur-fill for mixed aspect ratios.
5. **Safe-zone overlays** in the preview (Reels/Stories UI areas) and a platform checklist: max length, file size, aspect.
6. **More animation** – typewriter text, counters (price/countdown), progress bars, ken-burns on image layers, easing choices.
7. **Local background removal** (`rembg`) for product shots, plus drop-shadow/gradient backdrops.
8. **Template packs by use case** – product launch, testimonial, offer/countdown, event invite, before/after, carousel (multi-image export).
9. **Voice-over** – offline TTS (e.g. Piper) or recorded audio track with auto-ducked music.
10. **Packaging** – single-file app via PyInstaller so non-technical teammates double-click it; optional `docker` image with ffmpeg bundled.
11. **Content tips baked in**: hook in 1–2 s, ≤7 words per scene, CTA on the last scene, keep text out of top 12% / bottom 22% on 9:16, always add captions.
12. **Licensing hygiene** – only use fonts/music/photos you have rights to; keep a `LICENSES.md` in `assets/`.

## Moving this into its own repository
This folder is self-contained. To publish it as a separate repo:
```bash
git subtree split -P marketing-studio -b marketing-studio-only
git remote add new git@github.com:<you>/<new-repo>.git && git push new marketing-studio-only:main
```
