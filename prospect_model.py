#!/usr/bin/env python3
"""
Back-test college metrics against NFL draft results and fit the Prospect Score.

Training set: FBS WR/TE/RB whose college careers ended after the 2018-2024 seasons
(2019-2025 drafts), with at least a minimal role. The 2025 season / 2026 draft is held
out. Labels: drafted at all, and drafted in the top 100 picks (roughly Day 1-2).

    python prospect_model.py backtest      # metric-by-metric AUCs + model validation
    python prospect_model.py score         # writes data/premium/prospects-2026.json for current players
"""
from __future__ import annotations

import functools
import json
import math
import sys
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score, brier_score_loss
from sklearn.preprocessing import StandardScaler

from prospect_features import careers, drafted as drafted_all, LAST

ROOT = Path(__file__).resolve().parent
TRAIN_LAST = (2018, 2024)  # final college season range used to fit
HOLDOUT_LAST = 2025        # final season 2025 -> 2026 draft
MIN_VOL = {"WR": 200, "TE": 100, "RB": 200}  # best-season scrimmage yards to enter the pool
TOP = 100                  # "Day 1-2" cut

# Recruiting (stars, whether he was a ranked recruit, seasons since high school) and the
# best recruit among his teammates in the same role.
EXTRA = ["stars", "recruited", "years_out_c", "years_known", "mate_stars"]
FEATURES = {
    "WR": ["last_dominator", "best_dominator", "last_yprr_team", "best_rec_ypg", "last_academy", "breakout_age", "early_breakout",
           "n_seasons", "power_last", "last_ppa_pass", "weight", "height", "last_ypr", *EXTRA],
    "TE": ["last_dominator", "best_dominator", "last_yprr_team", "best_rec_ypg", "last_academy", "breakout_age", "early_breakout",
           "n_seasons", "power_last", "last_ppa_pass", "weight", "height", "last_ypr", *EXTRA],
    "RB": ["last_rb_dominator", "best_rb_dominator", "last_carry_share", "last_scrim_per_play", "best_scrim_ypg", "last_academy",
           "last_rec_yds_share", "last_ypc", "breakout_age", "early_breakout", "n_seasons", "power_last",
           "last_ppa_rush", "weight", *EXTRA],
}
LABELS = {
    "last_dominator": "Final-season dominator", "best_dominator": "Best-season dominator",
    "last_yprr_team": "Rec yds per team pass att", "breakout_age": "Seasons since breakout",
    "early_breakout": "Broke out in 1st/2nd season", "n_seasons": "College seasons played",
    "power_last": "Power conference", "last_ppa_pass": "EPA per target (PPA)", "weight": "Weight",
    "height": "Height", "last_ypr": "Yards per catch", "last_rb_dominator": "Final-season RB dominator",
    "best_rb_dominator": "Best-season RB dominator", "last_carry_share": "Carry share",
    "last_scrim_per_play": "Scrimmage yds per team play", "last_rec_yds_share": "Receiving yards share",
    "last_ypc": "Yards per carry", "best_rec_ypg": "Best rec yds per game", "best_scrim_ypg": "Best scrimmage yds per game",
    "last_academy": "Service academy offense", "stars": "Recruiting stars", "recruited": "Ranked recruit",
    "years_out_c": "Years since high school", "years_known": "Recruiting class known", "mate_stars": "Top teammate's recruiting stars", "last_ppa_rush": "EPA per rush (PPA)",
}


def pool(pos, through=LAST):
    out = []
    for c in careers(through):
        if c["pos"] != pos:
            continue
        if max(s["rec_yds"] + s["rush_yds"] for s in c["seasons"]) < MIN_VOL[pos]:
            continue
        # players can't enter the draft before their third college season, so 1-2 is treated as 3
        c["n_real"] = c["n_seasons"]
        c["n_seasons"] = max(3, c["n_seasons"])
        # same rule for seasons since high school: no one is draft-eligible before year 3
        c["years_out_c"] = None if c["years_out"] is None else max(3, c["years_out"])
        c["years_known"] = int(c["years_out"] is not None)
        c["early_breakout"] = int(c["breakout_idx"] is not None and c["breakout_idx"] <= 2)
        c["y_drafted"] = int("pick" in c)
        c["y_top"] = int("pick" in c and c["pick"] <= TOP)
        out.append(c)
    return out


def matrix(rows, feats, fill=None):
    X = np.array([[np.nan if r.get(f) is None else float(r[f]) for f in feats] for r in rows])
    if fill is None:
        fill = np.nanmedian(X, axis=0)
    idx = np.where(np.isnan(X))
    X[idx] = np.take(fill, idx[1])
    return X, fill


class PosModel:
    def __init__(self, pos):
        self.pos, self.feats = pos, FEATURES[pos]

    def fit(self, rows):
        X, self.fill = matrix(rows, self.feats)
        self.scaler = StandardScaler().fit(X)
        Z = self.scaler.transform(X)
        self.m_draft = LogisticRegression(C=0.5, max_iter=2000).fit(Z, [r["y_drafted"] for r in rows])
        self.m_top = LogisticRegression(C=0.5, max_iter=2000).fit(Z, [r["y_top"] for r in rows])
        return self

    def predict(self, rows):
        X, _ = matrix(rows, self.feats, self.fill)
        Z = self.scaler.transform(X)
        return self.m_draft.predict_proba(Z)[:, 1], self.m_top.predict_proba(Z)[:, 1], Z

    def score(self, rows):
        """Prospect Score 0-100: weighted blend of drafted and top-100 chances (top-100 counts double)."""
        pd_, pt, Z = self.predict(rows)
        return 100 * (pd_ + 2 * pt) / 3, pd_, pt, Z

    def drivers(self, z_row, k=3):
        """Top contributing features (positive and negative) for one player."""
        w = (self.m_draft.coef_[0] + 2 * self.m_top.coef_[0]) / 3
        contrib = w * z_row
        order = np.argsort(-np.abs(contrib))[:k]
        return [(plain_label(self.feats[i], z_row[i]), float(contrib[i])) for i in order]


# Plain words for the site's "why" chips: what his value is (high / low), not the model term.
PLAIN = {
    "last_dominator": ("High dominator", "Low dominator"),
    "best_dominator": ("High best-season dominator", "Low best-season dominator"),
    "last_yprr_team": ("Lots of yards per team pass", "Few yards per team pass"),
    "best_rec_ypg": ("Big receiving yards per game", "Low receiving yards per game"),
    "breakout_age": ("Several productive seasons", "Short track record"),
    "early_breakout": ("Broke out early", "No early breakout"),
    "n_seasons": ("Many college seasons", "Few college seasons"),
    "power_last": ("Power-conference production", "Non-power conference"),
    "last_ppa_pass": ("Efficient on his targets", "Inefficient on his targets"),
    "weight": ("Bigger build", "Smaller build"),
    "height": ("Taller", "Shorter"),
    "last_ypr": ("Big yards per catch", "Low yards per catch"),
    "last_academy": ("Service academy offense", "Standard offense"),
    "last_rb_dominator": ("High RB dominator", "Low RB dominator"),
    "best_rb_dominator": ("High best-season RB dominator", "Low best-season RB dominator"),
    "last_carry_share": ("Big carry share", "Small carry share"),
    "last_scrim_per_play": ("Lots of yards per team play", "Few yards per team play"),
    "best_scrim_ypg": ("Big scrimmage yards per game", "Low scrimmage yards per game"),
    "last_rec_yds_share": ("Big receiving role", "Small receiving role"),
    "last_ypc": ("High yards per carry", "Low yards per carry"),
    "last_ppa_rush": ("Efficient runner", "Inefficient runner"),
    "stars": ("Highly recruited", "Lower recruiting rating"),
    "recruited": ("Ranked recruit", "Unranked recruit"),
    "years_out_c": ("More years since high school", "Young for his production"),
    "years_known": ("Recruiting class known", "Recruiting class unknown"),
    "mate_stars": ("Talented teammates", "Less-heralded teammates"),
}


def plain_label(feat, z):
    hi, lo = PLAIN.get(feat, (LABELS.get(feat, feat), LABELS.get(feat, feat)))
    return hi if z >= 0 else lo


def auc(y, s):
    return roc_auc_score(y, s) if 0 < sum(y) < len(y) else float("nan")


def backtest():
    report = {}
    for pos in ("WR", "TE", "RB"):
        P = pool(pos)
        train = [r for r in P if TRAIN_LAST[0] <= r["final"] <= TRAIN_LAST[1]]
        hold = [r for r in P if r["final"] == HOLDOUT_LAST]
        yd, yt = [r["y_drafted"] for r in train], [r["y_top"] for r in train]
        print(f"\n=== {pos}: train {len(train)} players ({sum(yd)} drafted, {sum(yt)} top-{TOP}); "
              f"holdout {len(hold)} ({sum(r['y_drafted'] for r in hold)} drafted)")
        single = []
        for f in FEATURES[pos]:
            X, _ = matrix(train, [f])
            single.append((f, auc(yd, X[:, 0]), auc(yt, X[:, 0])))
        single.sort(key=lambda t: -abs(t[1] - .5))
        print(f"{'metric':32s} AUC drafted  AUC top-{TOP}")
        for f, a, b in single:
            print(f"{LABELS[f]:32s} {a:.3f}        {b:.3f}")
        # leave-one-class-out over training years
        cv_d, cv_t = [], []
        for y in range(TRAIN_LAST[0], TRAIN_LAST[1] + 1):
            tr = [r for r in train if r["final"] != y]
            te = [r for r in train if r["final"] == y]
            m = PosModel(pos).fit(tr)
            s, _, _, _ = m.score(te)
            cv_d.append(auc([r["y_drafted"] for r in te], s))
            cv_t.append(auc([r["y_top"] for r in te], s))
        m = PosModel(pos).fit(train)
        s, pdr, ptp, _ = m.score(hold)
        hd, ht = [r["y_drafted"] for r in hold], [r["y_top"] for r in hold]
        print(f"Model, leave-one-class-out: AUC drafted {np.nanmean(cv_d):.3f}, top-{TOP} {np.nanmean(cv_t):.3f}")
        print(f"Model, 2026 draft holdout:  AUC drafted {auc(hd, s):.3f}, top-{TOP} {auc(ht, s):.3f}, "
              f"Brier drafted {brier_score_loss(hd, pdr):.3f}")
        w = (m.m_draft.coef_[0] + 2 * m.m_top.coef_[0]) / 3
        print("Weights (standardized):", ", ".join(f"{LABELS[f]} {v:+.2f}" for f, v in sorted(zip(m.feats, w), key=lambda t: -abs(t[1]))))
        ranked = sorted(zip(s, hold), key=lambda t: -t[0])
        print("Holdout top 15:")
        for sc, r in ranked[:15]:
            res = f"pick {r['pick']}" if "pick" in r else "undrafted"
            print(f"  {sc:5.1f}  {r['name']:24s} {r['team']:18s} {res}")
        report[pos] = {"single": single, "cv": [np.nanmean(cv_d), np.nanmean(cv_t)], "holdout": [auc(hd, s), auc(ht, s)]}
    return report


def current_players(pos, season=LAST):
    """Players with a 2026 season, scored as if it were their final one."""
    # the current season must carry a real share of the pool minimum, so a few early catches don't count
    # Includes players still on a roster who haven't played this season (injured): they're
    # scored on their college career so far and flagged.
    return [r for r in pool(pos) if r["final"] == season
            and r["last_rec_yds"] + r["last_rush_yds"] >= 0.6 * MIN_VOL[pos]]


# ---------------------------------------------------------------- NFL outcomes
STARTER = {"WR": 24, "TE": 12, "RB": 24}


def nfl_outcomes():
    import gzip
    p = ROOT / "data" / "history" / "nfl-outcomes.json.gz"
    if not p.exists():
        return {}, None
    d = json.load(gzip.open(p))
    return {x["collegeId"]: x for x in d["players"]}, d["lastNflSeason"]


@functools.lru_cache(maxsize=None)
def nfl_calibration():
    """Chance of an NFL fantasy starter season (top 24 WR / 12 TE / 24 RB in half-PPR points
    per game) in a player's first three NFL years, as a function of his Prospect Score.

    Fit on college careers ending 2014-2022 (2015-2023 drafts, three NFL seasons observed),
    using each class's score from a model that didn't see that class. Training a separate
    model directly on NFL hits did no better (too few hits), so the Prospect Score is mapped
    to NFL odds instead. Undrafted players count as misses unless they hit."""
    outc, _ = nfl_outcomes()
    cal = {}
    for pos in ("WR", "TE", "RB"):
        P = [r for r in pool(pos) if 2014 <= r["final"] <= 2022]
        S = np.zeros(len(P))
        for yr in sorted({r["final"] for r in P}):
            ix = [i for i, r in enumerate(P) if r["final"] == yr]
            m = PosModel(pos).fit([r for r in P if r["final"] != yr])
            S[ix] = m.score([P[i] for i in ix])[0]
        y = [outc.get(r["id"], {}).get("hit", 0) for r in P]
        lr = LogisticRegression(C=10, max_iter=2000).fit((S / 100).reshape(-1, 1), y)
        bands = []
        for lab, lo, hi in (("75+", 75, 101), ("50-75", 50, 75), ("25-50", 25, 50), ("10-25", 10, 25), ("<10", 0, 10)):
            b = [h for sc, h in zip(S, y) if lo <= sc < hi]
            bands.append([lab, len(b), round(100 * sum(b) / len(b), 1) if b else None])
        # after the draft, the pick itself is the best guide: hit rate by pick range
        D = [(r["pick"], h) for r, h in zip(P, y) if "pick" in r]
        picks = []
        for lab, lo, hi in (("1-32", 1, 32), ("33-64", 33, 64), ("65-100", 65, 100), ("101-150", 101, 150), ("151+", 151, 999)):
            b = [h for k, h in D if lo <= k <= hi]
            picks.append([lab, len(b), round(100 * sum(b) / len(b), 1) if b else None])
        cal[pos] = {"coef": float(lr.coef_[0][0]), "intercept": float(lr.intercept_[0]), "auc": round(auc(y, S), 3),
                    "n": len(P), "hits": int(sum(y)), "bands": bands, "picks": picks, "starter": STARTER[pos]}
    return cal


def p_nfl(pos, score):
    c = nfl_calibration()[pos]
    return 1 / (1 + math.exp(-(c["coef"] * score / 100 + c["intercept"])))


def score_current(out=ROOT / "data" / "premium" / "prospects-2026.json"):
    out.parent.mkdir(parents=True, exist_ok=True)
    res = {"season": LAST, "through": None, "nfl": nfl_calibration(), "players": []}
    for pos in ("WR", "TE", "RB"):
        P = pool(pos)
        train = [r for r in P if TRAIN_LAST[0] <= r["final"] <= HOLDOUT_LAST]  # refit with 2026 draft included
        m = PosModel(pos).fit(train)
        cur = current_players(pos)
        if not cur:
            continue
        s, pdr, ptp, Z = m.score(cur)
        from prospect_features import _load as _ld
        roster_team = {str(x["id"]): x["team"] for x in _ld(f"roster-{LAST}")}
        for r in cur:   # players who haven't played this season: show the team he's on now
            if r["last_season"] < LAST and roster_team.get(r["id"]):
                r["team"] = roster_team[r["id"]]
        for sc, a, b, z, r in zip(s, pdr, ptp, Z, cur):
            res["players"].append({
                "id": r["id"], "name": r["name"], "pos": pos, "team": r["team"], "conf": r["conf"],
                "score": round(float(sc), 1), "pDraft": round(float(a), 3), "pTop100": round(float(b), 3),
                "pNfl": round(p_nfl(pos, float(sc)), 3), "seasons": r["n_real"],
                "noGames": bool(r["last_season"] < LAST), "lastSeason": r["last_season"],
                "dominator": round(r["last_rb_dominator" if pos == "RB" else "last_dominator"] * 100, 1),
                "drivers": [[k, round(v, 2)] for k, v in m.drivers(z)],
                "ypg": round(r["best_scrim_ypg" if pos == "RB" else "best_rec_ypg"], 1),
                "perPlay": round(r["last_scrim_per_play" if pos == "RB" else "last_yprr_team"], 2),
                "power": bool(r["power_last"]),
            })
    res["players"].sort(key=lambda p: -p["score"])
    try:
        idx = json.loads((ROOT / "data" / "weeks" / "index.json").read_text())
        res["through"] = max(w["week"] for w in idx if w.get("season") == LAST)
    except Exception:
        pass
    out.write_text(json.dumps(res, separators=(",", ":")))
    print(f"Wrote {len(res['players'])} players to {out}")
    return res


def score_history(first_draft=2019, out=ROOT / "data" / "premium" / "prospects-history.json"):
    """Every pool player whose college career ended before the 2022-2026 drafts, scored by a
    model that never saw his draft class, next to where (if) he was drafted."""
    outc, last_nfl = nfl_outcomes()
    res = {"drafts": list(range(first_draft, LAST + 1)), "lastNflSeason": last_nfl, "players": [], "summary": {}}
    for pos in ("WR", "TE", "RB"):
        P = pool(pos)
        fit_pool = [r for r in P if TRAIN_LAST[0] <= r["final"] <= HOLDOUT_LAST]
        for draft in range(first_draft, LAST + 1):
            # class = the draft he was picked in (opt-outs like Ja'Marr Chase sat a season), else the next one
            cls_of = lambda r: r.get("draft_year") or r["final"] + 1
            cls = [r for r in fit_pool if cls_of(r) == draft]
            m = PosModel(pos).fit([r for r in fit_pool if cls_of(r) != draft])
            s, pdr, ptp, Z = m.score(cls)
            order = sorted(range(len(cls)), key=lambda i: -s[i])
            for rank, i in enumerate(order, 1):
                r = cls[i]
                res["players"].append({
                    "id": r["id"], "name": r["name"], "pos": pos, "team": r["team"], "draft": draft,
                    "score": round(float(s[i]), 1), "pDraft": round(float(pdr[i]), 3), "pTop100": round(float(ptp[i]), 3),
                    "rank": rank, "of": len(cls),
                    "pick": r.get("pick"), "round": r.get("round"), "nfl": r.get("nfl_team"),
                    "pNfl": round(p_nfl(pos, float(s[i])), 3),
                    "nflSeasons": (outc.get(r["id"]) or {}).get("seasonsObserved"),
                    "nflBest": (outc.get(r["id"]) or {}).get("bestRank"),
                    "nflBestPpg": (outc.get(r["id"]) or {}).get("bestPpg"),
                    "nflHit": (outc.get(r["id"]) or {}).get("hit"),
                    "dominator": round(r["last_rb_dominator" if pos == "RB" else "last_dominator"] * 100, 1),
                    "drivers": [[k, round(v, 2)] for k, v in m.drivers(Z[i])],
                })
            drafted = [r for r in cls if "pick" in r]
            res["summary"][f"{pos}-{draft}"] = {"pool": len(cls), "drafted": len(drafted),
                                                "aucDrafted": round(auc([r["y_drafted"] for r in cls], s), 3)}
    # drafted players the pool doesn't cover (FCS, position changes, no FBS stats)
    have = {p["id"] for p in res["players"]}
    res["notScored"] = sorted(
        [{"name": v["draft_name"], "pos": v["draft_pos"], "draft": v["draft_year"], "pick": v["pick"]}
         for k, v in drafted_all().items() if v["draft_year"] >= first_draft and k not in have],
        key=lambda x: (x["draft"], x["pick"]))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(res, separators=(",", ":")))
    print(f"Wrote {len(res['players'])} past prospects ({len(res['notScored'])} drafted players not scored) to {out}")
    return res


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "backtest"
    {"backtest": backtest, "score": score_current, "history": score_history}[cmd]()
