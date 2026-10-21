# CFB Usage Report

Pulls each week's college football box scores and play-by-play from the
[CollegeFootballData API](https://collegefootballdata.com), computes usage stats for
skill players, and publishes a filterable dashboard on GitHub Pages. Every game card
has a **Copy Substack Markdown** button.

```
CFBD API ──> fetch_cfb_stats.py (GitHub Actions, Sundays) ──> week_stats.json
                                                               ├─> index.html dashboard (GitHub Pages)
                                                               └─> Substack Markdown (copy button)
```

The repo ships with **sample data using fictional players**, so the dashboard works
before you have an API key. The first real run replaces it automatically.

## Files

| File | What it does |
|---|---|
| `fetch_cfb_stats.py` | Pipeline: fetch, derive targets from play-by-play, compute metrics, write JSON |
| `index.html` | Dashboard: filters, game cards, Markdown formatter (`gameToMarkdown()`) |
| `.github/workflows/weekly-update.yml` | Runs the pipeline every Sunday and commits the new data |
| `week_stats.json` | Latest week (what the dashboard opens on) |
| `data/weeks/` | Archive of every week, plus `index.json` for the week picker |
| `data/cache/roster_<year>.json` | Season roster cache (one API call per season) |
| `tests/` | Fixture generator and offline tests |

## Setup

### 1. Get an API key
Request a free key at <https://collegefootballdata.com/key>. It arrives by email.

### 2. Run it locally once
Requires Python 3.10+.

```bash
pip install -r requirements.txt
export CFBD_API_KEY=your_key_here          # Windows PowerShell: $env:CFBD_API_KEY="your_key_here"
python fetch_cfb_stats.py --week 6 --year 2026
python -m http.server                      # then open http://localhost:8000
```

Opening `index.html` by double-clicking won't work: browsers block pages from reading
local JSON files. Use the `http.server` command above.

Leave off `--week` to auto-detect the most recent week. For bowls and the playoff, use
`--season-type postseason --week 1`.

### 3. Create the GitHub repo
1. On GitHub, click **New repository**. Name it (e.g. `cfb-usage`), make it **Public**
   (free Pages requires public on the free plan), and don't add a README.
2. Upload this folder. Either drag the files into the repo's web page (**Add file → Upload files**;
   make sure the hidden `.github` folder comes along), or from a terminal:
   ```bash
   cd cfb-stats
   git init && git add . && git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<you>/cfb-usage.git
   git push -u origin main
   ```

### 4. Add your API key as a secret
Repo **Settings → Secrets and variables → Actions → New repository secret**.
Name: `CFBD_API_KEY`, value: your key. Never commit the key to the repo.

### 5. Turn on GitHub Pages
**Settings → Pages → Build and deployment**: Source **Deploy from a branch**,
branch **main**, folder **/ (root)**. Your dashboard will be at
`https://<you>.github.io/cfb-usage/` within a minute or two.

### 6. Test the automation
**Actions → Weekly stats update → Run workflow**. Leave the inputs blank for the latest
week, or fill in a week number. When it finishes, it commits fresh data and Pages
redeploys. From then on it runs every Sunday on its own.

If the run fails at the push step, go to **Settings → Actions → General → Workflow
permissions** and choose **Read and write permissions**.

## Weekly workflow
1. Sunday morning the Action pulls Saturday's games and commits the data.
2. Open the dashboard and filter (e.g. SEC, or AP Top 25 only).
3. Build a post from the bar above the games, or from the buttons on a single game card:
   * **Game recaps**: usage notes (written automatically from the numbers) plus the
     players who mattered: QBs, backs with 20%+ of carries, receivers with 10%+ of targets
     or yards.
   * **Tables**: the same usage notes, with each game's numbers as a table image.
     Substack has no table block, so tables go in as pictures.
   * **Top 20 leaderboard**: opens with a dominator rating explainer, then the season's
     top 5 WRs and TEs by season dominator and top 5 RBs by RB dominator (average of
     share of RB carries and receiving credit, where 20% of team targets = 100%, capped), over the games each played; min half
     his team's games and 7+ targets / 5+ targets / 10+ carries a game. Then this week's WR target share
     (min 7 targets), TE target share (min 5), RB carry share (min 12 carries), and the
     biggest risers, for whatever conference/AP filter is set. After the season top 5s comes a
     season volume top 5: WRs and TEs by receiving yards a game, RBs by scrimmage yards a game
     (min half the team's games; 4+ targets a game WR, 3+ TE, 8+ touches RB). Volume catches
     receivers on pass-heavy offenses whose share looks ordinary (e.g. Oregon State).
   * **Trends up & down**: top 10 risers and fallers in target share and RB carry
     share, week to week (vs. the player's last game with touches) and multi-week
     (last 3 games vs. his earlier games; needs 5+ games, so it starts around week 5).
     Volume headers say what's counted: Targets/Carries week to week, Tgt/g and Car/g
     for multi-week.

### Members site (members.html)
The reader-facing site: https://kylemeuli-lab.github.io/cfb-usage/members.html. Same data
and calculations as the dashboard (shared `app.js`), none of the post or upload tools.
* **Games**: headline cards (biggest jumps and drop, season dominator), every game with
  the opponent defense ranks it faced; "Show players" opens both teams' usage tables.
* **Leaderboards**: this week's top WR/TE target share and RB carry share, season
  dominator leaders (top 25), or season volume (receiving yards, TDs, targets a game;
  RB scrimmage yards, carries, targets a game), sortable by column.
* **Trends**: week-to-week and last-3-game risers and fallers, with the defense faced, and
  trend lines for the biggest movers.
* **Defenses**: every FBS defense ranked vs. the pass and run, sortable and searchable.
* Click any player for his week-by-week share, with hover details for each game
  (opponent, stat line, that defense's rank going in and for the season). Player links
  can be shared: `members.html#/trends?p=<player id>`.

`index.html` stays the behind-the-scenes dashboard with the Substack post builders.

### Defense ranks
Every FBS defense is ranked against the pass and the run by **yards per play allowed**
(the default, used in posts), or by **EPA per play allowed** (switch with "Defense rank"
in the filter bar, or `?dm=epa`). Only games against FBS offenses count; sacks count as pass plays,
scrambles as runs. Ranks are built by the pipeline into
`data/weeks/defense-<season>-<type>.json`: the rank going into each week, the season
rank, and what each defense allowed in each game.
* **Game cards** show "Faced: pass D / run D" chips, colored by fifths (red = toughest,
  green = softest) from the rank going into the game. Hover for the going-in and
  season ranks. `*` = no earlier games, so the season rank is shown.
* **Recap posts** add "vs. 34th pass D, 88th run D" to each team line.
* **Trends posts** add this week's opponent to week-to-week lines ("vs. UL Monroe
  (132nd pass D)") and the average rank of the last 3 opponents to multi-week lines.

### Pickups post (Fantrax)
**Pickups (Fantrax)** builds a "Who to Pick Up" post from this week's risers and your
Fantrax roster percentages. Export the players list from Fantrax as CSV, click the
button and pick the file (shift-click to pick a new one later). The file is read in your
browser and never uploaded or committed.
* **Who qualifies:** on a top-10 riser list (all FBS, week to week or multi-week), or a
  20+ point jump this week on 8+ targets or 15+ carries.
* **Tiers:** Getting Ahead (25% rostered or less), Likely Available (26–50%), Double
  Check (51–75%). Above 75% is left off.
* **Order:** multi-week risers first, then one-week jumps; within each, the bigger current
  share first. The top tier splits into running backs and receivers/tight ends, 7 written
  up in each, the rest as "Deeper adds".
* Players missing from the Fantrax file are named at the bottom. Injury context (who a
  fill-in replaced) is added by hand.

### Trend callouts in recaps
A recap marks any player who is on that week's all-FBS trends lists: 📈 for rising,
📉 for falling, with a "Trending up: 12% → 44% target share" sub-bullet under his line.
Only real moves count: 12+ points week to week, or 10+ over the last 3 games (dropped if
this week went the other way). Emoji are used because Substack keeps them on paste;
colored text usually doesn't survive.

### Post format
The recap and trends posts match the published Substack format:
* **Recap** opens with "The numbers" (definitions and the team-line explainer), then
  the games, then the Data line.
* **Trends** uses "Week to Week" / "Multi-Week" headings with 📈 / 📉 subheads, a
  "Trend Lines for the Biggest Movers" chart, a "How the trends are measured" section
  and the Data line. The chart is a PNG (Copy image / Download PNG) with eight small
  line charts: from each week-to-week list, the biggest move plus the biggest move by
  an AP-ranked player (or the runner-up), each showing his share by week.
* **No injury flags.** CFBD has no injury reports, so the posts don't guess. Usage
  notes keep the fact ("didn't record a touch after 14 carries"), and confirmed injury
  context gets added by hand before publishing.
* **Didn't play**: a player with a heavy role last game (6+ targets or 12+ carries) and
  no touches at all is left off the trends lists, and the next player moves up to fill
  the top 10.
* "(compared with week N)" only appears when the player missed games his team played,
  not after a team bye.
4. Each opens a preview. **Copy text for Substack** pastes formatted (headings, bold,
   bullets). For table and leaderboard posts, use **Copy image** under each table and
   paste it where it goes.
5. Add your own take and publish.

### Usage notes and season context
Notes compare this week to the player's earlier weeks this season ("a season high",
"up from his 18% average"). Season numbers come from `data/weeks/history-<season>-<type>.json`,
rebuilt on every run. Averages cover the weeks a player appeared in the dashboard
(i.e. had real usage), so they skip weeks he sat out.

## How the stats are defined

| Stat | Definition |
|---|---|
| **Tgt %** | Player targets ÷ team targets. Targets are counted from play-by-play: completions, incompletions, and interceptions with a named receiver. Plays wiped out by penalty don't count. |
| **Car %** | RB carries ÷ team carries by non-QBs. QBs are excluded because college box scores count sacks as QB rushes. |
| **Yds %** | Share of team total yards (passing + rushing). For RB/WR/TE this is rushing + receiving yards; for QBs, passing + rushing yards. |
| **Dom %** | Dominator rating: the average of a player's share of team receiving yards and team receiving TDs. If the team had no receiving TDs, it's the yards share alone. Game cards show the single game; the leaderboard shows season to date, which is steadier (one TD swings a single game a lot). |
| **Plays** | Offensive snaps from play-by-play: runs, passes, sacks and fumbled snaps. Kicks, penalties with no play, and timeouts don't count. |
| **s/play** | Possession time ÷ snaps. CFBD's play-by-play clock only updates at drive changes, so possession time is measured per drive: from a drive's first play to the next drive's first play (or the end of the half). Overtime is excluded. Each game's possession adds up to 60:00. |
| **PROE** | Pass rate over expected, on 1st and 2nd down with the score within 7 (quarters 1–4). Expected = the pass rate of every offense that week in the same down, distance (1–3, 4–6, 7–10, 11+ yards) and field zone. Sacks count as passes; scrambles count as runs because play-by-play logs them as rushes. Shown when a team has 10+ such plays in a game (20+ for the season). |

The **Pace & PROE** post ranks teams in the current filter on season-to-date pace and
PROE (2+ games), with each team's week number alongside.

Every player with a pass, carry, target or catch is kept in the data. The dashboard
shows the **featured** group by default: up to 2 QBs, 2 RBs, 3–4 WRs (the 4th only
with 2+ targets) and 2 TEs. Turn on **All players** to see everyone. Leaderboards and
usage notes consider all players. Each team also has `totals.byPos`, its production by
position. The opponent's `byPos` is what that defense allowed. Positions come from the season roster. A player with no listed position
is classified by usage.

### Matching targets to players
Play-by-play names receivers in several styles: "Dillon Bell", "D.Bell", or the NCAA
feed's "pass complete short left to #13 C.Durr Jr.". The pipeline matches each name
against the team's full roster, so receivers who were targeted but caught nothing still
get credit. If an abbreviation fits two roster players (two "K.Gray"s), the target goes
to the one who recorded a stat in that game. If both did, it isn't guessed: the target
still counts in the team total, and the card shows an "N unassigned tgt" note.
Interceptions that don't name an intended receiver can't be attributed and aren't counted.

Each run writes its output to `data/last_run.log`, including how many pass plays were
attributed and which receiver names couldn't be matched.

## API usage
About 5 calls per weekly run (`/calendar`, `/games`, `/games/players`, `/plays`,
`/rankings`), plus one `/roster` call per season, which is cached in `data/cache/`.
Use `--refresh-roster` to re-pull it after midseason roster changes.

## Tests
```bash
python tests/make_fixtures.py   # builds fake API responses in tests/fixtures/
python tests/test_pipeline.py   # parsing, matching, totals, AP flags, limits
```
