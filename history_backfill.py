#!/usr/bin/env python3
"""
One-time pull of season-level history for the prospect model (WR, TE, RB).

For each season 2014-2026: season player stats (receiving + rushing), team season
stats, player usage, player season PPA, and rosters (class year). For each draft
2015-2026: NFL draft picks. About 77 API calls in total. Files that already exist are
skipped, so a re-run only fetches what's missing, and a hard cap stops it early.

Output: data/history/<kind>-<year>.json.gz, trimmed to skill positions so the repo
stays small.

    CFBD_API_KEY=... python history_backfill.py [--first 2014] [--last 2026] [--max-calls 90]
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import sys
from pathlib import Path

from fetch_cfb_stats import CFBDClient, ROOT

OUT = ROOT / "data" / "history"
POS = {"WR", "TE", "RB"}
DRAFT_POS = {"Wide Receiver", "Tight End", "Running Back", "WR", "TE", "RB"}


def save(name: str, rows) -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    with gzip.open(OUT / f"{name}.json.gz", "wt", encoding="utf-8") as f:
        json.dump(rows, f, separators=(",", ":"))
    return len(rows)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--first", type=int, default=2014)
    ap.add_argument("--last", type=int, default=2026)
    ap.add_argument("--max-calls", type=int, default=90)
    ap.add_argument("--refresh", action="store_true", help="re-fetch files that already exist")
    ap.add_argument("--kinds", default="", help="comma list to limit, e.g. player-stats,team-stats,ppa")
    args = ap.parse_args(argv)
    key = os.environ.get("CFBD_API_KEY")
    if not key:
        sys.exit("Set CFBD_API_KEY.")
    client = CFBDClient(key)

    def pos_ok(row, field="position"):
        return (row.get(field) or "").upper() in POS

    jobs = []
    for y in range(args.first, args.last + 1):
        jobs += [
            (f"player-stats-{y}", "/stats/player/season", {"year": y},
             lambda rows: [r for r in rows if r.get("category") in ("receiving", "rushing") and pos_ok(r)]),
            (f"team-stats-{y}", "/stats/season", {"year": y}, lambda rows: rows),
            (f"usage-{y}", "/player/usage", {"year": y}, lambda rows: [r for r in rows if pos_ok(r)]),
            (f"ppa-{y}", "/ppa/players/season", {"year": y}, lambda rows: [r for r in rows if pos_ok(r)]),
            (f"roster-{y}", "/roster", {"year": y}, lambda rows: [
                {k: r.get(k) for k in ("id", "firstName", "lastName", "team", "height", "weight", "year", "position", "recruitIds")}
                for r in rows if pos_ok(r)]),
        ]
    for y in range(args.first + 1, args.last + 1):
        jobs.append((f"draft-{y}", "/draft/picks", {"year": y},
                     lambda rows: [r for r in rows if (r.get("position") or "") in DRAFT_POS]))

    # Quarterbacks (for the QB Prospect Score): passing + rushing season stats, PPA, rosters
    # and drafted QBs, in their own files so the WR/TE/RB files above stay as they are.
    qb = lambda row, field="position": (row.get(field) or "").upper() == "QB"
    for y in range(args.first, args.last + 1):
        jobs += [
            (f"qb-stats-{y}", "/stats/player/season", {"year": y},
             lambda rows: [r for r in rows if r.get("category") in ("passing", "rushing") and qb(r)]),
            (f"qb-ppa-{y}", "/ppa/players/season", {"year": y}, lambda rows: [r for r in rows if qb(r)]),
            (f"qb-roster-{y}", "/roster", {"year": y}, lambda rows: [
                {k: r.get(k) for k in ("id", "firstName", "lastName", "team", "height", "weight", "year", "position", "recruitIds")}
                for r in rows if qb(r)]),
        ]
    for y in range(args.first + 1, args.last + 1):
        jobs.append((f"qb-draft-{y}", "/draft/picks", {"year": y},
                     lambda rows: [r for r in rows if (r.get("position") or "") in ("Quarterback", "QB")]))

    # High school recruiting classes, from four years before the first season (2010 for 2014)
    for y in range(args.first - 4, args.last + 1):
        jobs.append((f"recruits-{y}", "/recruiting/players", {"year": y, "classification": "HighSchool"},
                     lambda rows: [{k: r.get(k) for k in ("id", "athleteId", "year", "ranking", "name", "committedTo",
                                                          "position", "stars", "rating", "height", "weight")} for r in rows]))

    # Team list (colors, abbreviations) for the latest season: used for the site's team badges
    jobs.append((f"teams-{args.last}", "/teams", {"year": args.last},
                 lambda rows: [{k: r.get(k) for k in ("id", "school", "abbreviation", "mascot", "color", "alternateColor",
                                                      "classification", "conference")} for r in rows]))

    kinds = {k for k in args.kinds.split(",") if k}
    if kinds:
        jobs = [j for j in jobs if j[0].rsplit("-", 1)[0] in kinds]
    done = skipped = 0
    for name, path, params, trim in jobs:
        if not args.refresh and (OUT / f"{name}.json.gz").exists():
            skipped += 1
            continue
        if client.calls >= args.max_calls:
            print(f"Stopping at the {args.max_calls}-call cap; re-run to continue.")
            break
        try:
            rows = client.get(path, timeout=180, **params) or []
        except Exception as e:  # keep going; a re-run picks up what failed
            print(f"  {name}: failed ({type(e).__name__}: {e})", flush=True)
            continue
        n = save(name, trim(rows))
        done += 1
        print(f"  {name}: {len(rows)} rows, kept {n}", flush=True)
    print(f"Fetched {done} files, skipped {skipped} already present, {client.calls} API calls.")


if __name__ == "__main__":
    main()
