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
   * **Top 20 leaderboard**: WR target share (min 7 targets), TE target share (min 5),
     RB carry share (min 12 carries), and the biggest risers, for whatever
     conference/AP filter is set.
   * **Trends up & down**: top 10 risers and fallers in target share and RB carry
     share, week to week (vs. the player's last game with touches) and multi-week
     (last 3 games vs. his earlier games; needs 5+ games, so it starts around week 5).
     Big drops are often injuries, so check the news before writing them up.
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
