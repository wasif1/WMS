# Marketing Studio – instructions for Claude Code

Offline tool that turns text into branded, animated social/ad videos (mp4/gif) and images (png/jpg).
No API keys, no network. **Preferred workflow for a request like "make a 15s Diwali sale reel":**
1. Check the brand: `python studio.py brand show` (colours, logo, CTA, URL, theme). If the user gave
   brand details, save them to `brands/<name>.json` (shape below) and `python studio.py brand use <name>`.
2. Write the copy as a script (one line per scene, see syntax) and run
   `python studio.py make @script.txt -t <theme> -p reels -p square --save projects/<name>.json`
   (`-k image` for a single poster, `-k carousel` for one image per slide, `--length 20`, `--image a.jpg`).
3. Look at the result (PNG directly, or `ffmpeg -ss 2 -i out.mp4 -frames:v 1 f.png`) and report the paths.
4. Many variants/products? Write a CSV and run `python studio.py bulk data.csv -p square`.
   The user can open any saved project in the editor (`python studio.py serve`) to fine-tune.

Everything exported lands in `outputs/` (bulk runs in `outputs/bulk_<time>/`); the app's Library tab lists it and zips it.
To publish this tool as its own repo: `python make_repo.py <new-folder> [--github NAME]`.

## Script syntax (generator)
One line (or blank-line-separated paragraph) = one scene; one long paragraph is split into scenes.
`*word*` highlight · `Headline | subtitle` · `1. step` (numbered) · `"Quote" — Name` ·
`[img: file.jpg]` photo background (file must be in `assets/`) · `[dur: 5]` seconds ·
`CTA: Shop now` · `URL: site.com` (last scene; otherwise brand defaults; use `--cta ""` to omit).
Numbers/prices are auto-highlighted. Keep each scene ≤ 12 words; hook first, CTA last.
Themes: bold, minimal, elegant, neon, corporate, playful (`-t`); brand's own theme is the default.

## Commands (run from this folder)
```
python studio.py check | presets | brand list|show|use NAME
python studio.py make "text or @file" [-k video|image|carousel] [-t theme] [-b brand] [-p preset]... [--size WxH]
                      [-f mp4|gif|png|jpg] [-q standard|hd|ultra] [--cta T] [--url U] [--image F]... [--music F]
                      [--length SEC] [--no-logo] [--save spec.json] [--no-render]
python studio.py bulk data.csv [--template NAME|path.json] [-k ...] [-t ...] [-p ...] [-f ...]
python studio.py render|image projects/x.json -p reels -p square [-q hd] [--scene N]
python studio.py validate projects/x.json
python -m unittest discover -s tests        # run after changing any .py file
```
CSV columns (only `script` required): `name, script, theme, cta, url, image, music, kind`; extra columns
usable as `{{column}}` in template mode (`templates/offer-card.json` is an example).

## Brand file `brands/<name>.json`
```jsonc
{"name":"Acme","tagline":"Made simple","logo":"logo.png",           // logo = file in assets/
 "colors":{"primary":"#ff6a1a","secondary":"#6d28d9","accent":"#fbbf24","dark":"#0f172a","light":"#f8fafc"},
 "fonts":{"heading":"auto","body":"auto"},                           // auto | sans | sans-bold | serif | serif-bold | mono | file in fonts/
 "cta":"Shop now","url":"acme.com","watermark":{"position":"top-left","size":0.16},   // none|top-left|top-right|top-center|bottom-*
 "theme":{"base":"bold","upper":true,"align":"center","anim":"punchy","transition":"slide-left",
          "motion":"dynamic","deco":"circles","bar":true,"progress":true,"shadow":true,"bg_style":"alternate"}}
```
Theme keys are optional overrides: anim calm|smooth|dynamic|punchy · motion still|subtle|dynamic ·
deco none|circles|glow|lines · bg_style theme|alternate|primary|duo|secondary|accent|dark|light.

## Low-level spec (for hand-written projects / the Advanced editor)
All x/y/w/h/size values are **fractions** (0–1) of the canvas, x/y = layer *centre*, `size` = font
height as a fraction of the shorter canvas side. One spec renders at every size.
```jsonc
{ "name": "diwali-sale", "width": 1080, "height": 1920, "fps": 30,
  "transition": {"type": "fade|slide-left|slide-up|none", "duration": 0.5},
  "audio": {"asset": "music.mp3", "volume": 0.8, "fade_out": 1},      // optional, file in assets/
  "scenes": [{
    "duration": 3,
    "background": {"type":"color","color":"#111"}
               // | {"type":"gradient","colors":["#f00","#00f"],"angle":160,"drift":30,"vignette":0.3}
               // | {"type":"image","asset":"photo.jpg","kenburns":0.1,"dim":0.3,"focus_x":.5,"focus_y":.5},
    "layers": [   // drawn bottom -> top
      {"type":"text","text":"Save *40%*","x":.5,"y":.4,"size":.12,"w":.84,"color":"#fff","accent":"#fbbf24",
       "font":"sans|sans-bold|serif|serif-bold|mono|<file in fonts/>","align":"center","upper":false,
       "shadow":true,"line_height":1.2,"stroke":{"width":.004,"color":"#000"},
       "box":{"color":"#000","opacity":.6,"pad":.03,"radius":.5}},       // *word* uses "accent"
      {"type":"image","asset":"logo.png","x":.5,"y":.1,"w":.3,"radius":0,"shadow":false},   // add "h" to crop-fill a box
      {"type":"shape","shape":"rect|rounded|circle","x":.5,"y":.8,"w":.5,"h":.08,"color":"#fff","radius":.3,
       "blur":0,"stroke":{"width":.004,"color":"#000"}}                   // blur>0 = soft glow
    ]}] }
```
Every layer also accepts: `opacity`, `rotate`, `start`/`end` seconds, `in` (none|fade|slide-up|slide-down|
slide-left|slide-right|zoom|pop|wipe), `out` (none|fade|slide-down|zoom), `anim_dur`, `ease:"linear"`,
`motion:{"dx":.03,"dy":0,"scale":.05}` (slow drift/push-in across the scene).
Brand tokens in any string: `"$primary" "$secondary" "$accent" "$dark" "$light" "$font_heading" "$font_body" "$logo"`
and `{{brand.cta}}`-style placeholders. Colours: `#rgb`, `#rrggbb`, `#rrggbbaa`.

## Rules of thumb for good output
- ≤ 7 words per scene is ideal; hook in the first 1–2 s; last scene = call to action + brand/URL.
- 9:16: keep key content between y 0.15 and 0.75 (platform UI covers top ~12% and bottom ~22%).
- 6–15 s for Reels/Shorts/Stories; 15–30 s for feed ads. Always prefer HD quality; ultra only on request.
- Emoji are not rendered. Asset files must already be in `assets/` (ask the user to add them).
- Never write outside this folder; never commit `outputs/`, `assets/`, `projects/` or `brands/` content.
