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

FEATURES = {
    "WR": ["last_dominator", "best_dominator", "last_yprr_team", "best_rec_ypg", "last_academy", "breakout_age", "early_breakout",
           "n_seasons", "power_last", "last_ppa_pass", "weight", "height", "last_ypr"],
    "TE": ["last_dominator", "best_dominator", "last_yprr_team", "best_rec_ypg", "last_academy", "breakout_age", "early_breakout",
           "n_seasons", "power_last", "last_ppa_pass", "weight", "height", "last_ypr"],
    "RB": ["last_rb_dominator", "best_rb_dominator", "last_carry_share", "last_scrim_per_play", "best_scrim_ypg", "last_academy",
           "last_rec_yds_share", "last_ypc", "breakout_age", "early_breakout", "n_seasons", "power_last",
           "last_ppa_rush", "weight"],
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
    "last_academy": "Service academy offense", "last_ppa_rush": "EPA per rush (PPA)",
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
        return [(LABELS[self.feats[i]], float(contrib[i])) for i in order]


def auc(y, s):
    return roc_auc_score(y, s) if 0 < sum(y) < len(y) else float("nan")


def backtest():
    report = {}
    for pos in ("WR", "TE", "RB"):
        P = pool(pos)
        train = [r for r in P if TRAIN_LAST[0] <= r["last_season"] <= TRAIN_LAST[1]]
        hold = [r for r in P if r["last_season"] == HOLDOUT_LAST]
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
            tr = [r for r in train if r["last_season"] != y]
            te = [r for r in train if r["last_season"] == y]
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
    return [r for r in pool(pos) if r["last_season"] == season
            and r["last_rec_yds"] + r["last_rush_yds"] >= 0.6 * MIN_VOL[pos]]


def score_current(out=ROOT / "data" / "premium" / "prospects-2026.json"):
    out.parent.mkdir(parents=True, exist_ok=True)
    res = {"season": LAST, "through": None, "players": []}
    for pos in ("WR", "TE", "RB"):
        P = pool(pos)
        train = [r for r in P if TRAIN_LAST[0] <= r["last_season"] <= HOLDOUT_LAST]  # refit with 2026 draft included
        m = PosModel(pos).fit(train)
        cur = current_players(pos)
        if not cur:
            continue
        s, pdr, ptp, Z = m.score(cur)
        for sc, a, b, z, r in zip(s, pdr, ptp, Z, cur):
            res["players"].append({
                "id": r["id"], "name": r["name"], "pos": pos, "team": r["team"], "conf": r["conf"],
                "score": round(float(sc), 1), "pDraft": round(float(a), 3), "pTop100": round(float(b), 3),
                "seasons": r["n_real"],
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


def score_history(first_draft=2022, out=ROOT / "data" / "premium" / "prospects-history.json"):
    """Every pool player whose college career ended before the 2022-2026 drafts, scored by a
    model that never saw his draft class, next to where (if) he was drafted."""
    res = {"drafts": list(range(first_draft, LAST + 1)), "players": [], "summary": {}}
    for pos in ("WR", "TE", "RB"):
        P = pool(pos)
        fit_pool = [r for r in P if TRAIN_LAST[0] <= r["last_season"] <= HOLDOUT_LAST]
        for draft in range(first_draft, LAST + 1):
            cls = [r for r in fit_pool if r["last_season"] == draft - 1]
            m = PosModel(pos).fit([r for r in fit_pool if r["last_season"] != draft - 1])
            s, pdr, ptp, Z = m.score(cls)
            order = sorted(range(len(cls)), key=lambda i: -s[i])
            for rank, i in enumerate(order, 1):
                r = cls[i]
                res["players"].append({
                    "id": r["id"], "name": r["name"], "pos": pos, "team": r["team"], "draft": draft,
                    "score": round(float(s[i]), 1), "pDraft": round(float(pdr[i]), 3), "pTop100": round(float(ptp[i]), 3),
                    "rank": rank, "of": len(cls),
                    "pick": r.get("pick"), "round": r.get("round"), "nfl": r.get("nfl_team"),
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
