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
from collections import Counter, defaultdict  # noqa: E402
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
        pos = [p["pos"] for p in t["players"] if p["featured"]]
        for k, lim in {"QB": 2, "RB": 2, "WR": 4, "TE": 2}.items():
            check(pos.count(k) <= lim, f'{t["name"]} too many featured {k}')
        # All players are kept, so position totals reconcile with team totals.
        bp = t["totals"]["byPos"]
        check(sum(v["rec"] for v in bp.values()) == t["totals"]["receptions"], f'{t["name"]} byPos receptions')
        check(sum(v["recYds"] for v in bp.values()) == t["totals"]["passYds"], f'{t["name"]} byPos rec yds = pass yds')
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
check(georgia["abbr"] == "GEOR", f"team abbreviation {georgia.get('abbr')}")
check(georgia["apRank"] == 3, f"Georgia AP rank {georgia['apRank']}")

# Dominator rating: share of team receiving yards and TDs, averaged.
for g in d["games"]:
    for t in (g["home"], g["away"]):
        doms = [p["metrics"]["dominator"] for p in t["players"] if p["metrics"].get("dominator") is not None]
        check(all(0 <= x <= 100 for x in doms), f'{t["name"]} dominator in range')
        ys = sum(p["metrics"]["rec_yds_share"] or 0 for p in t["players"])
        check(t["totals"]["recYds"] <= 0 or ys <= 100.6, f'{t["name"]} rec yds shares sum {ys}')
        check("pace" in t and "proe" in t, "tempo keys present")

# Real play order from CFBD (two week-6 games): possession must add up to 60:00.
import json as _json
sample = ROOT / "tests" / "fixtures" / "plays_real_sample.json"
if sample.exists():
    import fetch_cfb_stats as F
    rm = F.team_play_metrics(_json.loads(sample.read_text()))
    tot = defaultdict(int)
    for (gid, _), v in rm.items():
        tot[gid] += v["pace"]["possSecs"]
    check(all(v == 3600 for v in tot.values()), f"possession per game {dict(tot)}")
    army = next(v for (g, o), v in rm.items() if o == "Army")["pace"]
    check(30 <= army["secPerPlay"] <= 37, f"Army sec/play {army['secPerPlay']}")

# Pace and PROE on hand-built plays (fixture plays lack clock/score fields).
import fetch_cfb_stats as F
def P(gid, off, drive, n, per, mins, secs, down, dist, ytg, ptype, os_=0, ds=0):
    return {"gameId": gid, "offense": off, "driveId": f"{gid}-{drive}", "driveNumber": drive, "playNumber": n,
            "period": per, "clock": {"minutes": mins, "seconds": secs}, "down": down, "distance": dist,
            "yardsToGoal": ytg, "playType": ptype, "offenseScore": os_, "defenseScore": ds}
plays = [
    # Team A: 4 snaps, 20 s apart, all neutral 1st/2nd down: pass, pass, rush, pass.
    P(1, "A", 1, 1, 1, 14, 0, 1, 10, 75, "Pass Reception"),
    P(1, "A", 1, 2, 1, 13, 40, 2, 4, 66, "Pass Incompletion"),
    P(1, "A", 1, 3, 1, 13, 20, 1, 10, 60, "Rush"),
    P(1, "A", 1, 4, 1, 13, 0, 2, 7, 55, "Pass Reception"),
    P(1, "A", 1, 5, 1, 12, 55, 4, 2, 50, "Punt"),
    # Team B: 3 snaps, 30 s apart, two neutral rushes then a blowout-score pass.
    P(1, "B", 2, 1, 1, 12, 0, 1, 10, 75, "Rush"),
    P(1, "B", 2, 2, 1, 11, 30, 2, 6, 70, "Rush"),
    P(1, "B", 2, 3, 1, 11, 0, 1, 10, 60, "Sack", os_=0, ds=21),
    P(1, "B", 2, 4, 1, 10, 50, None, None, 60, "Timeout"),
]
m = F.team_play_metrics(plays)
a, b = m[(1, "A")], m[(1, "B")]
# A's drive runs from its first snap (14:00) to B's first snap (12:00): 120 s.
check(a["pace"]["plays"] == 4 and a["pace"]["possSecs"] == 120, f'A pace {a["pace"]}')
check(b["pace"]["plays"] == 3, f'B pace {b["pace"]}')
check(b["pace"]["neutralPlays"] == 2, "blowout snap excluded from neutral count")
check(a["proe"]["plays"] == 4 and a["proe"]["passes"] == 3, f'A proe counts {a["proe"]}')
check(b["proe"]["plays"] == 2 and b["proe"]["passes"] == 0, f'B proe counts {b["proe"]}')
# Expected rate per team is the league rate in each bucket, so team residuals sum to zero.
check(abs((a["proe"]["passes"] - a["proe"]["expPasses"]) + (b["proe"]["passes"] - b["proe"]["expPasses"])) < 0.02,
      "PROE residuals balance across the league")
check(F.play_kind("Kickoff") is None and F.play_kind("Sack") == "pass" and F.play_kind("Rushing Touchdown") == "run"
      and F.play_kind("Penalty") is None and F.play_kind("Fumble Recovery (Own)") == "other", "play_kind")

print("ALL PASS" if not fails else f"{fails} FAILURE(S)")
sys.exit(1 if fails else 0)
