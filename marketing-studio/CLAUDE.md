# Marketing Studio – instructions for Claude Code

Offline tool that turns a JSON *spec* into social/ad videos (mp4/gif) and images (png/jpg).
No API keys, no network. When the user asks for a creative ("15s Diwali sale reel", "LinkedIn
banner for X"), **write a spec to `projects/<name>.json`, validate it, render it, and tell them
the output paths**. They can then open it in the editor (`python studio.py serve`) to tweak.

## Commands (run from this folder)
```
python studio.py check                      # ffmpeg/Pillow present?
python studio.py presets                    # size ids
python studio.py validate projects/x.json
python studio.py render projects/x.json -p reels -p square      # mp4 per size -> outputs/
python studio.py render projects/x.json -f gif --size 720x720
python studio.py image  projects/x.json -p portrait -p yt_thumb [--scene 2]   # png/jpg
python -m unittest discover -s tests        # run after changing engine.py
```
Look at a result by opening the PNG (images) or extracting a frame:
`ffmpeg -ss 2 -i outputs/x.mp4 -frames:v 1 frame.png`.

## Spec format
All x/y/w/h/size values are **fractions** (0–1) of the canvas, x/y = layer *centre*, `size` = font
height as a fraction of the shorter canvas side. One spec therefore renders at every size.
```jsonc
{ "name": "diwali-sale", "width": 1080, "height": 1920, "fps": 30,
  "transition": {"type": "fade|slide-left|slide-up|none", "duration": 0.5},
  "audio": {"asset": "music.mp3", "volume": 0.8, "fade_out": 1},      // optional, file in assets/
  "scenes": [{
    "duration": 3,
    "background": {"type":"color","color":"#111"}
               // | {"type":"gradient","colors":["#f00","#00f"],"angle":160}   (CSS angle, 2–5 stops)
               // | {"type":"image","asset":"photo.jpg","kenburns":0.1,"dim":0.3,"focus_x":.5,"focus_y":.5},
    "layers": [   // drawn bottom -> top
      {"type":"text","text":"SALE","x":.5,"y":.4,"size":.12,"w":.84,"color":"#fff",
       "font":"sans|sans-bold|serif|serif-bold|mono|<file in fonts/>","align":"center","upper":false,
       "shadow":true,"line_height":1.2,"stroke":{"width":.004,"color":"#000"},
       "box":{"color":"#000","opacity":.6,"pad":.03,"radius":.5}},
      {"type":"image","asset":"logo.png","x":.5,"y":.1,"w":.3,"radius":0,"shadow":false},   // add "h" to crop-fill a box
      {"type":"shape","shape":"rect|rounded|circle","x":.5,"y":.8,"w":.5,"h":.08,"color":"#fff","radius":.3,
       "stroke":{"width":.004,"color":"#000"}}
    ]}] }
```
Every layer also accepts: `opacity` 0–1, `rotate` degrees, `start`/`end` seconds within the scene,
`in` (none|fade|slide-up|slide-down|slide-left|slide-right|zoom|pop), `out` (none|fade|slide-down|zoom),
`anim_dur` seconds (default 0.5). Colours: `#rgb`, `#rrggbb`, `#rrggbbaa`.

## Rules of thumb for good output
- Keep text ≤ 7 words per scene; hook in the first 1–2 s; end scene = call to action + brand/URL.
- Stay inside safe zones for 9:16: nothing important in the top ~12% or bottom ~22%
  (y between 0.15 and 0.75).
- Contrast: put text on `dim`med image backgrounds or on a `box`; min text `size` ≈ 0.045.
- 6–15 s for Reels/Shorts/Stories; 15–30 s for feed ads.
- Emoji are not rendered (no colour-font support) – use shapes/images instead.
- Asset files must be placed in `assets/` first (ask the user to drop them there).
- Never write outside this folder; never commit `outputs/`, `assets/` or `projects/` content.
