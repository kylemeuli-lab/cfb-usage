#!/usr/bin/env python3
"""
NFL fantasy outcomes for drafted WR/TE/RB, from nflverse's free public data on GitHub.

For each drafted player (CFBD draft picks, linked to nflverse through the ESPN id), his
half-PPR points per game in each NFL regular season, his positional rank by points per
game (8+ games), and whether he had a "starter" season in his first three NFL years:
top 24 WR, top 12 TE or top 24 RB.

    python nfl_outcomes.py        # downloads nflverse files, writes data/history/nfl-outcomes.json.gz
"""
from __future__ import annotations

import gzip
import io
import json
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

import pandas as pd

from prospect_features import _load, HIST, DRAFT_POS, FIRST, LAST

BASE = "https://github.com/nflverse/nflverse-data/releases/download"
STARTER = {"WR": 24, "TE": 12, "RB": 24}
MIN_GAMES = 8
CACHE = Path(__file__).resolve().parent / "data" / "cache" / "nflverse"


def fetch(rel: str) -> pd.DataFrame:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / rel.replace("/", "_")
    if not path.exists():
        with urllib.request.urlopen(f"{BASE}/{rel}", timeout=120) as r:
            path.write_bytes(r.read())
    return pd.read_csv(path, low_memory=False)


def weekly(last_season: int) -> pd.DataFrame:
    cols = ["player_id", "season", "week", "season_type", "receptions", "receiving_yards", "receiving_tds",
            "rushing_yards", "rushing_tds"]
    frames = [fetch("player_stats/player_stats.csv")[cols]]
    have = int(frames[0]["season"].max())
    for y in range(have + 1, last_season + 1):
        try:
            frames.append(fetch(f"stats_player/stats_player_week_{y}.csv")[cols])
        except Exception as e:
            print(f"  no weekly file for {y}: {e}")
    df = pd.concat(frames)
    df = df[df["season_type"] == "REG"].fillna(0)
    df["pts"] = 0.5 * df["receptions"] + 0.1 * (df["receiving_yards"] + df["rushing_yards"]) + \
        6 * (df["receiving_tds"] + df["rushing_tds"])
    return df


def main():
    players = fetch("players/players.csv")
    players = players[players["espn_id"].notna()]
    espn_to_gsis = {str(int(e)): g for e, g in zip(players["espn_id"], players["gsis_id"])}
    pos_of = dict(zip(players["gsis_id"], players["position"]))
    allp = fetch("players/players.csv")
    by_pick = {(int(y), int(k)): g for y, k, g in zip(allp["draft_year"], allp["draft_pick"], allp["gsis_id"])
               if pd.notna(y) and pd.notna(k)}
    pos_of.update(dict(zip(allp["gsis_id"], allp["position"])))
    wk = weekly(LAST)
    seasons = wk.groupby(["player_id", "season"]).agg(games=("week", "nunique"), pts=("pts", "sum")).reset_index()
    seasons["ppg"] = seasons["pts"] / seasons["games"]
    seasons["pos"] = seasons["player_id"].map(pos_of)
    # positional rank by points per game among 8+ game seasons
    q = seasons[(seasons["games"] >= MIN_GAMES) & seasons["pos"].isin(STARTER)].copy()
    q["rank"] = q.groupby(["season", "pos"])["ppg"].rank(ascending=False, method="first")
    rank = {(r.player_id, r.season): int(r.rank) for r in q.itertuples()}
    by_player = defaultdict(list)
    for r in seasons.itertuples():
        by_player[r.player_id].append(r)
    last_nfl = int(wk["season"].max())
    if wk[wk["season"] == last_nfl]["week"].max() < 17:   # season still in progress
        last_nfl -= 1
    seasons = seasons[seasons["season"] <= last_nfl]
    by_player = defaultdict(list)
    for r in seasons.itertuples():
        by_player[r.player_id].append(r)
    out, missing = [], []
    for y in range(FIRST + 1, LAST + 1):
        for d in _load(f"draft-{y}"):
            pos = DRAFT_POS.get(d["position"])
            if pos not in STARTER:
                continue
            gsis = by_pick.get((y, d["overall"])) or espn_to_gsis.get(str(d.get("collegeAthleteId")))
            if not gsis:
                missing.append((y, d["name"]))
                continue
            first3 = [s for s in by_player.get(gsis, []) if y <= s.season <= y + 2]
            rows = [{"season": int(s.season), "games": int(s.games), "ppg": round(float(s.ppg), 2),
                     "rank": rank.get((gsis, s.season))} for s in sorted(first3, key=lambda s: s.season)]
            ranks = [r["rank"] for r in rows if r["rank"]]
            out.append({
                "collegeId": str(d["collegeAthleteId"]), "name": d["name"], "pos": pos, "draft": y, "pick": d["overall"],
                "seasonsObserved": max(0, min(3, last_nfl - y + 1)), "first3": rows,
                "bestPpg": max([r["ppg"] for r in rows if r["games"] >= MIN_GAMES], default=None),
                "bestRank": min(ranks) if ranks else None,
                "hit": int(any(r <= STARTER[pos] for r in ranks)),
            })
    # Undrafted players who reached the NFL, linked through nflverse's ESPN id (the same
    # id CFBD uses in college). Their "first three" seasons start the year after college.
    drafted_ids = {p["collegeId"] for p in out}
    last_college = {}
    for y in range(FIRST, LAST + 1):
        for r in _load(f"player-stats-{y}"):
            last_college[r["playerId"]] = max(y, last_college.get(r["playerId"], 0))
    udfa = []
    for cid, gsis in espn_to_gsis.items():
        if cid in drafted_ids or cid not in last_college:
            continue
        pos = {"WR": "WR", "TE": "TE", "RB": "RB", "FB": "RB"}.get(pos_of.get(gsis))
        if not pos or gsis not in by_player:
            continue
        y = last_college[cid] + 1
        first3 = [s for s in by_player[gsis] if y <= s.season <= y + 2]
        rows = [{"season": int(s.season), "games": int(s.games), "ppg": round(float(s.ppg), 2),
                 "rank": rank.get((gsis, s.season))} for s in sorted(first3, key=lambda s: s.season)]
        ranks = [r["rank"] for r in rows if r["rank"]]
        udfa.append({"collegeId": cid, "name": None, "pos": pos, "draft": None, "pick": None, "nflYear": y,
                     "seasonsObserved": max(0, min(3, last_nfl - y + 1)), "first3": rows,
                     "bestPpg": max([r["ppg"] for r in rows if r["games"] >= MIN_GAMES], default=None),
                     "bestRank": min(ranks) if ranks else None, "hit": int(any(r <= STARTER[pos] for r in ranks))})
    out += udfa
    print(f"{len(udfa)} undrafted players who played NFL snaps, {sum(u['hit'] for u in udfa)} with a starter season")
    path = HIST / "nfl-outcomes.json.gz"
    with gzip.open(path, "wt", encoding="utf-8") as f:
        json.dump({"lastNflSeason": last_nfl, "players": out}, f, separators=(",", ":"))
    print(f"{len(out)} players linked ({len(missing)} drafted players not found in nflverse); NFL seasons through {last_nfl}.")
    full = [p for p in out if p["seasonsObserved"] == 3]
    for pos in STARTER:
        P = [p for p in full if p["pos"] == pos]
        print(f"  {pos}: {len(P)} with three NFL seasons, {sum(p['hit'] for p in P)} hit")


if __name__ == "__main__":
    main()
