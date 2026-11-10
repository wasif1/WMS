# Marketing Studio

An **offline, free** tool for making professional social videos, ads and images in HD.
Type a sentence, a paragraph or a script, pick a look, press export. Python + one HTML page,
runs on your own computer: no accounts, no API keys, no uploads, no watermarks.

## What you get
| | |
|---|---|
| **Create** | Paste text → themed, animated video (MP4/GIF), single image post (PNG/JPG) or a carousel. Live preview, scene thumbnails, multi-size export in one click. |
| **Brand & theme** | Your logo, 5 colours, fonts, default button text + website, and **your own theme** (animation style, transitions, decoration, text case…). Everything you create follows it. Keep one profile per client. |
| **Bulk (CSV)** | One row = one creative. Generate from a script column, or fill a template with `{{placeholders}}`. Download everything as a .zip. |
| **Library** | One button shows every generated video and image (filter, preview, select), **download everything or just your selection as one .zip**, or delete. |
| **Advanced editor** | Full scene/layer control when you want to fine-tune (opens from "Fine-tune in editor"). |

Professional touches built in: auto-fitted text, automatic readable contrast from your brand
colours, highlighted words/numbers, staggered entrance animations, crossfade/slide transitions,
slow push-ins, drifting gradients, story-style progress bar, accent lines, logo watermark,
photo backgrounds with slow zoom + darkening, CTA button scene, music with fade-out,
H.264 high profile, 1080p default (up to 4K), 3 quality levels.

## Setup (2 minutes)
Needs Python 3.9+ and [ffmpeg](https://ffmpeg.org) (video/GIF only; images work without it).
```bash
# ffmpeg: brew install ffmpeg | sudo apt install ffmpeg | winget install ffmpeg
./start.sh          # Windows: start.bat   (creates a venv, installs Pillow, opens the app)
# or:  pip install -r requirements.txt && python studio.py serve
python studio.py check
```
Opens at http://127.0.0.1:8765 (this computer only).

## How to use (3 steps)
1. **Brand & theme** (once): name, logo, colours, button text, website → *Save brand*.
2. **Create**: paste your text, choose Video / Image post / Carousel, pick a style and sizes → *Export*.
3. **Bulk** (optional): upload a CSV to make many at once. Tick *Also make a version in every theme* on Create for an instant A/B set.
4. **Library**: find everything you made, download it all (or a selection) as one .zip.

### Writing your content
One sentence, a paragraph, or a script with one line (or paragraph) per scene. Optional shortcuts:

| You type | You get |
|---|---|
| `*word*` | word highlighted in the accent colour (numbers like `40%` or `$49` are highlighted automatically) |
| `Headline \| smaller line` | headline with a subtitle |
| `1. Step one` | numbered step with a badge |
| `"Quote" — Name` | quote scene with attribution |
| `[img: photo.jpg]` | photo background for that scene (file in the Assets/Photos list) |
| `[dur: 5]` | that scene lasts 5 s |
| `CTA: Shop now` / `URL: site.com` | final button text / link (otherwise the brand defaults are used) |

### Themes
`Bold Ad`, `Clean Minimal`, `Elegant Serif`, `Neon Night`, `Corporate`, `Playful`. Colours always come
from your brand; the theme decides layout, type, motion and transitions. **My theme** (Brand tab)
lets you override any of those (text case, alignment, animation, transition, background motion,
decoration, progress bar, accent line, shadow) and is saved with the brand profile.

### CSV bulk
Columns (only `script` is required): `name, script, theme, cta, url, image, music, kind`.
Download a sample from the Bulk tab. Template mode: use a saved project/template containing
`{{column}}` placeholders (see `templates/offer-card.json`); brand values are available as
`{{brand.cta}}`, `{{brand.url}}`, `{{brand.name}}`, `{{brand.tagline}}` and colour/font tokens like `"$primary"`, `"$font_heading"`, `"$logo"`.
Rows that fail are skipped and reported; the rest finish.

## Command line (also great for scripting or Claude Code)
```bash
python studio.py make "Summer sale: save *40%* this week only." -t bold -p reels -p square
python studio.py make @script.txt -k carousel -p portrait --save projects/launch.json
python studio.py bulk products.csv --template offer-card -k image -f png -p portrait
python studio.py brand list | show | use NAME
python studio.py render projects/x.json -p reels -q ultra      # re-render a saved project
```
Add `--length 30` to fit a target length, `--image photo.jpg`, `--music track.mp3`, `-q standard|hd|ultra`.

## Using it with Claude (your Claude account, no API key)
Open this folder in **Claude Code** (logged in with your Claude subscription). `CLAUDE.md` explains
everything, so you can say: *"Make a 20s product video for my new candle range, elegant theme,
Reels and Square"* and Claude will write the script, run `studio.py make`, and check the output.
Claude can also edit `brands/<name>.json` or write a CSV for bulk runs.
(The built-in generator itself is rule-based and fully offline; Claude is optional help with copywriting.)

## Notes & limits
- No emoji (no colour-font support). Use fonts you are licensed for; add `.ttf/.otf` in the Brand tab or `fonts/`.
- Transparent PNG logos look best.
- 4K and *Ultra* quality are slow and large; *HD* is the right default for social.
- Server binds to localhost, blocks foreign Host/Origin headers, confines files to `assets/`, `outputs/`, `projects/`, `brands/`, `fonts/`.
- Tests: `python -m unittest discover -s tests`

## What I'd add next
1. Auto-captions with local Whisper for talking-head clips · 2. Your own video clips as layers ·
3. Offline voice-over (Piper TTS) with music ducking · 4. Safe-zone overlay + platform checklist in the preview ·
5. Typewriter/counter animations · 6. Background removal for product shots (`rembg`) ·
7. Single-file desktop build (PyInstaller) for non-technical teammates · 8. A/B variant generator (same script × themes) in one click.

## Put this in its own new repository
`make_repo.py` copies only the source (never your outputs, photos, brands or projects) into a fresh folder with a clean one-commit git history:
```bash
python make_repo.py ~/projects/marketing-studio                          # local repo only
python make_repo.py ~/projects/marketing-studio --github marketing-studio   # also creates a PRIVATE GitHub repo and pushes (needs `gh auth login`)
python make_repo.py ~/projects/marketing-studio --github marketing-studio --public
python make_repo.py ~/projects/marketing-studio --remote git@github.com:you/repo.git --push   # existing empty repo
```
