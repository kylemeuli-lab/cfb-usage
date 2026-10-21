// Shared data loading and calculations for the dashboard (index.html) and the
// members site (members.html). Page-specific wiring lives in each page.
"use strict";
const DEFAULT_FILE = "week_stats.json";
const POWER4 = ["SEC", "Big Ten", "Big 12", "ACC"];
const state = { data: null, conf: "fbs", ap: false, all: false, sort: "rank", q: "", file: DEFAULT_FILE, dm: "ypp" };
const $ = (id) => document.getElementById(id);

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtPct = (v) => (v == null ? "–" : `${Math.round(v)}%`);

// ---------------------------------------------------------------- data load
async function loadJSON(path) {
  const r = await fetch(path, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

async function init() {
  readURL();
  try {
    const idx = await loadJSON("data/weeks/index.json");
    if (Array.isArray(idx) && idx.length) {
      const sel = $("week");
      sel.innerHTML = `<option value="${DEFAULT_FILE}">Latest week</option>` + idx.map((w) =>
        `<option value="${esc(w.file)}">${w.season} ${w.seasonType === "postseason" ? "Postseason " : ""}week ${w.week}</option>`).join("");
      $("weekCtl").hidden = false;
      if (![...sel.options].some((o) => o.value === state.file)) state.file = DEFAULT_FILE;
      sel.value = state.file;
    }
  } catch (_) { /* no archive yet: week picker stays hidden */ }
  await loadWeek(state.file);
}

async function loadWeek(file) {
  try {
    state.data = await loadJSON(file);
    state.file = file;
  } catch (e) {
    const local = location.protocol === "file:";
    $("subtitle").textContent = "No data loaded";
    $("grid").innerHTML = `<div class="empty"><h2>Couldn't load ${esc(file)}</h2>
      <p>${local ? "Browsers block reading local files from a page opened directly. In the project folder run <code>python -m http.server</code>, then open http://localhost:8000."
                 : "Run the pipeline (or the GitHub Action) to create it, then reload."}</p></div>`;
    return;
  }
  const m = state.data.meta;
  $("subtitle").textContent = `${m.season} ${m.seasonType === "postseason" ? "postseason" : "regular season"}, week ${m.week}`;
  $("updated").textContent = `Updated ${new Date(m.generatedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`;
  document.title = `Week ${m.week} usage report`;
  $("sampleBanner").hidden = !m.sample;
  buildConfOptions();
  await loadDefense();
  render();
}

// ---------------------------------------------------------------- defense ranks
// data/weeks/defense-<season>-<type>.json (built by the pipeline): FBS defenses ranked
// against the pass and the run, by EPA/play or yards/play allowed, in games vs FBS
// offenses. "in"[week] = ranks going into that week; "season" = through the latest week.
const DEF = { data: null, key: "" };
async function loadDefense() {
  const m = state.data.meta, key = `${m.season}-${m.seasonType}`;
  if (DEF.key === key) return;
  DEF.key = key;
  try { DEF.data = await loadJSON(`data/weeks/defense-${key}.json`); } catch (_) { DEF.data = null; }
}
const DM = { epa: { label: "EPA/play", pass: 0, run: 1, rank: 4, fmt: (v) => v.toFixed(2) },
             ypp: { label: "yards/play", pass: 2, run: 3, rank: 6, fmt: (v) => v.toFixed(1) } };
const ordinal = (n) => `${n}${[11, 12, 13].includes(n % 100) ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
/** A defense's rank vs. the pass or run: going into `week` and for the season. */
function defRank(team, week, kind, metric = state.dm) {
  const d = DEF.data;
  if (!d || !team) return null;
  const mm = DM[metric], col = kind === "pass" ? 0 : 1;
  const row = (r) => (r ? { rank: r[mm.rank + col], val: r[kind === "pass" ? mm.pass : mm.run], games: r[8] } : null);
  const n = Object.keys(d.season).length;
  const inn = row(d.in?.[String(week)]?.[team]), season = row(d.season[team]);
  if (!inn && !season) return null;
  return { inn, season, n, metric: mm };
}
const defBand = (rank, n) => 1 + Math.min(4, Math.floor(((rank - 1) / n) * 5));
/** Color-coded chip: rank going into the game (season rank when there is none yet). */
function defChip(team, week, kind) {
  const r = defRank(team, week, kind);
  if (!r) return "";
  const main = r.inn || r.season;
  const what = kind === "pass" ? "pass" : "run";
  const tip = [`${team}'s ${what} defense`,
    r.inn ? `going into this game: ${ordinal(r.inn.rank)} of ${r.n} (${r.metric.fmt(r.inn.val)} ${r.metric.label} allowed over ${plural(r.inn.games, "game")})` : "no games before this one",
    r.season ? `season: ${ordinal(r.season.rank)} (${r.metric.fmt(r.season.val)} ${r.metric.label})` : ""].filter(Boolean).join("\n");
  return `<span class="drk d${defBand(main.rank, r.n)}" title="${esc(tip)}">${ordinal(main.rank)}${r.inn ? "" : "*"}</span>`;
}
/** "vs. 34th pass D, 88th run D" for posts (going-in ranks; season if none yet). */
function defText(team, week, kinds = ["pass", "run"]) {
  const bits = kinds.map((k) => {
    const r = defRank(team, week, k);
    const m = r && (r.inn || r.season);
    return m ? `${ordinal(m.rank)} ${k} D` : null;
  }).filter(Boolean);
  return bits.length ? bits.join(", ") : "";
}

function buildConfOptions() {
  const confs = state.data.conferences || [];
  const others = confs.filter((c) => !POWER4.includes(c));
  const sel = $("conf");
  sel.innerHTML =
    `<option value="fbs">All FBS games</option><option value="all">All games</option>` +
    `<optgroup label="Power 4">${POWER4.map((c) => `<option>${esc(c)}</option>`).join("")}</optgroup>` +
    (others.length ? `<optgroup label="Other conferences">${others.map((c) => `<option>${esc(c)}</option>`).join("")}</optgroup>` : "");
  if (![...sel.options].some((o) => o.value === state.conf)) state.conf = "fbs";
  sel.value = state.conf;
  $("ap").checked = state.ap;
  $("allp").checked = state.all;
  $("sort").value = state.sort;
  $("dm").value = state.dm;
  $("q").value = state.q;
}

// ---------------------------------------------------------------- filtering
function visibleGames() {
  const q = state.q.trim().toLowerCase();
  let games = state.data.games.filter((g) => {
    const t = [g.home, g.away];
    if (state.conf === "fbs" && !g.fbsGame) return false;
    if (!["fbs", "all"].includes(state.conf) && !t.some((x) => x.conference === state.conf)) return false;
    if (state.ap && !g.apGame) return false;
    if (q && !t.some((x) => x.name.toLowerCase().includes(q) || x.players.some((p) => p.name.toLowerCase().includes(q)))) return false;
    return true;
  });
  const bestRank = (g) => Math.min(g.home.apRank || 99, g.away.apRank || 99);
  const bothRanked = (g) => (g.home.apRank && g.away.apRank ? 0 : 1);
  const sorters = {
    rank: (a, b) => bothRanked(a) - bothRanked(b) || bestRank(a) - bestRank(b) || a.startDate.localeCompare(b.startDate),
    kickoff: (a, b) => (a.startDate || "").localeCompare(b.startDate || ""),
    yards: (a, b) => (b.home.totals.totalYds + b.away.totals.totalYds) - (a.home.totals.totalYds + a.away.totals.totalYds),
  };
  return games.sort(sorters[state.sort]);
}

// ---------------------------------------------------------------- rendering
function teamLabel(t) {
  return (t.apRank ? `<span class="rank" title="AP rank">${t.apRank}</span>` : "") + esc(t.name);
}

function statLine(p) {
  const parts = [];
  if (p.passing) {
    const s = p.passing;
    parts.push(`${s.cmp}/${s.att}, ${s.yds} yds, ${s.td} TD${s.int ? `, ${s.int} INT` : ""}`);
  }
  if (p.rushing) parts.push(`${p.rushing.car} car, ${p.rushing.yds} yds${p.rushing.td ? `, ${p.rushing.td} TD` : ""}`);
  if (p.receiving) {
    const r = p.receiving;
    parts.push(`${r.rec}/${r.tgt} rec/tgt, ${r.yds} yds${r.td ? `, ${r.td} TD` : ""}`);
  }
  return parts.join("; ");
}

const signedPct = (v) => (v == null ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`);
/** "68 plays · 27.4 s/play · PROE +5.1%" (html=true adds hover explanations). */
function tempoLine(t, html = false) {
  const pc = t.pace, pr = t.proe, bits = [];
  const tip = (txt, title) => (html ? `<span title="${title}">${txt}</span>` : txt);
  if (pc && pc.plays) bits.push(tip(`${pc.plays} plays`, "Offensive snaps: runs, passes, sacks, fumbled snaps"));
  if (pc && pc.secPerPlay != null) bits.push(tip(`${pc.secPerPlay.toFixed(1)} s/play`, "Possession time per snap"));
  if (pr && pr.proe != null) bits.push(tip(`PROE ${signedPct(pr.proe)}`, `Neutral pass rate ${pr.passRate}% vs. ${pr.expRate}% expected (${pr.plays} plays: 1st/2nd down, score within 7)`));
  return bits.join(" · ");
}

function teamTable(t, opp) {
  const m = t.totals;
  const notes = [];
  if (t.targetsSource !== "pbp") notes.push(`<span class="note" title="Play-by-play missing for this game">Tgt % uses receptions</span>`);
  else if (m.unmatchedTargets) notes.push(`<span class="note" title="Receiver name in play-by-play matched more than one player">${m.unmatchedTargets} unassigned tgt</span>`);
  // Older week files have no "featured" flag: treat every listed player as featured.
  const shownPlayers = state.all ? t.players : t.players.filter((p) => p.featured !== false);
  const hidden = t.players.length - shownPlayers.length;
  const rows = shownPlayers.map((p) => {
    const mt = p.metrics;
    const w = Math.max(0, Math.min(100, mt.yds_pct || 0));
    return `<tr>
      <td><span class="pos">${esc(p.pos)}</span><span class="pname">${esc(p.name)}</span>
        <div class="line">${esc(statLine(p))}</div>
        <div class="field" role="img" aria-label="${fmtPct(mt.yds_pct)} of team yards"><i style="width:${w}%"></i></div></td>
      <td class="num ${mt.tgt_share == null ? "dim" : ""}">${fmtPct(mt.tgt_share)}</td>
      <td class="num ${mt.carry_share == null ? "dim" : ""} hide-sm">${fmtPct(mt.carry_share)}</td>
      <td class="num">${fmtPct(mt.yds_pct)}</td>
      <td class="num ${mt.dominator == null ? "dim" : ""} hide-sm">${fmtPct(mt.dominator)}</td>
    </tr>`;
  }).join("");
  return `<section class="team">
    <h3><span style="font:inherit;color:inherit">${esc(t.name)}</span><span>${m.totalYds} yds (${m.passYds} pass, ${m.rushYds} rush), ${m.targets} tgt ${notes.join(" ")}</span></h3>
    ${tempoLine(t) ? `<p class="tempo">${tempoLine(t, true)}</p>` : ""}
    ${opp && defChip(opp.name, state.data.meta.week, "pass") ? `<p class="dline">Faced: pass D ${defChip(opp.name, state.data.meta.week, "pass")} run D ${defChip(opp.name, state.data.meta.week, "run")}</p>` : ""}
    <table><thead><tr><th scope="col">Player</th><th scope="col">Tgt %</th><th scope="col" class="hide-sm">Car %</th><th scope="col">Yds %</th><th scope="col" class="hide-sm" title="Dominator rating: average of share of team receiving yards and receiving TDs">Dom %</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="5">No skill-player stats recorded.</td></tr>`}</tbody></table>
    ${hidden ? `<p class="more">${hidden} more player${hidden === 1 ? "" : "s"} with touches. Turn on All players to see them.</p>` : ""}
  </section>`;
}

function gameCard(g) {
  const [w, l] = g.winner === "home" ? [g.home, g.away] : [g.away, g.home];
  const order = [g.away, g.home];
  const d = g.startDate ? new Date(g.startDate) : null;
  const when = d ? d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "";
  const where = g.neutralSite ? `${g.venue || "neutral site"} (neutral)` : `at ${g.home.name}`;
  const confs = [...new Set(order.map((t) => t.conference).filter(Boolean))].join(" vs ");
  const scoreRow = (t) => `<div class="score-row ${t === w && g.winner ? "winner" : t === l && g.winner ? "loser" : ""}">
      <span class="tm">${teamLabel(t)}</span><span class="pts">${t.points ?? "–"}</span></div>`;
  return `<article class="game ${g.apGame ? "ranked" : ""}" data-id="${g.id}">
    <div class="board">
      <div class="scores">${order.map(scoreRow).join("")}</div>
      <div class="board-side">
        <span class="conf-tag">${esc(confs)}${g.conferenceGame ? "" : " (non-conf)"}</span>
        <span class="card-posts"><button class="btn" type="button" data-post="${g.id}" data-kind="recap">Recap post</button><button class="btn ghost" type="button" data-post="${g.id}" data-kind="tables">Table post</button></span>
      </div>
      <div class="meta">${esc(when)}, ${esc(where)}</div>
    </div>
    <div class="teams">${teamTable(w, l)}${teamTable(l, w)}</div>
  </article>`;
}

function render() {
  if (!state.data) return;
  const games = visibleGames();
  $("count").textContent = `${games.length} of ${state.data.games.length} games`;
  document.querySelectorAll("[data-postall]").forEach((b) => (b.disabled = !games.length && !["leaderboard", "trends", "pace", "pickups"].includes(b.dataset.postall)));
  $("grid").innerHTML = games.length ? games.map(gameCard).join("") :
    `<div class="empty"><h2>No games match</h2><p>Try another conference, turn off AP Top 25 only, or clear the search.</p></div>`;
  writeURL();
}

// ================================================================ Substack posts
// Three post types, all built from the games currently shown (filters apply):
//   recap       game-by-game: usage notes + trimmed player lines
//   tables      same games: usage notes + a table image per game
//   leaderboard top-20 target share, top-20 RB carry share, biggest risers
// Season context ("season high", "up from his 18% average") comes from
// data/weeks/history-<season>-<type>.json, loaded the first time a post is built.

const R = (v) => Math.round(v);
const plural = (n, word) => `${n} ${n === 1 ? word : word === "carry" ? "carries" : `${word}s`}`;
const poss = (team) => (team.endsWith("s") ? `${team}'` : `${team}'s`);
const recLine = (r) => `${plural(r.rec, "catch").replace("catchs", "catches")} for ${r.yds} yards${r.td ? ` and ${plural(r.td, "TD")}` : ""}`;
const slash = (r) => `${r.rec}-${r.yds}-${r.td}`;
/** "a 30% average" / "an 18% average" / "an 8% average" */
const aPct = (v) => `${/^(8|11|18|8\d)$/.test(String(R(v))) ? "an" : "a"} ${R(v)}%`;

const historyCache = {};
// School abbreviations (from CFBD's team list) for "Name (ABBR)" in commentary.
const TEAM_ABBR = {};
const abbr = (t) => (t && (t.abbr || TEAM_ABBR[t.name])) || (t && t.name) || "";
const nm = (name, t) => `**${name}** (${abbr(t)})`;
async function loadHistory() {
  const m = state.data.meta;
  const key = `${m.season}-${m.seasonType}`;
  if (!Object.keys(TEAM_ABBR).length) {
    try { Object.assign(TEAM_ABBR, await loadJSON(`data/weeks/teams-${m.season}.json`)); } catch (_) { /* falls back to team names */ }
  }
  if (!(key in historyCache)) {
    try { historyCache[key] = await loadJSON(`data/weeks/history-${key}.json`); }
    catch (_) { historyCache[key] = null; }   // posts still work, just without season context
  }
  return historyCache[key];
}

/** Usage in weeks before `week`, in games where the player was featured. */
function priorContext(hist, id, week) {
  const e = hist?.players?.[id];
  if (!e) return null;
  const rows = Object.entries(e.w).filter(([w]) => +w < week)
    .map(([w, a]) => ({ w: +w, tgt: a[0], ts: a[1], car: a[2], cs: a[3] }));
  if (!rows.length) return null;
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ts = rows.filter((r) => r.ts != null).map((r) => r.ts);
  const cs = rows.filter((r) => r.cs != null).map((r) => r.cs);
  return {
    games: rows.length,
    avgTs: ts.length ? mean(ts) : null, maxTs: ts.length ? Math.max(...ts) : null,
    avgCs: cs.length ? mean(cs) : null, maxCs: cs.length ? Math.max(...cs) : null,
  };
}

/** Who makes the trimmed recap: the players a reader would care about. */
function isFeatured(p, team) {
  const m = p.metrics;
  if (p.pos === "QB") {
    const topQb = team.players.filter((x) => x.pos === "QB").sort((a, b) => (b.passing?.att || 0) - (a.passing?.att || 0))[0];
    return p === topQb || (p.passing?.att || 0) >= 10 || (m.yds_pct || 0) >= 15;
  }
  if (p.pos === "RB") return (m.carry_share || 0) >= 20 || (m.tgt_share || 0) >= 10 || (m.yds_pct || 0) >= 10;
  return (m.tgt_share || 0) >= 10 || (m.yds_pct || 0) >= 10;
}

/**
 * Narrative usage notes for one game. Every rule produces a candidate with a score;
 * the best few are kept, one note per player, at most 3 per team, 5 per game.
 */
function usageNotes(g, hist, week) {
  const notes = [];
  for (const t of [g.home, g.away]) {
    if (t.targetsSource !== "pbp") continue;            // no real targets, no target narratives
    const add = (score, pid, text) => notes.push({ score, pid, team: t.name, text });
    const rbs = t.players.filter((p) => p.pos === "RB" && p.rushing).sort((a, b) => b.rushing.car - a.rushing.car);
    const limCar = limitedTeammates(hist, t.name, "RB", week, "car");
    const limTgt = ["WR", "TE", "RB"].flatMap((pos) => limitedTeammates(hist, t.name, pos, week, "tgt"));
    for (const x of limCar) add(45 + x.before / 2, `inj-${x.id}`, `${nm(x.name, t)} ${x.absent ? "didn't record a touch" : `was limited to ${plural(x.now, "carry")}`} after ${plural(x.before, "carry")} in his previous game.`);
    for (const x of limTgt) add(42 + x.before / 2, `inj-${x.id}`, `${nm(x.name, t)} ${x.absent ? "didn't record a touch" : `drew just ${plural(x.now, "target")}`} after ${plural(x.before, "target")} in his previous game.`);

    for (const p of t.players) {
      const m = p.metrics, r = p.receiving, ctx = priorContext(hist, p.id, week);
      const name = nm(p.name, t);
      const enough = ctx && ctx.games >= 2;

      if (p.pos !== "QB" && r && r.tgt >= 5 && m.tgt_share != null) {
        const s = m.tgt_share;
        let ctxText = "";
        if (enough && ctx.maxTs != null && R(s) > R(ctx.maxTs) && s >= 20) ctxText = ` That's a season high (previous best: ${R(ctx.maxTs)}%).`;
        else if (enough && ctx.avgTs != null && s - ctx.avgTs >= 8) ctxText = ` That's well above his ${R(ctx.avgTs)}% season average.`;

        if (enough && ctx.maxTs != null && ctx.maxTs < 15 && s >= 22)
          add(40 + s / 2, p.id, `${name} had a breakout role: ${R(s)}% of ${poss(t.name)} targets (${r.tgt}) after never topping ${R(ctx.maxTs)}% in a game this season. He turned them into ${recLine(r)}.`);
        else if (s >= 30 && r.tgt >= 7)
          add(30 + s / 2 + (ctxText ? 8 : 0), p.id, `${name} commanded ${R(s)}% of ${poss(t.name)} targets (${r.tgt}) and turned them into ${recLine(r)}.${ctxText}`);
        else if (enough && ctx.avgTs != null && s - ctx.avgTs >= 12)
          add(28 + (s - ctx.avgTs), p.id, `${name} saw a usage spike: ${R(s)}% target share (${r.tgt} targets), up from his ${R(ctx.avgTs)}% average over ${ctx.games} games.`);
        else if (enough && ctx.avgTs != null && ctx.avgTs >= 22 && ctx.avgTs - s >= 12)
          add(26 + (ctx.avgTs - s), p.id, `${name} saw a smaller role: ${R(s)}% target share (${r.tgt} targets) vs. his ${R(ctx.avgTs)}% season average.`);
        else if (r.tgt >= 6 && r.rec / r.tgt <= 0.34)
          add(22 + r.tgt, p.id, `${name} drew ${r.tgt} targets but caught only ${r.rec}. The volume (${R(s)}% share) is the part worth watching.`);
      }
      if (p.pos !== "QB" && r && r.tgt >= 4 && r.yds / r.tgt >= 15)
        add(18 + r.yds / r.tgt / 2, p.id, `${name} made his targets count: ${r.yds} yards on ${r.tgt} targets (${(r.yds / r.tgt).toFixed(1)} per target).`);

      if (p.pos === "RB" && p.rushing && m.carry_share != null) {
        const c = m.carry_share, ru = p.rushing;
        if (enough && ctx.avgCs != null && c - ctx.avgCs >= 20 && ru.car >= 12)
          add(34 + (c - ctx.avgCs) / 2, p.id, `${name} took over the backfield: ${R(c)}% of the RB carries (${ru.car} for ${ru.yds} yards), up from his ${R(ctx.avgCs)}% average.`);
        else if (c >= 65 && ru.car >= 15)
          add(24 + c / 5, p.id, `${name} was the clear lead back, handling ${R(c)}% of the RB carries (${ru.car} for ${ru.yds} yards${ru.td ? `, ${plural(ru.td, "TD")}` : ""}).`);
      }
      if (p.pos === "QB" && p.rushing && p.rushing.yds >= 80)
        add(20 + p.rushing.yds / 20, p.id, `${name} did damage with his legs: ${p.rushing.car} carries for ${p.rushing.yds} yards${p.rushing.td ? ` and ${plural(p.rushing.td, "TD")}` : ""}.`);
      else if (p.pos === "QB" && (m.yds_pct || 0) >= 80)
        add(14, p.id, `${name} was the offense: he accounted for ${R(m.yds_pct)}% of ${poss(t.name)} total yards.`);
    }
    if (rbs.length >= 2) {
      const [a, b] = rbs, ca = a.metrics.carry_share || 0, cb = b.metrics.carry_share || 0;
      if (ca >= 30 && cb >= 30 && Math.abs(ca - cb) <= 15 && a.rushing.car + b.rushing.car >= 16)
        add(21, `split-${t.name}`, `${poss(t.name)} backfield was a committee: ${nm(a.name, t)} ${R(ca)}% of RB carries, ${nm(b.name, t)} ${R(cb)}%.`);
    }
  }
  notes.sort((x, y) => y.score - x.score);
  const seen = new Set(), perTeam = {}, out = [];
  let injuries = 0;
  for (const n of notes) {
    const isInjury = String(n.pid).startsWith("inj-");
    const pid = String(n.pid).replace(/^inj-/, "");
    if (seen.has(pid) || (perTeam[n.team] || 0) >= 3 || (isInjury && injuries >= 2)) continue;
    if (isInjury) injuries++;
    n.pid = pid;
    seen.add(n.pid); perTeam[n.team] = (perTeam[n.team] || 0) + 1; out.push(n.text);
    if (out.length >= 5) break;
  }
  return out;
}

function gameHeader(g) {
  const [w, l] = g.winner === "away" ? [g.away, g.home] : [g.home, g.away];
  const name = (t) => `${t.apRank ? `#${t.apRank} ` : ""}${t.name}`;
  const d = g.startDate ? new Date(g.startDate).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }) : "";
  const confs = [...new Set([g.away.conference, g.home.conference].filter(Boolean))].join(" vs. ");
  return { w, l, lines: [`### ${name(w)} ${w.points}, ${name(l)} ${l.points}`, "", `*${[d, confs].filter(Boolean).join(", ")}*`, ""] };
}

// ---------------------------------------------------------------- trend callouts
// A recap marks any player who is on this week's trends post (same filters), so the
// recap doubles as a teaser for it. 📈 / 📉 survive a paste into Substack; colored
// text usually doesn't.
let TREND_INDEX = null;
// Only real moves get an emoji: 12+ points week to week, 10+ over the last 3 games.
const CALLOUT = { w2w: 12, multi: 10 };
function buildTrendIndex(hist) {
  const tr = buildTrends(hist), wk = state.data.meta.week, cand = new Map();
  const add = (rows, dir, kind, span) => rows.forEach((r) => {
    if (Math.abs(r.d) < CALLOUT[span]) return;
    const list = cand.get(r.p.id) || [];
    list.push({ dir, kind, span, d: r.d, before: r.before, now: r.now, vol: r.vol, volBefore: r.volBefore, injury: r.injury, absent: r.absent, p: r.p, t: r.t });
    cand.set(r.p.id, list);
  });
  for (const [k, kind] of [["tgt", "tgt"], ["car", "car"]]) {
    add(tr.w2w[`${k}Up`], 1, kind, "w2w"); add(tr.w2w[`${k}Down`], -1, kind, "w2w");
    add(tr.multi[`${k}Up`], 1, kind, "multi"); add(tr.multi[`${k}Down`], -1, kind, "multi");
  }
  const idx = new Map();
  for (const [id, list] of cand) {
    // Prefer this week's move; a multi-week move only counts if this week didn't go the other way.
    const w2w = list.filter((x) => x.span === "w2w").sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    let pick = w2w[0];
    if (!pick) {
      const multi = list.sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
      const series = playerSeries(hist, id, wk), now = series[series.length - 1], prev = series[series.length - 2];
      const key = multi.kind === "tgt" ? "ts" : "cs";
      const thisWeek = now && prev && now.w === wk && now[key] != null && prev[key] != null ? now[key] - prev[key] : 0;
      if (Math.sign(thisWeek) === -multi.dir && Math.abs(thisWeek) >= 5) continue;
      pick = multi;
    }
    idx.set(id, pick);
  }
  return idx;
}
const trendEmoji = (x) => (x.dir > 0 ? "📈" : "📉");
function trendTag(x) {
  const what = x.kind === "tgt" ? "target share" : "of RB carries";
  const span = x.span === "multi" ? " over his last 3 games" : "";
  return `${x.dir > 0 ? "Trending up" : "Trending down"}${span}: ${R(x.before)}% → ${R(x.now)}% ${what}.`;
}

// Definitions that open the recap post, the way the published posts run.
function recapNumbers() {
  return ["## The numbers", "",
    "* **Target share** = a player's targets / his team's targets. Targets come from play-by-play, so they include incompletions.",
    "* **RB carries** = a back's carries / all non-QB carries.",
    "* **% of team yards** = a player's passing, rushing and receiving yards / team total yards.",
    `* 📈 / 📉 = the player is on this week's all-FBS trends list (a ${CALLOUT.w2w}+ point move from his previous game, or ${CALLOUT.multi}+ points over his last 3 games). The full list is in this week's Trends post.`, "",
    "Each team line also shows **plays** (offensive snaps), **s/play** (possession time per snap) and **PROE** (pass rate over expected on 1st and 2nd down with the score within 7). PROE is left off when a team had fewer than 10 of those plays, usually a blowout.", "",
    `"vs. 34th pass D, 88th run D" is where the opponent's defense ranked among FBS teams going into the game, by ${DM[state.dm].label} allowed (1st = toughest).`, "",
    "## Game recaps", "", ""].join("\n");
}
function dataLine(extra) {
  const at = state.data.meta.generatedAt ? new Date(state.data.meta.generatedAt) : null;
  const when = at ? `, pulled ${at.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : "";
  return `Data: [CollegeFootballData.com](https://collegefootballdata.com)${when}. ${extra}`;
}

/** Game recap: usage notes, then the featured players for each team. */
function gameToMarkdown(g, hist) {
  const { w, l, lines: out } = gameHeader(g);
  const notes = usageNotes(g, hist, state.data.meta.week);
  if (notes.length) out.push("**Usage notes**", "", ...notes.map((n) => `* ${n}`), "");
  for (const t of [w, l]) {
    out.push(`#### ${t.name}`, "");
    const opp = t === w ? l : w, faced = defText(opp.name, state.data.meta.week);
    out.push(`*${t.totals.totalYds} total yards (${t.totals.passYds} passing, ${t.totals.rushYds} rushing)${tempoLine(t) ? ` · ${tempoLine(t)}` : ""}${faced ? ` · vs. ${faced}` : ""}*`, "");
    const shown = t.players.filter((p) => isFeatured(p, t));
    for (const p of shown) {
      const tx = TREND_INDEX?.get(p.id);
      out.push(`* ${tx ? `${trendEmoji(tx)} ` : ""}**${p.name} (${abbr(t)}, ${p.pos}):** ${playerMarkdownLine(p, t.targetsSource === "pbp")}`);
      if (tx) out.push(`  * ${trendTag(tx)}`);
    }
    // Trend players who didn't make the list above (no touches, or below the cutoff).
    const shownIds = new Set(shown.map((p) => p.id));
    for (const tx of TREND_INDEX?.values() || []) {
      if (tx.t.name !== t.name || shownIds.has(tx.p.id) || !tx.injury) continue;
      out.push(`* ${trendEmoji(tx)} **${tx.p.name} (${abbr(t)}, ${tx.p.pos}):** ${tx.absent ? "no touches" : plural(tx.vol, UNIT[tx.kind])} after ${tx.volBefore} in his previous game.`, `  * ${trendTag(tx)}`);
    }
    if (!shown.length) out.push("* No skill player reached the usage cutoff.");
    out.push("");
  }
  return out.join("\n").trim() + "\n";
}

function playerMarkdownLine(p, hasTargets = true) {
  const m = p.metrics, bits = [], usage = [];
  if (p.passing) {
    const s = p.passing;
    bits.push(`${s.cmp}/${s.att}, ${s.yds} pass yds, ${s.td} TD${s.int ? `, ${s.int} INT` : ""}`);
  }
  if (p.pos === "RB" && p.rushing) {
    bits.push(`${p.rushing.car} car, ${p.rushing.yds} rush yds${p.rushing.td ? `, ${p.rushing.td} TD` : ""}`);
    if (p.receiving && p.receiving.rec) bits.push(`${p.receiving.rec} rec, ${p.receiving.yds} rec yds${p.receiving.td ? `, ${p.receiving.td} TD` : ""}`);
    if (m.carry_share != null) usage.push(`${R(m.carry_share)}% of RB carries`);
  } else if (p.receiving) {
    const r = p.receiving;
    bits.push(`${r.rec} rec, ${r.yds} yds${r.td ? `, ${r.td} TD` : ""}` + (hasTargets ? ` on ${plural(r.tgt, "target")}` : ""));
    if (p.rushing) bits.push(`${p.rushing.car} car, ${p.rushing.yds} rush yds`);
    if (m.tgt_share != null) usage.push(`${R(m.tgt_share)}% ${hasTargets ? "target share" : "of team receptions"}`);
  } else if (p.rushing) {
    bits.push(`${p.rushing.car} car, ${p.rushing.yds} rush yds${p.rushing.td ? `, ${p.rushing.td} TD` : ""}`);
  }
  if (m.yds_pct) usage.push(`${R(m.yds_pct)}% of team yards`);
  return bits.join("; ") + (usage.length ? ` (${usage.join(", ")})` : "");
}

// ---------------------------------------------------------------- tables
const TEAM_COLUMNS = [
  { label: "Player", align: "left" }, { label: "Pos", align: "left" },
  { label: "Passing", align: "left" }, { label: "Rushing", align: "left" },
  { label: "Receiving", align: "left" }, { label: "Tgt %", align: "right" },
  { label: "Car %", align: "right" }, { label: "Yds %", align: "right" }, { label: "Dom %", align: "right" },
];
function teamRows(t) {
  const dash = "–", pc = (v) => (v == null ? dash : `${R(v)}%`);
  return t.players.filter((p) => isFeatured(p, t)).map((p) => [
    p.name, p.pos,
    p.passing ? `${p.passing.cmp}/${p.passing.att}, ${p.passing.yds} yds, ${p.passing.td} TD${p.passing.int ? `, ${p.passing.int} INT` : ""}` : dash,
    p.rushing ? `${p.rushing.car} for ${p.rushing.yds}${p.rushing.td ? `, ${p.rushing.td} TD` : ""}` : dash,
    p.receiving && p.pos !== "QB" ? `${slash(p.receiving)} (${p.receiving.tgt} tgt)` : dash,
    pc(p.metrics.tgt_share), pc(p.metrics.carry_share), pc(p.metrics.yds_pct), pc(p.metrics.dominator),
  ]);
}
function mdTable(columns, rows) {
  const head = `| ${columns.map((c) => c.label).join(" | ")} |`;
  const rule = `| ${columns.map((c) => (c.align === "right" ? "---:" : ":---")).join(" | ")} |`;
  return [head, rule, ...rows.map((r) => `| ${r.map((v) => String(v).replace(/\|/g, "/")).join(" | ")} |`)].join("\n");
}

/** Table post for one game: notes in text, then one image holding both team tables. */
function gameToTableMarkdown(g, hist, imageIndex) {
  const { w, l, lines: out } = gameHeader(g);
  const notes = usageNotes(g, hist, state.data.meta.week);
  if (notes.length) out.push("**Usage notes**", "", ...notes.map((n) => `* ${n}`), "");
  out.push(`[[image:${imageIndex}]]`, "");
  for (const t of [w, l]) out.push(`#### ${t.name}`, "", mdTable(TEAM_COLUMNS, teamRows(t)), "");
  return out.join("\n").trim() + "\n";
}
function gameTableImage(g) {
  const { w, l } = gameHeader(g);
  const name = (t) => `${t.apRank ? `#${t.apRank} ` : ""}${t.name}`;
  return drawTableImage({
    title: `${name(w)} ${w.points}, ${name(l)} ${l.points}`,
    subtitle: `Week ${state.data.meta.week} usage. Tgt % = share of team targets; Car % = share of RB carries; Yds % = share of team yards; Dom % = avg of receiving yards and TD shares.`,
    groups: [w, l].map((t) => ({ heading: `${t.name}: ${t.totals.totalYds} yards (${t.totals.passYds} pass, ${t.totals.rushYds} rush)${tempoLine(t) ? ` · ${tempoLine(t)}` : ""}`,
                                 columns: TEAM_COLUMNS, rows: teamRows(t) })),
  });
}

// ---------------------------------------------------------------- leaderboard
// Tight ends draw fewer targets, so they get a lower minimum (about 25-40 FBS TEs reach 5 a week).
const LB = { minTargets: { WR: 7, TE: 5 }, minCarries: 12, size: 20 };
function leaderboardScopeLabel() {
  const c = state.conf === "fbs" ? "All FBS" : state.conf === "all" ? "All games" : state.conf;
  return state.ap ? `${c}, AP Top 25 teams` : c;
}
function leaderboardTeams() {
  const teams = [];
  for (const g of state.data.games) for (const t of [g.home, g.away]) {
    if (state.conf === "fbs" && t.classification !== "fbs") continue;
    if (!["fbs", "all"].includes(state.conf) && t.conference !== state.conf) continue;
    if (state.ap && !t.apRank) continue;
    teams.push(t);
  }
  return teams;
}
/** Season-to-date dominator: share of team receiving yards and TDs over the weeks he played. */
function seasonDominator(hist, id, week) {
  const e = hist?.players?.[id], tm = e && hist?.teams?.[e.t];
  if (!e || !tm || e.p === "QB") return null;
  let py = 0, pt = 0, ty = 0, tt = 0;
  for (const [w, a] of Object.entries(e.w)) {
    const ta = tm.w[w];
    if (+w > week || !ta || a[6] == null || a[8] == null) continue;
    py += a[6]; pt += a[8]; ty += ta[7] || 0; tt += ta[8] || 0;
  }
  if (ty <= 0) return null;
  const ys = (100 * py) / ty;
  return Math.max(0, tt > 0 ? (ys + (100 * pt) / tt) / 2 : ys);
}
function buildLeaderboard(hist) {
  const wk = state.data.meta.week, wr = [], te = [], car = [], risers = [];
  for (const t of leaderboardTeams()) for (const p of t.players) {
    const m = p.metrics, ctx = priorContext(hist, p.id, wk);
    const row = { p, t, ctx, sdom: seasonDominator(hist, p.id, wk) };
    const min = LB.minTargets[p.pos];
    if (min && t.targetsSource === "pbp" && p.receiving && p.receiving.tgt >= min && m.tgt_share != null) {
      (p.pos === "TE" ? te : wr).push(row);
      if (ctx && ctx.games >= 2 && ctx.avgTs != null) risers.push({ ...row, delta: m.tgt_share - ctx.avgTs });
    }
    if (p.pos === "RB" && p.rushing && p.rushing.car >= LB.minCarries && m.carry_share != null) car.push(row);
  }
  const byShare = (a, b) => b.p.metrics.tgt_share - a.p.metrics.tgt_share || b.p.receiving.tgt - a.p.receiving.tgt;
  wr.sort(byShare); te.sort(byShare);
  car.sort((a, b) => b.p.metrics.carry_share - a.p.metrics.carry_share || b.p.rushing.car - a.p.rushing.car);
  risers.sort((a, b) => b.delta - a.delta);
  return { wr: wr.slice(0, LB.size), te: te.slice(0, LB.size), car: car.slice(0, LB.size), risers: risers.filter((r) => r.delta >= 8).slice(0, 5),
           season: buildSeasonLeaders(hist), hist };
}
// Season to date: target share (WR, TE) and RB carry share over the games each player
// played. Team totals per game are backed out of any teammate's count and share.
// Same per-game floors as the weekly lists (7 targets WR, 5 TE), so low-volume players stay off.
const SEASON_LB = { size: 5, minTgtPerGame: { WR: 7, TE: 5 }, minCarPerGame: 10, minGameShare: 0.5, rbFullTgtShare: 20 };
function buildSeasonLeaders(hist) {
  const wk = state.data.meta.week, out = { WR: [], TE: [], RB: [] };
  if (!hist?.players) return out;
  // Which teams count: the same conference / FBS / AP filter as the weekly lists.
  const week = leaderboardTeams(), names = new Set(week.map((t) => t.name));
  const fbsConfs = new Set(state.data.games.flatMap((g) => [g.home, g.away]).filter((t) => t.classification === "fbs").map((t) => t.conference));
  const inScope = (name) => {
    if (names.has(name)) return true;
    if (state.ap) return false;                   // ranked status is only known for teams that played
    const c = hist.teams?.[name]?.c;
    return state.conf === "all" || (state.conf === "fbs" ? fbsConfs.has(c) : c === state.conf);
  };
  const live = new Map(week.map((t) => [t.name, t]));
  const teamTot = {};                             // team -> week -> {tgt, car}
  for (const e of Object.values(hist.players)) for (const [w, a] of Object.entries(e.w)) {
    const tt = ((teamTot[e.t] ??= {})[w] ??= { tgt: 0, car: 0 });
    if (a[0] > 0 && a[1] > 0) tt.tgt = Math.max(tt.tgt, Math.round((a[0] * 100) / a[1]));
    if (a[2] > 0 && a[3] > 0) tt.car = Math.max(tt.car, Math.round((a[2] * 100) / a[3]));
  }
  for (const [id, e] of Object.entries(hist.players)) {
    if (!["WR", "TE", "RB"].includes(e.p) || !inScope(e.t)) continue;
    const teamGames = Object.keys(hist.teams?.[e.t]?.w || {}).filter((w) => +w <= wk).length;
    let g = 0, tgt = 0, ttgt = 0, car = 0, tcar = 0;
    for (const [w, a] of Object.entries(e.w)) {
      if (+w > wk) continue;
      const tt = teamTot[e.t]?.[w];
      g += 1;
      if (tt?.tgt) { tgt += a[0] || 0; ttgt += tt.tgt; }
      if (tt?.car) { car += a[2] || 0; tcar += tt.car; }
    }
    if (!g || g < Math.max(3, Math.ceil(teamGames * SEASON_LB.minGameShare))) continue;
    const t = live.get(e.t) || { name: e.t, abbr: hist.teams?.[e.t]?.a };
    const row = { id, name: e.n, t, games: g, sdom: seasonDominator(hist, id, wk) };
    if (e.p === "RB") {
      // RB dominator: average of his share of RB carries and his receiving credit, where a
      // 20% share of team targets counts as full credit (backs rarely draw more), capped at 100%.
      if (tcar && car / g >= SEASON_LB.minCarPerGame) {
        const cs = (100 * car) / tcar, ts = ttgt ? (100 * tgt) / ttgt : 0;
        const credit = Math.min(100, (100 * ts) / SEASON_LB.rbFullTgtShare);
        out.RB.push({ ...row, share: cs, perGame: car / g, tgtShare: ts, tgtPerGame: tgt / g, tgtCredit: credit, rbDom: (cs + credit) / 2 });
      }
    } else if (ttgt && tgt / g >= SEASON_LB.minTgtPerGame[e.p]) out[e.p].push({ ...row, share: (100 * tgt) / ttgt, perGame: tgt / g });
  }
  // WRs and TEs rank by season dominator; RBs by RB dominator (carry share + target share).
  const byDom = (a, b) => (b.sdom ?? -1) - (a.sdom ?? -1) || b.share - a.share;
  const byRbDom = (a, b) => b.rbDom - a.rbDom || b.share - a.share;
  for (const k of Object.keys(out)) out[k] = out[k].sort(k === "RB" ? byRbDom : byDom).slice(0, SEASON_LB.size);
  return out;
}

// Season volume: raw per-game production, for high-volume offenses where a big
// share of a big pie still reads as an average share. Same scope and games-played
// rule as the season leaders; per-game numbers are over the games he played.
const VOL = { size: 5, minGameShare: 0.5, minTgtPerGame: { WR: 4, TE: 3 }, minTouchPerGame: 8 };
function buildSeasonVolume(hist) {
  const wk = state.data.meta.week, out = { WR: [], TE: [], RB: [] };
  if (!hist?.players) return out;
  const week = leaderboardTeams(), names = new Set(week.map((t) => t.name)), live = new Map(week.map((t) => [t.name, t]));
  const fbsConfs = new Set(state.data.games.flatMap((g) => [g.home, g.away]).filter((t) => t.classification === "fbs").map((t) => t.conference));
  const inScope = (name) => names.has(name) || (!state.ap && (state.conf === "all" ||
    (state.conf === "fbs" ? fbsConfs.has(hist.teams?.[name]?.c) : hist.teams?.[name]?.c === state.conf)));
  for (const [id, e] of Object.entries(hist.players)) {
    if (!["WR", "TE", "RB"].includes(e.p) || !inScope(e.t)) continue;
    const teamGames = Object.keys(hist.teams?.[e.t]?.w || {}).filter((w) => +w <= wk).length;
    let g = 0, tgt = 0, rec = 0, recYds = 0, recTd = 0, car = 0, rushYds = 0;
    for (const [w, a] of Object.entries(e.w)) {
      if (+w > wk) continue;
      g += 1; tgt += a[0] || 0; car += a[2] || 0; rec += a[5] || 0; recYds += a[6] || 0; rushYds += a[7] || 0; recTd += a[8] || 0;
    }
    if (!g || g < Math.max(3, Math.ceil(teamGames * VOL.minGameShare))) continue;
    const row = { id, name: e.n, t: live.get(e.t) || { name: e.t, abbr: hist.teams?.[e.t]?.a }, pos: e.p, games: g,
                  tgt, rec, recYds, recTd, car, rushYds, scrimYds: recYds + rushYds,
                  tgtPg: tgt / g, recYdsPg: recYds / g, carPg: car / g, rushYdsPg: rushYds / g, scrimPg: (recYds + rushYds) / g };
    if (e.p === "RB") { if ((car + tgt) / g >= VOL.minTouchPerGame) out.RB.push(row); }
    else if (tgt / g >= VOL.minTgtPerGame[e.p]) out[e.p].push(row);
  }
  out.WR.sort((a, b) => b.recYdsPg - a.recYdsPg); out.TE.sort((a, b) => b.recYdsPg - a.recYdsPg);
  out.RB.sort((a, b) => b.scrimPg - a.scrimPg);
  return out;
}

// Team names in lists go without AP ranks (game score headers keep them).
const teamTag = (t) => t.name;
function leaderboardMarkdown(lb) {
  const wk = state.data.meta.week, out = [`### Week ${wk} usage leaderboard: ${leaderboardScopeLabel()}`, ""];
  // How dominator rating works, before any list that shows it.
  out.push("#### What is dominator rating?", "",
    "Dominator rating is the average of two shares: a player's share of his team's receiving yards and his share of its receiving touchdowns.", "",
    "**Dominator % = (receiving yards share + receiving TD share) ÷ 2**", "",
    "Say a receiver had 90 of his team's 300 receiving yards (30%) and 2 of its 3 receiving TDs (67%). His dominator is (30% + 67%) ÷ 2 = 48%.", "",
    "* If the team had no receiving TDs, the rating is just his yards share.",
    "* Negative receiving yards count as 0%.",
    "* Season dominator adds up his receiving yards and TDs over the games he played and divides by his team's totals in those games. It's steadier than a single game, where one touchdown swings the TD half a lot.",
    `* **Running backs** get their own version, since a back's value is carries plus catches: **RB dominator % = (share of RB carries + receiving credit) ÷ 2**. Backs rarely draw more than ${SEASON_LB.rbFullTgtShare}% of a team's targets, so ${SEASON_LB.rbFullTgtShare}% counts as full receiving credit (100%), 10% as half, and so on, capped at 100%. A back with 70% of the carries and 15% of the targets rates (70% + 75%) ÷ 2 = 73%.`, "");
  // Season top 5s first: the weekly top 20 moves around; these show who has owned the work all year.
  const sl = lb.season;
  if (sl && Object.values(sl).some((a) => a.length)) {
    out.push(`#### Season leaders through week ${wk}: top ${SEASON_LB.size}`, "",
      `*WRs and TEs are ranked by season dominator, RBs by RB dominator, over the games he played. Minimum half his team's games and ${SEASON_LB.minTgtPerGame.WR}+ targets a game for WRs, ${SEASON_LB.minTgtPerGame.TE}+ for TEs, ${SEASON_LB.minCarPerGame}+ carries for RBs.*`, "");
    for (const [pos, label] of [["WR", "Wide receivers"], ["TE", "Tight ends"], ["RB", "Running backs"]]) {
      if (!sl[pos].length) continue;
      out.push(`**${label}**`, "");
      sl[pos].forEach((x, i) => {
        const unit = pos === "RB" ? "of RB carries" : "of targets", per = pos === "RB" ? "carries" : "targets";
        if (pos === "RB") out.push(`${i + 1}. **${x.name}**, ${teamTag(x.t)}: ${R(x.rbDom)}% RB dominator. ${R(x.share)}% of RB carries (${x.perGame.toFixed(1)} a game) and ${R(x.tgtShare)}% of targets (${x.tgtPerGame.toFixed(1)} a game) over ${plural(x.games, "game")}.`);
        else out.push(`${i + 1}. **${x.name}**, ${teamTag(x.t)}: ${x.sdom != null ? `${R(x.sdom)}% season dominator` : "no dominator"}. ${R(x.share)}% ${unit} over ${plural(x.games, "game")} (${x.perGame.toFixed(1)} ${per} a game).`);
      });
      out.push("");
    }
    const vol = buildSeasonVolume(lb.hist);
    if (Object.values(vol).some((a) => a.length)) {
      out.push(`#### Season volume leaders through week ${wk}: top ${VOL.size}`, "",
        `*Raw production per game, for offenses that throw so much that even a No. 1 receiver's share looks ordinary. WRs and TEs by receiving yards a game, RBs by scrimmage yards a game.*`, "");
      const n = (v) => v.toLocaleString("en-US");
      for (const [pos, label] of [["WR", "Wide receivers"], ["TE", "Tight ends"], ["RB", "Running backs"]]) {
        if (!vol[pos].length) continue;
        out.push(`**${label}**`, "");
        vol[pos].slice(0, VOL.size).forEach((x, i) => out.push(pos === "RB"
          ? `${i + 1}. **${x.name}**, ${teamTag(x.t)}: ${x.scrimPg.toFixed(1)} scrimmage yards a game (${n(x.scrimYds)} total). ${x.carPg.toFixed(1)} carries and ${x.tgtPg.toFixed(1)} targets a game over ${plural(x.games, "game")}.`
          : `${i + 1}. **${x.name}**, ${teamTag(x.t)}: ${x.recYdsPg.toFixed(1)} receiving yards a game (${n(x.recYds)} total), ${plural(x.recTd, "TD")}. ${x.tgtPg.toFixed(1)} targets a game over ${plural(x.games, "game")}.`));
        out.push("");
      }
    }
    out.push(`#### This week`, "");
  }
  const lead = lb.wr[0], tightEnd = lb.te[0], back = lb.car[0], riser = lb.risers[0];
  const intro = [];
  if (lead) intro.push(`${nm(lead.p.name, lead.t)} led all receivers, drawing ${R(lead.p.metrics.tgt_share)}% of ${poss(lead.t.name)} targets (${lead.p.receiving.tgt}) and turning them into ${recLine(lead.p.receiving)}.`);
  if (tightEnd) intro.push(`At tight end, ${nm(tightEnd.p.name, tightEnd.t)} drew ${R(tightEnd.p.metrics.tgt_share)}% of ${poss(tightEnd.t.name)} looks.`);
  if (back) intro.push(`On the ground, ${nm(back.p.name, back.t)} had the biggest grip on a backfield: ${R(back.p.metrics.carry_share)}% of ${poss(back.t.name)} RB carries.`);
  if (riser) intro.push(`The biggest riser was ${nm(riser.p.name, riser.t)}, whose ${R(riser.p.metrics.tgt_share)}% target share was ${R(riser.delta)} points above his season average.`);
  if (intro.length) out.push(intro.join(" "), "");
  out.push(`*Target share is a player's share of his team's targets (minimum ${LB.minTargets.WR} targets for WRs, ${LB.minTargets.TE} for TEs). Carry share is a back's share of his team's RB carries (minimum ${LB.minCarries} carries). Season dominator is the average of his share of team receiving yards and receiving TDs, season to date.*`, "");

  const targetList = (rows, label) => {
    out.push(`#### ${rows.length >= LB.size ? `Top ${LB.size}` : "Top"} ${label} by target share`, "");
    if (!rows.length) out.push(`*No ${label} reached the minimum this week.*`);
    rows.forEach((x, i) => {
      const r = x.p.receiving, avg = x.ctx && x.ctx.games >= 2 && x.ctx.avgTs != null ? ` Season avg: ${R(x.ctx.avgTs)}%.` : "";
      const dom = x.sdom != null ? ` Season dominator ${R(x.sdom)}%.` : "";
      out.push(`${i + 1}. **${x.p.name}**, ${teamTag(x.t)}: ${R(x.p.metrics.tgt_share)}% (${r.tgt} tgt), ${slash(r)}.${dom}${avg}`);
    });
    out.push("");
  };
  targetList(lb.wr, "WRs");
  targetList(lb.te, "TEs");
  out.push(`#### ${lb.car.length >= LB.size ? `Top ${LB.size}` : "Top"} RBs by carry share`, "");
  lb.car.forEach((x, i) => {
    const ru = x.p.rushing, avg = x.ctx && x.ctx.games >= 2 && x.ctx.avgCs != null ? ` Season avg: ${R(x.ctx.avgCs)}%.` : "";
    out.push(`${i + 1}. **${x.p.name}**, ${teamTag(x.t)}: ${R(x.p.metrics.carry_share)}% (${ru.car} car, ${ru.yds} yds${ru.td ? `, ${ru.td} TD` : ""}).${avg}`);
  });
  if (lb.risers.length) {
    out.push("", "#### Biggest risers", "");
    lb.risers.forEach((x, i) => out.push(`${i + 1}. **${x.p.name}**, ${teamTag(x.t)} ${x.p.pos}: ${R(x.p.metrics.tgt_share)}% target share, up from ${aPct(x.ctx.avgTs)} average over ${x.ctx.games} games.`));
  }
  out.push("", "[[image:0]]", "", "[[image:1]]", "", "[[image:2]]");
  return out.join("\n").trim() + "\n";
}
function leaderboardImages(lb) {
  const wk = state.data.meta.week, scope = leaderboardScopeLabel(), dash = "–";
  const avg = (x, key) => (x.ctx && x.ctx.games >= 2 && x.ctx[key] != null ? `${R(x.ctx[key])}%` : dash);
  const targetImage = (rows, pos, label) => drawTableImage({
    title: `Week ${wk} ${label} target share leaders`, subtitle: `${scope}. Minimum ${LB.minTargets[pos]} targets.`,
    groups: [{ columns: [{ label: "#", align: "right" }, { label: "Player", align: "left" }, { label: "Team", align: "left" },
                         { label: "Tgt %", align: "right" }, { label: "Tgt", align: "right" },
                         { label: "Rec-Yds-TD", align: "right" }, { label: "Season Dom %", align: "right" }, { label: "Season avg", align: "right" }],
               rows: rows.map((x, i) => [i + 1, x.p.name, teamTag(x.t), `${R(x.p.metrics.tgt_share)}%`, x.p.receiving.tgt,
                                         slash(x.p.receiving), x.sdom != null ? `${R(x.sdom)}%` : dash, avg(x, "avgTs")]) }],
  });
  return [
    targetImage(lb.wr, "WR", "WR"),
    targetImage(lb.te, "TE", "TE"),
    drawTableImage({
      title: `Week ${wk} RB carry share leaders`, subtitle: `${scope}. Minimum ${LB.minCarries} carries.`,
      groups: [{ columns: [{ label: "#", align: "right" }, { label: "Player", align: "left" }, { label: "Team", align: "left" },
                           { label: "Car %", align: "right" }, { label: "Car", align: "right" }, { label: "Yds", align: "right" },
                           { label: "TD", align: "right" }, { label: "Season avg", align: "right" }],
                 rows: lb.car.map((x, i) => [i + 1, x.p.name, teamTag(x.t), `${R(x.p.metrics.carry_share)}%`, x.p.rushing.car,
                                             x.p.rushing.yds, x.p.rushing.td, avg(x, "avgCs")]) }],
    }),
  ];
}


// ---------------------------------------------------------------- pace & PROE (team post)
// Season-to-date team tempo and pass tendency for the teams in the current filter
// that played this week. Pace = possession time / snaps; PROE = neutral-situation pass
// rate minus the rate expected from down, distance and field position.
const PACE = { size: 10, minGames: 2 };
function teamSeason(hist, name, week) {
  const e = hist?.teams?.[name];
  if (!e) return null;
  let g = 0, plays = 0, secPlays = 0, secs = 0, pp = 0, ps = 0, ex = 0;
  for (const [w, a] of Object.entries(e.w)) {
    if (+w > week || !a[0]) continue;
    g += 1; plays += a[0];
    if (a[1] != null) { secs += a[1] * a[0]; secPlays += a[0]; }
    pp += a[4] || 0; ps += a[5] || 0; ex += a[6] || 0;
  }
  if (!g) return null;
  return { games: g, playsPg: plays / g, spp: secPlays ? secs / secPlays : null,
           proe: pp >= 20 ? (100 * (ps - ex)) / pp : null, passRate: pp ? (100 * ps) / pp : null, proePlays: pp };
}
function buildPace(hist) {
  const wk = state.data.meta.week, rows = [];
  for (const t of leaderboardTeams()) {
    const s = teamSeason(hist, t.name, wk);
    if (!s || s.games < PACE.minGames) continue;
    rows.push({ t, s });
  }
  const has = (k) => rows.filter((r) => r.s[k] != null);
  return {
    count: rows.length,
    fast: has("spp").sort((a, b) => a.s.spp - b.s.spp).slice(0, PACE.size),
    slow: has("spp").sort((a, b) => b.s.spp - a.s.spp).slice(0, PACE.size),
    pass: has("proe").sort((a, b) => b.s.proe - a.s.proe).slice(0, PACE.size),
    run: has("proe").sort((a, b) => a.s.proe - b.s.proe).slice(0, PACE.size),
  };
}
const f1 = (v) => (v == null ? "–" : v.toFixed(1));
function paceMarkdown(pc) {
  const wk = state.data.meta.week, out = [`### Week ${wk} pace & PROE: ${leaderboardScopeLabel()}`, ""];
  const tag = (x) => `**${teamTag(x.t)}**`;
  const intro = [], fast = pc.fast[0], slow = pc.slow[0], pass = pc.pass[0], run = pc.run[0];
  if (fast) intro.push(`${tag(fast)} has been the fastest offense through week ${wk}, snapping the ball every ${f1(fast.s.spp)} seconds of possession and running ${f1(fast.s.playsPg)} plays a game.`);
  if (slow) intro.push(`${tag(slow)} has been the slowest, at ${f1(slow.s.spp)} seconds per snap.`);
  if (pass) intro.push(`${tag(pass)} throws the most relative to the situation: ${signedPct(pass.s.proe)} over expected in neutral downs.`);
  if (run) intro.push(`${tag(run)} leans hardest on the run, at ${signedPct(run.s.proe)}.`);
  if (intro.length) out.push(intro.join(" "), "");
  out.push(`*Season to date, teams that played in week ${wk} with ${PACE.minGames}+ games (${pc.count} teams). Pace = possession time per offensive snap. PROE = pass rate over expected on 1st and 2nd down with the score within 7, where "expected" is what all offenses did that week in the same down, distance and field position. Scrambles count as runs.*`, "");
  const wkPace = (x) => (x.t.pace?.secPerPlay != null ? ` Week ${wk}: ${f1(x.t.pace.secPerPlay)}.` : "");
  const wkProe = (x) => (x.t.proe?.proe != null ? ` Week ${wk}: ${signedPct(x.t.proe.proe)}.` : "");
  const list = (title, rows, line) => {
    out.push(`#### ${title}`, "");
    if (!rows.length) out.push("*Not enough games yet.*");
    rows.forEach((x, i) => out.push(`${i + 1}. ${line(x)}`));
    out.push("");
  };
  list("Fastest offenses", pc.fast, (x) => `${tag(x)}: ${f1(x.s.spp)} sec/play, ${f1(x.s.playsPg)} plays/game.${wkPace(x)}`);
  list("Slowest offenses", pc.slow, (x) => `${tag(x)}: ${f1(x.s.spp)} sec/play, ${f1(x.s.playsPg)} plays/game.${wkPace(x)}`);
  list("Most pass-heavy (PROE)", pc.pass, (x) => `${tag(x)}: ${signedPct(x.s.proe)} (neutral pass rate ${f1(x.s.passRate)}%).${wkProe(x)}`);
  list("Most run-heavy (PROE)", pc.run, (x) => `${tag(x)}: ${signedPct(x.s.proe)} (neutral pass rate ${f1(x.s.passRate)}%).${wkProe(x)}`);
  out.push("[[image:0]]", "", "[[image:1]]");
  return out.join("\n").trim() + "\n";
}
function paceImages(pc) {
  const wk = state.data.meta.week, scope = leaderboardScopeLabel();
  const paceCols = [{ label: "#", align: "right" }, { label: "Team", align: "left" }, { label: "Sec/play", align: "right" },
                    { label: "Plays/g", align: "right" }, { label: `Wk ${wk} sec/play`, align: "right" }];
  const proeCols = [{ label: "#", align: "right" }, { label: "Team", align: "left" }, { label: "PROE", align: "right" },
                    { label: "Neutral pass %", align: "right" }, { label: `Wk ${wk} PROE`, align: "right" }];
  const paceRows = (rows) => rows.map((x, i) => [i + 1, teamTag(x.t), f1(x.s.spp), f1(x.s.playsPg), x.t.pace?.secPerPlay != null ? f1(x.t.pace.secPerPlay) : "–"]);
  const proeRows = (rows) => rows.map((x, i) => [i + 1, teamTag(x.t), signedPct(x.s.proe), `${f1(x.s.passRate)}%`, signedPct(x.t.proe?.proe)]);
  return [
    drawTableImage({ title: `Pace through week ${wk}`, subtitle: `${scope}. Possession time per offensive snap, season to date.`,
      groups: [{ heading: "Fastest", columns: paceCols, rows: paceRows(pc.fast) }, { heading: "Slowest", columns: paceCols, rows: paceRows(pc.slow) }] }),
    drawTableImage({ title: `Pass rate over expected through week ${wk}`, subtitle: `${scope}. 1st/2nd down, score within 7, season to date.`,
      groups: [{ heading: "Most pass-heavy", columns: proeCols, rows: proeRows(pc.pass) }, { heading: "Most run-heavy", columns: proeCols, rows: proeRows(pc.run) }] }),
  ];
}

// ---------------------------------------------------------------- injury signals
// CFBD has no injury reports, so these are inferred from usage and always labeled
// as something to confirm: a player with a heavy role last game who has almost
// nothing (or no touches at all) this week, and the teammate whose jump came in
// that same game.
const INJ = { heavyTgt: 6, heavyCar: 12, lowTgt: 2, lowCar: 3, lowTouches: 4 };
const wasHeavy = (e, kind) => (kind === "tgt" ? e.tgt >= INJ.heavyTgt : e.car >= INJ.heavyCar);
// Low in that stat AND few touches overall: a back who loses targets but still gets
// 14 carries is not hurt.
const isLow = (e, kind) => !e || ((kind === "tgt" ? e.tgt <= INJ.lowTgt : e.car <= INJ.lowCar) && e.tgt + e.car <= INJ.lowTouches);
const shortName = (n) => { const parts = n.split(" "); return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(" ")}` : n; };
const UNIT = { tgt: "target", car: "carry" };

/**
 * Teammates at `pos` who had a heavy role in their previous game (within the last two
 * weeks) and were limited or missing this week. Returns [{id, name, pos, before, now, absent}].
 */
function limitedTeammates(hist, team, pos, week, kind) {
  if (!hist) return [];
  const out = [];
  for (const [id, e] of Object.entries(hist.players)) {
    if (e.t !== team || (pos && e.p !== pos)) continue;
    const series = playerSeries(hist, id, week);
    const nowE = series.find((r) => r.w === week);
    const prior = series.filter((r) => r.w < week).pop();
    if (!prior || prior.w < week - 2 || !wasHeavy(prior, kind) || !isLow(nowE, kind)) continue;
    out.push({ id, name: e.n, pos: e.p, before: kind === "tgt" ? prior.tgt : prior.car,
               now: nowE ? (kind === "tgt" ? nowE.tgt : nowE.car) : 0, absent: !nowE, prevWeek: prior.w });
  }
  return out;
}

// ---------------------------------------------------------------- trends
// Biggest usage changes, up and down, for players whose team played this week:
//   week to week   this game vs. his previous game
//   multi-week     average of his last 3 games vs. his earlier games (needs 2+ earlier games)
// Target share covers WR/TE/RB; carry share covers RBs. Volume floors keep
// 1-target blips out: the "busy" side of the comparison must clear them.
const TR = { size: 10, tgt: 5, car: 10, recent: 3, minEarlier: 2 };

function playerSeries(hist, id, week) {
  const e = hist?.players?.[id];
  if (!e) return [];
  return Object.entries(e.w).map(([w, a]) => ({ w: +w, tgt: a[0], ts: a[1], car: a[2], cs: a[3], rec: a[5], recYds: a[6], rushYds: a[7] }))
    .filter((r) => r.w <= week).sort((a, b) => a.w - b.w);
}
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

function buildTrends(hist) {
  const wk = state.data.meta.week;
  const out = { w2w: { tgtUp: [], tgtDown: [], carUp: [], carDown: [] }, multi: { tgtUp: [], tgtDown: [], carUp: [], carDown: [] }, missed: [] };
  if (!hist) return out;
  const limCache = {};
  const lim = (t, pos, kind) => (limCache[`${t.name}|${pos}|${kind}`] ??= limitedTeammates(hist, t.name, pos, wk, kind));
  const limTgt = (t, p) => lim(t, p.pos, "tgt").find((x) => x.id !== p.id);
  const limCar = (t, p) => lim(t, "RB", "car").find((x) => x.id !== p.id);
  // Heavy-role players with no touches this week never appear in t.players. They
  // didn't play (almost always injury), so they're kept off the trend lists, where
  // they'd crowd out real role changes, and listed separately as "Didn't play".
  for (const t of leaderboardTeams()) {
    for (const pos of ["WR", "TE", "RB"]) for (const x of lim(t, pos, "tgt")) if (x.absent) {
      const prev = playerSeries(hist, x.id, wk).pop();
      if (t.targetsSource === "pbp" && prev.ts != null && prev.tgt >= TR.tgt)
        out.missed.push({ p: { id: x.id, name: x.name, pos: x.pos }, t, kind: "tgt", volBefore: prev.tgt, prevWeek: prev.w });
    }
    for (const x of lim(t, "RB", "car")) if (x.absent) {
      const prev = playerSeries(hist, x.id, wk).pop();
      if (prev.cs != null && prev.car >= TR.car)
        if (!out.missed.some((m) => m.p.id === x.id))
          out.missed.push({ p: { id: x.id, name: x.name, pos: "RB" }, t, kind: "car", volBefore: prev.car, prevWeek: prev.w });
    }
  }
  for (const t of leaderboardTeams()) for (const p of t.players) {
    if (p.pos === "QB") continue;
    const series = playerSeries(hist, p.id, wk);
    const now = series[series.length - 1];
    if (!now || now.w !== wk) continue;
    const base = { p, t };

    // Week to week
    const prev = series[series.length - 2];
    if (prev) {
      if (t.targetsSource === "pbp" && now.ts != null && prev.ts != null) {
        const d = now.ts - prev.ts, row = { ...base, before: prev.ts, now: now.ts, d, vol: now.tgt, volBefore: prev.tgt, prevWeek: prev.w };
        if (d > 0 && now.tgt >= TR.tgt) out.w2w.tgtUp.push({ ...row, fillIn: limTgt(t, p) });
        if (d < 0 && prev.tgt >= TR.tgt) out.w2w.tgtDown.push({ ...row, injury: wasHeavy(prev, "tgt") && isLow(now, "tgt") });
      }
      if (p.pos === "RB" && now.cs != null && prev.cs != null) {
        const d = now.cs - prev.cs, row = { ...base, before: prev.cs, now: now.cs, d, vol: now.car, volBefore: prev.car, prevWeek: prev.w };
        if (d > 0 && now.car >= TR.car) out.w2w.carUp.push({ ...row, fillIn: limCar(t, p) });
        if (d < 0 && prev.car >= TR.car) out.w2w.carDown.push({ ...row, injury: wasHeavy(prev, "car") && isLow(now, "car") });
      }
    }

    // Multi-week: last 3 games vs. everything before
    if (series.length >= TR.recent + TR.minEarlier) {
      const recent = series.slice(-TR.recent), earlier = series.slice(0, -TR.recent);
      const tsR = recent.filter((r) => r.ts != null), tsE = earlier.filter((r) => r.ts != null);
      if (t.targetsSource === "pbp" && tsR.length === TR.recent && tsE.length >= TR.minEarlier) {
        const a = mean(tsR.map((r) => r.ts)), b = mean(tsE.map((r) => r.ts));
        const vR = mean(tsR.map((r) => r.tgt)), vE = mean(tsE.map((r) => r.tgt));
        const row = { ...base, before: b, now: a, d: a - b, vol: vR, volBefore: vE, earlierGames: tsE.length };
        if (row.d > 0 && vR >= TR.tgt) out.multi.tgtUp.push(row);
        if (row.d < 0 && vE >= TR.tgt) out.multi.tgtDown.push(row);
      }
      const csR = recent.filter((r) => r.cs != null), csE = earlier.filter((r) => r.cs != null);
      if (p.pos === "RB" && csR.length === TR.recent && csE.length >= TR.minEarlier) {
        const a = mean(csR.map((r) => r.cs)), b = mean(csE.map((r) => r.cs));
        const vR = mean(csR.map((r) => r.car)), vE = mean(csE.map((r) => r.car));
        const row = { ...base, before: b, now: a, d: a - b, vol: vR, volBefore: vE, earlierGames: csE.length };
        if (row.d > 0 && vR >= TR.car) out.multi.carUp.push(row);
        if (row.d < 0 && vE >= TR.car) out.multi.carDown.push(row);
      }
    }
  }
  for (const grp of [out.w2w, out.multi]) {
    grp.tgtUp.sort((a, b) => b.d - a.d); grp.carUp.sort((a, b) => b.d - a.d);
    grp.tgtDown.sort((a, b) => a.d - b.d); grp.carDown.sort((a, b) => a.d - b.d);
    for (const k of Object.keys(grp)) grp[k] = grp[k].slice(0, TR.size);
  }
  return out;
}

const signed = (d) => `${d > 0 ? "+" : "−"}${Math.abs(R(d))}`;
function trendsMarkdown(tr, hist) {
  const wk = state.data.meta.week;
  const out = [`## Week ${wk} usage trends: ${leaderboardScopeLabel()}`, ""];
  const up = tr.w2w.tgtUp[0], down = tr.w2w.tgtDown[0], mUp = tr.multi.tgtUp[0], back = tr.w2w.carUp[0];
  const intro = [];
  if (up) intro.push(`The biggest week-to-week jump belonged to ${nm(up.p.name, up.t)}, whose target share went from ${R(up.before)}% to ${R(up.now)}%.`);
  if (down) intro.push(`Going the other way, ${nm(down.p.name, down.t)} fell from ${R(down.before)}% to ${R(down.now)}%.`);
  if (back) intro.push(`In the backfield, ${nm(back.p.name, back.t)} went from ${R(back.before)}% to ${R(back.now)}% of the RB carries${back.fillIn?.absent ? ` with **${back.fillIn.name}** (${abbr(back.t)}) not playing` : ""}.`);
  if (mUp) intro.push(`Over a longer stretch, ${nm(mUp.p.name, mUp.t)} has averaged ${R(mUp.now)}% of targets over his last ${TR.recent} games, up from ${R(mUp.before)}% before that.`);
  if (intro.length) out.push(intro.join(" "), "");
  out.push(`*Week to week compares this game with the player's last game with touches. Multi-week compares his last ${TR.recent} games with his earlier ones (at least ${TR.minEarlier}). Target trends need ${TR.tgt}+ targets on the busier side; carry trends need ${TR.car}+ carries.*`, "");

  const w2wLine = (x, i, unit) => `${i + 1}. **${x.p.name}**, ${teamTag(x.t)} ${x.p.pos}: ${R(x.before)}% → ${R(x.now)}% (${signed(x.d)}). ${x.volBefore} → ${plural(x.vol, unit)}${x.prevWeek !== wk - 1 && !teamOffSince(hist, x.t.name, x.prevWeek, wk) ? ` (compared with week ${x.prevWeek})` : ""}${facedThisWeek(x.t, unit === "target" ? "pass" : "run")}.`;
  const multiLine = (x, i, unit) => `${i + 1}. **${x.p.name}**, ${teamTag(x.t)} ${x.p.pos}: ${R(x.now)}% over his last ${TR.recent} games vs. ${R(x.before)}% in his first ${x.earlierGames} games (${signed(x.d)}). ${x.vol.toFixed(1)} ${unit}s a game, was ${x.volBefore.toFixed(1)}.${recentOpp(hist, x, unit === "target" ? "pass" : "run")}`;
  const section = (title, upRows, downRows, line, unit) => {
    out.push(`### ${title}`, "");
    if (title.startsWith("Multi")) out.push("*(Trending over multiple weeks)*", "");
    out.push("**Trending up 📈**", "");
    if (upRows.length) upRows.forEach((x, i) => out.push(line(x, i, unit))); else out.push("*Nobody cleared the volume floor.*");
    out.push("", "**Trending down 📉**", "");
    if (downRows.length) downRows.forEach((x, i) => out.push(line(x, i, unit))); else out.push("*Nobody cleared the volume floor.*");
    out.push("");
  };
  section("Week to Week: Target Share", tr.w2w.tgtUp, tr.w2w.tgtDown, w2wLine, "target");
  section("Week to Week: RB Carry Share", tr.w2w.carUp, tr.w2w.carDown, w2wLine, "carry");
  const enoughGames = Object.values(tr.multi).some((a) => a.length);
  if (enoughGames) {
    section("Multi-Week: Target Share", tr.multi.tgtUp, tr.multi.tgtDown, multiLine, "target");
    section("Multi-Week: RB Carry Share", tr.multi.carUp, tr.multi.carDown, multiLine, "carrie");
  } else {
    out.push("### Multi-Week Trends", "", `*Needs ${TR.recent + TR.minEarlier}+ games per player, so these start around week ${TR.recent + TR.minEarlier}.*`, "");
  }
  if (moversFor(tr).length) out.push("## Trend Lines for the Biggest Movers", "", "[[image:0]]", "",
    `*Share of team targets (top) or RB carries (bottom), week by week. Blue = week ${wk}. Dashed line = skipped week; ○ team bye; × no touches.*`, "");
  out.push("## How the trends are measured", "",
    "* **Week to week** compares this week's touches with last week's.",
    `* **Multi-week** compares his average over his last ${TR.recent} games with his average before that. He needs ${TR.recent}+ games with touches to qualify.`,
    `* **Volume floors:** target trends need ${TR.tgt}+ targets on the busier side of the comparison, and carry trends need ${TR.car}+ carries. That keeps blips off the lists.`,
    "* **Target share** = targets / team targets, from play-by-play. **RB carry share** = carries / all non-QB carries.",
    `* **Defense ranks** = where the opponent ranked among FBS defenses going into the game, by ${DM[state.dm].label} allowed against the pass (target trends) or the run (carry trends). 1st = toughest.`, "",
    dataLine(`All FBS teams that played in week ${wk} are included.`), "",
    "[[image:1]]", "", "[[image:2]]");
  return out.join("\n").trim() + "\n";
}
// " vs. Alabama (12th pass D)": this week's opponent and its rank going in.
function facedThisWeek(t, kind) {
  const wk = state.data.meta.week;
  const g = state.data.games.find((x) => x.home.name === t.name || x.away.name === t.name);
  if (!g) return "";
  const opp = g.home.name === t.name ? g.away : g.home, r = defRank(opp.name, wk, kind), m = r && (r.inn || r.season);
  return m ? ` vs. ${opp.name} (${ordinal(m.rank)} ${kind} D)` : "";
}
// " Last 3 opponents averaged 70th vs. the pass.": going-in ranks of the defenses he faced.
function recentOpp(hist, x, kind) {
  const games = playerSeries(hist, x.p.id, state.data.meta.week).slice(-TR.recent), tm = hist?.teams?.[x.t.name];
  const ranks = games.map((g) => {
    const opp = tm?.w?.[g.w]?.[9], r = opp && defRank(opp, g.w, kind), m = r && (r.inn || r.season);
    return m ? m.rank : null;
  }).filter((v) => v != null);
  return ranks.length === games.length && ranks.length ? ` Last ${ranks.length} opponents averaged ${ordinal(R(mean(ranks)))} vs. the ${kind}.` : "";
}
// True when the team played no game after week `from` and before week `to` (a bye),
// so the "(compared with week N)" note adds nothing.
function teamOffSince(h, name, from, to) {
  const e = h?.teams?.[name];
  if (!e) return false;
  for (let w = from + 1; w < to; w++) if (e.w[w]) return false;
  return true;
}

function trendsImages(tr, hist) {
  const wk = state.data.meta.week, scope = leaderboardScopeLabel();
  const cols = (volLabel, withNote) => [{ label: "#", align: "right" }, { label: "Player", align: "left" }, { label: "Team", align: "left" },
                { label: "Pos", align: "left" }, { label: "Before", align: "right" }, { label: "Now", align: "right" },
                { label: "Change", align: "right" }, { label: volLabel, align: "right" },
                ...(withNote ? [{ label: "Note", align: "left" }] : [])];
  const note = () => "";
  const rows = (list, fmt, withNote) => list.map((x, i) => [i + 1, x.p.name, teamTag(x.t), x.p.pos, `${R(x.before)}%`, `${R(x.now)}%`, signed(x.d), fmt(x),
                                                           ...(withNote ? [note(x)] : [])]);
  const w2wVol = (x) => `${x.volBefore} → ${x.vol}`;
  const multiVol = (x) => `${x.volBefore.toFixed(1)} → ${x.vol.toFixed(1)}`;
  const groups = (g, fmt, perGame) => {
    // One Note column for the whole image (if anything is flagged) so the tables line up.
    const withNote = Object.values(g).some((list) => list.some((x) => note(x)));
    const tgtLabel = perGame ? "Tgt/g" : "Targets", carLabel = perGame ? "Car/g" : "Carries";
    return [
      { heading: "Target share: trending up", columns: cols(tgtLabel, withNote), rows: rows(g.tgtUp, fmt, withNote) },
      { heading: "Target share: trending down", columns: cols(tgtLabel, withNote), rows: rows(g.tgtDown, fmt, withNote) },
      { heading: "RB carry share: trending up", columns: cols(carLabel, withNote), rows: rows(g.carUp, fmt, withNote) },
      { heading: "RB carry share: trending down", columns: cols(carLabel, withNote), rows: rows(g.carDown, fmt, withNote) },
    ];
  };
  const imgs = [drawMoversImage(tr, hist), drawTableImage({ title: `Week ${wk} usage trends: week to week`, subtitle: `${scope}. This game vs. the player's last game with touches.`, groups: groups(tr.w2w, w2wVol, false) })];
  if (Object.values(tr.multi).some((a) => a.length))
    imgs.push(drawTableImage({ title: `Week ${wk} usage trends: last ${TR.recent} games`, subtitle: `${scope}. Last ${TR.recent} games vs. earlier games (at least ${TR.minEarlier}).`, groups: groups(tr.multi, multiVol, true) }));
  return imgs;
}

// ---------------------------------------------------------------- pickups (Fantrax)
// Players trending up, sorted into tiers by how many Fantrax leagues roster them.
// Fantrax data comes from a CSV export the user picks; it never leaves the browser.
const FANTRAX = { rows: null, name: "", at: null };
const PICK = { size: 60, featured: 7, tiers: [
  { title: "Getting Ahead", max: 25, desc: "25% rostered or less. Grab him before the rest of your league notices.", split: true },
  { title: "Likely Available", max: 50, desc: "26% to 50% rostered. Odds are he's on waivers in about half of leagues." },
  { title: "Double Check", max: 75, desc: "51% to 75% rostered. Probably taken, but worth a look." }] };

function parseCSV(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      // A quote only closes the field before a comma or line end; Fantrax leaves some
      // inside names unescaped ("Ja"Cory Thomas").
      const nx = text[i + 1];
      if (c !== '"') cell += c;
      else if (nx === '"') { cell += '"'; i++; }
      else if (nx === "," || nx === "\n" || nx === "\r" || nx === undefined) q = false;
      else cell += c;
    }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1);
}
const fxNorm = (n) => {
  const k = n.toLowerCase().replace(/[’'.]/g, "").replace(/-/g, " ").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, " ").replace(/\s+/g, " ").trim();
  return FX_ALIAS[k] || k;
};
// Names CFBD and Fantrax spell differently.
const FX_ALIAS = { "cam cook": "cameron cook", "dandre hardeman": "deandre hardeman", "tama uiliata": "liatama uiliata" };
function loadFantrax(text, name, lastModified) {
  const [head, ...body] = parseCSV(text);
  const col = (n) => head.indexOf(n);
  // The export has two "Ros" columns; the roster percentage is the one with "%" values.
  const rosCols = head.map((h, i) => (h === "Ros" ? i : -1)).filter((i) => i >= 0);
  const pctCol = rosCols.find((i) => body.slice(0, 20).some((r) => /%$/.test(r[i] || "")));
  const chgCol = col("+/-");
  if (col("Player") < 0 || pctCol == null) throw new Error("expected Fantrax columns Player and Ros (%)");
  const byName = new Map();
  for (const r of body) {
    const e = { name: r[col("Player")], team: r[col("Team")] || "", pos: (r[col("Position")] || "").split(","), year: r[col("Year")] || "",
                pct: parseInt(r[pctCol], 10) || 0, chg: chgCol >= 0 ? r[chgCol] : "" };
    const k = fxNorm(e.name);
    byName.set(k, [...(byName.get(k) || []), e]);
  }
  Object.assign(FANTRAX, { rows: byName, name, at: lastModified ? new Date(lastModified) : new Date() });
}
function fantraxFor(p, t) {
  const c = FANTRAX.rows?.get(fxNorm(p.name)) || [];
  if (c.length < 2) return c[0] || null;
  const a = abbr(t).toLowerCase(), nmT = t.name.toLowerCase();
  const sim = (e) => (e.pos.includes(p.pos) ? 4 : 0) + (e.team.toLowerCase() === a ? 3 : 0) + (e.team.toLowerCase().slice(0, 3) === nmT.slice(0, 3) ? 2 : 0);
  return c.slice().sort((x, y) => sim(y) - sim(x))[0];
}

function buildPickups(hist) {
  // Always the all-FBS lists, like the Trends post, but deeper than its top 10.
  const scope = [state.conf, state.ap, TR.size];
  state.conf = "fbs"; state.ap = false; TR.size = PICK.size;
  const tr = buildTrends(hist);
  [state.conf, state.ap, TR.size] = scope;
  const byId = new Map();
  for (const span of ["w2w", "multi"]) for (const [k, kind] of [["tgtUp", "tgt"], ["carUp", "car"]])
    tr[span][k].forEach((x, i) => byId.set(x.p.id, [...(byId.get(x.p.id) || []), { ...x, span, kind, top10: i < 10 }]));
  // Qualifies: on a published top-10 riser list, or a 20+ point jump this week on real volume.
  const qualifies = (L) => L.some((y) => y.top10 || (y.span === "w2w" && y.d >= 20 && (y.kind === "tgt" ? y.vol >= 8 : y.vol >= 15)));
  // Longer trends first, then the bigger current share.
  const primary = (L) => { const m = L.filter((y) => y.span === "multi"); return (m.length ? m : L).slice().sort((a, b) => b.now - a.now)[0]; };
  const out = [], unmatched = [];
  for (const L of byId.values()) {
    if (!qualifies(L)) continue;
    const fx = fantraxFor(L[0].p, L[0].t);
    if (!fx) { unmatched.push(L[0]); continue; }
    if (fx.pct > PICK.tiers.at(-1).max) continue;
    out.push({ L, fx, top: primary(L) });
  }
  out.sort((a, b) => (a.top.span === "multi" ? 0 : 1) - (b.top.span === "multi" ? 0 : 1) || b.top.now - a.top.now);
  return { rows: out, unmatched };
}

function pickupsMarkdown(pk) {
  const wk = state.data.meta.week, out = [];
  const YR = { Fr: "Fr.", So: "So.", Jr: "Jr.", Sr: "Sr." };
  const why = (L) => L.slice().sort((a, b) => (a.span === "multi" ? 0 : 1) - (b.span === "multi" ? 0 : 1) || b.now - a.now).slice(0, 2).map((y) => {
    const what = y.kind === "tgt" ? "of the targets" : "of the RB carries", u = y.kind === "tgt" ? "targets" : "carries";
    return y.span === "w2w" ? `${R(y.before)}% → ${R(y.now)}% ${what} this week (${y.volBefore} → ${y.vol} ${u})`
                            : `${R(y.now)}% ${what} over his last ${TR.recent} games, up from ${R(y.before)}% (${y.vol.toFixed(1)} ${u} a game)`;
  }).join("; ");
  const full = (r) => {
    const x = r.L[0], chg = r.fx.chg && r.fx.chg !== "0%" ? ` (${r.fx.chg} this week)` : "", yr = YR[r.fx.year] ? `, ${YR[r.fx.year]}` : "";
    return [`* **${x.p.name}** (${abbr(x.t)}, ${x.p.pos}${yr}): **${r.fx.pct}% rostered**${chg}`, `  * ${why(r.L)}.`];
  };
  const short = (r) => {
    const x = r.L[0], y = r.top;
    return `* **${x.p.name}** (${abbr(x.t)}, ${x.p.pos}): ${r.fx.pct}% rostered. ${R(y.now)}% ${y.kind === "tgt" ? "target share" : "of RB carries"} ${y.span === "multi" ? `over his last ${TR.recent} games` : "this week"}.`;
  };
  const group = (rows) => {
    rows.slice(0, PICK.featured).forEach((r) => out.push(...full(r)));
    if (rows.length > PICK.featured) out.push("", "*Deeper adds:*", "", ...rows.slice(PICK.featured).map(short));
    out.push("");
  };
  out.push(`# Week ${wk} - Who to Pick Up`, "", "*Players trending up who are still on waivers in most leagues.*", "",
    "The trends post shows who's getting more work. This one adds how many leagues have already scooped them up, using Fantrax roster percentages. A player trending up and rostered in only a handful of leagues is the add to make before your leaguemates notice.", "",
    "## How to read this", "",
    "* **Roster %** = the share of Fantrax leagues where the player is on a roster. The number in parentheses is how much that moved this week.",
    `* **Who qualifies:** a player on this week's trends lists (top 10 risers, week to week or over his last ${TR.recent} games), or a 20+ point jump this week with real volume (8+ targets or 15+ carries).`,
    "* **Tiers:**", "  * **Getting Ahead:** 25% rostered or less.", "  * **Likely Available:** 26% to 50%.", "  * **Double Check:** 51% to 75%.", "  * Anyone above 75% is left off.",
    "* A player who took on a bigger role because a teammate was out may lose it when the teammate returns.", "");
  let lo = 0;
  PICK.tiers.forEach((t, ti) => {
    const rows = pk.rows.filter((r) => r.fx.pct >= lo && r.fx.pct <= t.max);
    lo = t.max + 1;
    out.push(`## ${t.title}`, "", `*${t.desc}*`, "");
    if (ti === 0) out.push(`Each group runs from players trending up over multiple weeks to one-week jumps, then by the size of his current target or carry share.`, "");
    if (!rows.length) { out.push("*Nobody this week.*", ""); return; }
    if (t.split) {
      const rb = rows.filter((r) => r.L[0].p.pos === "RB" && r.top.kind === "car");
      out.push("### Running backs", ""); group(rb);
      out.push("### Receivers and tight ends", ""); group(rows.filter((r) => !rb.includes(r)));
    } else group(rows);
  });
  if (pk.unmatched.length)
    out.push(`*Not in the Fantrax file, left off: ${pk.unmatched.map((x) => `${x.p.name} (${abbr(x.t)})`).join(", ")}.*`, "");
  out.push(dataLine(`Usage through week ${wk}; Fantrax roster percentages from ${FANTRAX.name}, ${FANTRAX.at.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.`));
  return out.join("\n").trim() + "\n";
}

// ---------------------------------------------------------------- movers chart
// Two players from each week-to-week list: the biggest move, plus the biggest move by
// an AP-ranked player (the next one down if the leader is ranked or nobody is).
function moversFor(tr) {
  const two = (list) => {
    if (!list.length) return [];
    const ranked = list.find((x, i) => i > 0 && x.t.apRank);
    return [list[0], ranked && !list[0].t.apRank ? ranked : list[1]].filter(Boolean);
  };
  return [...two(tr.w2w.tgtUp), ...two(tr.w2w.tgtDown), ...two(tr.w2w.carUp), ...two(tr.w2w.carDown)]
    .map((x, i) => ({ ...x, kind: i < two(tr.w2w.tgtUp).length + two(tr.w2w.tgtDown).length ? "tgt" : "car" }));
}

/** Small multiples: each mover's share by week. Light theme, 2x, for pasting into Substack. */
function drawMoversImage(tr, hist) {
  const movers = moversFor(tr), wk = state.data.meta.week;
  const S = 2, pad = 28, cols = 4, pw = 230, ph = 214, top = 96;
  const C = { bg: "#FFFFFF", ink: "#16211B", muted: "#5E6B63", line: "#8A968E", grid: "#E3E8E1", turf: "#1E5B3B", accent: "#2563EB" };
  const F = { title: "700 28px 'Barlow Condensed', 'Arial Narrow', sans-serif", sub: "400 15px Barlow, Arial, sans-serif",
              name: "600 15px Barlow, Arial, sans-serif", small: "400 12px Barlow, Arial, sans-serif",
              val: "700 13px Barlow, Arial, sans-serif", group: "700 17px 'Barlow Condensed', 'Arial Narrow', sans-serif" };
  const tgt = movers.filter((m) => m.kind === "tgt"), car = movers.filter((m) => m.kind === "car");
  const rowsOf = [tgt, car].filter((r) => r.length);
  const W = pad * 2 + cols * pw, H = top + rowsOf.length * ph + 40;
  const cv = document.createElement("canvas");
  cv.width = W * S; cv.height = H * S;
  const x = cv.getContext("2d"); x.scale(S, S);
  x.fillStyle = C.bg; x.fillRect(0, 0, W, H);
  x.fillStyle = C.turf; x.fillRect(0, 0, W, 5);
  x.fillStyle = C.ink; x.font = F.title; x.fillText(`Week ${wk}'s biggest movers, week by week`, pad, pad + 26);
  x.fillStyle = C.muted; x.font = F.sub;
  x.fillText(`Share of team targets (top) or RB carries (bottom). Blue = week ${wk}. Dashed line = skipped week; ○ team bye; × no touches.`, pad, pad + 52);
  rowsOf.forEach((row, ri) => {
    const y0 = top + ri * ph;
    x.fillStyle = C.muted; x.font = F.group; x.fillText(row[0].kind === "tgt" ? "TARGET SHARE" : "RB CARRY SHARE", pad, y0 + 8);
    row.forEach((m, ci) => {
      const px = pad + ci * pw, gx0 = px + (ci === 0 ? 40 : 14), gx1 = px + pw - 46, gy0 = y0 + 44, gy1 = y0 + 164;
      const xs = (w) => gx0 + ((w - 1) / Math.max(wk - 1, 1)) * (gx1 - gx0), ys = (v) => gy1 - (v / 100) * (gy1 - gy0);
      const key = m.kind === "tgt" ? "ts" : "cs";
      const series = playerSeries(hist, m.p.id, wk), played = hist?.teams?.[m.t.name]?.w || {};
      const pts = [];
      for (let w = 1; w <= wk; w++) {
        const r = series.find((q) => q.w === w);
        pts.push(r && r[key] != null ? { w, v: r[key], st: "played" } : { w, v: null, st: played[w] ? "dnp" : "bye" });
      }
      x.fillStyle = C.ink; x.font = F.name; x.fillText(`${m.p.name} (${abbr(m.t)})`, px + (ci === 0 ? 40 : 14), y0 + 30);
      for (const g of [0, 50, 100]) {
        x.fillStyle = g ? C.grid : C.line; x.fillRect(gx0 - 6, ys(g), gx1 - gx0 + 12, 1);
        if (ci === 0) { x.fillStyle = C.muted; x.font = F.small; x.textAlign = "right"; x.fillText(`${g}%`, gx0 - 10, ys(g) + 4); x.textAlign = "left"; }
      }
      const pl = pts.filter((q) => q.st === "played");
      x.strokeStyle = C.line; x.lineWidth = 2;
      pl.slice(1).forEach((b, j) => {
        const a = pl[j];
        x.setLineDash(b.w - a.w > 1 ? [4, 3] : []);
        x.beginPath(); x.moveTo(xs(a.w), ys(a.v)); x.lineTo(xs(b.w), ys(b.v)); x.stroke();
      });
      x.setLineDash([]);
      for (const q of pts) {
        const cx = xs(q.w), cur = q.w === wk;
        if (q.st === "played") { x.fillStyle = cur ? C.accent : C.line; x.beginPath(); x.arc(cx, ys(q.v), cur ? 5 : 3, 0, 7); x.fill(); }
        else if (q.st === "bye") { x.strokeStyle = C.line; x.lineWidth = 1.5; x.beginPath(); x.arc(cx, ys(0), 3.5, 0, 7); x.stroke(); }
        else { x.strokeStyle = cur ? C.accent : C.line; x.lineWidth = 2; x.beginPath(); x.moveTo(cx - 4, ys(0) - 4); x.lineTo(cx + 4, ys(0) + 4); x.moveTo(cx + 4, ys(0) - 4); x.lineTo(cx - 4, ys(0) + 4); x.stroke(); }
        x.fillStyle = C.muted; x.font = F.small; x.textAlign = "center"; x.fillText(`W${q.w}`, cx, gy1 + 20); x.textAlign = "left";
      }
      // Value labels: this week (blue) and the game it's compared with, placed on the
      // side away from the line between them so neither sits on a stroke.
      const now = pts[pts.length - 1], prev = pl.filter((q) => q.w < wk).pop();
      const nowV = now.st === "played" ? now.v : 0, rose = prev && nowV >= prev.v;
      const put = (txt, px2, py2, align, color, font) => {   // white halo keeps labels readable over strokes
        x.font = font; x.textAlign = align; x.lineJoin = "round"; x.strokeStyle = C.bg; x.lineWidth = 4;
        x.strokeText(txt, px2, py2); x.fillStyle = color; x.fillText(txt, px2, py2); x.textAlign = "left";
      };
      if (prev) {
        if (!rose) put(`${R(prev.v)}%`, xs(prev.w), ys(prev.v) - 10, "center", C.muted, F.small);
        else if (prev.v < 25) {   // low point: tuck the label left, on the side the incoming line isn't
          const pre = pl.filter((q) => q.w < prev.w).pop(), fromAbove = pre && pre.v > prev.v;
          if (fromAbove) put(`${R(prev.v)}%`, xs(prev.w) + 7, ys(prev.v) + 13, "left", C.muted, F.small);
          else put(`${R(prev.v)}%`, xs(prev.w) - 8, ys(prev.v) - 8, "right", C.muted, F.small);
        }
        else put(`${R(prev.v)}%`, xs(prev.w), ys(prev.v) + 19, "center", C.muted, F.small);
      }
      if (now.st === "played") {
        if (rose || !prev) put(`${R(now.v)}%`, xs(wk), ys(now.v) - 11, "center", C.accent, F.val);
        else put(`${R(now.v)}%`, xs(wk) + 9, ys(now.v) + 5, "left", C.accent, F.val);
      }
    });
  });
  x.fillStyle = C.muted; x.font = F.sub; x.fillText("Data: CollegeFootballData.com", pad, H - 16);
  return cv;
}

// ---------------------------------------------------------------- table images
/** Draws titled tables onto a canvas (2x for sharpness). Light theme: it's pasted into Substack. */
function drawTableImage({ title, subtitle, groups }) {
  const S = 2, pad = 28, rowH = 34, cellPad = 14;
  const F = { title: "700 28px 'Barlow Condensed', 'Arial Narrow', sans-serif", sub: "400 15px Barlow, Arial, sans-serif",
              head: "600 13px Barlow, Arial, sans-serif", cell: "400 15px Barlow, Arial, sans-serif",
              bold: "600 15px Barlow, Arial, sans-serif", group: "700 19px 'Barlow Condensed', 'Arial Narrow', sans-serif" };
  const C = { bg: "#FFFFFF", ink: "#16211B", muted: "#5E6B63", line: "#D5DBD3", zebra: "#F3F6F1", turf: "#1E5B3B" };
  const m = document.createElement("canvas").getContext("2d");
  const width = (txt, f) => { m.font = f; return m.measureText(String(txt)).width; };

  // Column widths are shared across groups when the columns match, so tables line up.
  const widths = groups[0].columns.map((c, i) => Math.ceil(Math.max(
    ...groups.map((gr) => width(gr.columns[i].label, F.head)), ...groups.flatMap((gr) => gr.rows.map((r) => width(r[i], gr.columns[i].label === "Player" ? F.bold : F.cell)))
  )) + cellPad * 2);
  const tableW = widths.reduce((a, b) => a + b, 0);
  const W = Math.max(tableW, width(title, F.title), width(subtitle, F.sub)) + pad * 2;
  let H = pad + 34 + 26 + 10;
  for (const gr of groups) H += (gr.heading ? 36 : 0) + rowH + rowH * Math.max(gr.rows.length, 1) + 18;
  H += 24 + pad;

  const cv = document.createElement("canvas");
  cv.width = Math.ceil(W * S); cv.height = Math.ceil(H * S);
  const x = cv.getContext("2d"); x.scale(S, S);
  x.fillStyle = C.bg; x.fillRect(0, 0, W, H);
  x.fillStyle = C.turf; x.fillRect(0, 0, W, 5);
  let y = pad + 26;
  x.fillStyle = C.ink; x.font = F.title; x.fillText(title, pad, y);
  y += 26; x.fillStyle = C.muted; x.font = F.sub; x.fillText(subtitle, pad, y);
  y += 18;
  for (const gr of groups) {
    if (gr.heading) { y += 30; x.fillStyle = C.ink; x.font = F.group; x.fillText(gr.heading, pad, y); y += 6; }
    let cx = pad;
    x.font = F.head; x.fillStyle = C.muted;
    gr.columns.forEach((c, i) => {
      const tx = c.align === "right" ? cx + widths[i] - cellPad - width(c.label, F.head) : cx + cellPad;
      x.font = F.head; x.fillText(c.label, tx, y + 22); cx += widths[i];
    });
    y += rowH;
    x.fillStyle = C.ink; x.fillRect(pad, y - 1, tableW, 1.5);
    gr.rows.forEach((r, ri) => {
      if (ri % 2) { x.fillStyle = C.zebra; x.fillRect(pad, y, tableW, rowH); }
      let cx2 = pad;
      r.forEach((v, i) => {
        const strong = gr.columns[i].label === "Player";
        const f = strong ? F.bold : F.cell;
        const tx = gr.columns[i].align === "right" ? cx2 + widths[i] - cellPad - width(v, f) : cx2 + cellPad;
        x.font = f; x.fillStyle = v === "–" ? C.muted : C.ink; x.fillText(String(v), tx, y + 22);
        cx2 += widths[i];
      });
      y += rowH;
    });
    if (!gr.rows.length) { x.fillStyle = C.muted; x.font = F.cell; x.fillText("No players reached the cutoff.", pad + cellPad, y + 22); y += rowH; }
    x.fillStyle = C.line; x.fillRect(pad, y, tableW, 1);
    y += 18;
  }
  x.fillStyle = C.muted; x.font = F.sub; x.fillText("Data: CollegeFootballData.com", pad, H - pad + 4);
  return cv;
}

// ---------------------------------------------------------------- preview + copy
/** Markdown -> HTML for the shapes these posts emit (headings, lists, tables, bold/italic). */
function markdownToHtml(md, images = []) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>");
  const html = []; const lines = md.split("\n"); let list = null;
  const close = () => { if (list) { html.push(`</${list}>`); list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ul = line.match(/^\* (.*)$/), ol = line.match(/^\d+\. (.*)$/), sub = line.match(/^ {2,}\* (.*)$/);
    if (sub && list) {   // one level of nesting: tuck it inside the item above
      const last = html.pop(), li = `<li>${inline(sub[1])}</li>`;
      html.push(last.endsWith("</ul></li>") ? last.replace(/<\/ul><\/li>$/, `${li}</ul></li>`) : last.replace(/<\/li>$/, `<ul>${li}</ul></li>`)); continue;
    }
    if (ul || ol) {
      const tag = ul ? "ul" : "ol";
      if (list !== tag) { close(); html.push(`<${tag}>`); list = tag; }
      html.push(`<li>${inline((ul || ol)[1])}</li>`); continue;
    }
    close();
    const img = line.match(/^\[\[image:(\d+)\]\]$/);
    if (img) { html.push(images[+img[1]] ? `<p data-image="${img[1]}"></p>` : ""); continue; }
    if (line.startsWith("| ")) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith("| ")) rows.push(lines[i++]);
      i--;
      const cells = (r) => r.slice(2, -2).split(" | ");
      const align = cells(rows[1]).map((c) => (c.endsWith(":") && !c.startsWith(":") ? "right" : "left"));
      html.push(`<table><thead><tr>${cells(rows[0]).map((c, k) => `<th style="text-align:${align[k]}">${inline(c)}</th>`).join("")}</tr></thead><tbody>` +
        rows.slice(2).map((r) => `<tr>${cells(r).map((c, k) => `<td style="text-align:${align[k]}">${inline(c)}</td>`).join("")}</tr>`).join("") + "</tbody></table>");
      continue;
    }
    const h = line.match(/^(#{1,6}) (.*)$/);
    if (h) html.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    else if (line.trim() === "---") html.push("<hr>");
    else if (line.trim()) html.push(`<p>${inline(line)}</p>`);
  }
  close();
  return html.join("");
}

/** What gets copied: Markdown tables and image markers are dropped from the pasted text. */
function pasteVersion(md, keepTables) {
  return md.split("\n").filter((l) => !/^\[\[image:\d+\]\]$/.test(l) && (keepTables || !l.startsWith("| ")))
    .join("\n").replace(/\n{3,}/g, "\n\n");
}

async function copyRich(md) {
  const html = markdownToHtml(md);
  try {
    if (window.ClipboardItem && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({
        "text/plain": new Blob([md], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      })]);
      return true;
    }
    await navigator.clipboard.writeText(md);
    return true;
  } catch (_) {
    const ta = Object.assign(document.createElement("textarea"), { value: md });
    ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}
async function copyImage(canvas) {
  try {
    const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch (_) { return false; }
}

function flash(btn, ok, label) {
  const orig = btn.dataset.label || btn.textContent;
  btn.dataset.label = orig;
  btn.textContent = ok ? label : "Copy failed";
  btn.classList.toggle("done", ok);
  clearTimeout(btn._t);
  btn._t = setTimeout(() => { btn.textContent = orig; btn.classList.remove("done"); }, 1800);
}

const POST_TITLES = { pickups: "Pickups post", recap: "Game recap post", tables: "Table post", leaderboard: "Leaderboard post", trends: "Trends post", pace: "Pace & PROE post" };
const POST_HELP = {
  recap: "Paste into Substack as is. Usage notes are generated from the numbers; add your own take around them.",
  tables: "Copy the text and paste it into Substack, then copy each table image and paste it under its game.",
  leaderboard: "Copy the text and paste it into Substack. The three table images (WR, TE, RB) are optional: paste them in or skip them.",
  trends: "Copy the text and paste it into Substack. The table images (week to week, multi-week) are optional.",
  pace: "Copy the text and paste it into Substack. The two table images (pace, PROE) are optional.",
  pickups: "Built from the Fantrax CSV you picked; it stays in your browser. Add injury context (who a fill-in replaced) before you publish.",
};

/** Builds a post for `games` (or the leaderboard) and opens the preview. */
async function openPost(kind, games) {
  const hist = await loadHistory();
  try { await document.fonts.ready; } catch (_) { /* images fall back to system fonts */ }
  let md, images = [];
  // Recap 📈/📉 callouts always use the all-FBS trends lists (the ones the Trends post
  // links to), not the current filter: a Top-25-only ranking would flag many more players.
  const scope = [state.conf, state.ap];
  state.conf = "fbs"; state.ap = false;
  TREND_INDEX = buildTrendIndex(hist);
  [state.conf, state.ap] = scope;
  if (kind === "recap") {
    md = recapNumbers() + games.map((g) => gameToMarkdown(g, hist)).join("\n---\n\n") + `\n${dataLine(`AP rankings are the ones in effect for week ${state.data.meta.week}.`)}\n`;
  }
  else if (kind === "tables") {
    md = games.map((g, i) => gameToTableMarkdown(g, hist, i)).join("\n---\n\n");
    images = games.map(gameTableImage);
  } else if (kind === "pace") {
    const pc = buildPace(hist);
    md = paceMarkdown(pc);
    images = paceImages(pc);
  } else if (kind === "pickups") {
    md = pickupsMarkdown(buildPickups(hist));
  } else if (kind === "trends") {
    const tr = buildTrends(hist);
    md = trendsMarkdown(tr, hist);
    images = trendsImages(tr, hist);
  } else {
    const lb = buildLeaderboard(hist);
    md = leaderboardMarkdown(lb);
    images = leaderboardImages(lb);
  }
  const text = pasteVersion(md, false);
  const dlg = $("postDialog");
  $("postTitle").textContent = `${POST_TITLES[kind]}: ${kind === "pickups" ? `All FBS · Fantrax ${FANTRAX.name}` : ["leaderboard", "trends", "pace"].includes(kind) ? leaderboardScopeLabel() : plural(games.length, "game")}`;
  $("postHelp").textContent = POST_HELP[kind];
  const body = $("postBody");
  body.innerHTML = markdownToHtml(md.split("\n").filter((l) => !l.startsWith("| ")).join("\n"), images);
  body.querySelectorAll("[data-image]").forEach((slot) => {
    const cv = images[+slot.dataset.image];
    const img = new Image(); img.src = cv.toDataURL("image/png"); img.alt = "Table image"; img.className = "post-img";
    const bar = document.createElement("div"); bar.className = "img-actions";
    const copy = Object.assign(document.createElement("button"), { type: "button", className: "btn", textContent: "Copy image" });
    copy.onclick = async () => flash(copy, await copyImage(cv), "Image copied");
    const dl = Object.assign(document.createElement("a"), { className: "btn ghost", textContent: "Download PNG",
      href: img.src, download: `week${state.data.meta.week}-${kind}-${+slot.dataset.image + 1}.png` });
    bar.append(copy, dl); slot.append(img, bar);
  });
  $("postCopy").onclick = async (e) => flash(e.currentTarget, await copyRich(text), "Text copied");
  $("postCopyMd").onclick = async (e) => {
    try { await navigator.clipboard.writeText(pasteVersion(md, true)); flash(e.currentTarget, true, "Markdown copied"); }
    catch (_) { flash(e.currentTarget, false); }
  };
  if (!dlg.open) dlg.showModal();
  body.scrollTop = 0;
}

// ---------------------------------------------------------------- URL state
function readURL() {
  const p = new URLSearchParams(location.search);
  state.conf = p.get("conf") || state.conf;
  state.ap = p.get("ap") === "1";
  state.all = p.get("all") === "1";
  state.sort = p.get("sort") || state.sort;
  state.dm = p.get("dm") === "epa" ? "epa" : "ypp";
  state.q = p.get("q") || "";
  state.file = p.get("week") || DEFAULT_FILE;
}
function writeURL() {
  const p = new URLSearchParams();
  if (state.conf !== "fbs") p.set("conf", state.conf);
  if (state.ap) p.set("ap", "1");
  if (state.all) p.set("all", "1");
  if (state.sort !== "rank") p.set("sort", state.sort);
  if (state.dm !== "ypp") p.set("dm", state.dm);
  if (state.q) p.set("q", state.q);
  if (state.file !== DEFAULT_FILE) p.set("week", state.file);
  history.replaceState(null, "", p.toString() ? `?${p}` : location.pathname);
}
