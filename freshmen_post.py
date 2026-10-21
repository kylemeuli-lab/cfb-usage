#!/usr/bin/env python3
"""
Friday "Freshman Watch" teaser post for Substack, in markdown.

Top 5 freshman receivers (WR/TE) by target share and top 5 freshman backs by carry share
over their last 3 games, plus the biggest risers. The full list lives on the Pro site.
Same definitions as the site's Freshman Watch page (freshmen.js).

    python freshmen_post.py [year] > post.md
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TOP = 5
FLOOR = {"rec": 4.0, "rb": 8.0}   # targets / carries per game over the last 3, to make the lists
RISER_FLOOR = {"rec": 9, "rb": 15}  # total targets / carries over the last 3, for risers


def rnd(x):
    """Round half up, like the site (Math.round)."""
    return int(x + 0.5) if x >= 0 else -int(-x + 0.5)


def rank_note(r):
    return f", No. {r['rank']} nationally" if r["rank"] and r["rank"] <= 500 else ""


def stars(n):
    return f"{n}-star recruit" if n else "unrated recruit"


def rows(year):
    hist = json.loads((ROOT / "data" / "weeks" / f"history-{year}-regular.json").read_text())
    fr = json.loads((ROOT / "data" / "premium" / f"freshmen-{year}.json").read_text())
    week = max(hist["weeks"])
    out = []
    for pid, rec in fr["players"].items():
        e = hist["players"].get(pid)
        if not e:
            continue
        team = hist["teams"].get(e["t"], {})
        if team.get("k") != "fbs":
            continue
        is_rb = e["p"] == "RB"
        si, vi = (3, 2) if is_rb else (1, 0)
        games = sorted(((int(w), a) for w, a in e["w"].items() if int(w) <= week), key=lambda x: x[0])
        sh = [(w, a) for w, a in games if a[si] is not None]
        if not sh:
            continue
        last3, before = sh[-3:], sh[:-3]
        avg = lambda xs: sum(a[si] for _, a in xs) / len(xs) if xs else None
        n = len(games)
        out.append({
            "id": pid, "name": e["n"], "team": e["t"], "abbr": team.get("a") or e["t"], "pos": e["p"], "rb": is_rb,
            "stars": rec.get("stars") or 0, "rank": rec.get("rank"), "usage": rec.get("usage"),
            "last3": avg(last3), "season": avg(sh), "before": avg(before),
            "delta": (avg(last3) - avg(before)) if before else None,
            "vol3": sum(a[vi] for _, a in last3) / len(last3), "vol3sum": sum(a[vi] for _, a in last3),
            "yds_pg": sum((a[6] or 0) + (a[7] or 0) for _, a in games) / n,
            "td": sum(a[8] or 0 for _, a in games), "n": n,
        })
    return week, len([p for p in fr["players"]]), out


def line(i, r):
    unit, vol = ("carries", "carries") if r["rb"] else ("targets", "targets")
    rank = rank_note(r)
    trend = ""
    if r["delta"] is not None and abs(r["delta"]) >= 3:
        trend = f", {'up' if r['delta'] > 0 else 'down'} from {rnd(r['before'])}% before {'📈' if r['delta'] > 0 else '📉'}"
    return (f"{i}. **{r['name']} ({r['abbr']}, {r['pos']})** – {rnd(r['last3'])}% of {unit} over his last "
            f"{min(3, r['n'])} games{trend}; {rnd(r['season'])}% on the season. "
            f"{r['vol3']:.1f} {vol} and {r['yds_pg']:.1f} yards a game. {stars(r['stars']).capitalize()}{rank}.")


def build(year):
    week, total, R = rows(year)
    rec = sorted([r for r in R if not r["rb"] and r["vol3"] >= FLOOR["rec"]], key=lambda r: -r["last3"])[:TOP]
    rb = sorted([r for r in R if r["rb"] and r["vol3"] >= FLOOR["rb"]], key=lambda r: -r["last3"])[:TOP]
    shown = {r["id"] for r in rec + rb}
    risers = sorted([r for r in R if r["delta"] is not None and r["delta"] > 0 and r["id"] not in shown
                     and r["vol3sum"] >= RISER_FLOOR["rb" if r["rb"] else "rec"]], key=lambda r: -r["delta"])[:3]
    fbs_total = len(R)
    md = [f"## Week {week} Freshman Watch: All FBS", "",
          "*True freshmen = the " + str(year) + " high school recruiting class. Target share for WR/TE, carry share for "
          "RBs, over each player's last 3 games. Minimums: " + f"{FLOOR['rec']:.0f}+ targets or {FLOOR['rb']:.0f}+ carries a game.*", "",
          "### Top freshman receivers", ""]
    md += [line(i, r) for i, r in enumerate(rec, 1)] + ["", "### Top freshman backs", ""]
    md += [line(i, r) for i, r in enumerate(rb, 1)] + [""]
    if risers:
        md += ["### Rising 📈", ""]
        for i, r in enumerate(risers, 1):
            unit = "carries" if r["rb"] else "targets"
            md.append(f"{i}. **{r['name']} ({r['abbr']}, {r['pos']})** – {rnd(r['before'])}% → {rnd(r['last3'])}% of {unit} "
                      f"(+{rnd(r['delta'])}), {r['vol3sum']} {unit} over his last {min(3, r['n'])} games. "
                      f"{stars(r['stars']).capitalize()}{rank_note(r)}.")
        md.append("")
    md += ["## The full list", "",
           f"Freshman Watch on the site tracks all {fbs_total} FBS true freshmen at WR, TE and RB with a touch this season: "
           "week-by-week share, last 3 vs. earlier games, yards per game, usage rate and recruiting profile, sortable "
           "by position and conference. It's part of the Pro tier.", "",
           f"*Data: CollegeFootballData.com, through week {week}. Recruiting rankings: 247Sports composite via CFBD.*"]
    return week, "\n".join(md)


if __name__ == "__main__":
    year = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
    print(build(year)[1])
