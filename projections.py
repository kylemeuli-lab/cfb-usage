#!/usr/bin/env python3
"""
Half-PPR projections for FBS WR, TE and RB: next week and rest of season.

Built from the weekly game files in data/weeks/ (no API calls), plus the season schedule
(one call, `fetch-schedule`). For each player:

    targets  = team targets a game x his target share      (recent games count more)
    carries  = team RB carries a game x his carry share
    catches, yards and TDs = volume x his rates, each pulled toward the position average
                             until he has enough volume to trust his own number
    opponent = his rates are scaled by how many yards per play the opponent allows
               against the pass or the run, compared with the FBS average

    points = 0.5 per catch + 0.1 per rushing/receiving yard + 6 per TD

Projections assume he plays; players who missed their team's last game are flagged.

    python projections.py backtest          # weeks 3+ scored with only earlier data
    CFBD_API_KEY=... python projections.py fetch-schedule
    python projections.py build             # writes data/premium/projections-<year>.json
"""
from __future__ import annotations

import glob
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WEEKS = ROOT / "data" / "weeks"
PREMIUM = ROOT / "data" / "premium"
POS = ("WR", "TE", "RB")
SCORING = {"rec": 0.5, "yd": 0.1, "td": 6.0}

# Tuned on the 2026 back-test (see `backtest`).
P = {
    "decay": 0.9,        # weight per game back for shares and team volume
    "k_catch": 25,        # targets of prior for catch rate
    "k_ypt": 40,          # targets of prior for yards per target
    "k_rtd": 80,         # targets of prior for receiving TD rate
    "k_ypc": 60,          # carries of prior for yards per carry
    "k_rutd": 80,        # carries of prior for rushing TD rate
    "k_def": 200,         # plays of prior for a defense's yards per play allowed
    "def_weight": 0.3,    # how much of the opponent adjustment to apply
    "line_td": 0.5,       # TD rates scale with (implied team points / usual points) ** this
    "line_yd": 0.3,       # yards scale with the same ratio ** this
    "k_pts": 3,           # games of prior (league average) for a team's usual points
}


def load_lines(year):
    """(week, team) -> implied points from the betting spread and total."""
    path = WEEKS / f"lines-{year}-regular.json"
    out = {}
    if not path.exists():
        return out
    for r in json.loads(path.read_text()):
        home = (r["total"] - r["spread"]) / 2   # spread is from the home side: -7 = home favored by 7
        out[(r["week"], r["home"])] = home
        out[(r["week"], r["away"])] = r["total"] - home
    return out


# ---------------------------------------------------------------- loading
def season_files(year: int, season_type="regular"):
    files = sorted(glob.glob(str(WEEKS / f"{year}-{season_type}-w*.json")))
    return [(int(re.search(r"-w(\d+)\.json$", f).group(1)), f) for f in files]


def load_games(year: int, season_type="regular"):
    """Flatten the week files into team-games and player-games."""
    team_games, player_games = [], []
    for week, f in season_files(year, season_type):
        d = json.load(open(f))
        for g in d.get("games", []):
            for side, other in (("home", "away"), ("away", "home")):
                t, o = g[side], g[other]
                tot = t.get("totals") or {}
                split = t.get("offenseSplits") or {}
                tg = {
                    "week": week, "team": t["name"], "opp": o["name"], "fbs": t.get("classification") == "fbs",
                    "opp_fbs": o.get("classification") == "fbs", "tgt": tot.get("targets") or 0,
                    "pts": t.get("points") or 0,
                    "rb_car": (tot.get("byPos") or {}).get("RB", {}).get("car", 0),
                    "pass_plays": split.get("passPlays"), "pass_yds": split.get("passYds"),
                    "run_plays": split.get("runPlays"), "run_yds": split.get("runYds"),
                }
                team_games.append(tg)
                for p in t.get("players", []):
                    if p.get("pos") not in POS:
                        continue
                    r, ru = p.get("receiving") or {}, p.get("rushing") or {}
                    player_games.append({
                        "week": week, "id": str(p["id"]), "name": p["name"], "pos": p["pos"], "team": t["name"],
                        "opp": o["name"], "tgt": r.get("tgt") or 0, "rec": r.get("rec") or 0, "rec_yds": r.get("yds") or 0,
                        "rec_td": r.get("td") or 0, "car": ru.get("car") or 0, "rush_yds": ru.get("yds") or 0,
                        "rush_td": ru.get("td") or 0,
                    })
    return team_games, player_games


def points(rec, yds, td):
    return SCORING["rec"] * rec + SCORING["yd"] * yds + SCORING["td"] * td


def actual_points(pg):
    return points(pg["rec"], pg["rec_yds"] + pg["rush_yds"], pg["rec_td"] + pg["rush_td"])


# ---------------------------------------------------------------- model
class Model:
    """Everything needed to project games after week `through`."""

    def __init__(self, team_games, player_games, through: int, params=None, lines=None):
        self.p = dict(P, **(params or {}))
        self.lines = lines or {}
        tg = [g for g in team_games if g["week"] <= through]
        pg = [g for g in player_games if g["week"] <= through]
        self.through = through
        self.team_log = defaultdict(list)
        for g in sorted(tg, key=lambda g: g["week"]):
            self.team_log[g["team"]].append(g)
        self.player_log = defaultdict(list)
        for g in sorted(pg, key=lambda g: g["week"]):
            self.player_log[g["id"]].append(g)
        self._priors(pg)
        self._defense(tg)
        fbs_pts = [g["pts"] for g in tg if g["fbs"]]
        self.avg_pts = sum(fbs_pts) / len(fbs_pts) if fbs_pts else 28.0

    def _priors(self, pg):
        self.prior = {}
        for pos in POS:
            rows = [g for g in pg if g["pos"] == pos]
            tgt = sum(g["tgt"] for g in rows) or 1
            car = sum(g["car"] for g in rows) or 1
            self.prior[pos] = {
                "catch": sum(g["rec"] for g in rows) / tgt, "ypt": sum(g["rec_yds"] for g in rows) / tgt,
                "rtd": sum(g["rec_td"] for g in rows) / tgt, "ypc": sum(g["rush_yds"] for g in rows) / car,
                "rutd": sum(g["rush_td"] for g in rows) / car,
            }

    def _defense(self, tg):
        """Yards per pass / run play each FBS defense allows to FBS offenses, shrunk to the average."""
        allowed = defaultdict(lambda: [0, 0, 0, 0])
        tot = [0, 0, 0, 0]
        vs_fcs = [0, 0, 0, 0]
        for g in tg:
            if not g["fbs"] or g["pass_plays"] is None:
                continue
            row = (g["pass_plays"] or 0, g["pass_yds"] or 0, g["run_plays"] or 0, g["run_yds"] or 0)
            if g["opp_fbs"]:
                a = allowed[g["opp"]]
                for i in range(4):
                    a[i] += row[i]
                    tot[i] += row[i]
            else:
                for i in range(4):
                    vs_fcs[i] += row[i]
        self.avg_pass = tot[1] / max(tot[0], 1)
        self.avg_run = tot[3] / max(tot[2], 1)
        k = self.p["k_def"]
        self.def_factor = {}
        for team, a in allowed.items():
            fp = ((a[1] + k * self.avg_pass) / (a[0] + k)) / self.avg_pass
            fr = ((a[3] + k * self.avg_run) / (a[2] + k)) / self.avg_run
            self.def_factor[team] = (fp, fr)
        # FBS offenses against FCS defenses: one shared factor
        self.fcs_factor = ((vs_fcs[1] / max(vs_fcs[0], 1)) / self.avg_pass if vs_fcs[0] else 1.3,
                           (vs_fcs[3] / max(vs_fcs[2], 1)) / self.avg_run if vs_fcs[2] else 1.3)

    def opp_factor(self, opp):
        f = self.def_factor.get(opp)
        if f is None:
            f = self.fcs_factor
        w = self.p["def_weight"]
        return (1 + w * (f[0] - 1), 1 + w * (f[1] - 1))

    def _wmean(self, values):
        """Recency-weighted mean, newest last."""
        d = self.p["decay"]
        n = len(values)
        ws = [d ** (n - 1 - i) for i in range(n)]
        return sum(w * v for w, v in zip(ws, values)) / sum(ws) if ws else 0.0

    def usage(self, pid):
        """Recency-weighted target and carry shares over the player's games, plus team volume."""
        log = self.player_log.get(pid)
        if not log:
            return None
        team = log[-1]["team"]
        tlog = {g["week"]: g for g in self.team_log.get(team, [])}
        games = [g for g in log if g["team"] == team and g["week"] in tlog]
        if not games:
            return None
        d = self.p["decay"]
        n = len(games)
        ws = [d ** (n - 1 - i) for i in range(n)]
        tt = sum(w * tlog[g["week"]]["tgt"] for w, g in zip(ws, games))
        tc = sum(w * tlog[g["week"]]["rb_car"] for w, g in zip(ws, games))
        ts = sum(w * g["tgt"] for w, g in zip(ws, games)) / tt if tt else 0.0
        car_src = [g["car"] if g["pos"] == "RB" else 0 for g in games]
        cs = sum(w * c for w, c in zip(ws, car_src)) / tc if tc else 0.0
        team_games = list(tlog.values())
        return {
            "team": team, "pos": log[-1]["pos"], "name": log[-1]["name"], "games": n,
            "tshare": ts, "cshare": cs,
            "team_tgt": self._wmean([g["tgt"] for g in team_games]),
            "team_car": self._wmean([g["rb_car"] for g in team_games]),
            "missed_last": bool(team_games) and team_games[-1]["week"] != log[-1]["week"],
            "other_car": sum(g["car"] for g in games if g["pos"] != "RB") / n,  # WR/TE jet sweeps
        }

    def rates(self, pid, pos):
        log = self.player_log.get(pid, [])
        pr, p = self.prior[pos], self.p
        tgt = sum(g["tgt"] for g in log); car = sum(g["car"] for g in log)
        return {
            "catch": (sum(g["rec"] for g in log) + p["k_catch"] * pr["catch"]) / (tgt + p["k_catch"]),
            "ypt": (sum(g["rec_yds"] for g in log) + p["k_ypt"] * pr["ypt"]) / (tgt + p["k_ypt"]),
            "rtd": (sum(g["rec_td"] for g in log) + p["k_rtd"] * pr["rtd"]) / (tgt + p["k_rtd"]),
            "ypc": (sum(g["rush_yds"] for g in log) + p["k_ypc"] * pr["ypc"]) / (car + p["k_ypc"]),
            "rutd": (sum(g["rush_td"] for g in log) + p["k_rutd"] * pr["rutd"]) / (car + p["k_rutd"]),
        }

    def usual_points(self, team):
        log = self.team_log.get(team, [])
        k = self.p["k_pts"]
        return (sum(g["pts"] for g in log) + k * self.avg_pts) / (len(log) + k)

    def line_factor(self, team, week):
        imp = self.lines.get((week, team)) if week is not None else None
        return 1.0 if imp is None else max(0.4, min(2.0, imp / self.usual_points(team)))

    def project(self, pid, opp, week=None):
        u = self.usage(pid)
        if not u:
            return None
        r = self.rates(pid, u["pos"])
        fp, fr = self.opp_factor(opp)
        lf = self.line_factor(u["team"], week)
        u["implied"] = self.lines.get((week, u["team"])) if week is not None else None
        ly, lt = lf ** self.p["line_yd"], lf ** self.p["line_td"]
        tgt = u["team_tgt"] * u["tshare"]
        car = u["team_car"] * u["cshare"] if u["pos"] == "RB" else u["other_car"]
        rec = tgt * r["catch"]
        rec_yds = tgt * r["ypt"] * fp * ly
        rush_yds = car * r["ypc"] * fr * ly
        td = (tgt * r["rtd"] * fp + car * r["rutd"] * fr) * lt
        return {**u, "opp": opp, "tgt": tgt, "car": car, "rec": rec, "rec_yds": rec_yds, "rush_yds": rush_yds,
                "td": td, "pts": points(rec, rec_yds + rush_yds, td), "fp": fp, "fr": fr}


# ---------------------------------------------------------------- back-test
def backtest(year=2026, params=None, first=3, quiet=False):
    tg, pg = load_games(year)
    fbs = {g["team"] for g in tg if g["fbs"]}
    pg = [g for g in pg if g["team"] in fbs]
    lines = load_lines(year)
    weeks = sorted({g["week"] for g in pg})
    res = []
    for w in weeks:
        if w < first:
            continue
        m = Model(tg, pg, w - 1, params, lines)
        for g in pg:
            if g["week"] != w:
                continue
            pr = m.project(g["id"], g["opp"], w)
            if not pr or pr["games"] < 2:
                continue
            log = m.player_log[g["id"]]
            season_avg = sum(actual_points(x) for x in log) / len(log)
            last3 = sum(actual_points(x) for x in log[-3:]) / len(log[-3:])
            res.append((pr["pts"], season_avg, last3, actual_points(g), g["pos"], w))
    def stats(rows, i):
        n = len(rows)
        mae = sum(abs(r[i] - r[3]) for r in rows) / n
        mx = sum(r[i] for r in rows) / n; my = sum(r[3] for r in rows) / n
        cov = sum((r[i] - mx) * (r[3] - my) for r in rows)
        vx = sum((r[i] - mx) ** 2 for r in rows); vy = sum((r[3] - my) ** 2 for r in rows)
        return mae, cov / (vx * vy) ** 0.5 if vx and vy else 0.0
    out = {}
    pools = {"all (proj 5+)": [r for r in res if r[0] >= 5]}
    for pos in POS:
        pools[pos] = [r for r in res if r[4] == pos and r[0] >= 5]
    for name, rows in pools.items():
        if not rows:
            continue
        out[name] = {"n": len(rows), "model": stats(rows, 0), "season_avg": stats(rows, 1), "last3": stats(rows, 2)}
        if not quiet:
            mm, sa, l3 = out[name]["model"], out[name]["season_avg"], out[name]["last3"]
            print(f"{name:14s} n={len(rows):5d}  model MAE {mm[0]:.2f} r {mm[1]:.3f} | season avg MAE {sa[0]:.2f} r {sa[1]:.3f} | last 3 MAE {l3[0]:.2f} r {l3[1]:.3f}")
    return out


# ---------------------------------------------------------------- schedule + build
def schedule_path(year):
    return WEEKS / f"schedule-{year}-regular.json"


def lines_path(year):
    return WEEKS / f"lines-{year}-regular.json"


def fetch_schedule(year):
    """Season schedule and betting lines: two API calls."""
    from fetch_cfb_stats import CFBDClient
    client = CFBDClient(os.environ.get("CFBD_API_KEY"))
    lines = client.get("/lines", year=year, seasonType="regular") or []
    keep_lines = []
    for r in lines:
        ls = [l for l in (r.get("lines") or []) if l.get("spread") is not None and l.get("overUnder") is not None]
        if not ls:
            continue
        spread = sum(float(l["spread"]) for l in ls) / len(ls)
        total = sum(float(l["overUnder"]) for l in ls) / len(ls)
        keep_lines.append({"week": r.get("week"), "home": r.get("homeTeam"), "away": r.get("awayTeam"),
                           "spread": round(spread, 2), "total": round(total, 2), "books": len(ls)})
    lines_path(year).write_text(json.dumps(keep_lines, separators=(",", ":")))
    print(f"Lines: {len(keep_lines)} games with a spread and total.")
    rows = client.get("/games", year=year, seasonType="regular") or []
    keep = [{"week": r.get("week"), "home": r.get("homeTeam"), "away": r.get("awayTeam"),
             "homeClass": r.get("homeClassification"), "awayClass": r.get("awayClassification"),
             "start": r.get("startDate"), "done": bool(r.get("completed"))} for r in rows]
    schedule_path(year).write_text(json.dumps(keep, separators=(",", ":")))
    print(f"Schedule: {len(keep)} games, {client.calls} API calls.")


def build(year=2026):
    tg, pg = load_games(year)
    through = max(g["week"] for g in pg)
    m = Model(tg, pg, through, lines=load_lines(year))
    sched = json.loads(schedule_path(year).read_text()) if schedule_path(year).exists() else []
    upcoming = defaultdict(list)  # team -> [(week, opp, home)]
    for g in sched:
        if g["week"] is None or g["week"] <= through:
            continue
        upcoming[g["home"]].append((g["week"], g["away"], True))
        upcoming[g["away"]].append((g["week"], g["home"], False))
    next_week = min((w for v in upcoming.values() for w, _, _ in v), default=through + 1)
    players = []
    for pid, log in m.player_log.items():
        last = log[-1]
        if last["pos"] not in POS:
            continue
        fbs_team = any(g["fbs"] for g in m.team_log.get(last["team"], []))
        if not fbs_team:
            continue
        games = sorted(upcoming.get(last["team"], []))
        nxt = [x for x in games if x[0] == next_week]
        pr_next = m.project(pid, nxt[0][1], next_week) if nxt else None
        u = pr_next or m.project(pid, None)
        if not u or (u["pts"] < 2 and (not pr_next or pr_next["pts"] < 2)):
            continue
        ros = [m.project(pid, opp, w) for w, opp, _ in games]
        ros_pts = sum(x["pts"] for x in ros if x)
        rnd = lambda v, k=1: round(v, k)
        players.append({
            "id": pid, "name": u["name"], "pos": u["pos"], "team": u["team"], "games": u["games"],
            "missedLast": u["missed_last"],
            "next": None if not pr_next else {
                "week": next_week, "opp": nxt[0][1], "home": nxt[0][2], "pts": rnd(pr_next["pts"]),
                "tgt": rnd(pr_next["tgt"]), "car": rnd(pr_next["car"]), "rec": rnd(pr_next["rec"]),
                "yds": round(pr_next["rec_yds"] + pr_next["rush_yds"]), "td": rnd(pr_next["td"], 2),
                "oppPass": rnd(pr_next["fp"], 2), "oppRun": rnd(pr_next["fr"], 2),
                "implied": None if pr_next["implied"] is None else rnd(pr_next["implied"])},
            "ros": {"games": len(games), "pts": rnd(ros_pts), "perGame": rnd(ros_pts / len(games)) if games else None,
                    "weeks": [[w, opp, rnd(x["pts"]) if x else None] for (w, opp, _), x in zip(games, ros)]},
            "share": {"tgt": rnd(100 * u["tshare"]), "car": rnd(100 * u["cshare"])},
        })
    players.sort(key=lambda p: -(p["next"]["pts"] if p["next"] else 0))
    PREMIUM.mkdir(parents=True, exist_ok=True)
    bt = backtest(year, quiet=True)
    acc = {k: {"n": v["n"], "mae": round(v["model"][0], 2), "r": round(v["model"][1], 3),
               "baseMae": round(v["season_avg"][0], 2), "baseR": round(v["season_avg"][1], 3)} for k, v in bt.items()}
    out = {"season": year, "through": through, "nextWeek": next_week, "scoring": "half PPR",
           "hasSchedule": bool(sched), "accuracy": acc, "players": players}
    path = PREMIUM / f"projections-{year}.json"
    path.write_text(json.dumps(out, separators=(",", ":")))
    print(f"Wrote {len(players)} projections (week {next_week}) to {path}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "backtest"
    year = int(sys.argv[2]) if len(sys.argv) > 2 else 2026
    {"backtest": lambda: backtest(year), "fetch-schedule": lambda: fetch_schedule(year), "build": lambda: build(year)}[cmd]()
