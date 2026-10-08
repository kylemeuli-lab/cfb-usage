#!/usr/bin/env python3
"""
Generates fake CFBD API responses (same shapes as the real API) so the pipeline
and dashboard can be tested without an API key. Player names are fictional.

  python tests/make_fixtures.py            # writes tests/fixtures/*.json
  python fetch_cfb_stats.py --offline-dir tests/fixtures --week 6 --year 2026 --sample
"""
import json
import random
from collections import defaultdict
from pathlib import Path

random.seed(7)
OUT = Path(__file__).parent / "fixtures"
YEAR, WEEK = 2026, 6

GAMES = [
    # home, home_conf, away, away_conf, classification
    ("Georgia", "SEC", "Alabama", "SEC", "fbs"),
    ("Ohio State", "Big Ten", "Penn State", "Big Ten", "fbs"),
    ("Texas", "SEC", "Oklahoma", "SEC", "fbs"),
    ("Oregon", "Big Ten", "USC", "Big Ten", "fbs"),
    ("Clemson", "ACC", "Florida State", "ACC", "fbs"),
    ("Utah", "Big 12", "Kansas State", "Big 12", "fbs"),
    ("Miami", "ACC", "Louisville", "ACC", "fbs"),
    ("LSU", "SEC", "Michigan", "Big Ten", "fbs"),
    ("Iowa State", "Big 12", "Arizona", "Big 12", "fbs"),
    ("Boise State", "Mountain West", "UNLV", "Mountain West", "fbs"),
    ("Montana", "Big Sky", "Montana State", "Big Sky", "fcs"),
]
AP = ["Texas", "Ohio State", "Georgia", "Oregon", "Penn State", "Miami", "Alabama", "LSU",
      "Clemson", "Michigan", "Oklahoma", "Utah", "Iowa State", "Boise State", "USC",
      "Kansas State", "Louisville", "Florida State", "Ole Miss", "Notre Dame",
      "Tennessee", "Missouri", "Indiana", "SMU", "Arizona State"]

FIRST = ["Jalen", "Marcus", "Tyler", "DeShawn", "Caleb", "Bryce", "Trey", "Isaiah", "Jordan",
         "Malik", "Cole", "Xavier", "Devin", "Elijah", "Quincy", "Rashad", "Ty", "Brennan",
         "Kendrick", "Avery", "Micah", "Darius", "Landon", "Jaylen", "Corey", "Amari", "Tavion"]
LAST = ["Holloway", "Pruitt", "Okafor", "Whitfield", "Barnes", "Delacroix", "Kimble", "Sutton",
        "Varner", "Ashby", "Mbeki", "Treadwell", "Coleman", "Rourke", "Lindqvist", "Ojo",
        "Faulkner", "Haskins", "Bellamy", "Strickland", "Maddox", "Ravenel", "Tolliver",
        "Quarles", "Ainsworth", "Dupree", "Castellanos", "Merriweather", "Nakamura", "O'Neal"]

used = set()
team_short = {}
pid_counter = [4430000]


def new_player(team, pos):
    while True:
        n = f"{random.choice(FIRST)} {random.choice(LAST)}"
        if random.random() < 0.08:
            n += " Jr."
        sk = (team, n[0], n.replace(" Jr.", "").split()[-1])
        if n not in used and sk not in team_short:
            used.add(n)
            team_short[sk] = n
            break
    pid_counter[0] += random.randint(1, 900)
    return {"id": pid_counter[0], "name": n, "team": team, "pos": pos}


def abbrev(name):
    parts = name.replace(" Jr.", "").split()
    return f"{parts[0][0]}.{parts[-1]}"


def sim_team(team, game_id, offense_team, defense_team):
    qb1, qb2 = new_player(team, "QB"), new_player(team, "QB")
    rbs = [new_player(team, "RB") for _ in range(3)]
    wrs = [new_player(team, "WR") for _ in range(5)]
    tes = [new_player(team, "TE") for _ in range(2)]
    ath = new_player(team, "ATH")  # position the pipeline must infer
    roster = [qb1, qb2, *rbs, *wrs, *tes, ath]

    plays, stats = [], defaultdict(lambda: defaultdict(int))
    use_abbrev = random.random() < 0.4   # some feeds use "J.Smith"
    backup_in = random.random() < 0.35

    # Passing plays
    weights = [26, 20, 15, 8, 4, 12, 5, 6, 3]   # wr1..wr5, te1, te2, rb1, rb2
    recvs = [*wrs, *tes, rbs[0], rbs[1]]
    n_att = random.randint(24, 42)
    for i in range(n_att):
        qb = qb2 if backup_in and i > n_att - 6 else qb1
        r = random.choices(recvs, weights)[0]
        qn = abbrev(qb["name"]) if use_abbrev else qb["name"]
        rn = abbrev(r["name"]) if use_abbrev else r["name"]
        roll = random.random()
        stats[qb["id"]]["att"] += 1
        stats[r["id"]]["tgt_true"] += 1
        if roll < 0.64:
            yds = max(-3, int(random.gauss(12, 9)))
            td = random.random() < 0.07
            stats[qb["id"]]["cmp"] += 1
            stats[qb["id"]]["pass_yds"] += yds
            stats[r["id"]]["rec"] += 1
            stats[r["id"]]["rec_yds"] += yds
            stats[r["id"]]["rec_long"] = max(stats[r["id"]]["rec_long"], yds)
            if td:
                stats[qb["id"]]["pass_td"] += 1
                stats[r["id"]]["rec_td"] += 1
                text, ptype = f"{qn} pass complete to {rn} for {yds} yds for a TD", "Passing Touchdown"
            elif yds < 0:
                text, ptype = f"{qn} pass complete to {rn} for a loss of {-yds} yards", "Pass Reception"
            elif yds == 0:
                text, ptype = f"{qn} pass complete to {rn} for no gain", "Pass Reception"
            else:
                text, ptype = f"{qn} pass complete to {rn} for {yds} yds to the 35", "Pass Reception"
        elif roll < 0.97:
            if random.random() < 0.3:
                text = f"{qn} pass incomplete to {rn}, broken up by {random.choice(LAST)}"
            else:
                text = f"{qn} pass incomplete to {rn}"
            ptype = "Pass Incompletion"
        else:
            stats[qb["id"]]["int"] += 1
            text = f"{qn} pass intercepted by {random.choice(FIRST)} {random.choice(LAST)}, intended for {rn}"
            ptype = "Pass Interception Return"
        plays.append({"id": f"{game_id}-{offense_team}-{len(plays):04d}", "gameId": game_id, "offense": offense_team,
                      "defense": defense_team, "playType": ptype, "playText": text,
                      "yardsGained": 0})

    # A penalty-nullified pass: must NOT count as a target.
    plays.append({"id": f"{game_id}-{offense_team}-9999", "gameId": game_id, "offense": offense_team,
                  "defense": defense_team, "playType": "Penalty",
                  "playText": f"{qb1['name']} pass complete to {wrs[0]['name']} for 15 yds, PENALTY holding (No Play)"})

    # Sacks: count as QB rushes in college box scores.
    for _ in range(random.randint(0, 4)):
        loss = random.randint(3, 10)
        stats[qb1["id"]]["car"] += 1
        stats[qb1["id"]]["rush_yds"] -= loss
        plays.append({"id": f"{game_id}-{offense_team}-{len(plays):04d}", "gameId": game_id, "offense": offense_team,
                      "defense": defense_team, "playType": "Sack",
                      "playText": f"{qb1['name']} sacked by {random.choice(LAST)} for a loss of {loss} yards"})

    # Rushing
    rush_w = [(rbs[0], 16), (rbs[1], 9), (rbs[2], 3), (qb1, 6), (ath, 1)]
    for _ in range(random.randint(24, 40)):
        p = random.choices([x for x, _ in rush_w], [w for _, w in rush_w])[0]
        yds = int(random.gauss(4.8, 5))
        stats[p["id"]]["car"] += 1
        stats[p["id"]]["rush_yds"] += yds
        stats[p["id"]]["rush_long"] = max(stats[p["id"]]["rush_long"], yds)
        if random.random() < 0.04:
            stats[p["id"]]["rush_td"] += 1
        plays.append({"id": f"{game_id}-{offense_team}-{len(plays):04d}", "gameId": game_id, "offense": offense_team,
                      "defense": defense_team, "playType": "Rush",
                      "playText": f"{p['name']} run for {yds} yds"})
    team_kneel = random.randint(0, 2)
    return roster, plays, stats, team_kneel


def box_categories(roster, stats, team_kneel):
    by_id = {p["id"]: p for p in roster}
    def ath(pid, val):
        return {"id": str(pid), "name": by_id[pid]["name"], "stat": str(val)}
    passers = [pid for pid in stats if stats[pid]["att"]]
    rushers = [pid for pid in stats if stats[pid]["car"]]
    receivers = [pid for pid in stats if stats[pid]["rec"]]
    team_row = {"id": "-9999", "name": "TEAM", "stat": str(-team_kneel)}
    cats = [
        {"name": "passing", "types": [
            {"name": "C/ATT", "athletes": [ath(p, f"{stats[p]['cmp']}/{stats[p]['att']}") for p in passers]},
            {"name": "YDS", "athletes": [ath(p, stats[p]["pass_yds"]) for p in passers]},
            {"name": "TD", "athletes": [ath(p, stats[p]["pass_td"]) for p in passers]},
            {"name": "INT", "athletes": [ath(p, stats[p]["int"]) for p in passers]},
        ]},
        {"name": "rushing", "types": [
            {"name": "CAR", "athletes": [ath(p, stats[p]["car"]) for p in rushers] + [{**team_row, "stat": str(team_kneel)}]},
            {"name": "YDS", "athletes": [ath(p, stats[p]["rush_yds"]) for p in rushers] + [team_row]},
            {"name": "TD", "athletes": [ath(p, stats[p]["rush_td"]) for p in rushers]},
            {"name": "LONG", "athletes": [ath(p, stats[p]["rush_long"]) for p in rushers]},
        ]},
        {"name": "receiving", "types": [
            {"name": "REC", "athletes": [ath(p, stats[p]["rec"]) for p in receivers]},
            {"name": "YDS", "athletes": [ath(p, stats[p]["rec_yds"]) for p in receivers]},
            {"name": "TD", "athletes": [ath(p, stats[p]["rec_td"]) for p in receivers]},
            {"name": "LONG", "athletes": [ath(p, stats[p]["rec_long"]) for p in receivers]},
        ]},
    ]
    return cats


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    games, box, plays_all, roster_all, truth = [], [], [], [], {}
    for i, (h, hc, a, ac, cls) in enumerate(GAMES):
        gid = 401800000 + i
        hp, ap = 0, 0
        teams_box = []
        for side, team, conf, opp in (("home", h, hc, a), ("away", a, ac, h)):
            roster, plays, stats, kneel = sim_team(team, gid, team, opp)
            pts = 7 * sum(stats[p]["pass_td"] + stats[p]["rush_td"] for p in stats) + 3 * random.randint(0, 3)
            if side == "home":
                hp = pts
            else:
                ap = pts
            teams_box.append({"team": team, "conference": conf, "homeAway": side, "points": pts,
                              "categories": box_categories(roster, stats, kneel)})
            plays_all += plays
            for p in roster:
                pos = "" if p["pos"] == "ATH" else p["pos"]
                first, _, last = p["name"].partition(" ")
                roster_all.append({"id": p["id"], "firstName": first, "lastName": last,
                                   "team": team, "position": pos or "ATH", "jersey": random.randint(1, 99)})
            truth[f"{gid}|{team}"] = {p["name"]: stats[p["id"]]["tgt_true"] for p in roster if stats[p["id"]]["tgt_true"]}
        if hp == ap:
            hp += 3
        teams_box[0]["points"], teams_box[1]["points"] = hp, ap
        line = lambda pts: [pts // 4, pts // 4, pts // 4, pts - 3 * (pts // 4)]
        games.append({
            "id": gid, "season": YEAR, "week": WEEK, "seasonType": "regular",
            "startDate": f"2026-10-03T{16 + (i % 8):02d}:00:00.000Z", "startTimeTBD": False,
            "completed": True, "neutralSite": h == "Texas", "conferenceGame": hc == ac,
            "venue": f"{h} Stadium", "homeId": 100 + i * 2, "homeTeam": h, "homeConference": hc,
            "homeClassification": cls, "homePoints": hp, "homeLineScores": line(hp),
            "awayId": 101 + i * 2, "awayTeam": a, "awayConference": ac, "awayClassification": cls,
            "awayPoints": ap, "awayLineScores": line(ap), "excitementIndex": round(random.uniform(2, 9), 2),
        })
        box.append({"id": gid, "teams": teams_box})
    # One game not yet completed: must be skipped.
    games.append({**games[0], "id": 401899999, "completed": False, "homeTeam": "Tulane",
                  "awayTeam": "Memphis", "homePoints": None, "awayPoints": None})

    rankings = [{"season": YEAR, "seasonType": "regular", "week": w, "polls": [
        {"poll": "Coaches Poll", "ranks": []},
        {"poll": "AP Top 25", "ranks": [{"rank": r + 1, "school": s, "conference": "", "points": 1500 - r * 50}
                                         for r, s in enumerate(AP if w == WEEK else AP[::-1])]},
    ]} for w in (WEEK - 1, WEEK, WEEK + 1)]
    # Week 7 poll exists in the data but must not be used for week 6 games? (it's <= check)
    rankings[-1]["week"] = WEEK + 1

    calendar = [{"season": YEAR, "week": w, "seasonType": "regular",
                 "startDate": f"2026-{8 + (w + 3) // 5:02d}-01T07:00:00.000Z",
                 "firstGameStart": f"2026-{8 + (w + 3) // 5:02d}-01T23:00:00.000Z",
                 "lastGameStart": f"2026-{8 + (w + 3) // 5:02d}-04T04:00:00.000Z",
                 "endDate": f"2026-{8 + (w + 3) // 5:02d}-07T07:00:00.000Z"} for w in range(1, 16)]

    files = {"games": games, "games_players": box, "plays": plays_all, "rankings": rankings,
             "roster": roster_all, "calendar": calendar}
    for k, v in files.items():
        (OUT / f"{k}.json").write_text(json.dumps(v))
    (OUT / "_truth_targets.json").write_text(json.dumps(truth, indent=1))
    print(f"wrote {len(files)} fixtures: {len(games)} games, {len(plays_all)} plays, {len(roster_all)} roster rows")


if __name__ == "__main__":
    main()
