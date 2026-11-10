#!/usr/bin/env python3
"""Regenerate the golden images/snapshots. Run only after you have *looked* at the change and decided it is intended:
    python tests/update_golden.py
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from golden_cases import cases, montage
from snapshot_cases import snapshot

GOLD = os.path.join(os.path.dirname(__file__), "golden")
os.makedirs(GOLD, exist_ok=True)
for name, items in cases().items():
    montage(items).save(os.path.join(GOLD, name + ".png"), optimize=True)
json.dump(snapshot(), open(os.path.join(GOLD, "generator_snapshot.json"), "w"), indent=1, sort_keys=True)
print("golden files updated in", GOLD)
