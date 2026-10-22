// Quarterbacks on the members site: QB leaderboards, QB trends (rushing share, pass
// attempts, starter changes) and the QB player card. Everything comes from the season
// history file, which carries each QB's passing line, rushing line and sacks.
//
// College box scores count sacks as QB runs. Every QB rushing number here takes them
// back out ("net of sacks"), the way fantasy leagues and NFL stats count rushing.
"use strict";

// History array positions (see build_history in fetch_cfb_stats.py)
const QI = { car: 2, rushYds: 7, att: 10, cmp: 11, passYds: 12, passTd: 13, int: 14, rushTd: 15, sacks: 16, sackYds: 17 };
const QT = { opp: 9, rushYds: 17, rushTd: 18, sacks: 19, sackYds: 20, passAtt: 21 };
const QB_MIN = { weekAtt: 10, seasonAttPerGame: 10 };
const QB_BOARDS = { pass: "Passing", rush: "Rushing", dom: "Rush dominator %", fpts: "Fantasy pts" };

// ---------------------------------------------------------------- scoring
// 0.04 per passing yard (1 per 25), 4 or 6 per passing TD, −1 per INT, 0.1 per rushing yard, 6 per rushing TD.
const passTdPts = () => (typeof PR !== "undefined" && PR.ptd === 6 ? 6 : 4);
const qbRule = () => `1 point per 25 passing yards, ${passTdPts()} per passing TD, −1 per INT, 1 per 10 rushing yards, 6 per rushing TD`;
const qbPts = (g) => 0.04 * g.passYds + passTdPts() * g.passTd - g.int + 0.1 * g.rushYds + 6 * g.rushTd;
function ptdControls() {
  return `<div class="seg" role="group" aria-label="Passing TD points" ${tipAttr("<b>Passing TD points</b>\nMost leagues give 4 points per passing TD; some give 6")}>
    <button type="button" data-act="ptd" data-val="4" aria-pressed="${passTdPts() === 4}">4-pt pass TD</button>
    <button type="button" data-act="ptd" data-val="6" aria-pressed="${passTdPts() === 6}">6-pt pass TD</button></div>`;
}

// ---------------------------------------------------------------- one QB game
/**
 * Sacks to take out of a player's box-score rushing: [sacks, yards]. A few box scores
 * (mostly FCS) leave some sacks out of the rushing line, so when he has fewer carries than
 * sacks, only that many come out, with a matching share of the sack yards.
 */
function sackOut(a) {
  const n = a[QI.sacks] || 0, car = a[QI.car] || 0;
  if (!n) return [0, 0];
  const k = Math.min(n, car);
  return [k, ((a[QI.sackYds] || 0) * k) / n];
}
/** A QB's game from the history arrays, rushing net of sacks, plus team context. */
function qbGame(a, ta, teamCar, teamSackYds) {
  if (!a || a.length <= QI.sackYds) return null;
  const [sacks, sackYds] = sackOut(a);
  const g = { att: a[QI.att] || 0, cmp: a[QI.cmp] || 0, passYds: a[QI.passYds] || 0, passTd: a[QI.passTd] || 0, int: a[QI.int] || 0,
              car: (a[QI.car] || 0) - sacks, rushYds: R((a[QI.rushYds] || 0) - sackYds), rushTd: a[QI.rushTd] || 0, sacks: a[QI.sacks] || 0 };
  if (ta && ta.length > QT.passAtt) {
    g.tRushYds = (ta[QT.rushYds] || 0) - (teamSackYds || 0);
    g.tRushTd = ta[QT.rushTd] || 0;
    g.tAtt = ta[QT.passAtt] || 0;
    g.tCar = teamCar;
    g.ydsShare = g.tRushYds > 0 ? Math.max(0, Math.min(100, (100 * g.rushYds) / g.tRushYds)) : null;
    g.tdShare = g.tRushTd > 0 ? (100 * g.rushTd) / g.tRushTd : null;
    g.carShare = teamCar > 0 ? (100 * g.car) / teamCar : null;
  }
  g.dom = qbDom(g.rushYds, g.tRushYds, g.rushTd, g.tRushTd);
  g.pts = qbPts(g);
  return g;
}
/** QB rushing dominator: average of his share of team rushing yards and rushing TDs (yards alone if the team had no rushing TD). */
function qbDom(yds, tYds, td, tTd) {
  if (!(tYds > 0)) return null;
  const ys = Math.max(0, Math.min(100, (100 * yds) / tYds));
  return tTd > 0 ? (ys + (100 * td) / tTd) / 2 : ys;
}

// Team rushing attempts per week, net of sacks (sum of every player's carries minus team sacks).
let QB_CACHE = null;
function qbIndex() {
  const hist = M.hist;
  if (!hist) return null;
  if (QB_CACHE?.hist === hist) return QB_CACHE;
  const car = {}, sackYds = {}, lead = {};
  for (const [id, e] of Object.entries(hist.players)) for (const [w, a] of Object.entries(e.w)) {
    const [n, y] = a.length > QI.sackYds ? sackOut(a) : [0, 0];
    (car[e.t] ??= {})[w] = (car[e.t][w] || 0) + (a[QI.car] || 0) - n;
    (sackYds[e.t] ??= {})[w] = (sackYds[e.t][w] || 0) + y;
    const att = a[QI.att] || 0;
    if (att > 0) { const L = ((lead[e.t] ??= {})[w] ??= { id: null, att: 0 }); if (att > L.att) Object.assign(L, { id, att }); }
  }
  return (QB_CACHE = { hist, car, sackYds, lead });
}
/** All of a QB's games through `wk`, in order, with the week number and whether he started (led his team in attempts). */
function qbGames(id, wk = state.data.meta.week) {
  const e = M.hist?.players?.[id], ix = qbIndex();
  if (!e || !ix) return [];
  const tm = M.hist.teams?.[e.t]?.w || {};
  return Object.entries(e.w).filter(([w]) => +w <= wk).sort((x, y) => x[0] - y[0]).map(([w, a]) => {
    const g = qbGame(a, tm[w], ix.car[e.t]?.[w], ix.sackYds[e.t]?.[w]);
    if (!g) return null;
    return { ...g, w: +w, opp: tm[w]?.[QT.opp] || null, started: ix.lead[e.t]?.[w]?.id === id };
  }).filter(Boolean);
}
const qbHasData = () => {
  const any = Object.values(M.hist?.players || {}).find((e) => e.p === "QB");
  return !!any && Object.values(any.w).some((a) => a.length > QI.sackYds);
};

// ---------------------------------------------------------------- season totals
function qbSum(games) {
  const s = { games: games.length, starts: games.filter((g) => g.started).length };
  for (const k of ["att", "cmp", "passYds", "passTd", "int", "car", "rushYds", "rushTd", "sacks", "pts", "tRushYds", "tRushTd"]) s[k] = games.reduce((t, g) => t + (g[k] || 0), 0);
  s.cmpPct = s.att ? (100 * s.cmp) / s.att : null;
  s.ypa = s.att ? s.passYds / s.att : null;
  s.dom = qbDom(s.rushYds, s.tRushYds, s.rushTd, s.tRushTd);
  const per = (k) => (s.games ? s[k] / s.games : null);
  Object.assign(s, { attPg: per("att"), passYdsPg: per("passYds"), carPg: per("car"), rushYdsPg: per("rushYds"), sacksPg: per("sacks"), ptsPg: per("pts") });
  return s;
}
/** Teams in the current conference / team / AP scope (same rules as the other season boards). */
function qbScope() {
  const week = leaderboardTeams(), names = new Set(week.map((t) => t.name)), live = new Map(week.map((t) => [t.name, t]));
  const fbsConfs = new Set(state.data.games.flatMap((g) => [g.home, g.away]).filter((t) => t.classification === "fbs").map((t) => t.conference));
  const ok = (name) => {
    if (state.team) return name === state.team;
    if (names.has(name)) return true;
    if (state.ap) return false;
    const c = M.hist.teams?.[name]?.c;
    return state.conf === "all" || (state.conf === "fbs" ? fbsConfs.has(c) : c === state.conf);
  };
  return { ok, team: (name) => live.get(name) || { name, abbr: M.hist.teams?.[name]?.a } };
}
/** Season rows for every QB in scope who played half his team's games (3+) with 10+ attempts a game. */
function qbSeasonRows() {
  const wk = state.data.meta.week, sc = qbScope(), out = [];
  for (const [id, e] of Object.entries(M.hist?.players || {})) {
    if (e.p !== "QB" || !sc.ok(e.t)) continue;
    const games = qbGames(id, wk).filter((g) => g.att > 0 || g.car > 0);
    const teamGames = Object.keys(M.hist.teams?.[e.t]?.w || {}).filter((w) => +w <= wk).length;
    const s = qbSum(games);
    if (!state.team && (s.games < Math.max(3, Math.ceil(teamGames * SEASON_LB.minGameShare)) || s.attPg < QB_MIN.seasonAttPerGame)) continue;
    if (state.team && !s.att && !s.car) continue;
    out.push({ id, name: e.n, t: sc.team(e.t), ...s });
  }
  return out;
}
function qbWeekRows() {
  const wk = state.data.meta.week, rows = [];
  for (const t of leaderboardTeams()) for (const p of t.players) {
    if (p.pos !== "QB") continue;
    const g = qbGames(String(p.id), wk).find((x) => x.w === wk);
    if (!g || (!g.att && !g.car)) continue;
    if (!state.team && g.att < QB_MIN.weekAtt) continue;
    rows.push({ id: String(p.id), name: p.name, t, ...g, cmpPct: g.att ? (100 * g.cmp) / g.att : null, ypa: g.att ? g.passYds / g.att : null });
  }
  return rows;
}

// ---------------------------------------------------------------- leaderboards
function qbBoardSpec() {
  const { period, board } = M.lb, wk = state.data.meta.week;
  const P = (v) => pct(v), F1 = (v) => (v == null ? "–" : v.toFixed(1)), N = (v) => (v == null ? "–" : R(v).toLocaleString("en-US"));
  const faced = (kind) => ({ k: "faced", label: `Faced ${kind} D`, nosort: true,
                             html: (x) => { const o = oppOf(x.t.name); return o ? chip(o.name, wk, kind) : "–"; } });
  const cmpAtt = { k: "att", label: "Cmp/Att", html: (x) => `${x.cmp}/${x.att}` };
  if (!qbHasData()) return { title: "Quarterbacks", note: "", rows: [], cols: [{ k: "x", label: "–" }], empty: "QB stats are being loaded for this season. Check back shortly." };
  if (period === "week") {
    const rows = qbWeekRows(), note = state.team ? "" : `${QB_MIN.weekAtt}+ pass attempts`;
    if (board === "rush") return { title: `QB rushing · week ${wk}`, note: `${note} · net of sacks`, rows,
      cols: [{ k: "rushYds", label: "Rush yds", fmt: N, bar: 1 }, { k: "car", label: "Car" }, { k: "rushTd", label: "Rush TD" },
             { k: "carShare", label: "Rush att %", fmt: P }, { k: "sacks", label: "Sacks" }, faced("run")] };
    if (board === "dom") return { title: `QB rushing dominator · week ${wk}`, note: `${note} · net of sacks`, rows: rows.filter((x) => x.dom != null),
      cols: [{ k: "dom", label: "QB rush dom", fmt: P, bar: 1, tan: 1 }, { k: "ydsShare", label: "Rush yds %", fmt: P }, { k: "tdShare", label: "Rush TD %", fmt: P },
             { k: "rushYds", label: "Rush yds", fmt: N }, { k: "rushTd", label: "Rush TD" }, faced("run")] };
    if (board === "fpts") return { title: `QB fantasy points · week ${wk}`, note: `${note} · ${passTdPts()}-pt passing TDs`, rows,
      cols: [{ k: "pts", label: "Pts", fmt: F1, bar: 1 }, { k: "passYds", label: "Pass yds", fmt: N }, { k: "passTd", label: "Pass TD" }, { k: "int", label: "INT" },
             { k: "rushYds", label: "Rush yds", fmt: N }, { k: "rushTd", label: "Rush TD" }, faced("pass")] };
    return { title: `QB passing · week ${wk}`, note, rows,
      cols: [{ k: "passYds", label: "Pass yds", fmt: N, bar: 1 }, { k: "passTd", label: "Pass TD" }, { k: "int", label: "INT" }, cmpAtt,
             { k: "cmpPct", label: "Cmp %", fmt: P }, { k: "ypa", label: "Y/A", fmt: F1 }, faced("pass")] };
  }
  const rows = qbSeasonRows(), through = state.team ? `through week ${wk}` : `through week ${wk} · played at least half his team's games · ${QB_MIN.seasonAttPerGame}+ attempts a game`;
  if (board === "rush") return { title: "Season QB rushing", note: `${through} · net of sacks`, rows,
    cols: [{ k: "rushYdsPg", label: "Rush yds / g", fmt: F1, bar: 1 }, { k: "carPg", label: "Car / g", fmt: F1 }, { k: "rushTd", label: "Rush TD" },
           { k: "rushYds", label: "Rush yds", fmt: N }, { k: "sacksPg", label: "Sacks / g", fmt: F1 }, { k: "games", label: "Games" }] };
  if (board === "dom") return { title: "Season QB rushing dominator", note: `${through} · net of sacks`, rows: rows.filter((x) => x.dom != null),
    cols: [{ k: "dom", label: "QB rush dom", fmt: P, bar: 1, tan: 1 }, { k: "rushYdsPg", label: "Rush yds / g", fmt: F1 }, { k: "rushTd", label: "Rush TD" },
           { k: "carPg", label: "Car / g", fmt: F1 }, { k: "games", label: "Games" }] };
  if (board === "fpts") return { title: "Season QB fantasy points", note: `${through} · ${passTdPts()}-pt passing TDs`, rows,
    cols: [{ k: "ptsPg", label: "Pts / g", fmt: F1, bar: 1 }, { k: "pts", label: "Total pts", fmt: F1 }, { k: "passYdsPg", label: "Pass yds / g", fmt: F1 },
           { k: "passTd", label: "Pass TD" }, { k: "rushYdsPg", label: "Rush yds / g", fmt: F1 }, { k: "rushTd", label: "Rush TD" }, { k: "games", label: "Games" }] };
  return { title: "Season QB passing", note: through, rows,
    cols: [{ k: "passYdsPg", label: "Pass yds / g", fmt: F1, bar: 1 }, { k: "passTd", label: "Pass TD" }, { k: "int", label: "INT" }, { k: "cmpPct", label: "Cmp %", fmt: P },
           { k: "ypa", label: "Y/A", fmt: F1 }, { k: "attPg", label: "Att / g", fmt: F1 }, { k: "games", label: "Games" }] };
}
Object.assign(COL_TIPS, {
  "Pass yds": "<b>Passing yards</b>", "Pass TD": "<b>Passing touchdowns</b>", "INT": "<b>Interceptions thrown</b>",
  "Cmp/Att": "<b>Completions / attempts</b>", "Cmp %": "<b>Completion percentage</b>", "Y/A": "<b>Yards per pass attempt</b>",
  "Rush TD": "<b>Rushing touchdowns</b>", "Sacks": "<b>Times sacked</b>\nCollege box scores count sacks as runs; we take them out of his rushing",
  "Sacks / g": "<b>Times sacked per game</b>", "Rush att %": "<b>Share of team runs</b>\nHis carries (sacks taken out) as a share of all the team's rushing attempts",
  "Rush yds %": "<b>Share of team rushing yards</b>\nSacks taken out of both his and the team's yards", "Rush TD %": "<b>Share of team rushing TDs</b>",
  "QB rush dom": "<b>QB rushing dominator</b>\nThe average of his share of the team's rushing yards and rushing TDs, with sacks taken out. See \"What is dominator rating?\"",
  "Pts": "<b>Fantasy points</b>\nSee the scoring rule under the table", "Pts / g": "<b>Fantasy points per game</b>\nGames he played", "Total pts": "<b>Fantasy points, season</b>",
  "Pass yds / g": "<b>Passing yards per game</b>\nGames he played", "Att / g": "<b>Pass attempts per game</b>\nGames he played",
});
function qbExplainer() {
  return `<section class="card pad"><h2 style="font-size: 18px">How QB numbers work here</h2>
    <p style="margin: 8px 0 0; font-size: 13px; color: var(--ink2)"><b>Rushing is net of sacks.</b> College box scores count a sack as a QB run, which hides how much a quarterback actually runs. We take sacks back out, the way fantasy leagues count rushing.</p>
    <p style="margin: 8px 0 0; font-size: 13px; color: var(--ink2)"><b>QB rushing dominator</b> is how much of his team's run game is him: the average of his share of the team's rushing yards and its rushing TDs. Example: 60 of the team's 180 rushing yards (33%) and 1 of its 2 rushing TDs (50%) = <b>42%</b>.</p>
    <p style="margin: 8px 0 0; font-size: 13px; color: var(--ink2)"><b>Fantasy points:</b> ${esc(qbRule())}.</p></section>`;
}

// ---------------------------------------------------------------- trends
// Rushing share = his carries as a share of the team's rushing attempts (sacks out).
const QB_TR = { minAtt: 10 };
function qbTrends() {
  const wk = state.data.meta.week, multi = M.tr.span === "multi", up = [], down = [], changes = [];
  const ix = qbIndex();
  if (!ix) return { up, down, changes };
  for (const t of leaderboardTeams()) {
    // Starter changes: the team's leading passer this week vs. its previous game.
    const L = ix.lead[t.name] || {}, prevW = Object.keys(L).map(Number).filter((w) => w < wk).sort((a, b) => b - a)[0];
    const cur = L[wk], prev = prevW && L[prevW];
    if (cur && prev && cur.id !== prev.id && cur.att >= QB_MIN.weekAtt) {
      const was = M.hist.players[prev.id], now = M.hist.players[cur.id];
      const nowStarts = qbGames(cur.id, wk).filter((g) => g.started).length;
      const playedNow = !!M.hist.players[prev.id]?.w?.[wk];
      changes.push({ t, now: { id: cur.id, name: now.n, att: cur.att, starts: nowStarts }, was: { id: prev.id, name: was.n, att: prev.att, w: prevW, playedNow } });
    }
    for (const p of t.players) {
      if (p.pos !== "QB") continue;
      const games = qbGames(String(p.id), wk), g = games[games.length - 1];
      if (!g || g.w !== wk || g.carShare == null) continue;
      const before = multi ? games.slice(0, -3) : games.slice(-2, -1), now = multi ? games.slice(-3) : [g];
      if (!before.length || (multi && before.length < TR.minEarlier)) continue;
      if (now.reduce((s, x) => s + x.att, 0) / now.length < QB_TR.minAtt) continue;
      const avg = (xs, k) => xs.reduce((s, x) => s + (x[k] ?? 0), 0) / xs.length;
      const row = { p: { id: String(p.id), name: p.name }, t, now: avg(now, "carShare"), before: avg(before, "carShare"),
                    car: avg(now, "car"), carBefore: avg(before, "car"), att: avg(now, "att"), attBefore: avg(before, "att") };
      row.d = row.now - row.before;
      if (row.d >= 0.5) up.push(row); else if (row.d <= -0.5) down.push(row);
    }
  }
  up.sort((a, b) => b.d - a.d); down.sort((a, b) => a.d - b.d);
  return { up, down, changes };
}
function qbTrendLi(x, i, dir) {
  const multi = M.tr.span === "multi", f = (v) => (multi ? v.toFixed(1) : R(v));
  const att = R(x.att - x.attBefore);
  return `<li class="${dir > 0 ? "up" : "down"}"><span class="num">${i + 1}</span><div>${pbtn(x.p.id, x.p.name)} ${tb(x.t)} <span class="pos">QB</span>
    <div class="l2"><b>${R(x.before)}% → ${R(x.now)}%</b> of team runs (${signed(x.d)} pts) · ${f(x.carBefore)} → ${f(x.car)} carries${multi ? " a game" : ""} ·
      ${f(x.att)} pass att${multi ? " a game" : ""}${att ? ` (${att > 0 ? "+" : "−"}${Math.abs(att)})` : ""}</div></div></li>`;
}
function renderQbTrends() {
  const wk = state.data.meta.week, { up, down, changes } = qbTrends();
  const col = (rows, dir) => `<section class="card pad" style="flex: 1 1 300px; min-width: 0"><h2>${dir > 0 ? "Running more" : "Running less"}</h2>
    <ol class="list" style="margin-top: 12px">${rows.slice(0, lim(TR.size)).map((x, i) => qbTrendLi(x, i, dir)).join("") || `<li class="muted">Nobody moved enough to list.</li>`}</ol>
    ${isFree() && rows.length > FREE_ROWS ? lockBox({ need: "data", title: `${Math.min(rows.length, TR.size) - FREE_ROWS} more`, rows: 3, compact: true }) : ""}</section>`;
  const how = M.tr.span === "w2w"
    ? `Each QB's share of his team's runs this week compared with his previous game (sacks taken out). He needs ${QB_TR.minAtt}+ pass attempts this week.`
    : `Each QB's share of his team's runs over his last 3 games compared with his earlier games (he needs at least ${TR.minEarlier}). ${QB_TR.minAtt}+ pass attempts a game.`;
  const ch = changes.slice(0, lim(changes.length)).map((c) => `<li><div>${tb(c.t)} <b>${esc(c.t.name)}</b>
      <div class="l2">${pbtn(c.now.id, c.now.name)} led in pass attempts (${c.now.att})${c.now.starts > 1 ? ` · ${ordinal(c.now.starts)} start this season` : " · first start this season"}.
      Week ${c.was.w}: ${pbtn(c.was.id, c.was.name)} (${c.was.att} att)${c.was.playedNow ? ", who also played" : ", who didn't play"}.</div></div></li>`).join("");
  return `<p class="muted" style="margin: -6px 0 16px">${esc(leaderboardScopeLabel())} · ${how}</p>
    <section class="card pad" style="margin-bottom: 16px"><div style="display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: baseline"><h2>Starter changes · week ${wk}</h2>
      <span class="muted" style="font-size: 13px">Teams whose leading passer changed from their previous game</span></div>
      <ul class="list plain" style="margin-top: 12px">${ch || `<li class="muted">No starter changes this week.</li>`}</ul>
      ${isFree() && changes.length > FREE_ROWS ? lockBox({ need: "data", title: `${changes.length - FREE_ROWS} more starter changes`, rows: 2, compact: true }) : ""}</section>
    <div style="display: flex; flex-wrap: wrap; gap: 16px">${col(up, 1)}${col(down, -1)}</div>`;
}

// ---------------------------------------------------------------- QB card
const QB_KINDS = { pts: "Fantasy pts", passYds: "Pass yds", rushYds: "Rush yds" };
function qbRanks(id) {
  // Rank among FBS QBs who qualify for the season boards.
  const rows = withScope("fbs", false, qbSeasonRows);
  const at = (k) => { const L = rows.slice().sort((a, b) => (b[k] ?? -1) - (a[k] ?? -1)); const i = L.findIndex((x) => x.id === id); return i < 0 ? null : [i + 1, L.length]; };
  return { n: rows.length, pts: at("ptsPg"), pass: at("passYdsPg"), rush: at("rushYdsPg"), dom: at("dom"), qualifies: rows.some((x) => x.id === id) };
}
function renderQbDrawer(focus = false) {
  const e = M.hist.players[M.player], wk = state.data.meta.week, tm = M.hist.teams?.[e.t];
  const kind = QB_KINDS[M.pkind] ? M.pkind : "pts", games = qbGames(M.player, wk), s = qbSum(games), byW = new Map(games.map((g) => [g.w, g]));
  const weeks = [];
  for (let w = 1; w <= wk; w++) weeks.push({ w, g: byW.get(w), opp: tm?.w?.[String(w)]?.[QT.opp] || null, status: byW.has(w) ? "played" : tm?.w?.[String(w)] ? "dnp" : "bye" });
  const vals = games.map((g) => g[kind]), top = Math.max(kind === "pts" ? 25 : kind === "passYds" ? 300 : 60, ...vals.map((v) => v * 1.15));
  const h = (v) => Math.max(2, Math.min(100, (100 * Math.max(0, v)) / top));
  const fmtV = (v) => (kind === "pts" ? v.toFixed(1) : R(v));
  const cols = `grid-template-columns: repeat(${wk}, minmax(0, 1fr))`, dkind = kind === "rushYds" ? "run" : "pass";
  const line = (g) => `${g.cmp}/${g.att}, ${g.passYds} yds, ${g.passTd} TD, ${g.int} INT · ${g.car} car, ${g.rushYds} rush yds, ${g.rushTd} TD${g.sacks ? ` · sacked ${g.sacks}x` : ""}`;
  const bars = weeks.map((x) => {
    const cur = x.w === wk ? " cur" : "";
    if (!x.g) {
      const label = x.status === "bye" ? "Bye" : "Out";
      const t = x.status === "bye" ? `<b>Week ${x.w}</b>\nTeam bye` : `<b>Week ${x.w}${x.opp ? ` vs. ${esc(x.opp)}` : ""}</b>\nDidn't play`;
      return `<button type="button" class="wk${cur}" ${tipAttr(t)} aria-label="${esc(t.replace(/<[^>]+>/g, ""))}"><span class="miss">${label}</span></button>`;
    }
    const v = x.g[kind], t = `<b>Week ${x.w}${x.opp ? ` vs. ${esc(x.opp)}` : ""}</b>${x.g.started ? "" : " (not the starter)"}\n${line(x.g)}\n${x.g.pts.toFixed(1)} fantasy pts`;
    return `<button type="button" class="wk${cur}" ${tipAttr(t)} aria-label="${esc(t.replace(/<[^>]+>/g, "").replace(/\n/g, ". "))}">
      <span class="lbl" style="bottom: calc(${h(v)}% + 4px)">${fmtV(v)}</span><i style="height: ${h(v)}%"></i></button>`;
  }).join("");
  const strip = weeks.map((x) => `<span class="${x.opp ? bandFor(x.opp, x.w, dkind) : "none"}" ${tipAttr(x.opp ? `<b>Week ${x.w}: ${esc(x.opp)}</b>\n${dkind} D going in` : `<b>Week ${x.w}</b>\nBye`)}></span>`).join("");
  const initials = e.n.split(" ").filter((p) => /^[A-Z]/.test(p)).slice(0, 2).map((p) => p[0]).join("");
  const nextOpp = oppOf(e.t), F1 = (v) => (v == null ? "–" : v.toFixed(1));
  const rk = isFree() ? null : qbRanks(M.player);
  const rkRow = (label, r) => `<tr><td style="text-align: left">${label}</td><td class="strong">${r ? `${ordinal(r[0])} of ${r[1]}` : "–"}</td></tr>`;
  const log = games.slice().reverse().map((g) => `<tr><td>W${g.w}</td><td style="text-align: left">${g.opp ? tb(g.opp) : ""}${g.started ? "" : ` <span class="muted" ${tipAttr("Came on in relief: someone else led the team in pass attempts")}>*</span>`}</td>
    <td>${g.cmp}/${g.att}</td><td>${g.passYds}</td><td>${g.passTd}</td><td>${g.int}</td><td>${g.car}</td><td>${g.rushYds}</td><td>${g.rushTd}</td><td class="strong">${g.pts.toFixed(1)}</td></tr>`).join("");
  $("drawerRoot").innerHTML = `<div class="scrim" data-act="close"></div>
  <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="pTitle">
    <div class="d-top"><div class="avatar" aria-hidden="true">${esc(initials)}</div>
      <div style="flex: 1; min-width: 0"><h2 id="pTitle">${esc(e.n)}</h2><div class="muted" style="font-size: 13px">${tb(e.t)} ${esc(e.t)} · QB · ${plural(s.starts, "start")} in ${plural(s.games, "game")}${s.dom != null ? ` · QB rush dominator ${R(s.dom)}%` : ""}</div></div>
      <button type="button" class="x" data-act="close" aria-label="Close player detail">${ICON_X}</button></div>
    <div class="seg kindsw" role="group" aria-label="Measure">${Object.entries(QB_KINDS).map(([k, label]) =>
      `<button type="button" data-act="pk" data-val="${k}" aria-pressed="${kind === k}">${label}</button>`).join("")}</div>
    <div class="tiles">
      <div class="tile" ${tipAttr(`<b>Fantasy points per game</b>\n${esc(qbRule())}`)}><div class="k">Fantasy pts / game</div><div class="v" style="color: var(--up)">${F1(s.ptsPg)}</div><div class="muted" style="font-size: 11px">${passTdPts()}-pt pass TD</div></div>
      <div class="tile"><div class="k">Pass yds / game</div><div class="v">${s.passYdsPg == null ? "–" : R(s.passYdsPg)}</div><div class="muted" style="font-size: 11px">${s.passTd} TD · ${s.int} INT</div></div>
      <div class="tile" ${tipAttr("<b>Rushing yards per game</b>\nSacks taken out")}><div class="k">Rush yds / game</div><div class="v">${s.rushYdsPg == null ? "–" : R(s.rushYdsPg)}</div><div class="muted" style="font-size: 11px">${s.rushTd} rush TD · net of sacks</div></div>
    </div>
    <h3 style="margin: 18px 0 0; font-size: 13px">${QB_KINDS[kind]} by week <span class="muted" style="font-weight: 400">· hover or tap a week</span></h3>
    <div class="weeks" style="${cols}">${bars}</div>
    <div class="wkx" style="${cols}">${weeks.map((x) => `<span>W${x.w}</span>`).join("")}</div>
    <div class="strip" style="${cols}">${strip}</div>
    <div class="muted" style="margin-top: 6px; font-size: 11px">Color strip = how tough each opponent's ${dkind} defense was going into the game (red = tough, green = soft)</div>
    <div class="callout">${s.games ? `Season: ${s.cmp}/${s.att} (${pct(s.cmpPct)}), ${s.passYds.toLocaleString("en-US")} yds, ${F1(s.ypa)} a throw, ${s.passTd} TD, ${s.int} INT. Running: ${s.car} carries, ${s.rushYds} yds, ${s.rushTd} TD; sacked ${s.sacks} times.` : "No games yet."}
      ${nextOpp ? `<br>Week ${wk} opponent: ${esc(nextOpp.name)}, pass D ranked ${chip(nextOpp.name, wk, "pass")}, run D ${chip(nextOpp.name, wk, "run")}` : ""}</div>
    <h3 style="margin: 18px 0 8px; font-size: 13px">Game log <span class="muted" style="font-weight: 400">· rushing net of sacks · ${passTdPts()}-pt pass TD${games.some((g) => !g.started) ? " · * = in relief" : ""}</span></h3>
    ${isFree() ? lockBox({ need: "data", title: "Game log", body: "Members see every game: passing, rushing and fantasy points.", rows: 3, compact: true })
      : `<div class="tbl"><table style="min-width: 0; font-size: 12px"><thead><tr><th>Wk</th><th style="text-align: left">Opp</th><th>Cmp/Att</th><th>Yds</th><th>TD</th><th>INT</th><th>Car</th><th>Rush</th><th>TD</th><th>Pts</th></tr></thead><tbody>${log}</tbody></table></div>`}
    <h3 style="margin: 18px 0 8px; font-size: 13px">Where he ranks <span class="muted" style="font-weight: 400">· among FBS QBs on the season boards</span></h3>
    ${isFree() ? lockBox({ need: "data", title: "Where he ranks", body: "Members see where every QB ranks on each list.", rows: 3, compact: true })
      : rk.qualifies ? `<div class="tbl"><table style="min-width: 0"><tbody>${rkRow("Fantasy points per game", rk.pts)}${rkRow("Passing yards per game", rk.pass)}${rkRow("Rushing yards per game", rk.rush)}${rkRow("QB rushing dominator", rk.dom)}</tbody></table></div>`
      : `<p class="muted" style="font-size: 13px; margin: 0">Not on the season boards yet: they need at least half his team's games (3+) with ${QB_MIN.seasonAttPerGame}+ pass attempts a game.</p>`}
    ${qbDrawerPro(M.player)}
  </aside>`;
  if (focus) $("drawerRoot").querySelector(".x").focus();
}

/** Pro section of the QB card: next-week and rest-of-season projections. */
function qbDrawerPro(id) {
  const h = `<h3 style="margin: 20px 0 8px; font-size: 13px">Projections ${PRO_BADGE}</h3>`;
  if (!canPro()) return h + lockBox({ need: "pro", title: "QB projections", body: "Pro members see his projected passing and rushing line and fantasy points for next week and the rest of the season, and can compare him in Who to start?", rows: 3, compact: true });
  if (!PR.ready) { loadPremium().then(() => M.player === id && renderDrawer()); return ""; }
  const j = PR.jById?.get(String(id));
  if (!j) return h + `<p class="muted" style="font-size: 13px; margin: 0">No projection: he hasn't had a big enough share of his team's pass attempts lately.</p>`;
  const qbs = PR.proj.players.filter((p) => p.pos === "QB" && p.next).sort((a, b) => nextPts(b) - nextPts(a));
  const i = qbs.findIndex((p) => p.id === j.id), n = j.next;
  let html = h + `<div class="tiles">
    <div class="tile" ${tipAttr(`<b>Week ${PR.proj.nextWeek} projection</b>\n${esc(qbRule())}`)}><div class="k">Week ${PR.proj.nextWeek}</div><div class="v">${n ? pf1(nextPts(j)) : "–"}</div><div class="muted" style="font-size: 11px">${n ? `${n.home ? "vs." : "at"} ${esc(teamAbbr(n.opp))}` : "Bye"}</div></div>
    <div class="tile"><div class="k">QB rank</div><div class="v">${i >= 0 ? `QB${i + 1}` : "–"}</div><div class="muted" style="font-size: 11px">week ${PR.proj.nextWeek}, of ${qbs.length}</div></div>
    <div class="tile" ${tipAttr("<b>Rest of season</b>\nRemaining regular-season games")}><div class="k">Rest of season</div><div class="v">${pf1(rosPts(j))}</div><div class="muted" style="font-size: 11px">${plural(j.ros.games, "game")}</div></div></div>`;
  const lines = [];
  if (n) lines.push(`Week ${n.week} ${n.home ? "vs." : "at"} ${esc(n.opp)} (pass D ${nextChip(n.opp, "pass")}, run D ${nextChip(n.opp, "run")}): about ${R(n.att)} attempts for ${n.passYds} yards, ${(+n.passTd).toFixed(1)} TDs and ${(+n.int).toFixed(1)} INTs, plus ${R(n.car)} carries for ${n.rushYds} yards and ${(+n.rushTd).toFixed(1)} rushing TDs${n.implied != null ? `. The betting line expects his team to score about ${Math.round(n.implied)}` : ""}.`);
  if (j.missedLast) lines.push(`<span style="color: var(--down)">Missed his team's last game; the projection assumes he plays.</span>`);
  else if (j.startedLast === false) lines.push(`<span style="color: var(--down)">Another QB led his team in pass attempts last game; the projection follows his recent share of the throws (${R(j.share.att)}%).</span>`);
  if (lines.length) html += `<div class="callout" style="min-height: 0">${lines.join("<br>")}</div>`;
  return html;
}

// ---------------------------------------------------------------- wiring
CLICK_ACTS.ptd = (val) => {
  PR.ptd = +val === 6 ? 6 : 4;
  if (typeof saveFmt === "function") saveFmt();
  render(); if (M.player) renderDrawer();
  document.querySelector(`[data-act="ptd"][data-val="${PR.ptd}"]`)?.focus();
};
