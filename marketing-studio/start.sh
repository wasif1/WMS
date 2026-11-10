#!/usr/bin/env bash
# One-click launcher (macOS / Linux). Creates a venv on first run.
cd "$(dirname "$0")"
command -v ffmpeg >/dev/null || echo "! ffmpeg not found - video export needs it (brew install ffmpeg / apt install ffmpeg)"
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q -r requirements.txt
exec .venv/bin/python studio.py serve "$@"
