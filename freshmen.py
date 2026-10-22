#!/usr/bin/env python3
"""
Freshman Watch: true freshmen (this year's high school recruiting class) at QB, WR, TE and RB
who have touched the ball this season, with their recruiting profile and CFBD usage rate.
Weekly shares come from the season history the site already loads. No API calls here; the
recruiting class and usage files come from history_backfill.py.

    python freshmen.py [year]      # writes data/premium/freshmen-<year>.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from prospect_features import _load, LAST

ROOT = Path(__file__).resolve().parent


def build(year: int = LAST):
    hist_path = ROOT / "data" / "weeks" / f"history-{year}-regular.json"
    hist = json.loads(hist_path.read_text())["players"]
    recs = {}
    by_recruit = {}
    for r in _load(f"recruits-{year}"):
        rec = {"stars": r.get("stars") or 0, "rating": r.get("rating"), "rank": r.get("ranking"),
               "rpos": r.get("position"), "school": r.get("school")}
        by_recruit[str(r["id"])] = rec
        if r.get("athleteId"):
            recs[str(r["athleteId"])] = rec
    for ro in _load(f"roster-{year}") + _load(f"qb-roster-{year}"):
        pid = str(ro["id"])
        if pid not in recs:
            for rid in ro.get("recruitIds") or []:
                if str(rid) in by_recruit:
                    recs[pid] = by_recruit[str(rid)]
                    break
    usage = {str(u["id"]): (u.get("usage") or {}) for u in _load(f"usage-{year}")}
    out = {}
    for pid, e in hist.items():
        if e.get("p") not in ("QB", "WR", "TE", "RB") or pid not in recs:
            continue
        u = usage.get(pid, {})
        out[pid] = {**recs[pid], "usage": u.get("overall"), "usagePass": u.get("pass"), "usageRush": u.get("rush")}
    path = ROOT / "data" / "premium" / f"freshmen-{year}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"season": year, "class": year, "players": out}, separators=(",", ":")))
    print(f"Freshman Watch: {len(out)} true freshmen with touches -> {path}")


if __name__ == "__main__":
    build(int(sys.argv[1]) if len(sys.argv) > 1 else LAST)
