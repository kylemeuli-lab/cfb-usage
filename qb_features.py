#!/usr/bin/env python3
"""
Season and career features for the QB Prospect Score, from the qb-* files in data/history/
(see history_backfill.py). Same record shape as prospect_features.careers(), so the
prospect model can treat QBs like any other position. No API calls.

College season rushing for QBs counts sacks (as college box scores do), so rushing numbers
here are box-score rushing.
"""
from __future__ import annotations

from collections import defaultdict
from functools import lru_cache

from fetch_cfb_stats import display_name
from prospect_features import FIRST, LAST, _f, _load, is_power, team_totals

STARTER_SHARE = 0.5   # a season as the main passer: half the team's attempts or more


def qb_season_rows(year):
    teams = team_totals(year)
    players = {}
    for r in _load(f"qb-stats-{year}"):
        if r["team"] not in teams:
            continue
        key = (r["playerId"], r["team"])
        p = players.setdefault(key, {"id": r["playerId"], "name": display_name(r["player"]), "pos": "QB", "team": r["team"],
                                     "conf": r.get("conference") or teams[r["team"]].get("conference"), "season": year})
        p[f"{r['category'][:3]}_{r['statType']}"] = _f(r["stat"])
    ppa = {(u["id"], u["team"]): u for u in _load(f"qb-ppa-{year}")}
    roster = {(r["id"], r["team"]): r for r in _load(f"qb-roster-{year}")}
    out = []
    for key, p in players.items():
        t = teams[p["team"]]
        g = t.get("games") or 1
        att, cmp_, yds = p.get("pas_ATT", 0), p.get("pas_COMPLETIONS", 0), p.get("pas_YDS", 0)
        td, ints = p.get("pas_TD", 0), p.get("pas_INT", 0)
        car, ryds, rtd = p.get("rus_CAR", 0), p.get("rus_YDS", 0), p.get("rus_TD", 0)
        team_att = max(t.get("passAttempts", 0), 1)
        team_ryds = max(t.get("rushingYards", 0), 1)
        team_rtd = t.get("rushingTDs", 0)
        pp, ro = ppa.get(key, {}), roster.get(key, {})
        ys = max(0.0, ryds / team_ryds)
        row = dict(p)
        row.update(
            games=g, power=is_power(p["conf"], p["team"], year), academy=int(p["team"] in ("Army", "Navy", "Air Force")),
            att=att, cmp=cmp_, pass_yds=yds, pass_td=td, int=ints, car=car, rush_yds=ryds, rush_td=rtd,
            att_share=att / team_att,
            ypa=yds / att if att else 0.0, cmp_pct=cmp_ / att if att else 0.0,
            td_rate=td / att if att else 0.0, int_rate=ints / att if att else 0.0,
            # adjusted yards per attempt: TDs worth 20 yards, interceptions cost 45
            anya=(yds + 20 * td - 45 * ints) / att if att else 0.0,
            pass_ypg=yds / g, rush_ypg=ryds / g, total_ypg=(yds + ryds) / g,
            qb_dom=(ys + (rtd / team_rtd if team_rtd else ys)) / 2,
            ppa_pass=_f((pp.get("averagePPA") or {}).get("pass")), ppa_rush=_f((pp.get("averagePPA") or {}).get("rush")),
            ppa_total=_f((pp.get("totalPPA") or {}).get("all")),
            height=_f(ro.get("height")) or None, weight=_f(ro.get("weight")) or None,
        )
        out.append(row)
    return out


@lru_cache(maxsize=None)
def qb_seasons():
    rows = []
    for y in range(FIRST, LAST + 1):
        rows += qb_season_rows(y)
    return rows


@lru_cache(maxsize=None)
def qb_recruits():
    """Player id -> best high school recruiting record, linked by athlete id, then by the
    recruit ids on his QB roster rows."""
    by_athlete, by_recruit = {}, {}
    for y in range(FIRST - 4, LAST + 1):
        for r in _load(f"recruits-{y}"):
            rec = {"class": r["year"], "stars": r.get("stars") or 0, "rating": _f(r.get("rating")) or None, "rpos": r.get("position")}
            by_recruit[str(r["id"])] = rec
            if r.get("athleteId"):
                by_athlete.setdefault(str(r["athleteId"]), rec)
    out = dict(by_athlete)
    for y in range(FIRST, LAST + 1):
        for ro in _load(f"qb-roster-{y}"):
            pid = str(ro["id"])
            if pid not in out:
                for rid in ro.get("recruitIds") or []:
                    if str(rid) in by_recruit:
                        out[pid] = by_recruit[str(rid)]
                        break
    return out


@lru_cache(maxsize=None)
def qb_roster_years():
    out = {}
    for y in range(FIRST, LAST + 1):
        fbs = team_totals(y)
        for r in _load(f"qb-roster-{y}"):
            if r.get("team") in fbs:
                out[str(r["id"])] = max(y, out.get(str(r["id"]), 0))
    return out


@lru_cache(maxsize=None)
def qb_drafted():
    d = {}
    for y in range(FIRST + 1, LAST + 1):
        for r in _load(f"qb-draft-{y}"):
            d[str(r["collegeAthleteId"])] = {"draft_year": y, "pick": r["overall"], "round": r["round"], "draft_pos": "QB",
                                             "nfl_team": r["nflTeam"], "draft_name": r["name"],
                                             "draft_ht": r.get("height"), "draft_wt": r.get("weight")}
    return d


CAREER_KEYS = ("att", "pass_yds", "pass_td", "int", "car", "rush_yds", "rush_td", "att_share", "ypa", "cmp_pct",
               "td_rate", "int_rate", "anya", "pass_ypg", "rush_ypg", "total_ypg", "qb_dom", "ppa_pass", "ppa_rush",
               "ppa_total", "power", "academy")


def qb_careers(through=LAST):
    by = defaultdict(list)
    for s in qb_seasons():
        if s["season"] <= through:
            by[s["id"]].append(s)
    dr, recs, rosters = qb_drafted(), qb_recruits(), qb_roster_years()
    out = []
    for pid, ss in by.items():
        per = {}
        for s in ss:   # one row per season: the team where he threw more
            if s["season"] not in per or s["att"] > per[s["season"]]["att"]:
                per[s["season"]] = s
        seasons = [per[y] for y in sorted(per)]
        last, n = seasons[-1], len(seasons)
        starts = [i for i, s in enumerate(seasons) if s["att_share"] >= STARTER_SHARE]
        rec = {
            "id": pid, "name": last["name"], "pos": "QB", "team": last["team"], "conf": last["conf"],
            "first_season": seasons[0]["season"], "last_season": last["season"], "n_seasons": n,
            "teams": len({s["team"] for s in seasons}), "power_last": last["power"],
            "starter_seasons": len(starts),
            "first_start_idx": (starts[0] + 1) if starts else None,   # 1 = his first season with stats
            "career_att": sum(s["att"] for s in seasons), "career_pass_yds": sum(s["pass_yds"] for s in seasons),
            "career_pass_td": sum(s["pass_td"] for s in seasons), "career_rush_yds": sum(s["rush_yds"] for s in seasons),
            "height": next((s["height"] for s in reversed(seasons) if s["height"]), None),
            "weight": next((s["weight"] for s in reversed(seasons) if s["weight"]), None),
            "seasons": seasons,
            # fields the shared pool code reads
            "rec_yds": 0, "last_rec_yds": 0,
        }
        att_all = rec["career_att"]
        rec["career_anya"] = ((rec["career_pass_yds"] + 20 * rec["career_pass_td"] - 45 * sum(s["int"] for s in seasons)) / att_all
                              if att_all else 0.0)
        for k in CAREER_KEYS:
            rec[f"last_{k}"] = last[k]
            # "best" rate stats only count seasons with real volume (100+ attempts), so a 5-for-5 cameo can't be his best
            vol = [s for s in seasons if s["att"] >= 100] or seasons
            rec[f"best_{k}"] = max(s[k] for s in (vol if k in ("ypa", "cmp_pct", "td_rate", "anya", "ppa_pass") else seasons))
        rc = recs.get(pid)
        rec["recruited"] = int(bool(rc and rc["rating"]))
        rec["stars"] = rc["stars"] if rc else 0
        rec["rating"] = rc["rating"] if rc and rc["rating"] else None
        rec["years_out"] = (last["season"] - rc["class"] + 1) if rc else None
        d = dr.get(pid)
        final = max(last["season"], min(rosters.get(pid, 0), through))
        if d:
            final = min(final, d["draft_year"] - 1)
        rec["final"] = final
        rec["sat_out"] = final > last["season"]
        if d:
            rec.update(d)
        out.append(rec)
    return out
