#!/usr/bin/env python3
"""
fetch_cfb_stats.py: weekly college football skill-player stats pipeline.

Pulls one week of data from the CollegeFootballData (CFBD) API, derives
targets from play-by-play, computes usage metrics, and writes JSON for the
dashboard.

API calls per run (CFBD free tier has a monthly limit):
  /calendar      only when --week is omitted (auto-detect)
  /games         1
  /games/players 1
  /plays         1   (whole week; targets, pace and PROE all come from it)
  /rankings      1
  /roster        1 per season, then served from data/cache/

Usage:
  export CFBD_API_KEY=your_key
  python fetch_cfb_stats.py                       # auto-detect latest completed week
  python fetch_cfb_stats.py --week 6 --year 2026
  python fetch_cfb_stats.py --week 1 --season-type postseason
  python fetch_cfb_stats.py --offline-dir tests/fixtures   # no network, for testing

Outputs:
  week_stats.json                      latest week (what the dashboard loads first)
  data/weeks/<year>-<type>-w<NN>.json  archive copy of every week
  data/weeks/index.json                list of archived weeks for the week picker
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import requests

API_BASE = "https://api.collegefootballdata.com"
ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
CACHE_DIR = DATA_DIR / "cache"
WEEKS_DIR = DATA_DIR / "weeks"

AP_POLL_NAME = "AP Top 25"

# How many players of each position group to keep per team.
POSITION_LIMITS = {"QB": 2, "RB": 2, "WR": 4, "TE": 2}
WR_MIN = 3                 # always show at least 3 WRs (if they recorded a stat)
WR4_MIN_TARGETS = 2        # 4th WR only shown if he drew at least this many targets

POSITION_MAP = {
    "QB": "QB", "RB": "RB", "TB": "RB", "HB": "RB", "FB": "RB",
    "WR": "WR", "SB": "WR", "FL": "WR", "SE": "WR",
    "TE": "TE", "H": "TE",
}


# --------------------------------------------------------------------------- #
# API client
# --------------------------------------------------------------------------- #
class CFBDClient:
    """Thin wrapper around requests with retries, plus an offline fixture mode."""

    def __init__(self, api_key: str | None, offline_dir: Path | None = None):
        self.offline_dir = offline_dir
        self.calls = 0
        self.session = requests.Session()
        if api_key:
            self.session.headers["Authorization"] = f"Bearer {api_key}"
        self.session.headers["Accept"] = "application/json"

    def get(self, path: str, timeout: int = 90, **params):
        params = {k: v for k, v in params.items() if v is not None}
        if self.offline_dir:
            return self._offline(path)

        url = f"{API_BASE}{path}"
        for attempt in range(4):
            self.calls += 1
            resp = self.session.get(url, params=params, timeout=timeout)
            if resp.status_code == 429 or resp.status_code >= 500:
                wait = 5 * (attempt + 1)
                print(f"  {path}: HTTP {resp.status_code}, retrying in {wait}s", file=sys.stderr)
                time.sleep(wait)
                continue
            if resp.status_code == 401:
                sys.exit("CFBD API returned 401 Unauthorized. Check CFBD_API_KEY.")
            resp.raise_for_status()
            return resp.json()
        resp.raise_for_status()
        return None

    def _offline(self, path: str):
        f = self.offline_dir / (path.strip("/").replace("/", "_") + ".json")
        if not f.exists():
            raise FileNotFoundError(f"offline fixture missing: {f}")
        return json.loads(f.read_text())


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}


def norm_name(name: str) -> str:
    """'Ja'Marr Chase Jr.' -> 'jamarr chase'"""
    s = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode()
    s = s.lower().replace(".", " ").replace("'", "").replace("’", "")
    s = re.sub(r"[^a-z ]", " ", s)
    parts = [p for p in s.split() if p not in _SUFFIXES]
    return " ".join(parts)


_SUFFIX_FIX = {"jr": "Jr.", "sr": "Sr.", "ii": "II", "iii": "III", "iv": "IV", "v": "V"}


def display_name(name: str | None) -> str | None:
    """Fix the case of a trailing suffix: 'Omar Mabson Ii' -> 'Omar Mabson II', 'Chad Elzy Jr' -> 'Chad Elzy Jr.'"""
    if not name:
        return name
    parts = name.strip().split()
    if len(parts) > 1:
        key = parts[-1].rstrip(".").lower()
        if key in _SUFFIX_FIX and (key != "v" or parts[-1] in ("V", "v")):
            parts[-1] = _SUFFIX_FIX[key]
    return " ".join(parts)


def short_key(name: str) -> str | None:
    """First initial + last name, used to match 'J.Smith' style play text."""
    parts = norm_name(name).split()
    if len(parts) < 2:
        return None
    return f"{parts[0][0]} {parts[-1]}"


def to_num(v, default=0):
    try:
        if v in (None, "", "--"):
            return default
        f = float(v)
        return int(f) if f.is_integer() else f
    except (TypeError, ValueError):
        return default


def pct(n, d):
    return round(100.0 * n / d, 1) if d else None


# --------------------------------------------------------------------------- #
# Week detection
# --------------------------------------------------------------------------- #
def default_year(now: datetime) -> int:
    # January games (bowls / playoff) belong to the previous season.
    return now.year - 1 if now.month < 3 else now.year


def detect_week(client: CFBDClient, year: int, now: datetime) -> tuple[int, str]:
    """
    Most recent week whose last game has kicked off. Games still in progress are
    skipped by the completed-games filter and picked up by the later Sunday run.
    (A 5-hour buffer here made the 08:00 UTC run re-pull the previous week whenever
    a West Coast game kicked off after ~03:00 UTC, which is most weeks.)
    A week also counts once its Saturday slate is over (Sunday 07:00 UTC), even if
    the calendar lists a stray later game (a postponed game or a long date range
    would otherwise hold the week back until the next one).
    """
    def parse(s):
        return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None

    cal = client.get("/calendar", year=year) or []
    done = []
    for w in cal:
        first = parse(w.get("firstGameStart") or w.get("startDate"))
        last = parse(w.get("lastGameStart") or w.get("endDate"))
        if not first and not last:
            continue
        ready = bool(last and last <= now)
        if not ready and first:
            sat = (first + timedelta(days=(5 - first.weekday()) % 7)).replace(hour=0, minute=0, second=0, microsecond=0)
            ready = now >= sat + timedelta(hours=31)
        if ready:
            done.append((first or last, w))
    if not done:
        sys.exit(f"No {year} weeks have finished yet; pass --week explicitly.")
    _, w = max(done, key=lambda x: x[0])
    print(f"Auto-detected week {w['week']} ({w.get('seasonType', 'regular')}): "
          f"first game {w.get('firstGameStart') or w.get('startDate')}, last game {w.get('lastGameStart') or w.get('endDate')}")
    return int(w["week"]), w.get("seasonType", "regular")


# --------------------------------------------------------------------------- #
# Roster (cached per season)
# --------------------------------------------------------------------------- #
def load_team_abbrs(client: CFBDClient, year: int, refresh: bool) -> dict:
    """{school: abbreviation} from /teams, one call per season (cached). Never fatal."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache = CACHE_DIR / f"teams_{year}.json"
    if cache.exists() and not refresh and not client.offline_dir:
        return json.loads(cache.read_text())
    try:
        rows = client.get("/teams", year=year) or []
    except Exception as e:  # offline fixture missing, API hiccup: fall back to full names
        print(f"  WARNING: team abbreviations unavailable ({type(e).__name__}); using team names", flush=True)
        return {}
    abbrs = {r["school"]: r["abbreviation"] for r in rows if r.get("school") and r.get("abbreviation")}
    if not client.offline_dir:
        cache.write_text(json.dumps(abbrs, separators=(",", ":")))
    return abbrs


def load_roster(client: CFBDClient, year: int, refresh: bool) -> dict:
    """Returns {'by_id': {id: pos}, 'by_name': {(team, normname): pos}}."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache = CACHE_DIR / f"roster_{year}.json"
    if cache.exists() and not refresh and not client.offline_dir:
        rows = json.loads(cache.read_text())
    else:
        rows = client.get("/roster", year=year) or []
        slim = [
            {"id": r.get("id"), "team": r.get("team"), "position": r.get("position"),
             "firstName": r.get("firstName"), "lastName": r.get("lastName")}
            for r in rows
        ]
        if not client.offline_dir:
            cache.write_text(json.dumps(slim, separators=(",", ":")))
        rows = slim

    by_id, by_name, by_team = {}, {}, defaultdict(list)
    for r in rows:
        full = f"{r.get('firstName') or ''} {r.get('lastName') or ''}".strip()
        pos = POSITION_MAP.get((r.get("position") or "").upper())
        if full and r.get("id") is not None:
            by_team[r.get("team")].append({"player_id": str(r["id"]), "name": full})
        if not pos:
            continue
        if r.get("id") is not None:
            by_id[str(r["id"])] = pos
        by_name[(r.get("team"), norm_name(full))] = pos
    return {"by_id": by_id, "by_name": by_name, "by_team": by_team}


# --------------------------------------------------------------------------- #
# Targets from play-by-play
# --------------------------------------------------------------------------- #
# Matches ESPN-style play text, e.g.
#   "Carson Beck pass complete to Dillon Bell for 12 yds"
#   "C.Beck pass incomplete to D.Bell, broken up by X"
#   "Beck pass intercepted by Y, intended for Bell"
# A name is a run of capitalized tokens ("Dillon Bell", "D.Bell", "Ja'Tavion Sanders",
# "Tyler Booker Jr."), ending at the first lowercase word ("for", "broken", ...).
_NAME = r"(?P<name>[A-Z][\w.'’\-]*(?:\s+(?:[A-Z][\w.'’\-]*|Jr\.?|Sr\.?))*)"
# NCAA feeds add pass direction and jersey numbers:
#   "#7 M.Washington pass complete short left to #13 C.Durr Jr. caught at UMD30"
_DIR = r"(?:\s+(?:short|deep))?(?:\s+(?:left|middle|right))?"
_JERSEY = r"(?:#\d+\s+)?"
_INTENDED_RE = re.compile(r"intended for\s+" + _JERSEY + _NAME)
_RECEIVER_RE = re.compile(r"pass (?:complete|completed|incomplete)" + _DIR + r"\s+to\s+" + _JERSEY + _NAME)
# ESPN scoring summary: "Cam Abshire 8 Yd pass from Kalieb Osborne (Jack O'Connor Kick)"
_TD_FROM_RE = re.compile(r"^\s*" + _NAME + r"\s+\d+\s+Yd\s+pass\s+from\b")
_NO_PLAY_RE = re.compile(r"\bno play\b", re.I)


def extract_receiver(text: str) -> str | None:
    if not text or "pass" not in text.lower():
        return None
    if _NO_PLAY_RE.search(text):
        return None
    m = _INTENDED_RE.search(text) or _RECEIVER_RE.search(text) or _TD_FROM_RE.search(text)
    return m.group("name").strip().rstrip(".") if m else None


def report_parse_misses(plays: list[dict], show: int = 5):
    """Print pass plays whose receiver couldn't be read, so the parser can be tuned."""
    pass_plays = [p for p in plays if "pass" in (p.get("playType") or "").lower()
                  or "interception" in (p.get("playType") or "").lower()]
    missed = [p for p in pass_plays if not extract_receiver(p.get("playText") or "")]
    print(f"  {len(pass_plays)} pass plays, receiver identified on {len(pass_plays) - len(missed)}")
    if plays and not pass_plays:
        types = Counter(p.get("playType") for p in plays).most_common(12)
        print(f"  WARNING: no pass plays recognized. Play types seen: {types}")
    for p in missed[:show]:
        print(f"    unparsed [{p.get('playType')}]: {p.get('playText')}")


def count_targets(plays: list[dict]) -> dict:
    """{(gameId, offenseTeam): Counter({raw_receiver_name: targets})}"""
    out: dict = defaultdict(Counter)
    for p in plays:
        ptype = (p.get("playType") or "").lower()
        if "sack" in ptype or "rush" in ptype or "penalty" == ptype:
            continue
        if "pass" not in ptype and "interception" not in ptype:
            continue
        rec = extract_receiver(p.get("playText") or "")
        if rec:
            out[(p.get("gameId"), p.get("offense"))][rec] += 1
    return out


# --------------------------------------------------------------------------- #
# Team tempo and pass rate over expected (from the same play-by-play)
# --------------------------------------------------------------------------- #
NEUTRAL_MARGIN = 7          # "neutral" = score within this many points


def play_kind(ptype: str) -> str | None:
    """'pass', 'run', 'other' (a snap we can't call either way), or None (not a snap)."""
    t = (ptype or "").lower()
    if not t or "penalty" in t or "timeout" in t or "end of" in t or "kickoff" in t \
            or "punt" in t or "field goal" in t or "extra point" in t or "two point" in t \
            or "2pt" in t or "safety" in t or "uncategorized" in t or "end period" in t:
        return None
    if "pass" in t or "interception" in t or "sack" in t:
        return "pass"
    if "rush" in t:
        return "run"
    if "fumble" in t:
        return "other"
    return None


def _clock_secs(p) -> int | None:
    c = p.get("clock")
    if not isinstance(c, dict):
        return None
    m, s = c.get("minutes"), c.get("seconds")
    if m is None or s is None:
        return None
    return int(m) * 60 + int(s)


def _dist_bucket(d) -> str:
    d = to_num(d, None)
    if d is None:
        return "?"
    return "1-3" if d <= 3 else "4-6" if d <= 6 else "7-10" if d <= 10 else "11+"


def _zone(ytg) -> str:
    y = to_num(ytg, None)
    if y is None:
        return "?"
    return "own" if y > 80 else "mid" if y > 40 else "opp" if y > 20 else "rz"


def _neutral(p) -> bool:
    os_, ds = to_num(p.get("offenseScore"), None), to_num(p.get("defenseScore"), None)
    per = to_num(p.get("period"), 0)
    return os_ is not None and ds is not None and abs(os_ - ds) <= NEUTRAL_MARGIN and 1 <= per <= 4


def _game_secs(p) -> int | None:
    """Elapsed regulation game time at this play, in seconds (None in overtime)."""
    c, per = _clock_secs(p), to_num(p.get("period"), 0)
    if c is None or not 1 <= per <= 4:
        return None
    return (per - 1) * 900 + (900 - c)


def team_play_metrics(plays: list[dict]) -> dict:
    """
    {(gameId, offense): {"pace": {...}, "proe": {...}}} from play-by-play.

    Pace = possession time / offensive snaps (runs, passes incl. sacks, fumbled snaps).
    CFBD's play clock is only reliable at drive boundaries (most plays repeat the
    drive's start time), so possession time is measured per drive: from the drive's
    first play to the next drive's first play, or to the end of the quarter for the
    last drive before halftime/the end of regulation. Overtime is left out. Neutral pace
    uses only drives that started with the score within 7.

    PROE: on 1st/2nd down with the score within 7 (quarters 1-4), the team's pass rate
    minus the rate expected from down, distance and field position. "Expected" is the
    pass rate of every offense this week in the same situation bucket. Scrambles show
    up as runs in play-by-play, so a scrambling QB's team reads a bit run-heavier than
    it called.
    """
    by_game: dict = defaultdict(list)
    for i, p in enumerate(plays):
        by_game[p.get("gameId")].append((i, p))

    def order(item):
        i, p = item
        return (to_num(p.get("driveNumber"), 0), to_num(p.get("playNumber"), 0), i)

    acc: dict = defaultdict(lambda: {"snaps": 0, "nsnaps": 0, "secs": 0, "secSnaps": 0, "nsecs": 0, "nsecSnaps": 0})
    situ = []                                          # (key, bucket, is_pass)
    base: dict = defaultdict(lambda: [0, 0])           # bucket -> [passes, snaps]

    for gid, items in by_game.items():
        items.sort(key=order)
        drives: dict = {}                              # driveId -> {"n", "start", "last_per", "snaps": [plays]}
        for _, p in items:
            did = p.get("driveId")
            d = drives.setdefault(did, {"n": to_num(p.get("driveNumber"), 0), "start": None, "last_per": 0, "snaps": []})
            t = _game_secs(p)
            if t is not None and (d["start"] is None or t < d["start"]):
                d["start"] = t
            d["last_per"] = max(d["last_per"], to_num(p.get("period"), 0))
            kind = play_kind(p.get("playType"))
            if kind:
                d["snaps"].append((p, kind))
        seq = sorted(drives.values(), key=lambda d: d["n"])
        for j, d in enumerate(seq):
            if not d["snaps"]:
                continue
            offense = Counter(p.get("offense") for p, _ in d["snaps"]).most_common(1)[0][0]
            key = (gid, offense)
            a = acc[key]
            first = d["snaps"][0][0]
            drive_neutral = _neutral(first)
            for p, kind in d["snaps"]:
                if p.get("offense") != offense:
                    continue
                neutral = _neutral(p)
                a["snaps"] += 1
                a["nsnaps"] += neutral
                down = to_num(p.get("down"), 0)
                if kind in ("pass", "run") and down in (1, 2) and neutral:
                    b = (down, _dist_bucket(p.get("distance")), _zone(p.get("yardsToGoal")))
                    base[b][0] += kind == "pass"
                    base[b][1] += 1
                    situ.append((key, b, kind == "pass"))
            # Drive length: to the next drive's start, capped at the end of its half.
            if d["start"] is None or d["last_per"] > 4:
                continue
            half_end = 1800 if d["start"] < 1800 else 3600
            nxt = next((x["start"] for x in seq[j + 1:] if x["start"] is not None), None)
            end = min(nxt, half_end) if nxt is not None and nxt >= d["start"] else half_end
            dur = end - d["start"]
            n = sum(1 for p, _ in d["snaps"] if p.get("offense") == offense)
            if 0 <= dur <= 900 and n:
                a["secs"] += dur
                a["secSnaps"] += n
                if drive_neutral:
                    a["nsecs"] += dur
                    a["nsecSnaps"] += n

    out: dict = {}
    proe_acc: dict = defaultdict(lambda: [0, 0, 0.0])  # key -> [plays, passes, expected passes]
    for key, b, is_pass in situ:
        passes, n = base[b]
        pa = proe_acc[key]
        pa[0] += 1
        pa[1] += is_pass
        pa[2] += passes / n
    for key, a in acc.items():
        pa = proe_acc.get(key, [0, 0, 0.0])
        out[key] = {
            "pace": {
                "plays": a["snaps"],
                "possSecs": a["secs"],
                "secPerPlay": round(a["secs"] / a["secSnaps"], 1) if a["secSnaps"] >= 10 else None,
                "neutralPlays": a["nsnaps"],
                "neutralSecPerPlay": round(a["nsecs"] / a["nsecSnaps"], 1) if a["nsecSnaps"] >= 10 else None,
            },
            "proe": {
                "plays": pa[0],
                "passes": pa[1],
                "expPasses": round(pa[2], 2),
                "passRate": pct(pa[1], pa[0]) if pa[0] else None,
                "expRate": round(100 * pa[2] / pa[0], 1) if pa[0] else None,
                "proe": round(100 * (pa[1] - pa[2]) / pa[0], 1) if pa[0] >= 10 else None,
            },
        }
    return out


def team_play_splits(plays: list[dict]) -> dict:
    """
    {(gameId, offense): {"passPlays", "passYds", "passEpa", "runPlays", "runYds", "runEpa"}}.

    Pass plays include sacks and interceptions (dropbacks); runs are designed rushes,
    so QB scrambles count as runs, as in play-by-play. Yards are yardsGained; EPA is
    CFBD's ppa (expected points added), summed. A team's defense allowed whatever its
    opponent's offense produced. Overtime is left out.
    """
    out: dict = defaultdict(lambda: {"passPlays": 0, "passYds": 0, "passEpa": 0.0, "passEpaPlays": 0,
                                     "runPlays": 0, "runYds": 0, "runEpa": 0.0, "runEpaPlays": 0,
                                     "sacks": 0, "sackYds": 0})
    for p in plays:
        kind = play_kind(p.get("playType"))
        if kind not in ("pass", "run"):
            continue
        a = out[(p.get("gameId"), p.get("offense"))]
        if "sack" in (p.get("playType") or "").lower():
            # Sacks count against the passer's rushing line in college box scores; keep them
            # (all periods, as in the box score) so QB rushing can be shown net of sacks.
            a["sacks"] += 1
            a["sackYds"] += to_num(p.get("yardsGained"), 0)
            m = re.match(r"\s*(.+?)\s+sacked\b", p.get("playText") or "", re.I)
            if m:
                by = a.setdefault("sackBy", {})
                n = by.setdefault(m.group(1), [0, 0])
                n[0] += 1
                n[1] += to_num(p.get("yardsGained"), 0)
        if not 1 <= to_num(p.get("period"), 0) <= 4:
            continue
        a[f"{kind}Plays"] += 1
        a[f"{kind}Yds"] += to_num(p.get("yardsGained"), 0)
        ppa = to_num(p.get("ppa"), None)
        if ppa is not None:
            a[f"{kind}Epa"] += ppa
            a[f"{kind}EpaPlays"] += 1
    for a in out.values():
        a["passEpa"] = round(a["passEpa"], 2)
        a["runEpa"] = round(a["runEpa"], 2)
    return dict(out)


def attach_sacks(team: dict) -> None:
    """
    Give each passer his sacks: player["rushing"]["sacks"] / ["sackYds"] (yards, negative).
    College box scores fold sacks into the passer's rushing line, so a QB's real rushing
    is car - sacks and yds - sackYds. Play text names the passer ("X sacked by Y");
    names that don't match a passer go to the team's leading passer. The name map is
    dropped from the splits afterwards (it was only needed here).
    """
    sp = team.get("offenseSplits") or {}
    by = sp.pop("sackBy", None) or {}
    if not sp.get("sacks"):
        return
    passers = [p for p in team["players"] if (p.get("passing") or {}).get("att")]
    if not passers:
        return
    lead = max(passers, key=lambda p: p["passing"]["att"])
    keys = {}
    for p in passers:
        keys[norm_name(p["name"])] = p
        sk = short_key(p["name"])
        if sk:
            keys.setdefault(sk, p)
    got = {}
    for raw, (n, yds) in by.items():
        nn = norm_name(raw)
        who = keys.get(nn) or keys.get(short_key(raw) or "") or lead
        g = got.setdefault(who["id"], [who, 0, 0])
        g[1] += n
        g[2] += yds
    left = sp["sacks"] - sum(g[1] for g in got.values())
    if left > 0:
        g = got.setdefault(lead["id"], [lead, 0, 0])
        g[1] += left
        g[2] += sp["sackYds"] - sum(x[2] for x in got.values())
    for who, n, yds in got.values():
        r = who.get("rushing") or {"car": 0, "yds": 0, "td": 0, "long": 0}
        r["sacks"], r["sackYds"] = n, yds
        who["rushing"] = r


UNMATCHED_LOG: Counter = Counter()


def match_targets(raw: Counter, box_players: list[dict], roster_players: list[dict]):
    """
    Map play-text receiver names onto player ids.

    Candidates are box-score players plus the team roster, so receivers who were
    targeted but never caught a pass (absent from the box score) still get credit.
    Returns ({player_id: targets}, {player_id: name for roster-only players}, unmatched).
    """
    box_ids = {p["player_id"] for p in box_players}
    cands = list(box_players) + [p for p in roster_players if p["player_id"] not in box_ids]

    full = defaultdict(set)
    short_all, short_box, last_all = defaultdict(set), defaultdict(set), defaultdict(set)
    for p in cands:
        nn = norm_name(p["name"])
        full[nn].add(p["player_id"])
        sk = short_key(p["name"])
        if sk:
            short_all[sk].add(p["player_id"])
            if p["player_id"] in box_ids:
                short_box[sk].add(p["player_id"])
        if nn:
            last_all[nn.split()[-1]].add(p["player_id"])

    def unique(s):
        return next(iter(s)) if len(s) == 1 else None

    names = {p["player_id"]: p["name"] for p in cands}
    result, unmatched = Counter(), 0
    for raw_name, n in raw.items():
        nn = norm_name(raw_name)
        pid = unique(full.get(nn, set()))
        sk = short_key(raw_name)
        if pid is None and sk:
            # "J.Smith": exactly one J. Smith on the roster; otherwise exactly one
            # J. Smith who recorded a stat in this game. Still ambiguous -> unassigned.
            pid = unique(short_all.get(sk, set())) or unique(short_box.get(sk, set()))
        if pid is None and nn and len(nn.split()) == 1:
            pid = unique(last_all.get(nn, set()))
        if pid is None:
            unmatched += n
            UNMATCHED_LOG[raw_name] += n
        else:
            result[pid] += n
    extra = {pid: names[pid] for pid in result if pid not in box_ids}
    return dict(result), extra, unmatched


# --------------------------------------------------------------------------- #
# Box scores -> per-player DataFrame
# --------------------------------------------------------------------------- #
STAT_COLUMNS = {
    ("passing", "C/ATT"): None,  # split into cmp / att below
    ("passing", "YDS"): "pass_yds",
    ("passing", "TD"): "pass_td",
    ("passing", "INT"): "pass_int",
    ("rushing", "CAR"): "car",
    ("rushing", "YDS"): "rush_yds",
    ("rushing", "TD"): "rush_td",
    ("rushing", "LONG"): "rush_long",
    ("receiving", "REC"): "rec",
    ("receiving", "YDS"): "rec_yds",
    ("receiving", "TD"): "rec_td",
    ("receiving", "LONG"): "rec_long",
}
NUM_COLS = ["cmp", "att", "pass_yds", "pass_td", "pass_int", "car", "rush_yds",
            "rush_td", "rush_long", "rec", "rec_yds", "rec_td", "rec_long"]


def box_to_frame(player_stats: list[dict]) -> pd.DataFrame:
    rows = []
    for game in player_stats:
        gid = game.get("id")
        for t in game.get("teams", []):
            team = t.get("team")
            for cat in t.get("categories", []):
                cname = (cat.get("name") or "").lower()
                for typ in cat.get("types", []):
                    tname = (typ.get("name") or "").upper()
                    if (cname, tname) not in STAT_COLUMNS:
                        continue
                    for a in typ.get("athletes", []):
                        base = {"game_id": gid, "team": team,
                                "player_id": str(a.get("id")), "name": display_name(a.get("name"))}
                        stat = a.get("stat")
                        if (cname, tname) == ("passing", "C/ATT"):
                            c, _, att = str(stat).partition("/")
                            rows.append({**base, "col": "cmp", "val": to_num(c)})
                            rows.append({**base, "col": "att", "val": to_num(att)})
                        else:
                            rows.append({**base, "col": STAT_COLUMNS[(cname, tname)],
                                         "val": to_num(stat)})
    if not rows:
        return pd.DataFrame(columns=["game_id", "team", "player_id", "name", *NUM_COLS])
    long = pd.DataFrame(rows)
    wide = (long.pivot_table(index=["game_id", "team", "player_id", "name"],
                             columns="col", values="val", aggfunc="sum")
                .reset_index())
    for c in NUM_COLS:
        if c not in wide:
            wide[c] = 0
    wide[NUM_COLS] = wide[NUM_COLS].fillna(0)
    return wide


def is_team_row(name: str, pid: str) -> bool:
    return (name or "").strip().lower() in {"team", "team team"} or str(pid).startswith("-")


def assign_position(row, team: str, roster: dict) -> str:
    pos = roster["by_id"].get(str(row.player_id)) or roster["by_name"].get((team, norm_name(row.name)))
    if pos:
        return pos
    # Fallback when roster has no match: infer from usage.
    if row.att >= 3:
        return "QB"
    if row.car > row.rec:
        return "RB"
    return "WR"


# --------------------------------------------------------------------------- #
# Main processing
# --------------------------------------------------------------------------- #
def build_team(team_name, team_df, raw_targets, roster, game_info, side, ap_ranks, abbrs=None):
    df = team_df.copy()
    # Explicit bool dtype: on an empty frame (a team with no box-score rows) an
    # untyped mask would select columns instead of rows.
    df["is_team"] = pd.Series([is_team_row(n, p) for n, p in zip(df["name"], df["player_id"])],
                              index=df.index, dtype=bool)
    players = df[~df["is_team"]].copy()

    # Team totals (TEAM rows included: kneel-downs, etc. count toward offense).
    pass_yds = int(df["pass_yds"].sum())
    rush_yds = int(df["rush_yds"].sum())
    total_yds = pass_yds + rush_yds

    players["pos"] = [assign_position(r, team_name, roster) for r in players.itertuples()]
    players = players.reset_index(drop=True)

    # Targets.
    tgt_map, extra, unmatched = match_targets(
        raw_targets or Counter(),
        players[["player_id", "name"]].to_dict("records"),
        roster["by_team"].get(team_name, []),
    )
    if extra:  # targeted but no catches/carries: add zero-stat rows
        add = pd.DataFrame([{"player_id": pid, "name": nm, **{c: 0 for c in NUM_COLS}}
                            for pid, nm in extra.items()])
        add["pos"] = [assign_position(r, team_name, roster) for r in add.itertuples()]
        players = pd.concat([players, add], ignore_index=True)
    targets_source = "pbp" if raw_targets else "receptions"
    players["tgt"] = players["player_id"].map(tgt_map).fillna(0).astype(int)
    if targets_source == "pbp":
        # A catch is always a target; guards against name-matching misses.
        players["tgt"] = players[["tgt", "rec"]].max(axis=1).astype(int)
    else:
        players["tgt"] = players["rec"].astype(int)
    if targets_source == "pbp":
        # Every parsed target counts toward the team total, including ones whose
        # receiver name was ambiguous (e.g. two "J.Smith"s), so shares stay honest.
        team_targets = max(int(sum(raw_targets.values())), int(players["tgt"].sum()))
    else:
        team_targets = int(players["tgt"].sum())
    team_rec = int(players["rec"].sum())
    team_rec_yds = int(players["rec_yds"].sum())
    team_rec_td = int(players["rec_td"].sum())

    non_qb_carries = int(players.loc[players["pos"] != "QB", "car"].sum())
    team_carries = int(df["car"].sum())

    # Pick players per position group.
    selected = []
    for pos, limit in POSITION_LIMITS.items():
        grp = players[players["pos"] == pos].copy()
        if pos == "QB":
            grp = grp[grp["att"] > 0].sort_values(["att", "pass_yds"], ascending=False)
        elif pos == "RB":
            grp["touches"] = grp["car"] + grp["rec"]
            grp = grp[grp["touches"] > 0].sort_values(["car", "rush_yds"], ascending=False)
        else:
            grp = grp[(grp["tgt"] > 0) | (grp["rec"] > 0)].sort_values(
                ["tgt", "rec_yds"], ascending=False)
        grp = grp.head(limit)
        if pos == "WR" and len(grp) > WR_MIN:
            keep = [i < WR_MIN or t >= WR4_MIN_TARGETS for i, t in enumerate(grp["tgt"])]
            grp = grp[keep]
        selected.append(grp)
    sel = pd.concat(selected) if selected else players.head(0)
    featured_ids = set(sel["player_id"])

    # Keep every player who touched the ball; "featured" marks the core group shown
    # by default (top QBs/RBs/WRs/TEs). Full lists feed leaderboards and defense context.
    everyone = players[(players["att"] > 0) | (players["car"] > 0) | (players["rec"] > 0) | (players["tgt"] > 0)].copy()
    everyone["is_featured"] = everyone["player_id"].isin(featured_ids)
    everyone["pos_order"] = everyone["pos"].map({"QB": 0, "RB": 1, "WR": 2, "TE": 3}).fillna(4)
    everyone["usage_score"] = everyone["att"] * 2 + everyone["car"] + everyone["tgt"] * 1.5 + everyone["rec"]
    everyone = everyone.sort_values(["pos_order", "is_featured", "usage_score"], ascending=[True, False, False])

    by_pos = {}
    for pos in ("QB", "RB", "WR", "TE"):
        grp = everyone[everyone["pos"] == pos]
        by_pos[pos] = {"players": int(len(grp)), "tgt": int(grp["tgt"].sum()), "rec": int(grp["rec"].sum()),
                       "recYds": int(grp["rec_yds"].sum()), "recTd": int(grp["rec_td"].sum()),
                       "car": int(grp["car"].sum()), "rushYds": int(grp["rush_yds"].sum()),
                       "rushTd": int(grp["rush_td"].sum())}

    out_players = []
    for r in everyone.itertuples():
        scrimmage = int(r.rush_yds + r.rec_yds)
        # Dominator rating: average of his share of team receiving yards and receiving
        # TDs. With no receiving TDs by the team, it falls back to the yards share.
        rys = pct(r.rec_yds, team_rec_yds) if r.pos != "QB" and (r.rec > 0 or r.tgt > 0) and team_rec_yds > 0 else None
        rts = pct(r.rec_td, team_rec_td) if rys is not None and team_rec_td > 0 else None
        dom = max(0.0, round((rys + rts) / 2, 1) if rts is not None else rys) if rys is not None else None
        responsible = int(r.pass_yds + r.rush_yds + (r.rec_yds if r.pos != "QB" else 0))
        p = {
            "id": r.player_id,
            "name": r.name,
            "pos": r.pos,
            "featured": bool(r.is_featured),
            "passing": {"cmp": int(r.cmp), "att": int(r.att), "yds": int(r.pass_yds),
                        "td": int(r.pass_td), "int": int(r.pass_int)} if r.att > 0 else None,
            "rushing": {"car": int(r.car), "yds": int(r.rush_yds), "td": int(r.rush_td),
                        "long": int(r.rush_long)} if r.car > 0 else None,
            "receiving": {"rec": int(r.rec), "tgt": int(r.tgt), "yds": int(r.rec_yds),
                          "td": int(r.rec_td), "long": int(r.rec_long)} if (r.rec > 0 or r.tgt > 0) else None,
            "metrics": {
                # QB: share of team total yards he accounted for (pass + rush).
                # Others: scrimmage yards (rush + rec) as share of team total yards.
                "yds_pct": pct(responsible if r.pos == "QB" else scrimmage, total_yds),
                "tgt_share": pct(r.tgt, team_targets) if r.pos != "QB" else None,
                "carry_share": pct(r.car, non_qb_carries) if r.pos == "RB" else None,
                "ypc": round(r.rush_yds / r.car, 1) if r.car else None,
                "ypt": round(r.rec_yds / r.tgt, 1) if r.tgt and r.pos != "QB" else None,
                "ypa": round(r.pass_yds / r.att, 1) if r.att else None,
                "rec_yds_share": rys,
                "rec_td_share": rts,
                "dominator": dom,
            },
        }
        out_players.append(p)

    g = game_info
    return {
        "name": team_name,
        "id": g.get(f"{side}Id"),
        "conference": g.get(f"{side}Conference"),
        "classification": g.get(f"{side}Classification"),
        "points": g.get(f"{side}Points"),
        "lineScores": g.get(f"{side}LineScores"),
        "apRank": ap_ranks.get(team_name),
        "abbr": (abbrs or {}).get(team_name),
        "totals": {
            "passYds": pass_yds, "rushYds": rush_yds, "totalYds": total_yds,
            "targets": team_targets, "receptions": team_rec,
            "recYds": team_rec_yds, "recTd": team_rec_td,
            "carries": team_carries, "nonQbCarries": non_qb_carries,
            "unmatchedTargets": unmatched if targets_source == "pbp" else 0,
            # Offensive production by position (all players). The opponent's byPos is
            # what this team's defense allowed.
            "byPos": by_pos,
        },
        "targetsSource": targets_source,
        "players": out_players,
    }


def fetch_plays(client, year, week, season_type, games) -> tuple[list, str | None]:
    """
    Whole-week play-by-play in one call; if that fails or comes back empty, fall back
    to one call per conference (deduped by play id). Never fatal: on total failure the
    run continues with reception share.
    """
    try:
        plays = client.get("/plays", timeout=300, year=year, week=week, seasonType=season_type) or []
        if plays:
            return plays, None
        first_err = "whole-week request returned no plays"
    except Exception as e:
        first_err = f"whole-week request failed: {type(e).__name__}: {e}"
    print(f"  WARNING: {first_err}; retrying by conference", flush=True)

    confs = sorted({g.get(f"{side}Conference") for g in games for side in ("home", "away")} - {None})
    seen, plays, errors = set(), [], []
    for conf in confs:
        try:
            chunk = client.get("/plays", timeout=300, year=year, week=week,
                               seasonType=season_type, conference=conf) or []
        except Exception as e:
            errors.append(f"{conf}: {type(e).__name__}: {e}")
            continue
        for p in chunk:
            if p.get("id") not in seen:
                seen.add(p.get("id"))
                plays.append(p)
    print(f"  conference fallback: {len(plays)} plays from {len(confs)} conferences, "
          f"{len(errors)} failed", flush=True)
    for e in errors[:5]:
        print(f"    {e}", flush=True)
    if plays:
        return plays, None
    return [], first_err + (f"; conference retries failed ({errors[0]})" if errors else "; conference retries returned nothing")


def get_ap_ranks(client, year, week, season_type) -> tuple[dict, int | None]:
    """AP ranks in effect for this week's games: {school: rank}, poll week used."""
    polls = client.get("/rankings", year=year, seasonType=season_type) or []
    if not polls and season_type != "regular":
        polls = client.get("/rankings", year=year, seasonType="regular") or []
        week = 99
    candidates = []
    for pw in polls:
        for poll in pw.get("polls", []):
            if poll.get("poll") == AP_POLL_NAME and to_num(pw.get("week")) <= week:
                candidates.append((to_num(pw.get("week")), poll))
    if not candidates:
        return {}, None
    wk, poll = max(candidates, key=lambda x: x[0])
    return {r["school"]: r["rank"] for r in poll.get("ranks", [])}, wk


def run(args) -> dict:
    api_key = os.environ.get("CFBD_API_KEY")
    offline = Path(args.offline_dir) if args.offline_dir else None
    if not api_key and not offline:
        sys.exit("Set CFBD_API_KEY (free key at https://collegefootballdata.com/key).")
    client = CFBDClient(api_key, offline)

    now = datetime.now(timezone.utc)
    year = args.year or default_year(now)
    if args.week:
        week, season_type = args.week, args.season_type
    else:
        week, season_type = detect_week(client, year, now)
    print(f"Season {year}, {season_type} week {week}")

    games = client.get("/games", year=year, week=week, seasonType=season_type) or []
    games = [g for g in games if g.get("completed")]
    print(f"  {len(games)} completed games")

    box = client.get("/games/players", year=year, week=week, seasonType=season_type) or []
    box_df = box_to_frame(box)

    plays, pbp_error = fetch_plays(client, year, week, season_type, games)
    targets = count_targets(plays)
    tempo = team_play_metrics(plays)
    splits = team_play_splits(plays)
    if plays:
        print(f"  play fields: {sorted(plays[0].keys())}")
    print(f"  {len(plays)} plays fetched, targets found for {len(targets)} team-games")
    report_parse_misses(plays)

    ap_ranks, ap_week = get_ap_ranks(client, year, week, season_type)
    roster = load_roster(client, year, args.refresh_roster)
    abbrs = load_team_abbrs(client, year, args.refresh_roster)

    out_games = []
    for g in sorted(games, key=lambda x: x.get("startDate") or ""):
        gid = g["id"]
        gdf = box_df[box_df["game_id"] == gid]
        if gdf.empty:
            continue
        teams = {}
        for side in ("home", "away"):
            name = g[f"{side}Team"]
            tdf = gdf[gdf["team"] == name]
            teams[side] = build_team(name, tdf, targets.get((gid, name)), roster, g, side, ap_ranks, abbrs)
            tm = tempo.get((gid, name), {})
            teams[side]["pace"] = tm.get("pace")
            teams[side]["proe"] = tm.get("proe")
            teams[side]["offenseSplits"] = splits.get((gid, name))
            attach_sacks(teams[side])
        # Each defense allowed what the other side's offense produced.
        teams["home"]["defenseSplits"] = teams["away"].get("offenseSplits")
        teams["away"]["defenseSplits"] = teams["home"].get("offenseSplits")
        hp, ap_ = g.get("homePoints") or 0, g.get("awayPoints") or 0
        out_games.append({
            "id": gid,
            "startDate": g.get("startDate"),
            "venue": g.get("venue"),
            "neutralSite": g.get("neutralSite"),
            "conferenceGame": g.get("conferenceGame"),
            "excitement": g.get("excitementIndex"),
            "home": teams["home"],
            "away": teams["away"],
            "winner": "home" if hp > ap_ else "away" if ap_ > hp else None,
            "apGame": bool(teams["home"]["apRank"] or teams["away"]["apRank"]),
            "fbsGame": "fbs" in {teams["home"]["classification"], teams["away"]["classification"]},
        })

    if UNMATCHED_LOG:
        total = sum(UNMATCHED_LOG.values())
        print(f"  {total} targets with ambiguous/unknown receiver; most common: "
              f"{UNMATCHED_LOG.most_common(8)}")
    conferences = sorted({t["conference"] for g in out_games for t in (g["home"], g["away"])
                          if t["conference"]})
    pbp_teams = sum(1 for g in out_games for t in (g["home"], g["away"]) if t["targetsSource"] == "pbp")
    result = {
        "meta": {
            "season": year,
            "week": week,
            "seasonType": season_type,
            "apPollWeek": ap_week,
            "generatedAt": now.isoformat(timespec="seconds"),
            "gameCount": len(out_games),
            "teamsWithPbpTargets": pbp_teams,
            "teamsTotal": len(out_games) * 2,
            "apiCalls": client.calls,
            "pbpError": pbp_error,
            "sample": bool(args.sample),
        },
        "teamAbbrs": abbrs,
        "conferences": conferences,
        "games": out_games,
    }
    return result


def build_history(season: int, season_type: str) -> Path | None:
    """
    Compact per-player usage by week for one season, built from the archived week
    files. The dashboard uses it for season context ("season high", "up from his
    18% average") and week-over-week leaderboard movement.

    Shape: {"season", "seasonType", "weeks": [...],
            "players": {id: {"n": name, "t": team, "p": pos,
                             "w": {week: [tgt, tgtShare, car, carryShare, ydsPct, rec, recYds, rushYds,
                                          recTd, dominator,
                                          passAtt, passCmp, passYds, passTd, int, rushTd, sacks, sackYds]}}},
            "teams": {name: {"c": conference, "a": abbr, "k": classification,
                             "w": {week: [plays, secPerPlay, neutralPlays, neutralSecPerPlay,
                                          proePlays, passes, expPasses, recYds, recTd, opponent,
                                          defense allowed: passPlays, passYds, passEpa, runPlays,
                                          runYds, runEpa, opponentClassification,
                                          rushYds, rushTd, sacks, sackYds, passAtt]}}}}
    Rushing yards (player and team) are box-score yards, which include sacks; sacks and
    sackYds (negative) let the site show QB and team rushing net of sacks.
    """
    files = sorted(WEEKS_DIR.glob(f"{season}-{season_type}-w*.json"))
    if not files:
        return None
    players, teams, weeks = {}, {}, []
    for f in files:
        d = json.loads(f.read_text())
        if d["meta"].get("sample"):
            continue
        wk = d["meta"]["week"]
        weeks.append(wk)
        for g in d["games"]:
            for side in ("home", "away"):
                t = g[side]
                opp = g["away" if side == "home" else "home"]["name"]
                pace, proe = t.get("pace") or {}, t.get("proe") or {}
                te = teams.setdefault(t["name"], {"c": t.get("conference"), "a": t.get("abbr"), "w": {}})
                te.update({"c": t.get("conference"), "a": t.get("abbr") or te.get("a"), "k": t.get("classification")})
                ds = t.get("defenseSplits") or {}
                os_ = t.get("offenseSplits")
                opp_k = g["away" if side == "home" else "home"].get("classification")
                te["w"][str(wk)] = [pace.get("plays"), pace.get("secPerPlay"), pace.get("neutralPlays"),
                                    pace.get("neutralSecPerPlay"), proe.get("plays"), proe.get("passes"),
                                    proe.get("expPasses"), t["totals"].get("recYds"), t["totals"].get("recTd"), opp,
                                    ds.get("passPlays"), ds.get("passYds"), ds.get("passEpa"),
                                    ds.get("runPlays"), ds.get("runYds"), ds.get("runEpa"), opp_k,
                                    t["totals"].get("rushYds"),
                                    sum((v or {}).get("rushTd", 0) for v in (t["totals"].get("byPos") or {}).values()),
                                    (os_ or {}).get("sacks"), (os_ or {}).get("sackYds"),
                                    sum((pl.get("passing") or {}).get("att", 0) for pl in t["players"])]
                for pl in t["players"]:
                    rec = pl.get("receiving") or {}
                    rush = pl.get("rushing") or {}
                    pas = pl.get("passing") or {}
                    m = pl["metrics"]
                    entry = players.setdefault(pl["id"], {"n": pl["name"], "t": t["name"], "p": pl["pos"], "w": {}})
                    entry.update({"n": pl["name"], "t": t["name"], "p": pl["pos"]})
                    entry["w"][str(wk)] = [rec.get("tgt", 0), m.get("tgt_share"), rush.get("car", 0),
                                           m.get("carry_share"), m.get("yds_pct"), rec.get("rec", 0),
                                           rec.get("yds", 0), rush.get("yds", 0), rec.get("td", 0),
                                           m.get("dominator"),
                                           pas.get("att", 0), pas.get("cmp", 0), pas.get("yds", 0), pas.get("td", 0),
                                           pas.get("int", 0), rush.get("td", 0), rush.get("sacks", 0),
                                           rush.get("sackYds", 0)]
    out = WEEKS_DIR / f"history-{season}-{season_type}.json"
    out.write_text(json.dumps({"season": season, "seasonType": season_type, "weeks": sorted(weeks),
                               "players": players, "teams": teams}, separators=(",", ":")))
    build_defense(season, season_type, teams, sorted(weeks))
    return out


DEF_FIELDS = ("passEpa", "runEpa", "passYpp", "runYpp")


def defense_ranks(teams: dict, through: int) -> dict:
    """
    {team: [passEpa, runEpa, passYpp, runYpp, ranks..., games]} for FBS defenses, using
    games through week `through` against FBS offenses only. Lower allowed = better = rank 1.
    EPA/play is the expected points the offense added per play; yards/play counts sacks
    as pass plays.
    """
    vals, plays = {}, {}
    for name, te in teams.items():
        if te.get("k") != "fbs":
            continue
        tot = [0, 0, 0.0, 0, 0, 0.0]          # passPlays, passYds, passEpa, runPlays, runYds, runEpa
        games = 0
        for w, a in te["w"].items():
            if int(w) > through or len(a) < 17 or a[16] != "fbs" or not a[10]:
                continue
            games += 1
            for i in range(6):
                tot[i] += a[10 + i] or 0
        if not games or not tot[0] or not tot[3]:
            continue
        vals[name] = [tot[2] / tot[0], tot[5] / tot[3], tot[1] / tot[0], tot[4] / tot[3], games]
        plays[name] = (tot[0], tot[3])
    out = {}
    for name, v in vals.items():
        out[name] = [round(x, 3) for x in v[:4]] + [None] * 4 + [v[4]] + [None] * 4
    for i in range(4):
        for r, name in enumerate(sorted(vals, key=lambda n: vals[n][i]), start=1):
            out[name][4 + i] = r
    # Overall: each side's allowed rate as a z-score against FBS, weighted by how often
    # FBS offenses pass vs. run in these games. Lower = better, like the parts.
    if len(vals) >= 2:
        pass_plays = sum(p for p, _ in plays.values())
        all_plays = sum(p + r for p, r in plays.values())
        w = pass_plays / all_plays if all_plays else 0.5
        for col, (pi, ri) in ((9, (0, 1)), (10, (2, 3))):       # 9 = EPA, 10 = yards/play
            zs = {}
            for i in (pi, ri):
                xs = [vals[n][i] for n in vals]
                mu = sum(xs) / len(xs)
                sd = (sum((x - mu) ** 2 for x in xs) / len(xs)) ** 0.5 or 1
                zs[i] = {n: (vals[n][i] - mu) / sd for n in vals}
            for n in vals:
                out[n][col] = round(w * zs[pi][n] + (1 - w) * zs[ri][n], 3)
            for r, n in enumerate(sorted(vals, key=lambda n: out[n][col]), start=1):
                out[n][col + 2] = r
    return out


def build_defense(season: int, season_type: str, teams: dict, weeks: list) -> Path | None:
    """
    data/weeks/defense-<season>-<type>.json: FBS defensive ranks against the pass and
    the run, by EPA/play and yards/play allowed.
      "in"[week]  = ranks going into that week (games through the week before),
      "season"    = ranks through the latest week,
      "games"     = what each defense allowed in each game (for "that game" tooltips).
    Row layout: [passEpa, runEpa, passYpp, runYpp, passEpaRank, runEpaRank, passYppRank, runYppRank, games,
                 overallEpa, overallYpp, overallEpaRank, overallYppRank]. Overall = pass and run z-scores
                 weighted by the FBS pass/run play mix (lower = better).
    """
    if not weeks:
        return None
    last = max(weeks)
    games = {}
    for name, te in teams.items():
        if te.get("k") != "fbs":
            continue
        g = {}
        for w, a in te["w"].items():
            if len(a) >= 17 and a[10]:
                pp, py, pe, rp, ry, re_ = a[10:16]
                g[w] = [a[9], a[16], round(pe / pp, 3) if pp else None, round(re_ / rp, 3) if rp else None,
                        round(py / pp, 2) if pp else None, round(ry / rp, 2) if rp else None]
        games[name] = g
    data = {"season": season, "seasonType": season_type, "through": last,
            "fields": ["passEpa", "runEpa", "passYpp", "runYpp", "passEpaRank", "runEpaRank",
                       "passYppRank", "runYppRank", "games", "overallEpa", "overallYpp",
                       "overallEpaRank", "overallYppRank"],
            "gameFields": ["opponent", "opponentClass", "passEpa", "runEpa", "passYpp", "runYpp"],
            "in": {str(w): defense_ranks(teams, w - 1) for w in range(2, last + 2)},
            "season": defense_ranks(teams, last),
            "games": games}
    out = WEEKS_DIR / f"defense-{season}-{season_type}.json"
    out.write_text(json.dumps(data, separators=(",", ":")))
    return out


def write_outputs(result: dict, out_path: Path, archive: bool = True):
    m = result["meta"]
    payload = json.dumps({k: v for k, v in result.items() if k != "teamAbbrs"}, separators=(",", ":"))
    if m["gameCount"] == 0:
        print("No completed games with stats for this week; nothing written.")
        return
    if not archive:
        out_path.write_text(payload)
        print(f"Wrote {out_path}")
        return

    WEEKS_DIR.mkdir(parents=True, exist_ok=True)
    fname = f"{m['season']}-{m['seasonType']}-w{m['week']:02d}.json"
    (WEEKS_DIR / fname).write_text(payload)

    idx_path = WEEKS_DIR / "index.json"
    idx = json.loads(idx_path.read_text()) if idx_path.exists() else []
    if not m["sample"]:  # first real run: drop the bundled sample week(s)
        for w in idx:
            if w.get("sample"):
                (ROOT / w["file"]).unlink(missing_ok=True)
        idx = [w for w in idx if not w.get("sample")]
    rel = f"data/weeks/{fname}"
    idx = [w for w in idx if w["file"] not in (rel, fname)]
    seen = set()  # also clears any duplicates left by older versions
    idx = [w for w in idx if not (w["file"] in seen or seen.add(w["file"]))]
    idx.append({"season": m["season"], "seasonType": m["seasonType"], "week": m["week"],
                "file": f"data/weeks/{fname}", "games": m["gameCount"],
                "generatedAt": m["generatedAt"], "sample": m["sample"]})
    order = {"regular": 0, "postseason": 1}
    idx.sort(key=lambda w: (w["season"], order.get(w["seasonType"], 0), w["week"]), reverse=True)
    idx_path.write_text(json.dumps(idx, indent=1))
    if result.get("teamAbbrs"):  # season-wide lookup so older week files get abbreviations too
        (WEEKS_DIR / f"teams-{m['season']}.json").write_text(json.dumps(result["teamAbbrs"], indent=0, sort_keys=True))
    build_history(m["season"], m["seasonType"])

    # week_stats.json is the dashboard's "Latest week": only replace it when this run
    # is the newest week archived, so backfilling old weeks doesn't bump it.
    newest = idx[0]["file"] == f"data/weeks/{fname}"
    if newest:
        out_path.write_text(payload)
    print(f"Wrote {'%s and ' % out_path.name if newest else ''}data/weeks/{fname} "
          f"({m['gameCount']} games, {m['teamsWithPbpTargets']}/{m['teamsTotal']} teams with PBP targets, "
          f"{m['apiCalls']} API calls)")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--year", type=int, help="Season year (default: current season)")
    ap.add_argument("--week", type=int, help="Week number (default: latest week that has started)")
    ap.add_argument("--season-type", default="regular", choices=["regular", "postseason"])
    ap.add_argument("--out", default=str(ROOT / "week_stats.json"))
    ap.add_argument("--refresh-roster", action="store_true", help="Ignore cached roster")
    ap.add_argument("--offline-dir", help=argparse.SUPPRESS)
    ap.add_argument("--sample", action="store_true", help=argparse.SUPPRESS)
    ap.add_argument("--no-archive", action="store_true", help="Only write --out; skip data/weeks/")
    ap.add_argument("--rebuild-history", action="store_true",
                    help="Rebuild data/weeks/history-*.json from archived weeks (no API calls) and exit")
    args = ap.parse_args(argv)
    if args.rebuild_history:
        idx = json.loads((WEEKS_DIR / "index.json").read_text()) if (WEEKS_DIR / "index.json").exists() else []
        for season, stype in sorted({(w["season"], w["seasonType"]) for w in idx}):
            print("Wrote", build_history(season, stype))
        return
    result = run(args)
    write_outputs(result, Path(args.out), archive=not args.no_archive)


if __name__ == "__main__":
    main()
