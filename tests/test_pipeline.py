#!/usr/bin/env python3
"""
Offline checks for fetch_cfb_stats.py. Run from the repo root:
    python tests/make_fixtures.py && python tests/test_pipeline.py
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from collections import Counter  # noqa: E402
from fetch_cfb_stats import extract_receiver, match_targets, norm_name  # noqa: E402

fails = 0


def check(cond, msg):
    global fails
    if not cond:
        fails += 1
        print("FAIL:", msg)


# Play-text parsing
cases = {
    "Carson Beck pass complete to Dillon Bell for 12 yds to the UGA 40": "Dillon Bell",
    "C.Beck pass incomplete to D.Bell, broken up by J.Smith": "D.Bell",
    "C.Beck pass incomplete to D.Bell": "D.Bell",
    "Beck pass intercepted by Jalen Smith, intended for Arian Smith": "Arian Smith",
    "Jalen Milroe pass complete to Ryan Williams for 75 yds for a TD (Will Reichard Kick)": "Ryan Williams",
    "Milroe pass complete to Tyler Booker Jr. for 4 yds": "Tyler Booker Jr",
    "Quinn Ewers pass complete to Matthew Golden for a loss of 3 yards": "Matthew Golden",
    "Ewers pass complete to Ja'Tavion Sanders for no gain": "Ja'Tavion Sanders",
    "Ewers pass complete to Golden for 15 yds, PENALTY TEX holding (No Play)": None,
    "Ewers sacked by Bob Jones for a loss of 7 yards": None,
    "Jaydon Blue run for 5 yds": None,
    # Real NCAA-format lines (2026 week 5)
    "(14:59) No Huddle-Shotgun #7 M.Washington pass incomplete short left to #13 C.Durr Jr. thrown to UMD20": "C.Durr Jr",
    "(14:57) No Huddle-Shotgun #7 M.Washington pass complete short left to #9 D.Fleming caught at UMD30, for 5 yards to the UMD30 (#22 V.Evans III)": "D.Fleming",
    "(14:27) No Huddle-Shotgun #7 M.Washington pass incomplete short right to #1 N.Abdul-Rahim Gladding thrown to UMD35 QB hurried by #24 D.Foster": "N.Abdul-Rahim Gladding",
    "No Huddle-Shotgun #7 M.Washington pass complete deep right to #13 C.Durr Jr. caught at NEB29, for 36 yards to the NEB29 (#8 D.Jones), 1ST DOWN": "C.Durr Jr",
    "Shotgun #7 M.Washington pass complete short middle to #13 C.Durr Jr. caught at NEB34, for 20 yards": "C.Durr Jr",
    "#7 M.Washington pass intercepted by #3 J.Smith at UMD40, intended for #13 C.Durr Jr.": "C.Durr Jr",
    "Shotgun #7 M.Washington pass incomplete short left": None,
    "Cam Abshire 8 Yd pass from Kalieb Osborne (Jack O'Connor Kick)": "Cam Abshire",
}
for text, want in cases.items():
    got = extract_receiver(text)
    check(got == want, f"extract_receiver({text!r}) -> {got!r}, want {want!r}")
check(norm_name("Ja'Marr Chase Jr.") == "jamarr chase", "norm_name suffix/apostrophe")
check(norm_name("Abdul-Rahim Gladding") == "abdul rahim gladding", "norm_name hyphen")

# Two J. Duprees on the roster: the one with stats in this game gets the target.
box = [{"player_id": "1", "name": "Jaylen Dupree"}, {"player_id": "2", "name": "Avery Dupree"}]
ros = [{"player_id": "3", "name": "Jalen Dupree Jr."}, {"player_id": "4", "name": "Sam Ortiz"}]
res, extra, un = match_targets(Counter({"J.Dupree": 5, "A.Dupree": 2, "S.Ortiz": 3}), box, ros)
check(res == {"1": 5, "2": 2, "4": 3} and un == 0 and extra == {"4": "Sam Ortiz"},
      f"box tiebreak matching: {res} {extra} {un}")
# Both J. Smiths played: genuinely ambiguous, must stay unassigned.
box = [{"player_id": "1", "name": "Jalen Smith"}, {"player_id": "2", "name": "Josh Smith"}]
res, extra, un = match_targets(Counter({"J.Smith": 4}), box, [])
check(res == {} and un == 4, f"ambiguous matching: {res} {un}")
# Hyphenated surnames match with or without the hyphen.
res, _, un = match_targets(Counter({"I.Jackson-Anderson": 3}), [{"player_id": "9", "name": "Isaiah Jackson Anderson"}], [])
check(res == {"9": 3}, f"hyphen matching: {res}")

# Archive: re-running a week replaces its index entry; backfilling keeps "latest" pinned.
with tempfile.TemporaryDirectory() as td:
    import shutil
    repo = Path(td) / "r"
    shutil.copytree(ROOT, repo, ignore=shutil.ignore_patterns("data", "week_stats.json", "__pycache__", ".git"))
    run = lambda wk: subprocess.run([sys.executable, str(repo / "fetch_cfb_stats.py"), "--offline-dir",
                                     str(ROOT / "tests/fixtures"), "--week", str(wk), "--year", "2026"],
                                    check=True, capture_output=True, cwd=repo)
    for wk in (5, 5, 5, 3, 4):
        run(wk)
    idx = json.loads((repo / "data/weeks/index.json").read_text())
    check([w["week"] for w in idx] == [5, 4, 3], f"archive index weeks {[w['week'] for w in idx]}")
    check(json.loads((repo / "week_stats.json").read_text())["meta"]["week"] == 5, "latest stays week 5")

# A team with no box-score rows must not crash (2026 week 2).
import pandas as pd  # noqa: E402
from fetch_cfb_stats import build_team, NUM_COLS  # noqa: E402
empty = pd.DataFrame(columns=["game_id", "team", "player_id", "name", *NUM_COLS])
t0 = build_team("Nobody State", empty, None, {"by_id": {}, "by_name": {}, "by_team": {}},
                {"homeId": 1, "homeConference": "X", "homePoints": 0}, "home", {})
check(t0["players"] == [] and t0["totals"]["totalYds"] == 0, "empty team handled")

# End to end on fixtures
with tempfile.TemporaryDirectory() as td:
    out = Path(td) / "out.json"
    subprocess.run([sys.executable, str(ROOT / "fetch_cfb_stats.py"), "--offline-dir",
                    str(ROOT / "tests/fixtures"), "--week", "6", "--year", "2026", "--out", str(out), "--no-archive"],
                   check=True, capture_output=True)
    d = json.loads(out.read_text())

truth = json.loads((ROOT / "tests/fixtures/_truth_targets.json").read_text())
check(d["meta"]["gameCount"] == 11, "incomplete game should be skipped")
mism = 0
for g in d["games"]:
    for side in ("home", "away"):
        t = g[side]
        tt = truth[f'{g["id"]}|{t["name"]}']
        check(t["totals"]["targets"] == sum(tt.values()), f'{t["name"]} team targets')
        check(t["totals"]["unmatchedTargets"] == 0, f'{t["name"]} unmatched targets')
        check(t["totals"]["totalYds"] == t["totals"]["passYds"] + t["totals"]["rushYds"], "total yds")
        pos = [p["pos"] for p in t["players"]]
        for k, lim in {"QB": 2, "RB": 2, "WR": 4, "TE": 2}.items():
            check(pos.count(k) <= lim, f'{t["name"]} too many {k}')
        shares = [p["metrics"]["tgt_share"] or 0 for p in t["players"]]
        check(sum(shares) <= 100.5, f'{t["name"]} target shares sum {sum(shares)}')
        carry = [p["metrics"]["carry_share"] or 0 for p in t["players"]]
        check(sum(carry) <= 100.5, f'{t["name"]} carry shares')
        for p in t["players"]:
            if p["receiving"] and p["receiving"]["tgt"] != tt.get(p["name"], 0):
                mism += 1
                print(f'  target mismatch {t["name"]} {p["name"]}: {p["receiving"]["tgt"]} vs {tt.get(p["name"])}')
            if p["receiving"]:
                check(p["receiving"]["tgt"] >= p["receiving"]["rec"], "targets >= receptions")
check(mism == 0, f"{mism} player target mismatches")
check(any(g["apGame"] for g in d["games"]) and not all(g["apGame"] for g in d["games"]), "AP flags")
check(d["meta"]["apPollWeek"] == 6, "uses week-6 AP poll, not week 7")
georgia = next(g for g in d["games"] if g["home"]["name"] == "Georgia")["home"]
check(georgia["apRank"] == 3, f"Georgia AP rank {georgia['apRank']}")

print("ALL PASS" if not fails else f"{fails} FAILURE(S)")
sys.exit(1 if fails else 0)
