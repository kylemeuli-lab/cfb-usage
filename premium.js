// Premium features for the members site: Prospects and Projections pages, plus a
// prospect score and projection on the player card. Kept in its own file, with its
// data in data/premium/, so it can sit behind a separate paid tier later.
"use strict";

const PR = {
  prospects: null, proj: null, loading: null,
  pros: { pos: "WR", q: "", sort: "score", view: "now", year: null, filter: "all", psort: "rank", limit: 100 },
  pj: { span: "next", pos: "WR", q: "", sort: null, limit: 100, details: false },
};
const PRO_BADGE = `<span class="pro" aria-label="Pro feature">Pro</span>`;

async function loadPremium() {
  if (PR.loading) return PR.loading;
  const season = state.data?.meta?.season || new Date().getFullYear();
  PR.loading = Promise.all([
    loadJSON(`data/premium/prospects-${season}.json`).catch(() => null),
    loadJSON(`data/premium/projections-${season}.json`).catch(() => null),
  ]).then(([a, b]) => {
    PR.prospects = a; PR.proj = b; PR.ready = true;
    PR.pById = new Map((a?.players || []).map((p) => [String(p.id), p]));
    PR.jById = new Map((b?.players || []).map((p) => [String(p.id), p]));
    // rank within position, for "3rd of 366 WRs"
    PR.pRank = new Map();
    for (const pos of ["WR", "TE", "RB", "QB"]) {
      const L = (a?.players || []).filter((p) => p.pos === pos);
      L.forEach((p, i) => PR.pRank.set(String(p.id), [i + 1, L.length]));
    }
  });
  return PR.loading;
}

// ---------------------------------------------------------------- scoring formats
// Projections are stored as catches, yards and TDs, so any format is a re-score:
// points = per-catch x catches + 0.1 x yards + 6 x TDs (+ 0.5 per TE catch with TE premium).
const FORMATS = { std: ["Standard", 0], half: ["Half PPR", 0.5], ppr: ["PPR", 1] };
// QBs: 4 points per passing TD by default (6 with the toggle). Superflex (sf) is stored for the
// overall rankings that come with QB projections.
PR.fmt = "half"; PR.tep = false; PR.ptd = 4; PR.sf = false;
try {
  const f = JSON.parse(localStorage.getItem("cff-scoring") || "{}");
  if (FORMATS[f.fmt]) PR.fmt = f.fmt; PR.tep = !!f.tep; PR.ptd = f.ptd === 6 ? 6 : 4; PR.sf = !!f.sf;
} catch (_) {}
function saveFmt() { try { localStorage.setItem("cff-scoring", JSON.stringify({ fmt: PR.fmt, tep: PR.tep, ptd: PR.ptd, sf: PR.sf })); } catch (_) {} }
const fmtName = () => `${FORMATS[PR.fmt][0]}${PR.tep ? " + TE premium" : ""}`;
const fmtRule = () => `${FORMATS[PR.fmt][1]} per catch${PR.tep ? " (+0.5 more for TEs)" : ""}, 0.1 per yard, 6 per TD`;
function ptsOf(pos, rec, yds, td) {
  if (rec == null) return null;
  return (FORMATS[PR.fmt][1] + (PR.tep && pos === "TE" ? 0.5 : 0)) * rec + 0.1 * yds + 6 * td;
}
// QB lines are passing yards, TDs and INTs plus rushing yards and TDs: scored with the passing-TD setting.
const qbLinePts = (passYds, passTd, int, rushYds, rushTd) => 0.04 * passYds + PR.ptd * passTd - int + 0.1 * rushYds + 6 * rushTd;
const nextPts = (p) => (!p.next ? null : p.pos === "QB" ? qbLinePts(p.next.passYds, p.next.passTd, p.next.int, p.next.rushYds, p.next.rushTd)
                                                         : ptsOf(p.pos, p.next.rec, p.next.yds, p.next.td));
const weekPts = (p, wk) => (p.pos === "QB" ? (wk.length > 7 ? qbLinePts(wk[3], wk[4], wk[5], wk[6], wk[7]) : null)
                                           : wk.length > 3 ? ptsOf(p.pos, wk[3], wk[4], wk[5]) : wk[2]);
const rosPts = (p) => p.ros.weeks.reduce((t, wk) => t + (weekPts(p, wk) || 0), 0);
function fmtControls() {
  return `<div class="seg" role="group" aria-label="Scoring">${Object.entries(FORMATS).map(([k, [label]]) =>
    `<button type="button" data-act="fmt" data-val="${k}" aria-pressed="${PR.fmt === k}">${label}</button>`).join("")}
    <button type="button" data-act="tep" aria-pressed="${PR.tep}" ${tipAttr("<b>TE premium</b>\nTight ends get an extra 0.5 points per catch")}>TEP</button></div>`;
}

// ---------------------------------------------------------------- overall ranks
// Overall rank = points above a replacement-level player at his position (value over
// replacement), for a 12-team league starting QB, 2 RB, 3 WR, TE and a flex (RB/WR/TE),
// plus a superflex spot (any position, usually a second QB) when superflex is on. Starters
// are filled from the top down; the best player left over at each position sets its
// replacement level. Position rank is by points.
const LEAGUE = { teams: 12, slots: { QB: 1, RB: 2, WR: 3, TE: 1 }, flex: 1 };
function overallRanks(players, ptsFn) {
  const pool = players.map((p) => ({ p, pts: ptsFn(p) })).filter((x) => x.pts != null).sort((a, b) => b.pts - a.pts);
  const used = new Set(), T = LEAGUE.teams;
  const take = (ok, n) => { for (const x of pool) { if (!n) break; if (!used.has(x) && ok(x.p.pos)) { used.add(x); n--; } } };
  for (const [pos, k] of Object.entries(LEAGUE.slots)) take((q) => q === pos, k * T);
  take((q) => q !== "QB", LEAGUE.flex * T);
  if (PR.sf) take(() => true, T);
  const repl = {};
  for (const x of pool) if (!used.has(x) && repl[x.p.pos] == null) repl[x.p.pos] = x.pts;
  const posRank = {}, out = new Map();
  for (const x of pool) {
    posRank[x.p.pos] = (posRank[x.p.pos] || 0) + 1;
    out.set(x.p.id, { pts: x.pts, value: x.pts - (repl[x.p.pos] ?? 0), posRank: posRank[x.p.pos] });
  }
  [...out.entries()].sort((a, b) => b[1].value - a[1].value || b[1].pts - a[1].pts).forEach(([, v], i) => { v.overall = i + 1; });
  return out;
}
function sfControl() {
  return `<button type="button" class="pill" data-act="sf" aria-pressed="${PR.sf}" ${tipAttr("<b>Superflex</b>\nYour league has a spot any position can fill, so most teams start two QBs. QBs move up the overall ranks.")}>Superflex</button>`;
}

// ---------------------------------------------------------------- shared bits
/** Lower-case the start of each phrase but keep acronyms like RB. */
const lc = (s) => s.replace(/(^|, | and )([A-Z])([a-z])/g, (m, a, b, c) => a + b.toLowerCase() + c);
const pf1 = (v) => (v == null ? "–" : (+v).toFixed(1));
const pctOf = (v) => (v == null ? "–" : v > 0.99 ? ">99%" : v < 0.01 ? "<1%" : `${Math.round(v * 100)}%`);
function confOk(team, conf) {
  if (state.team) return team === state.team;
  if (state.conf === "fbs" || state.conf === "all") return true;
  return (conf || M.hist?.teams?.[team]?.c) === state.conf;
}
function scoreBand(s) { return s >= 75 ? "s1" : s >= 50 ? "s2" : s >= 25 ? "s3" : s >= 10 ? "s4" : "s5"; }
function scoreBar(s) {
  return `<span class="sbar ${scoreBand(s)}" role="img" aria-label="Prospect Score ${pf1(s)} of 100"><i style="width: ${Math.max(2, Math.min(100, s))}%"></i></span>`;
}
/** Opponent defense chip for an upcoming game: season rank through the latest week. */
function nextChip(team, kind) {
  const r = team && defRank(team, 0, kind);
  if (!r || !r.season) return `<span class="chip none" ${tipAttr(`<b>${esc(team || "Opponent")}</b>\nNot ranked (FCS or no data)`)}>–</span>`;
  const m = r.season;
  return `<span class="chip d${defBand(m.rank, r.n)}" tabindex="0" ${tipAttr(`<b>${esc(team)} ${kind} defense</b>\nSeason: ${ordinal(m.rank)} of ${r.n} (${r.metric.fmt(m.val)} ${r.metric.label} allowed)`)}>${ordinal(m.rank)}</span>`;
}
function seg(key, store, opts, label, act) {
  return `<div class="seg" role="group" aria-label="${label}">${opts.map(([v, text]) =>
    `<button type="button" data-act="${act}" data-key="${key}" data-val="${v}" aria-pressed="${store[key] === v}">${text}</button>`).join("")}</div>`;
}
function searchBox(id, value, placeholder) {
  return `<label><span class="sr">${placeholder}</span><input type="search" id="${id}" placeholder="${placeholder}" value="${esc(value)}"></label>`;
}
const notReady = (what) => `<div class="card empty">${what} aren't available yet.</div>`;
function sortTh(act, key, label, cur, tip = "") {
  return `<th scope="col" ${tip ? tipAttr(tip) : ""}><button type="button" data-act="${act}" data-val="${key}" aria-label="Sort by ${label}">${label}${cur === key ? " ▾" : ""}</button></th>`;
}

/** "Showing 100 of 366" with Show 100 more / Show all. Search and filters always cover everyone. */
function moreBar(total, shownN, act) {
  if (total <= shownN) return total > 100 ? `<p class="muted" style="margin: 0; padding: 12px 16px; font-size: 12px">Showing all ${total}. <button type="button" class="linkbtn" data-act="${act}" data-val="reset">Back to top 100</button></p>` : "";
  return `<div class="morebar"><span class="muted">Showing ${shownN} of ${total}. Search, or pick a team or conference in the sidebar, to find anyone.</span>
    <span><button type="button" class="btn" data-act="${act}" data-val="100">Show ${Math.min(100, total - shownN)} more</button>
    <button type="button" class="btn" data-act="${act}" data-val="all">Show all ${total}</button></span></div>`;
}
/** Name button when the player has a card this season; plain bold name otherwise. */
const nameCell = (p) => (M.hist?.players?.[p.id] ? pbtn(p.id, p.name) : `<b>${esc(p.name)}</b>`);

// ---------------------------------------------------------------- prospects page
function renderProspects() {
  if (!PR.ready) { loadPremium().then(render); return topBar(`Prospects ${PRO_BADGE}`) + `<div class="loading">Loading…</div>`; }
  if (!PR.prospects) return topBar(`Prospects ${PRO_BADGE}`) + notReady("Prospect scores");
  const st = PR.pros, q = st.q.trim().toLowerCase();
  if (st.view === "past") return renderPastDrafts();
  let rows = PR.prospects.players.filter((p) => p.pos === st.pos && confOk(p.team, p.conf) &&
    (!q || p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q)));
  const key = { score: (p) => -p.score, draft: (p) => -p.pDraft, top: (p) => -p.pTop100, nfl: (p) => -(p.pNfl ?? 0), dom: (p) => -p.dominator, ypg: (p) => -p.ypg, pp: (p) => -p.perPlay }[st.sort] || ((p) => -p.score);
  rows = rows.slice().sort((a, b) => key(a) - key(b));
  const shown = rows.slice(0, st.limit);
  const isRb = st.pos === "RB", isQb = st.pos === "QB";
  const controls = viewSeg() + seg("pos", st, PROS_POS, "Position", "pros") + searchBox("prq", st.q, "Search players or teams");
  const drv = (d) => d.slice(0, 2).map(([k, v]) => `<span class="drv ${v >= 0 ? "pos" : "neg"}">${v >= 0 ? "+" : "−"} ${esc(k)}</span>`).join(" ");
  const body = shown.map((p) => {
    const [rk] = PR.pRank.get(String(p.id)) || [];
    const out = p.noGames ? ` <span class="chip d2" ${tipAttr(`<b>Hasn't played in ${PR.prospects.season}</b>\nOn ${esc(p.team)}'s ${PR.prospects.season} roster but no stats this season (usually an injury or sitting out). Scored on his college career through ${p.lastSeason}.`)}>No ${PR.prospects.season} games</span>` : "";
    return `<tr><td class="dim">${rk ?? ""}</td><td class="l">${nameCell(p)} ${tb(p.team)} <span class="pos"></span>${out}
        <div class="sub">${esc(p.team)} · ${plural(p.seasons, "season")} with FBS stats</div><div class="sub">${drv(p.drivers)}</div></td>
      <td><div class="scell"><b>${pf1(p.score)}</b>${scoreBar(p.score)}</div></td>
      <td>${pctOf(p.pDraft)}</td><td>${pctOf(p.pTop100)}</td><td><b>${pctOf(p.pNfl)}</b></td>
      <td>${pct(p.dominator)}</td><td>${pf1(p.ypg)}</td><td>${(+p.perPlay).toFixed(2)}</td></tr>`;
  }).join("");
  const rk = st.sort;
  const table = `<section class="card"><div class="tbl" style="border: 0; border-radius: 16px"><table><thead><tr>
      <th scope="col">#</th><th scope="col" class="l">Player</th>
      ${sortTh("pros-sort", "score", "Score", rk, "<b>Prospect Score (0-100)</b>\nHow his college profile compares with past players who got drafted. It blends his chance of being drafted with his chance of going in the top 100 picks (counted double). Higher = more like past high picks.")}
      ${sortTh("pros-sort", "draft", "Drafted", rk, "<b>Chance of being drafted</b>\nHow often past players with college numbers like his were drafted")}
      ${sortTh("pros-sort", "top", "Top 100", rk, "<b>Chance of a top-100 pick</b>\nHow often players like him went in the first 100 picks (roughly rounds 1-3)")}
      ${sortTh("pros-sort", "nfl", "NFL starter", rk, `<b>Chance of an NFL fantasy starter season</b>\nHow often past players with his Prospect Score finished as a top-${PR.prospects.nfl?.[st.pos]?.starter ?? ""} ${st.pos} in half-PPR points per game (8+ games) at least once in their first three NFL seasons`)}
      ${isQb ? `${sortTh("pros-sort", "dom", "QB rush dom", rk, "<b>QB rushing dominator (this season)</b>\nThe average of his share of the team's rushing yards and rushing TDs (season totals, which count sacks as runs)")}
      ${sortTh("pros-sort", "ypg", "Total yds/g", rk, "<b>Passing + rushing yards per game</b>\nIn his best college season")}
      ${sortTh("pros-sort", "pp", "Adj yds/att", rk, "<b>Adjusted yards per pass attempt (this season)</b>\nPassing yards plus 20 per TD minus 45 per interception, per attempt. The best single draft signal for QBs.")}` :
      `${sortTh("pros-sort", "dom", isRb ? "RB dom" : "Dom", rk, isRb ? "<b>RB dominator (this season)</b>\nThe average of his share of the team's scrimmage yards and its touchdowns" : "<b>Dominator (this season)</b>\nThe average of his share of the team's receiving yards and its receiving touchdowns")}
      ${sortTh("pros-sort", "ypg", isRb ? "Scrim yds/g" : "Rec yds/g", rk, `<b>${isRb ? "Scrimmage" : "Receiving"} yards per game</b>\nIn his best college season${isRb ? " (rushing + receiving)" : ""}`)}
      ${sortTh("pros-sort", "pp", isRb ? "Yds / team play" : "Yds / team pass", rk, isRb ? "<b>Scrimmage yards per team play</b>\nHis rushing + receiving yards divided by all of his team's offensive plays, this season. The best single draft signal for backs." : "<b>Receiving yards per team pass attempt</b>\nHis receiving yards divided by all of his team's pass attempts, this season. One of the two best single draft signals for receivers.")}`}
    </tr></thead><tbody>${body || `<tr><td colspan="9" class="dim">No players match.</td></tr>`}</tbody></table></div>
    ${moreBar(rows.length, shown.length, "pros-more")}</section>`;
  const side = `<section class="card pad"><h2 style="font-size: 18px">What the score means</h2>
      <p style="margin: 6px 0 10px; font-size: 13px; color: var(--ink2)">How often past players in each score range were drafted. Each past class was scored without the model knowing how it was drafted (2019-2026 drafts).</p>
      <div class="tbl"><table style="min-width: 0"><thead><tr><th scope="col">Score</th><th scope="col">Drafted</th><th scope="col">Top 100</th></tr></thead><tbody>
      ${(st.pos === "WR" ? [["75+", 89, 63], ["50-75", 88, 65], ["25-50", 49, 25], ["10-25", 35, 9], ["<10", 4, 1]]
        : st.pos === "TE" ? [["75+", 86, 64], ["50-75", 87, 52], ["25-50", 56, 19], ["10-25", 34, 8], ["<10", 6, 2]]
        : [["75+", 100, 80], ["50-75", 85, 33], ["25-50", 72, 22], ["10-25", 34, 8], ["<10", 3, 0]])
        .map(([s, d, t]) => `<tr><td>${s}</td><td>${d}%</td><td>${t}%</td></tr>`).join("")}</tbody></table></div></section>
    ${nflCard(st.pos)}
    <section class="card pad"><h2 style="font-size: 18px">How it works</h2>
      <p style="margin: 6px 0 0; font-size: 13px; color: var(--ink2); line-height: 1.55">College usage and production for every FBS ${st.pos} since 2014, tested against who the NFL drafted and how high. ${isQb ? "For quarterbacks the strongest signals are adjusted yards per attempt, total yards per game, EPA per dropback and completion rate, adjusted for conference, size, how many seasons he started, how efficient he is as a runner and his high school recruiting rank." : `The strongest signals are ${isRb ? "scrimmage yards per team play, scrimmage yards per game and RB dominator" : "receiving yards per game, receiving yards per team pass attempt and dominator"}, adjusted for conference, size, how early he produced, his high school recruiting rank and years since high school, and the talent of the teammates he shares the ball with.`} Current players are scored as if this were their final season, so early-season scores move. It's built to predict the draft; the NFL starter column translates the score into how often players like him became fantasy starters.</p></section>`;
  return topBar(`Prospects ${PRO_BADGE}`, controls) +
    `<p class="muted" style="margin: -6px 0 16px">Prospect Score for ${PR.prospects.season} ${st.pos}s through week ${PR.prospects.through ?? state.data.meta.week}. Under each name: what's helping (green) and hurting (red) his score most. Click a player for his card.</p>
    <div class="note-box"><b>What this is (and isn't):</b> the Prospect Score is built only from data: college production and usage, recruiting rankings, size and conference. It includes no film study or scouting. It measures how likely a player is to be drafted and how high, because draft position is one of the strongest predictors of NFL production.</div>
    <div class="cols"><div class="wide">${table}</div><div class="narrow">${side}</div></div>`;
}

/** Score -> NFL starter rate, and hit rate by draft pick (for after the draft). */
function nflCard(pos) {
  const c = PR.prospects?.nfl?.[pos];
  if (!c) return "";
  const row = ([lab, n, r]) => `<tr><td>${lab}</td><td>${r == null ? "–" : `${r}%`}</td><td class="dim">${n}</td></tr>`;
  return `<section class="card pad"><h2 style="font-size: 18px">From score to NFL starter</h2>
      <p style="margin: 6px 0 10px; font-size: 13px; color: var(--ink2)">How often FBS ${pos}s from the 2015-2023 drafts had a top-${c.starter} half-PPR season in their first three NFL years, by Prospect Score.</p>
      <div class="tbl"><table style="min-width: 0"><thead><tr><th scope="col">Score</th><th scope="col">NFL starter</th><th scope="col">Players</th></tr></thead><tbody>${c.bands.map(row).join("")}</tbody></table></div>
      <h3 style="margin: 16px 0 6px; font-size: 13px">After the draft</h3>
      <p style="margin: 0 0 10px; font-size: 13px; color: var(--ink2)">Once he's picked, draft slot is the best guide. College stats added nothing on top of it in our tests.</p>
      <div class="tbl"><table style="min-width: 0"><thead><tr><th scope="col">Pick</th><th scope="col">NFL starter</th><th scope="col">Players</th></tr></thead><tbody>${c.picks.map(row).join("")}</tbody></table></div></section>`;
}

const viewSeg = () => seg("view", PR.pros, [["now", "This season"], ["past", "Past drafts"]], "View", "pros");

// ---------------------------------------------------------------- past drafts
// Each 2019-2026 class scored by a model that never saw that class, next to where
// (if) each player was drafted.
function renderPastDrafts() {
  const st = PR.pros;
  if (PR.hist === undefined) {
    PR.hist = null;
    loadJSON(`data/premium/prospects-history.json`).then((d) => { PR.hist = d || false; render(); }).catch(() => { PR.hist = false; render(); });
  }
  const head = (c = "") => topBar(`Prospects ${PRO_BADGE}`, c);
  if (PR.hist === null) return head(viewSeg()) + `<div class="loading">Loading…</div>`;
  if (!PR.hist) return head(viewSeg()) + notReady("Past draft classes");
  const d = PR.hist, years = d.drafts.slice().reverse();
  if (!st.year) st.year = years[0];
  const isRb = st.pos === "RB", q = st.q.trim().toLowerCase();
  const cls = d.players.filter((p) => p.pos === st.pos && p.draft === st.year);
  let rows = cls.filter((p) => (st.filter === "all" || (st.filter === "drafted" ? p.pick : !p.pick)) &&
    (!q || p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q)));
  rows = rows.slice().sort(st.psort === "pick" ? (a, b) => (a.pick ?? 999) - (b.pick ?? 999) || a.rank - b.rank
    : st.psort === "nfl" ? (a, b) => (a.nflBest ?? 999) - (b.nflBest ?? 999) || a.rank - b.rank : (a, b) => a.rank - b.rank);
  const shown = rows.slice(0, st.limit);
  const drafted = cls.filter((p) => p.pick), top10 = cls.filter((p) => p.rank <= 10);
  const sm = d.summary[`${st.pos}-${st.year}`] || {};
  const med = (xs) => { const v = xs.slice().sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
  const rd1 = drafted.filter((p) => p.round === 1);
  const cards = `<div class="heads">
    <div class="head" style="cursor: default"><div class="k">Top 10 scores</div><div class="v">${top10.filter((p) => p.pick).length} of 10</div>
      <div class="s">were drafted · ${top10.filter((p) => p.pick && p.pick <= 100).length} in the top 100</div></div>
    <div class="head" style="cursor: default"><div class="k">Drafted ${st.pos}s</div><div class="v">${drafted.length}</div>
      <div class="s">the typical one ranked ${ordinal(med(drafted.map((p) => p.rank)) || 0)} of ${cls.length} by score</div></div>
    ${rd1.length ? `<div class="head" style="cursor: default"><div class="k">First-rounders</div><div class="v">${rd1.length}</div>
      <div class="s">where the model ranked them: ${rd1.sort((a, b) => a.pick - b.pick).map((p) => ordinal(p.rank)).join(", ")}</div></div>` : ""}
    ${(() => {
      const hits = cls.filter((p) => p.nflHit), seen = d.lastNflSeason - st.year + 1;
      if (seen < 1) return "";
      return `<div class="head" style="cursor: default"><div class="k">NFL starters${seen < 3 ? ` (${seen} season${seen > 1 ? "s" : ""} in)` : ""}</div><div class="v">${hits.length}</div>
        <div class="s">${hits.length ? `where the model ranked them: ${hits.sort((a, b) => a.rank - b.rank).map((p) => ordinal(p.rank)).join(", ")}` : `no top-${PR.prospects?.nfl?.[st.pos]?.starter ?? ""} season yet`}</div></div>`;
    })()}
    ${sm.aucDrafted ? `<div class="head tan" style="cursor: default"><div class="k">Ranking accuracy</div><div class="v">${Math.round(sm.aucDrafted * 100)}%</div>
      <div class="s">Pick any drafted ${st.pos} and any undrafted one from this class: this is how often the drafted player had the higher score</div></div>` : ""}</div>`;
  const result = (p) => p.pick
    ? `<span class="chip ${p.pick <= 32 ? "d5" : p.pick <= 100 ? "d4" : "d3"}" style="cursor: default">Pick ${p.pick}</span><div class="sub">Rd ${p.round} · ${esc(p.nfl || "")}</div>`
    : `<span class="dim">Undrafted</span>`;
  const nflCell = (p) => {
    if (p.nflBest) return `<span class="chip ${p.nflHit ? "d5" : "d3"}" ${tipAttr(`<b>Best NFL finish: ${st.pos}${p.nflBest}</b>\nHis best rank among ${st.pos}s in half-PPR points per game (8+ games) in his first three NFL seasons. Green = a fantasy starter season (top ${PR.prospects?.nfl?.[st.pos]?.starter ?? ""}).`)}>Best: ${st.pos}${p.nflBest}</span><div class="sub">${pf1(p.nflBestPpg)} pts/game</div>`;
    if (p.nflSeasons) return `<span class="dim" ${tipAttr("No NFL season with 8+ games yet, so no finish to rank")}>No 8-game season</span>`;
    return p.pick ? `<span class="dim">–</span>` : "";
  };
  const drv = (dd) => dd.slice(0, 2).map(([k, v]) => `<span class="drv ${v >= 0 ? "pos" : "neg"}">${v >= 0 ? "+" : "−"} ${esc(k)}</span>`).join(" ");
  const body = shown.map((p) => `<tr><td class="dim">${p.rank}</td><td class="l"><b>${esc(p.name)}</b> ${tb(p.team)} <span class="pos"></span>
      <div class="sub">${esc(p.team)}</div><div class="sub">${drv(p.drivers)}</div></td>
      <td><div class="scell"><b>${pf1(p.score)}</b>${scoreBar(p.score)}</div></td><td>${pctOf(p.pDraft)}</td><td>${pctOf(p.pTop100)}</td>
      <td>${pct(p.dominator)}</td><td class="l">${result(p)}</td><td class="l">${nflCell(p)}</td></tr>`).join("");
  const sortBtn = (k, label) => `<th scope="col"${k !== "rank" ? ` class="l"` : ""}><button type="button" data-act="pros-psort" data-val="${k}" aria-label="Sort by ${label}">${label}${st.psort === k ? " ▾" : ""}</button></th>`;
  const missing = d.notScored.filter((x) => x.pos === st.pos && x.draft === st.year);
  const controls = viewSeg() + seg("year", st, years.map((y) => [y, String(y)]), "Draft", "pros-year") +
    seg("pos", st, PROS_POS, "Position", "pros") +
    seg("filter", st, [["all", "All"], ["drafted", "Drafted"], ["undrafted", "Undrafted"]], "Show", "pros") + searchBox("prq", st.q, "Search players or teams");
  return head(controls) +
    `<p class="muted" style="margin: -6px 0 16px">Every FBS ${st.pos} whose college career ended before the ${st.year} draft, scored by a model that never saw this class, next to where he was drafted and his best NFL finish (half-PPR points per game, 8+ games, first three seasons, through ${d.lastNflSeason}). Ranked by score.</p>
    ${cards}
    <section class="card"><div class="tbl" style="border: 0; border-radius: 16px"><table><thead><tr>
      ${sortBtn("rank", "Rank")}<th scope="col" class="l">Player</th><th scope="col" ${tipAttr("<b>Prospect Score</b>\nScored by a version of the model that never saw this draft class")}>Score</th><th scope="col" ${tipAttr("<b>Chance of being drafted</b>\nWhat the model said before the draft")}>Drafted</th><th scope="col" ${tipAttr("<b>Chance of a top-100 pick</b>\nWhat the model said before the draft")}>Top 100</th>
      <th scope="col">${isRb ? "RB dom" : st.pos === "QB" ? "QB rush dom" : "Dom"}</th>${sortBtn("pick", "Draft result")}${sortBtn("nfl", "NFL best")}</tr></thead>
      <tbody>${body || `<tr><td colspan="8" class="dim">No players match.</td></tr>`}</tbody></table></div>
      ${moreBar(rows.length, shown.length, "pros-more")}
      ${missing.length ? `<p class="muted" style="margin: 0; padding: 12px 16px; font-size: 12px; border-top: 1px solid var(--line2)">Drafted but not scored (FCS school or no FBS stats at ${st.pos}): ${missing.map((x) => `${esc(x.name)} (pick ${x.pick})`).join(", ")}.</p>` : ""}</section>`;
}

const PROS_POS = [["WR", "WR"], ["TE", "TE"], ["RB", "RB"], ["QB", "QB"]];

// ---------------------------------------------------------------- projections page
// Non-Pro teaser: next week's rankings without points or stat lines (Data top 24, Free top 10),
// from the public teaser file, so the full projections never reach non-Pro browsers.
PR.teaser = undefined;
function renderProjectionsTeaser() {
  const head = (c = "") => topBar(`Projections ${PRO_BADGE}`, c);
  if (PR.teaser === undefined) {
    PR.teaser = null;
    const season = state.data?.meta?.season || new Date().getFullYear();
    loadJSON(`data/teasers/projection-ranks-${season}.json`).then((d) => { PR.teaser = d || false; render(); }).catch(() => { PR.teaser = false; render(); });
  }
  if (PR.teaser === null) return head() + `<div class="loading">Loading…</div>`;
  if (!PR.teaser) return head() + lockedPage("projections");
  const st = PR.pj, n = isFree() ? 10 : 24, d = PR.teaser;
  if (!d.ranks[st.pos]) st.pos = "WR";
  const list = (d.ranks[st.pos] || []).filter((p) => confOk(p.team)).slice(0, n);
  const dk = st.pos === "RB" ? "run" : "pass";
  const body = list.map((p) => `<tr><td class="rk"><b>${st.pos}${p.rank}</b></td>
      <td class="l">${M.hist?.players?.[p.id] ? pbtn(p.id, p.name) : `<b>${esc(p.name)}</b>`} ${tb(p.team)}</td>
      <td class="l">${p.home ? "vs." : "at"} ${tb(p.opp)} ${nextChip(p.opp, dk)}</td>
      <td class="l"><span class="fk-inline" aria-label="Pro only"></span></td></tr>`).join("");
  const table = `<section class="card"><div class="tbl" style="border: 0; border-radius: 16px 16px 0 0"><table><thead><tr>
      <th scope="col">Rank</th><th scope="col" class="l">Player</th><th scope="col" class="l">Opponent</th><th scope="col" class="l">Projected points</th></tr></thead>
      <tbody>${body || `<tr><td colspan="4" class="dim">No rankings for these filters.</td></tr>`}</tbody></table></div>
    ${lockBox({ need: "pro", title: "Projected points, stat lines and rest of season", body: "Pro members see every player's projected points in their league's scoring (standard, half PPR, PPR, TE premium), projected targets, carries, yards and TDs, rest-of-season projections and Who to start?", rows: 4, compact: true })}</section>`;
  return head(seg("pos", st, [["WR", "WR"], ["TE", "TE"], ["RB", "RB"], ...(d.ranks.QB ? [["QB", "QB"]] : [])], "Position", "pj")) +
    `<p class="muted" style="margin: -6px 0 16px">Week ${d.nextWeek} rankings for FBS ${st.pos}s (top ${n}, ${st.pos === "QB" ? "4-pt passing TDs" : "half PPR"}), from our projections. Pro shows the numbers behind them${d.ranks.QB ? ", plus overall rankings across positions with a superflex option" : ""}.</p>
    <div class="cols"><div class="wide">${table}</div></div>`;
}
const PJ_POS = [["WR", "WR"], ["TE", "TE"], ["RB", "RB"], ["QB", "QB"], ["ALL", "Overall"]];
function renderProjections() {
  if (!canPro()) return renderProjectionsTeaser();
  if (!PR.ready) { loadPremium().then(render); return topBar(`Projections ${PRO_BADGE}`) + `<div class="loading">Loading…</div>`; }
  if (!PR.proj) return topBar(`Projections ${PRO_BADGE}`) + notReady("Projections");
  const st = PR.pj, d = PR.proj, q = st.q.trim().toLowerCase(), next = st.span === "next";
  const all = st.pos === "ALL", isQb = st.pos === "QB", posName = all ? "players" : `${st.pos}s`;
  const dkOf = (p) => (p.pos === "RB" ? "run" : "pass"), dk = st.pos === "RB" ? "run" : "pass";
  const live = (p) => (next ? p.next : p.ros.games);
  const ptsOf_ = (p) => (next ? nextPts(p) : rosPts(p));
  let rows = d.players.filter((p) => (all || p.pos === st.pos) && confOk(p.team) && live(p) &&
    (!q || p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q)));
  // Ranks are among every FBS player (so they stay put when you filter by team or search).
  const pool = d.players.filter((p) => (all || p.pos === st.pos) && live(p));
  const ov = all ? overallRanks(pool, ptsOf_) : null;
  const rankOf = new Map(pool.map((p) => [p, ptsOf_(p)]).sort((a, b) => b[1] - a[1]).map(([p], i) => [p.id, i + 1]));
  const sortKey = st.sort || (all ? "value" : next ? "pts" : "ros");
  const n_ = (f) => (p) => -(p.next?.[f] ?? -1);
  const key = {
    pts: (p) => -(nextPts(p) ?? -1), tgt: n_("tgt"), car: n_("car"), yds: n_("yds"), td: n_("td"), imp: n_("implied"),
    att: n_("att"), pyds: n_("passYds"), ptd: n_("passTd"), int: n_("int"), ryds: n_("rushYds"), rtd: n_("rushTd"),
    value: (p) => -(ov?.get(p.id)?.value ?? -1e9),
    ros: (p) => -rosPts(p), pg: (p) => -(p.ros.games ? rosPts(p) / p.ros.games : -1), g: (p) => -p.ros.games,
  }[sortKey] || ((p) => -(nextPts(p) ?? -1));
  rows = rows.slice().sort((a, b) => key(a) - key(b));
  const shown = rows.slice(0, st.limit);
  const rk = (p) => all
    ? `<td class="rk"><b>${ov.get(p.id)?.overall ?? ""}</b><div class="sub">${p.pos}${ov.get(p.id)?.posRank ?? ""}</div></td>`
    : `<td class="rk"><b>${st.pos}${rankOf.get(p.id) ?? ""}</b></td>`;
  const valTd = (p) => (all ? `<td>${pf1(ov.get(p.id)?.value)}</td>` : "");
  const valTh = all ? sortTh("pj-sort", "value", "Value", sortKey, `<b>Value over replacement</b>\nHis projected points minus those of the best ${"player"} at his position who wouldn't start in a 12-team league (QB, 2 RB, 3 WR, TE, flex${PR.sf ? ", superflex" : ""}). The overall rank sorts by this, so a QB's big point totals don't crowd out everyone else.`) : "";
  const rankTip = all ? `<b>Overall rank</b>\nBy value over replacement, ${PR.sf ? "superflex" : "1 QB"}, ${fmtName()}. Below it: his position rank by points.`
                      : `<b>Position rank</b>\nBy projected points in ${fmtName()}${isQb ? ` (${PR.ptd}-pt pass TD)` : ""}, among all FBS ${st.pos}s`;
  const det = st.details && !all;
  const flag = (p) => (p.missedLast ? ` <span class="chip d2" ${tipAttr("<b>Missed his team's last game</b>\nThe projection assumes he plays. Check his status.")}>Out last game</span>`
    : p.pos === "QB" && p.startedLast === false ? ` <span class="chip d2" ${tipAttr("<b>Not the starter last game</b>\nAnother QB led his team in pass attempts. The projection follows his recent share of the throws.")}>Not starting last game</span>` : "");
  const subOf = (p) => (p.pos === "QB" ? `${R(p.share.att)}% of pass attempts` : `${R(p.share.tgt)}% of targets${p.pos === "RB" ? ` · ${R(p.share.car)}% of carries` : ""}`);
  let head, body;
  if (next) {
    const detHead = isQb
      ? `${sortTh("pj-sort", "att", "Att", sortKey, "<b>Projected pass attempts</b>")}${sortTh("pj-sort", "pyds", "Pass yds", sortKey, "<b>Projected passing yards</b>")}
         ${sortTh("pj-sort", "ptd", "Pass TD", sortKey, "<b>Projected passing TDs</b>")}${sortTh("pj-sort", "int", "INT", sortKey, "<b>Projected interceptions</b>")}
         ${sortTh("pj-sort", "car", "Car", sortKey, "<b>Projected carries</b>\nSacks not counted")}${sortTh("pj-sort", "ryds", "Rush yds", sortKey, "<b>Projected rushing yards</b>\nNet of sacks")}
         ${sortTh("pj-sort", "rtd", "Rush TD", sortKey, "<b>Projected rushing TDs</b>")}`
      : `${sortTh("pj-sort", "tgt", "Tgt", sortKey, "<b>Projected targets</b>")}${sortTh("pj-sort", "car", "Car", sortKey, "<b>Projected carries</b>")}
         ${sortTh("pj-sort", "yds", "Yds", sortKey, "<b>Rushing + receiving yards</b>")}${sortTh("pj-sort", "td", "TD", sortKey, "<b>Projected touchdowns</b>\nAn average, so 0.80 means a TD in most of the games like this one")}`;
    head = `<th scope="col" ${tipAttr(rankTip)}>Rank</th><th scope="col" class="l">Player</th><th scope="col" class="l" ${tipAttr(`<b>Opponent</b>\nWith its ${all ? "pass (run for RBs)" : dk} defense rank (1st = toughest). Hover a chip for details.`)}>Opponent</th>
      ${sortTh("pj-sort", "pts", "Proj pts", sortKey, `<b>Projected points (${fmtName()})</b>\n${fmtRule()}${isQb || all ? `\nQBs: ${esc(qbRule())}` : ""}`)}${valTh}
      ${det ? `${detHead}${sortTh("pj-sort", "imp", "Team total", sortKey, "<b>Team's expected points</b>\nWhat the betting line implies his team will score this week (from the point spread and over/under)")}` : ""}`;
    body = shown.map((p) => {
      const n = p.next;
      const detRow = p.pos === "QB"
        ? `<td>${pf1(n.att)}</td><td>${n.passYds}</td><td>${(+n.passTd).toFixed(2)}</td><td>${(+n.int).toFixed(2)}</td><td>${pf1(n.car)}</td><td>${n.rushYds}</td><td>${(+n.rushTd).toFixed(2)}</td>`
        : `<td>${pf1(n.tgt)}</td><td>${pf1(n.car)}</td><td>${n.yds}</td><td>${(+n.td).toFixed(2)}</td>`;
      return `<tr>${rk(p)}<td class="l">${pbtn(p.id, p.name)} ${tb(p.team)} ${all ? `<span class="pos">${p.pos}</span>` : `<span class="pos"></span>`}${flag(p)}
          <div class="sub">${subOf(p)}</div></td>
        <td style="text-align: left">${n.home ? "vs." : "at"} ${tb(n.opp)} ${nextChip(n.opp, dkOf(p))}</td>
        <td><b class="big">${pf1(nextPts(p))}</b></td>${valTd(p)}
        ${det ? `${detRow}<td>${n.implied == null ? `<span class="dim">–</span>` : pf1(n.implied)}</td>` : ""}</tr>`;
    }).join("");
  } else {
    head = `<th scope="col" ${tipAttr(rankTip.replace("projected points", "rest-of-season points"))}>Rank</th><th scope="col" class="l">Player</th>
      ${sortTh("pj-sort", "ros", "Rest of season", sortKey, `<b>Total projected points (${fmtName()})</b>\nRemaining regular-season games`)}
      ${sortTh("pj-sort", "pg", "Per game", sortKey, "<b>Projected points per remaining game</b>")}${valTh}
      ${det ? `${sortTh("pj-sort", "g", "Games", sortKey, "<b>Regular-season games left</b>")}
      <th scope="col" style="text-align: left">Schedule <span class="muted" style="font-weight: 500; text-transform: none; letter-spacing: 0">(projected points)</span></th>` : ""}`;
    body = shown.map((p) => `<tr>${rk(p)}<td class="l">${pbtn(p.id, p.name)} ${tb(p.team)} ${all ? `<span class="pos">${p.pos}</span>` : `<span class="pos"></span>`}${flag(p)}</td>
        <td><b class="big">${pf1(rosPts(p))}</b></td><td>${pf1(p.ros.games ? rosPts(p) / p.ros.games : null)}</td>${valTd(p)}
        ${det ? `<td>${p.ros.games}</td>
        <td style="text-align: left"><div class="sched">${p.ros.weeks.map((wk) => {
          const [w, opp] = wk, pts = weekPts(p, wk);
          const r = defRank(opp, 0, dk), band = r?.season ? `d${defBand(r.season.rank, r.n)}` : "none";
          return `<span class="wkp ${band}" ${tipAttr(`<b>Week ${w} vs. ${esc(opp)}</b>\n${pf1(pts)} projected points${r?.season ? `\n${dk} D: ${ordinal(r.season.rank)}` : "\nNot ranked (FCS)"}`)}><small>W${w}</small>${pf1(pts)}</span>`;
        }).join("")}</div></td>` : ""}</tr>`).join("");
  }
  const controls = fmtControls() + (isQb || all ? ptdControls() : "") + (all ? sfControl() : "") +
    seg("span", st, [["next", `Week ${d.nextWeek}`], ["ros", "Rest of season"]], "Period", "pj") +
    seg("pos", st, PJ_POS, "Position", "pj") +
    (all ? "" : `<button type="button" class="pill" data-act="pj-details" aria-pressed="${det}">${det ? "Hide details" : "Show details"}</button>`) + searchBox("pjq", st.q, "Search players or teams");
  const acc = d.accuracyBy?.[PR.fmt] || d.accuracy || {}, a = acc[all ? "all (proj 5+)" : st.pos], allAcc = acc["all (proj 5+)"];
  const how = isQb
    ? `We start with his recent share of his team's pass attempts (recent games count much more, so a new starter takes over quickly) and multiply by how many passes his team usually throws. Then we apply his yards per attempt, TD rate and interception rate, plus his carries a game and yards and TDs per carry. Rushing is net of sacks. For QBs with only a few games, those rates lean toward the typical FBS QB. Finally we adjust for the opponent's pass and run defenses and for the betting line. QB scoring: ${esc(qbRule())}. Projections assume he plays.`
    : all
    ? `Every position's projections on one list. Ranking by raw points would put every QB on top, so the overall rank uses <b>value</b>: his points minus what you'd get from the best player at his position who wouldn't start in a 12-team league (QB, 2 RB, 3 WR, TE and a flex${PR.sf ? ", plus a superflex spot, so about 24 QBs start" : ""}). Turn on <b>Superflex</b> if your league can start a second QB. Scoring: ${fmtName()} (${fmtRule()}); QBs ${esc(qbRule())}.`
    : `We start with his recent share of his team's targets and carries (recent games count more) and multiply by how many his team usually has. Then we apply his own catch rate, yards per target or carry, and TD rate. For players with only a few games, those rates lean toward the typical ${st.pos} until he has enough volume. Finally we adjust for the opponent's ${dk} defense and for the betting line (teams expected to score more get more TD chances). Pick your league's scoring at the top: ${fmtName()} is ${fmtRule()}. Projections assume he plays.`;
  const side = `<section class="card pad"><h2 style="font-size: 18px">How ${all ? "overall ranks" : "projections"} work</h2>
      <p style="margin: 6px 0 0; font-size: 13px; color: var(--ink2); line-height: 1.55">${how}</p></section>
    ${a ? `<section class="card pad"><h2 style="font-size: 18px">How accurate</h2>
      <p style="margin: 6px 0 10px; font-size: 13px; color: var(--ink2)">Weeks 3-${d.through} of this season, each projected using only earlier games, scored ${isQb ? "with 4-pt passing TDs" : FORMATS[PR.fmt][0]}. ${isQb ? "Starting QBs with 2+ earlier games." : "Players projected for 5+ points."}</p>
      <div class="tbl"><table style="min-width: 0"><thead><tr><th scope="col"></th><th scope="col" ${tipAttr("<b>Average miss</b>\nHow far off the projection was from his actual points, on average")}>Average miss</th></tr></thead><tbody>
        <tr><td>These projections</td><td><b>${a.mae.toFixed(1)} pts</b></td></tr>
        <tr><td>Just using his season average</td><td>${a.baseMae.toFixed(1)} pts</td></tr></tbody></table></div>
      <p class="muted" style="margin: 10px 0 0; font-size: 12px">${plural(a.n, `${all ? "player" : st.pos} game`)}. Weekly fantasy points swing a lot (one TD is ${isQb ? "4 to 6" : "6"} points), so even good projections miss by several points on average.${!all && !isQb && allAcc ? ` WR, TE and RB together: ${allAcc.mae.toFixed(1)} vs. ${allAcc.baseMae.toFixed(1)}.` : ""}</p></section>` : ""}
    ${defLegend()}`;
  const table = `<section class="card"><div class="tbl" style="border: 0; border-radius: 16px"><table><thead><tr>${head}</tr></thead>
    <tbody>${body || `<tr><td colspan="12" class="dim">No players match.</td></tr>`}</tbody></table></div>
    ${moreBar(rows.length, shown.length, "pj-more")}</section>`;
  return topBar(`Projections ${PRO_BADGE}`, controls) +
    `<p class="muted" style="margin: -6px 0 16px">${next ? `Week ${d.nextWeek} projections` : "Rest-of-season projections"} in ${fmtName()}${isQb || all ? `, ${PR.ptd}-pt passing TDs` : ""}${all ? `, ${PR.sf ? "superflex" : "1 QB"}` : ""} for FBS ${posName}, using games through week ${d.through}.${d.hasSchedule ? "" : " No schedule loaded yet."} Teams on a bye are left off.</p>
    <div class="cols"><div class="wide">${table}</div><div class="narrow">${side}</div></div>`;
}

// ---------------------------------------------------------------- player card
function drawerPremium(id, e) {
  if (!["WR", "TE", "RB"].includes(e.p)) return "";
  if (!canPro()) return `<h3 style="margin: 20px 0 8px; font-size: 13px">Prospect score &amp; projections <span class="pro">Pro</span></h3>` +
    lockBox({ need: "pro", title: "Prospect Score, projections and NFL odds", body: "Pro members see his Prospect Score, next-week and rest-of-season projections, and his chance of becoming an NFL fantasy starter.", rows: 3, compact: true });
  if (!PR.ready) { loadPremium().then(() => M.player === id && renderDrawer()); return ""; }
  const p = PR.pById?.get(String(id)), j = PR.jById?.get(String(id));
  if (!p && !j) return "";
  const isRb = e.p === "RB", dk = isRb ? "run" : "pass";
  let html = `<h3 style="margin: 20px 0 8px; font-size: 13px">Prospect score &amp; projections ${PRO_BADGE}</h3><div class="tiles">`;
  if (p) {
    const [rk, n] = PR.pRank.get(String(id)) || [];
    html += `<div class="tile" ${tipAttr("<b>Prospect Score</b>\nHow his college profile compares with players the NFL drafted (0-100)")}><div class="k">Prospect</div><div class="v">${pf1(p.score)}</div><div class="muted" style="font-size: 11px">${rk ? `${ordinal(rk)} of ${n} ${e.p}s` : ""}</div></div>`;
  }
  if (j?.next) html += `<div class="tile" ${tipAttr(`<b>Week ${j.next.week} projection</b>\n${fmtName()}`)}><div class="k">Week ${j.next.week}</div><div class="v">${pf1(nextPts(j))}</div><div class="muted" style="font-size: 11px">${j.next.home ? "vs." : "at"} ${esc(teamAbbr(j.next.opp))}</div></div>`;
  else if (j) html += `<div class="tile"><div class="k">Week ${PR.proj.nextWeek}</div><div class="v">–</div><div class="muted" style="font-size: 11px">Bye</div></div>`;
  if (j) html += `<div class="tile" ${tipAttr(`<b>Rest of season</b>\nRemaining regular-season games, ${fmtName()}`)}><div class="k">Rest of season</div><div class="v">${pf1(rosPts(j))}</div><div class="muted" style="font-size: 11px">${plural(j.ros.games, "game")}</div></div>`;
  html += `</div>`;
  const lines = [];
  if (p) {
    const up = p.drivers.filter(([, v]) => v >= 0).map(([k]) => k.toLowerCase()), down = p.drivers.filter(([, v]) => v < 0).map(([k]) => k.toLowerCase());
    const list = (xs) => xs.join(", ").replace(/, ([^,]*)$/, " and $1");
    lines.push(`<b>${pctOf(p.pDraft)}</b> of past players with his profile were drafted, <b>${pctOf(p.pTop100)}</b> in the top 100, and <b>${pctOf(p.pNfl)}</b> had a top-${PR.prospects?.nfl?.[e.p]?.starter ?? ""} NFL fantasy season in their first three years.${up.length ? ` Helping his score most: ${esc(lc(list(up)))}.` : ""}${down.length ? ` Hurting it: ${esc(lc(list(down)))}.` : ""}`);
  }
  if (j?.next) {
    const n = j.next;
    lines.push(`Week ${n.week} projection ${n.home ? "vs." : "at"} ${esc(n.opp)} (${dk} D ranked ${nextChip(n.opp, dk)}): about ${isRb ? `${pf1(n.car)} carries and ${pf1(n.tgt)} targets` : `${pf1(n.tgt)} targets`}, ${n.yds} yards and ${(+n.td).toFixed(1)} TDs${n.implied != null ? `. The betting line expects his team to score about ${Math.round(n.implied)}` : ""}.`);
  }
  if (j?.missedLast) lines.push(`<span style="color: var(--down)">Missed his team's last game; the projection assumes he plays.</span>`);
  if (lines.length) html += `<div class="callout" style="min-height: 0">${lines.join("<br>")}</div>`;
  return html;
}

// ---------------------------------------------------------------- wiring
PAGES.prospects = renderProspects;
PAGES.projections = renderProjections;
DRAWER_EXTRAS.push(drawerPremium);
CLICK_ACTS["pj-details"] = () => { PR.pj.details = !PR.pj.details; render(); document.querySelector('[data-act="pj-details"]')?.focus(); };
CLICK_ACTS.fmt = (val) => { PR.fmt = val; saveFmt(); render(); if (M.player) renderDrawer(); };
CLICK_ACTS.sf = () => { PR.sf = !PR.sf; saveFmt(); render(); document.querySelector('[data-act="sf"]')?.focus(); };
CLICK_ACTS.tep = () => { PR.tep = !PR.tep; saveFmt(); render(); if (M.player) renderDrawer(); };
CLICK_ACTS["pros-more"] = (val) => { PR.pros.limit = val === "all" ? 1e9 : val === "reset" ? 100 : PR.pros.limit + 100; render(); };
CLICK_ACTS["pj-more"] = (val) => { PR.pj.limit = val === "all" ? 1e9 : val === "reset" ? 100 : PR.pj.limit + 100; render(); };
CLICK_ACTS.pros = (val, a) => { PR.pros[a.dataset.key] = val; PR.pros.sort = "score"; PR.pros.limit = 100; render(); document.querySelector(`[data-act="pros"][data-val="${val}"]`)?.focus(); };
CLICK_ACTS["pros-year"] = (val) => { PR.pros.year = +val; PR.pros.limit = 100; render(); document.querySelector(`[data-act="pros-year"][data-val="${val}"]`)?.focus(); };
CLICK_ACTS["pros-psort"] = (val) => { PR.pros.psort = val; render(); document.querySelector(`[data-act="pros-psort"][data-val="${val}"]`)?.focus(); };
CLICK_ACTS["pros-sort"] = (val) => { PR.pros.sort = val; render(); document.querySelector(`[data-act="pros-sort"][data-val="${val}"]`)?.focus(); };
CLICK_ACTS.pj = (val, a) => { PR.pj[a.dataset.key] = val; PR.pj.sort = null; PR.pj.limit = 100; render(); document.querySelector(`[data-act="pj"][data-val="${val}"]`)?.focus(); };
CLICK_ACTS["pj-sort"] = (val) => { PR.pj.sort = val; render(); document.querySelector(`[data-act="pj-sort"][data-val="${val}"]`)?.focus(); };
document.addEventListener("input", (ev) => {
  const id = ev.target.id;
  if (id !== "prq" && id !== "pjq") return;
  (id === "prq" ? PR.pros : PR.pj).q = ev.target.value;
  const pos = ev.target.selectionStart; render();
  const el = $(id); el.focus(); el.setSelectionRange(pos, pos);
});
start();
