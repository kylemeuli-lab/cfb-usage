#!/usr/bin/env python3
"""
Player-season and career features for the prospect model (WR, TE, RB), built from
data/history/ (see history_backfill.py). No API calls.

    from prospect_features import load_seasons, careers
"""
from __future__ import annotations

import gzip
import json
from collections import defaultdict
from functools import lru_cache
from pathlib import Path

HIST = Path(__file__).resolve().parent / "data" / "history"
FIRST, LAST = 2014, 2026
POWER = {"SEC", "Big Ten", "Big 12", "ACC"}


def is_power(conf, team, year):
    """Power conference that season. The Pac-12 counts through 2023 (after that it was two
    teams, then a rebuilt league); Notre Dame counts as an independent."""
    return int(conf in POWER or (conf == "Pac-12" and year <= 2023) or team == "Notre Dame")
DRAFT_POS = {"Wide Receiver": "WR", "Tight End": "TE", "Running Back": "RB"}
# Season counts as a breakout when the share clears these lines.
BREAKOUT = {"WR": 0.20, "TE": 0.15, "RB": 0.20}


def _load(name):
    p = HIST / f"{name}.json.gz"
    return json.load(gzip.open(p)) if p.exists() else []


def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


@lru_cache(maxsize=None)
def team_totals(year):
    t = defaultdict(dict)
    for r in _load(f"team-stats-{year}"):
        t[r["team"]][r["statName"]] = _f(r["statValue"])
        t[r["team"]]["conference"] = r.get("conference")
    return dict(t)


def season_rows(year):
    """One row per FBS WR/TE/RB with receiving or rushing stats in `year`."""
    teams = team_totals(year)
    players = {}
    for r in _load(f"player-stats-{year}"):
        if r["team"] not in teams:
            continue  # FCS team, no team totals to share against
        key = (r["playerId"], r["team"])
        p = players.setdefault(key, {"id": r["playerId"], "name": r["player"], "pos": r["position"].upper(),
                                     "team": r["team"], "conf": r.get("conference") or teams[r["team"]].get("conference"),
                                     "season": year})
        p[f"{r['category'][:3]}_{r['statType']}"] = _f(r["stat"])
    usage = {(u["id"], u["team"]): u.get("usage") or {} for u in _load(f"usage-{year}")}
    ppa = {(u["id"], u["team"]): u for u in _load(f"ppa-{year}")}
    roster = {(r["id"], r["team"]): r for r in _load(f"roster-{year}")}
    out = []
    for key, p in players.items():
        t = teams[p["team"]]
        g = t.get("games") or 1
        rec_yds, rec_td, rec = p.get("rec_YDS", 0), p.get("rec_TD", 0), p.get("rec_REC", 0)
        car, ru_yds, ru_td = p.get("rus_CAR", 0), p.get("rus_YDS", 0), p.get("rus_TD", 0)
        pass_yds = max(t.get("netPassingYards", 0), 1)
        pass_td = max(t.get("passingTDs", 0), 1)
        pass_att = max(t.get("passAttempts", 0), 1)
        rush_att = max(t.get("rushingAttempts", 0), 1)
        rush_yds = max(t.get("rushingYards", 0), 1)
        tot_yds = max(t.get("totalYards", 0), 1)
        tot_td = max(t.get("passingTDs", 0) + t.get("rushingTDs", 0), 1)
        plays = pass_att + rush_att
        u, pp, ro = usage.get(key, {}), ppa.get(key, {}), roster.get(key, {})
        row = dict(p)
        row.update(
            games=g, power=is_power(p["conf"], p["team"], year),
            rec=rec, rec_yds=rec_yds, rec_td=rec_td, car=car, rush_yds=ru_yds, rush_td=ru_td,
            rec_yds_share=rec_yds / pass_yds, rec_td_share=rec_td / pass_td,
            yprr_team=rec_yds / pass_att,  # receiving yards per team pass attempt
            rec_share=rec / max(t.get("passCompletions", 0), 1),
            carry_share=car / rush_att, rush_yds_share=ru_yds / rush_yds,
            scrim_share=(rec_yds + ru_yds) / tot_yds, td_share=(rec_td + ru_td) / tot_td,
            scrim_per_play=(rec_yds + ru_yds) / plays,
            rec_ypg=rec_yds / g, scrim_ypg=(rec_yds + ru_yds) / g,
            academy=int(p["team"] in ("Army", "Navy", "Air Force")),
            ypc=ru_yds / car if car else 0.0, ypr=rec_yds / rec if rec else 0.0,
            usage_pass=_f(u.get("pass")), usage_rush=_f(u.get("rush")), usage_all=_f(u.get("overall")),
            ppa_pass=_f((pp.get("averagePPA") or {}).get("pass")), ppa_rush=_f((pp.get("averagePPA") or {}).get("rush")),
            ppa_total=_f((pp.get("totalPPA") or {}).get("all")),
            height=_f(ro.get("height")) or None, weight=_f(ro.get("weight")) or None,
        )
        row["dominator"] = (row["rec_yds_share"] + row["rec_td_share"]) / 2
        # RB: average of scrimmage-yard and TD shares of the offense.
        row["rb_dominator"] = (row["scrim_share"] + row["td_share"]) / 2
        out.append(row)
    return out


@lru_cache(maxsize=None)
def load_seasons(first=FIRST, last=LAST):
    rows = []
    for y in range(first, last + 1):
        rows += season_rows(y)
    return rows


@lru_cache(maxsize=None)
def drafted():
    d = {}
    for y in range(FIRST + 1, LAST + 1):
        for r in _load(f"draft-{y}"):
            pos = DRAFT_POS.get(r["position"], r["position"])
            d[str(r["collegeAthleteId"])] = {"draft_year": y, "pick": r["overall"], "round": r["round"],
                                             "draft_pos": pos, "nfl_team": r["nflTeam"], "draft_name": r["name"],
                                             "draft_ht": r.get("height"), "draft_wt": r.get("weight")}
    return d


def share_of(s, pos):
    return s["rb_dominator"] if pos == "RB" else s["dominator"]


def careers(through=LAST, pos_from_draft=True):
    """One record per player, built from seasons up to `through`.

    Season-level stats are merged across teams within a year (transfers mid-year are rare,
    but a player can appear under two teams across years). Position comes from the draft
    record when the player was drafted, otherwise the most recent stats position.
    """
    by = defaultdict(list)
    for s in load_seasons():
        if s["season"] <= through:
            by[s["id"]].append(s)
    dr = drafted()
    out = []
    for pid, ss in by.items():
        ss.sort(key=lambda s: (s["season"], s["rec_yds"] + s["rush_yds"]))
        # one row per season: keep the bigger team row if a player shows up twice
        per = {}
        for s in ss:
            if s["season"] not in per or (s["rec_yds"] + s["rush_yds"]) > (per[s["season"]]["rec_yds"] + per[s["season"]]["rush_yds"]):
                per[s["season"]] = s
        seasons = [per[y] for y in sorted(per)]
        d = dr.get(pid)
        pos = (d["draft_pos"] if d and pos_from_draft else seasons[-1]["pos"])
        if pos not in BREAKOUT:
            continue
        last = seasons[-1]
        n = len(seasons)
        sh = [share_of(s, pos) for s in seasons]
        best_i = max(range(n), key=lambda i: sh[i])
        bo = next((i for i, v in enumerate(sh) if v >= BREAKOUT[pos]), None)
        rec = {
            "id": pid, "name": last["name"], "pos": pos, "team": last["team"], "conf": last["conf"],
            "first_season": seasons[0]["season"], "last_season": last["season"], "n_seasons": n,
            "teams": len({s["team"] for s in seasons}), "power_last": last["power"],
            "best_share": sh[best_i], "last_share": sh[-1], "best_season_idx": best_i + 1,
            "breakout_idx": (bo + 1) if bo is not None else None,  # 1 = first season with stats
            "breakout_age": (n - bo) if bo is not None else 0,  # seasons from breakout to the end, incl. it
            "career_rec_yds": sum(s["rec_yds"] for s in seasons), "career_rush_yds": sum(s["rush_yds"] for s in seasons),
            "career_td": sum(s["rec_td"] + s["rush_td"] for s in seasons),
            "height": next((s["height"] for s in reversed(seasons) if s["height"]), None),
            "weight": next((s["weight"] for s in reversed(seasons) if s["weight"]), None),
            "seasons": seasons,
        }
        for k in ("dominator", "rb_dominator", "rec_yds_share", "rec_td_share", "yprr_team", "rec_share",
                  "carry_share", "rush_yds_share", "scrim_share", "td_share", "scrim_per_play", "ypc", "ypr",
                  "usage_pass", "usage_rush", "usage_all", "ppa_pass", "ppa_rush", "ppa_total", "rec_yds",
                  "rush_yds", "rec", "car", "power", "rec_ypg", "scrim_ypg", "academy"):
            rec[f"last_{k}"] = last[k]
            rec[f"best_{k}"] = max(s[k] for s in seasons)
        if d:
            rec.update(d)
        out.append(rec)
    return out
