// Members site (members.html): the reader-facing view of the weekly usage data.
// All numbers come from the shared calculations in app.js, so they match the
// dashboard and the Substack posts. No post-building or upload controls here.
"use strict";

const M = {
  hist: null, trendsAll: null, route: "games",
  games: { open: new Set(), limit: 16 },
  lb: { view: "week", pos: "WR" },
  tr: { span: "w2w", kind: "tgt" },
  def: { sort: "pass", q: "" },
  player: null, pkind: null, lastFocus: null,
};
const ICON_X = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>`;

// ---------------------------------------------------------------- small helpers
/** Usage-note markdown (**bold** only) to HTML. */
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
const pct = (v) => (v == null ? "–" : `${R(v)}%`);
const pbtn = (id, name) => `<button type="button" class="pname" data-player="${esc(id)}">${esc(name)}</button>`;
const tipAttr = (html) => `data-tip="${esc(html)}"`;
const teamAbbr = (name) => TEAM_ABBR[name] || name;
function oppOf(teamName) {
  const g = state.data.games.find((x) => x.home.name === teamName || x.away.name === teamName);
  return g ? (g.home.name === teamName ? g.away : g.home) : null;
}
/** Color-coded rank chip for a defense; tooltip shows going-in and season ranks. */
function chip(team, week, kind) {
  const r = team && defRank(team, week, kind);
  if (!r) return `<span class="chip none" ${tipAttr(`<b>${esc(team || "Opponent")}</b>\nNot ranked (FCS or no data)`)}>–</span>`;
  const m = r.inn || r.season, what = kind === "pass" ? "pass" : "run";
  const lines = [`<b>${esc(team)} ${what} defense</b>`,
    r.inn ? `Going into week ${week}: ${ordinal(r.inn.rank)} of ${r.n} (${r.metric.fmt(r.inn.val)} ${r.metric.label})` : "No games before this one",
    r.season ? `Season: ${ordinal(r.season.rank)} (${r.metric.fmt(r.season.val)} ${r.metric.label})` : ""];
  return `<span class="chip d${defBand(m.rank, r.n)}" tabindex="0" ${tipAttr(lines.filter(Boolean).join("\n"))}>${ordinal(m.rank)}${r.inn ? "" : "*"}</span>`;
}
function bandFor(team, week, kind) {
  const r = team && defRank(team, week, kind);
  if (!r) return "none";
  const m = r.inn || r.season;
  return `d${defBand(m.rank, r.n)}`;
}
function withScope(conf, ap, fn) {
  const s = [state.conf, state.ap];
  state.conf = conf; state.ap = ap;
  try { return fn(); } finally { [state.conf, state.ap] = s; }
}

// ---------------------------------------------------------------- tooltip
const tip = $("tip");
function showTip(el) {
  tip.innerHTML = el.dataset.tip;
  tip.hidden = false;
  const r = el.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
  const x = Math.max(8, Math.min(r.left + r.width / 2 - tw / 2, innerWidth - tw - 8));
  let y = r.top - th - 8;
  if (y < 8) y = r.bottom + 8;
  tip.style.left = `${x}px`; tip.style.top = `${y}px`;
}
const hideTip = () => { tip.hidden = true; };
document.addEventListener("mouseover", (e) => { const el = e.target.closest("[data-tip]"); if (el) showTip(el); });
document.addEventListener("mouseout", (e) => { const el = e.target.closest("[data-tip]"); if (el && !el.contains(e.relatedTarget)) hideTip(); });
document.addEventListener("focusin", (e) => { const el = e.target.closest("[data-tip]"); el ? showTip(el) : hideTip(); });
addEventListener("scroll", hideTip, true);

// ---------------------------------------------------------------- loading
async function boot() {
  try {
    const idx = await loadJSON("data/weeks/index.json");
    $("week").innerHTML = `<option value="${DEFAULT_FILE}">Latest week</option>` +
      (Array.isArray(idx) ? idx.filter((w) => !w.sample).map((w) => `<option value="${esc(w.file)}">Week ${w.week}${w.seasonType === "postseason" ? " (post)" : ""}</option>`).join("") : "");
  } catch (_) { $("week").innerHTML = `<option value="${DEFAULT_FILE}">Latest week</option>`; }
  $("dm").value = state.dm;
  await loadMembersWeek(DEFAULT_FILE);
}
async function loadMembersWeek(file) {
  $("main").innerHTML = `<div class="loading">Loading…</div>`;
  try { state.data = await loadJSON(file); state.file = file; }
  catch (e) { $("main").innerHTML = `<div class="empty">Couldn't load this week's data.</div>`; return; }
  await loadDefense();
  M.hist = await loadHistory();
  withScope("fbs", false, () => { TREND_INDEX = buildTrendIndex(M.hist); M.trendsAll = buildTrends(M.hist); });
  M.games.open.clear(); M.games.limit = 16;
  fillConf();
  render();
  if (M.player) renderDrawer();
}
function fillConf() {
  const confs = state.data.conferences || [];
  $("conf").innerHTML = `<option value="fbs">All FBS</option><option value="all">All games</option>` +
    `<optgroup label="Power 4">${POWER4.map((c) => `<option>${esc(c)}</option>`).join("")}</optgroup>` +
    `<optgroup label="Other">${confs.filter((c) => !POWER4.includes(c)).map((c) => `<option>${esc(c)}</option>`).join("")}</optgroup>`;
  if (![...$("conf").options].some((o) => o.value === state.conf)) state.conf = "fbs";
  $("conf").value = state.conf;
}

// ---------------------------------------------------------------- routing
function readHash() {
  const [path, query] = location.hash.replace(/^#\/?/, "").split("?");
  M.route = ["games", "leaderboards", "trends", "defenses"].includes(path) ? path : "games";
  const p = new URLSearchParams(query || "").get("p");
  M.player = p || null;
}
function writeHash() {
  const h = `#/${M.route}${M.player ? `?p=${encodeURIComponent(M.player)}` : ""}`;
  if (location.hash !== h) history.replaceState(null, "", h);
}
addEventListener("hashchange", () => {
  const prev = M.route;
  readHash(); render();
  if (M.route !== prev) scrollTo(0, 0);
  M.player ? renderDrawer() : closeDrawer(false);
});

function render() {
  if (!state.data) return;
  document.querySelectorAll(".nav a").forEach((a) => (a.dataset.route === M.route ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  const page = { games: renderGames, leaderboards: renderLeaderboards, trends: renderTrends, defenses: renderDefenses }[M.route];
  $("main").innerHTML = page();
  document.title = `Week ${state.data.meta.week} ${M.route[0].toUpperCase() + M.route.slice(1)} · CFF Data Dawg`;
  writeHash();
}
function topBar(title, controls = "") {
  const m = state.data.meta;
  return `<div class="top"><div><div class="eyebrow">${m.season} ${m.seasonType === "postseason" ? "postseason" : "regular season"} · week ${m.week}</div>
    <h1>${title}</h1></div><div class="grow"></div>${controls}</div>`;
}

// ---------------------------------------------------------------- games
function headlineCards() {
  const tr = M.trendsAll, wk = state.data.meta.week;
  const cards = [];
  const up = tr.w2w.tgtUp[0];
  if (up) {
    const opp = oppOf(up.t.name);
    cards.push(`<button type="button" class="head" data-player="${up.p.id}"><div class="k">Biggest target jump</div>
      <div class="n">${esc(up.p.name)} <span class="muted">${esc(abbr(up.t))}</span></div>
      <div class="v" style="color: var(--up)">${R(up.before)}% → ${R(up.now)}%</div>
      <div class="s">${opp ? `vs. ${esc(opp.name)} ${chip(opp.name, wk, "pass")}` : ""}</div></button>`);
  }
  const back = tr.w2w.carUp[0];
  if (back) cards.push(`<button type="button" class="head" data-player="${back.p.id}"><div class="k">Biggest backfield jump</div>
      <div class="n">${esc(back.p.name)} <span class="muted">${esc(abbr(back.t))}</span></div>
      <div class="v" style="color: var(--up)">${R(back.before)}% → ${R(back.now)}%</div>
      <div class="s">${back.vol} carries after ${back.volBefore}</div></button>`);
  const downs = [tr.w2w.tgtDown[0], tr.w2w.carDown[0]].filter(Boolean).sort((a, b) => a.d - b.d);
  const down = downs[0];
  if (down) cards.push(`<button type="button" class="head" data-player="${down.p.id}"><div class="k">Biggest drop</div>
      <div class="n">${esc(down.p.name)} <span class="muted">${esc(abbr(down.t))}</span></div>
      <div class="v" style="color: var(--down)">${R(down.before)}% → ${R(down.now)}%</div>
      <div class="s">${down.volBefore} → ${down.vol} ${tr.w2w.tgtDown.includes(down) ? "targets" : "carries"}</div></button>`);
  const sl = withScope("fbs", false, () => buildSeasonLeaders(M.hist)), dom = sl.WR[0];
  if (dom) cards.push(`<button type="button" class="head tan" data-player="${dom.id}"><div class="k">Season dominator · WR</div>
      <div class="n">${esc(dom.name)} <span class="muted">${esc(abbr(dom.t))}</span></div>
      <div class="v">${R(dom.sdom)}%</div>
      <div class="s">${R(dom.share)}% of targets, ${plural(dom.games, "game")}</div></button>`);
  return `<div class="heads">${cards.join("")}</div>`;
}
function renderGames() {
  const games = visibleGames(), shown = games.slice(0, M.games.limit), wk = state.data.meta.week;
  const controls = `<button type="button" class="pill tan" data-act="ap" aria-pressed="${state.ap}">AP Top 25</button>
    <label><span class="sr">Search teams or players</span><input type="search" id="q" placeholder="Search players or teams" value="${esc(state.q)}"></label>`;
  return topBar("Week " + wk + " usage", controls) + headlineCards() +
    `<div class="cols"><div class="wide">${shown.length ? shown.map(gameCardM).join("") : `<div class="card empty">No games match these filters.</div>`}
      ${games.length > shown.length ? `<div class="more"><button type="button" class="btn" data-act="more">Show ${Math.min(16, games.length - shown.length)} more games (${games.length - shown.length} left)</button></div>` : ""}</div>
      <div class="narrow">${trendSide()}${defLegend()}</div></div>`;
}
function gameCardM(g) {
  const wk = state.data.meta.week;
  const [w, l] = g.winner === "away" ? [g.away, g.home] : [g.home, g.away];
  const row = (t, cls) => `<div class="srow ${cls}">${t.apRank ? `<span class="rank" aria-label="AP rank">${t.apRank}</span>` : ""}<span class="t">${esc(t.name)}</span><span>${t.points ?? "–"}</span></div>`;
  const d = g.startDate ? new Date(g.startDate).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "";
  const where = g.neutralSite ? "neutral site" : `at ${g.home.name}`;
  const note = usageNotes(g, M.hist, wk)[0];
  const open = M.games.open.has(String(g.id));
  const faced = (t, opp) => `<span><b>${esc(t.name)}</b> faced pass D ${chip(opp.name, wk, "pass")} run D ${chip(opp.name, wk, "run")}</span>`;
  return `<article class="card game">
    <div class="g-head"><div class="score">${row(w, "")}${row(l, g.winner ? "loser" : "")}</div>
      <div class="g-meta"><span>${esc(d)} · ${esc(where)}</span><span>${esc([...new Set([g.away.conference, g.home.conference].filter(Boolean))].join(" vs. "))}</span></div></div>
    ${note ? `<p class="story">${md(note)}</p>` : ""}
    <div class="faced">${faced(w, l)}${faced(l, w)}</div>
    ${open ? teamBlock(w, l) + teamBlock(l, w) : ""}
    <div style="padding: 0 20px 16px"><button type="button" class="btn" data-act="toggle" data-game="${g.id}" aria-expanded="${open}">${open ? "Hide players" : "Show players"}</button></div>
  </article>`;
}
function teamBlock(t, opp) {
  const players = t.players.filter((p) => isFeatured(p, t));
  const rows = players.map((p) => {
    const m = p.metrics, tx = TREND_INDEX?.get(p.id);
    const trend = tx ? `<div class="${tx.dir > 0 ? "up" : "down"}">${tx.dir > 0 ? "▲" : "▼"} ${esc(trendTag(tx))}</div>` : "";
    return `<tr><td>${pbtn(p.id, p.name)} <span class="pos">${esc(p.pos)}</span><div class="sub">${esc(statLine(p))}</div>${trend}</td>
      <td class="${m.tgt_share == null ? "dim" : m.tgt_share >= 20 ? "strong" : ""}">${pct(m.tgt_share)}</td>
      <td class="${m.carry_share == null ? "dim" : m.carry_share >= 50 ? "strong" : ""}">${pct(m.carry_share)}</td>
      <td>${pct(m.yds_pct)}</td>
      <td class="${m.dominator == null ? "dim" : ""}">${pct(m.dominator)}</td></tr>`;
  }).join("");
  const tl = tempoLine(t);
  return `<div class="team"><h3>${esc(t.name)}<span>${t.totals.totalYds} yds (${t.totals.passYds} pass, ${t.totals.rushYds} rush)${tl ? ` · ${esc(tl)}` : ""}</span></h3>
    <div class="tbl"><table><thead><tr><th scope="col">Player</th><th scope="col">Tgt %</th><th scope="col">Car %</th><th scope="col">Yds %</th>
      <th scope="col" ${tipAttr("<b>Dominator</b>\nAverage of his share of team receiving yards and receiving TDs")}>Dom %</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="5" class="dim">No skill-player stats.</td></tr>`}</tbody></table></div></div>`;
}
function trendSide() {
  const tr = M.trendsAll, wk = state.data.meta.week;
  const li = (x, cls, i, unit) => {
    const opp = oppOf(x.t.name);
    return `<li class="${cls}"><span class="num">${i + 1}</span><div>${pbtn(x.p.id, x.p.name)} <span class="pos">${esc(abbr(x.t))}</span>
      <div class="l2">${R(x.before)}% → ${R(x.now)}% of ${unit}${opp ? ` · vs. ${chip(opp.name, wk, unit === "targets" ? "pass" : "run")}` : ""}</div></div></li>`;
  };
  return `<section class="card pad"><h2>Trending up</h2><ol class="list" style="margin-top: 12px">${tr.w2w.tgtUp.slice(0, 4).map((x, i) => li(x, "up", i, "targets")).join("")}</ol>
    <h2 style="margin-top: 20px">Trending down</h2><ol class="list" style="margin-top: 12px">${tr.w2w.tgtDown.slice(0, 3).map((x, i) => li(x, "down", i, "targets")).join("")}</ol>
    <p style="margin: 16px 0 0"><a href="#/trends">All trends →</a></p></section>`;
}
function defLegend() {
  return `<section class="card pad"><h2 style="font-size: 18px">Defense rank colors</h2>
    <p class="muted" style="margin: 6px 0 10px; font-size: 13px">Where the opponent ranked among ${DEF.data ? Object.keys(DEF.data.season).length : "FBS"} FBS defenses going into the game, by ${DM[state.dm].label} allowed. Hover a chip for details.</p>
    <div class="legend"><span class="chip d1">Top fifth · tough</span><span class="chip d2">2nd</span><span class="chip d3">Middle</span><span class="chip d4">4th</span><span class="chip d5">Bottom fifth · soft</span></div>
    <p class="muted" style="margin: 10px 0 0; font-size: 12px">* = no earlier games, season rank shown.</p></section>`;
}

// ---------------------------------------------------------------- leaderboards
function renderLeaderboards() {
  const seg = (key, opts) => `<div class="seg" role="group">${opts.map(([v, label]) =>
    `<button type="button" data-act="lb-${key}" data-val="${v}" aria-pressed="${M.lb[key] === v}">${label}</button>`).join("")}</div>`;
  const controls = seg("view", [["week", "This week"], ["season", "Season"]]) + seg("pos", [["WR", "WR"], ["TE", "TE"], ["RB", "RB"]]);
  const body = M.lb.view === "week" ? weekBoard() : seasonBoard();
  return topBar("Leaderboards", controls) + `<div class="cols"><div class="wide">${body}</div><div class="narrow">${domExplainer()}${defLegend()}</div></div>`;
}
function weekBoard() {
  const lb = buildLeaderboard(M.hist), wk = state.data.meta.week, pos = M.lb.pos;
  const rows = pos === "WR" ? lb.wr : pos === "TE" ? lb.te : lb.car;
  const isRb = pos === "RB";
  const head = `<tr><th scope="col">#</th><th scope="col" style="text-align: left">Player</th><th scope="col">${isRb ? "Car %" : "Tgt %"}</th><th scope="col">${isRb ? "Car" : "Tgt"}</th>
    <th scope="col">Season avg</th>${isRb ? "" : `<th scope="col">Season dom</th>`}<th scope="col">Faced ${isRb ? "run" : "pass"} D</th></tr>`;
  const body = rows.map((x, i) => {
    const share = isRb ? x.p.metrics.carry_share : x.p.metrics.tgt_share, opp = oppOf(x.t.name);
    const avg = x.ctx && x.ctx.games >= 2 ? (isRb ? x.ctx.avgCs : x.ctx.avgTs) : null;
    return `<tr><td class="muted strong">${i + 1}</td><td style="text-align: left">${pbtn(x.p.id, x.p.name)} <span class="pos">${esc(abbr(x.t))}</span></td>
      <td><span class="barcell"><span class="bar"><i style="width: ${Math.min(100, share)}%"></i></span><b>${pct(share)}</b></span></td>
      <td>${isRb ? x.p.rushing.car : x.p.receiving.tgt}</td><td class="${avg == null ? "dim" : ""}">${pct(avg)}</td>
      ${isRb ? "" : `<td class="${x.sdom == null ? "dim" : ""}">${pct(x.sdom)}</td>`}
      <td>${opp ? chip(opp.name, wk, isRb ? "run" : "pass") : "–"}</td></tr>`;
  }).join("");
  const min = isRb ? `min. ${LB.minCarries} carries` : `min. ${LB.minTargets[pos]} targets`;
  return `<section class="card"><div class="pad" style="display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px; padding-bottom: 12px">
      <h2>Top ${pos}s by ${isRb ? "carry" : "target"} share · week ${wk}</h2><span class="muted" style="font-size: 12px">${min} · ${esc(leaderboardScopeLabel())}</span></div>
    <div class="tbl" style="border: 0; border-top: 1px solid var(--line); border-radius: 0 0 16px 16px"><table><thead>${head}</thead><tbody>${body || `<tr><td colspan="7" class="dim">Nobody reached the minimum.</td></tr>`}</tbody></table></div></section>`;
}
function seasonBoard() {
  const keep = SEASON_LB.size;
  SEASON_LB.size = 25;
  const sl = buildSeasonLeaders(M.hist);
  SEASON_LB.size = keep;
  const pos = M.lb.pos, rows = sl[pos], isRb = pos === "RB";
  const head = isRb
    ? `<tr><th scope="col">#</th><th scope="col" style="text-align: left">Player</th><th scope="col">RB dominator</th><th scope="col">Car %</th><th scope="col">Car / g</th><th scope="col">Tgt %</th><th scope="col">Games</th></tr>`
    : `<tr><th scope="col">#</th><th scope="col" style="text-align: left">Player</th><th scope="col">Season dominator</th><th scope="col">Tgt %</th><th scope="col">Tgt / g</th><th scope="col">Games</th></tr>`;
  const body = rows.map((x, i) => {
    const dom = isRb ? x.rbDom : x.sdom;
    return `<tr><td class="muted strong">${i + 1}</td><td style="text-align: left">${pbtn(x.id, x.name)} <span class="pos">${esc(abbr(x.t))}</span></td>
      <td><span class="barcell"><span class="bar tan"><i style="width: ${Math.min(100, dom || 0)}%"></i></span><b>${pct(dom)}</b></span></td>
      <td>${pct(x.share)}</td><td>${x.perGame.toFixed(1)}</td>${isRb ? `<td>${pct(x.tgtShare)}</td>` : ""}<td>${x.games}</td></tr>`;
  }).join("");
  const min = isRb ? `${SEASON_LB.minCarPerGame}+ carries a game` : `${SEASON_LB.minTgtPerGame[pos]}+ targets a game`;
  return `<section class="card"><div class="pad" style="display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px; padding-bottom: 12px">
      <h2>Season ${isRb ? "RB dominator" : "dominator"} leaders · ${pos}</h2><span class="muted" style="font-size: 12px">through week ${state.data.meta.week} · ${min} · half his team's games</span></div>
    <div class="tbl" style="border: 0; border-top: 1px solid var(--line); border-radius: 0 0 16px 16px"><table><thead>${head}</thead><tbody>${body || `<tr><td colspan="7" class="dim">Nobody qualifies yet.</td></tr>`}</tbody></table></div></section>`;
}
function domExplainer() {
  return `<section class="card pad"><h2 style="font-size: 18px">What is dominator rating?</h2>
    <p style="margin: 8px 0 0; font-size: 13px; color: var(--ink2)">The average of a player's share of his team's receiving yards and receiving touchdowns. 90 of 300 yards (30%) and 2 of 3 TDs (67%) rates 48%.</p>
    <p style="margin: 8px 0 0; font-size: 13px; color: var(--ink2)"><b>RB dominator</b> averages his share of RB carries with receiving credit, where 20% of team targets counts as full credit.</p></section>`;
}

// ---------------------------------------------------------------- trends
function renderTrends() {
  const seg = (key, opts) => `<div class="seg" role="group">${opts.map(([v, label]) =>
    `<button type="button" data-act="tr-${key}" data-val="${v}" aria-pressed="${M.tr[key] === v}">${label}</button>`).join("")}</div>`;
  const controls = seg("span", [["w2w", "Week to week"], ["multi", "Last 3 games"]]) + seg("kind", [["tgt", "Target share"], ["car", "RB carry share"]]);
  const tr = buildTrends(M.hist), g = tr[M.tr.span], k = M.tr.kind;
  const ups = g[`${k}Up`], downs = g[`${k}Down`];
  const col = (rows, dir) => `<section class="card pad" style="flex: 1 1 300px; min-width: 0"><h2>${dir > 0 ? "Trending up" : "Trending down"}</h2>
    <ol class="list" style="margin-top: 12px">${rows.map((x, i) => trendLi(x, i, dir)).join("") || `<li class="muted">Nobody cleared the volume floor.</li>`}</ol></section>`;
  const how = M.tr.span === "w2w"
    ? "This game vs. the player's last game with touches. Target trends need 5+ targets on the busier side, carry trends 10+ carries."
    : "His last 3 games vs. his earlier games (at least 2). Same volume floors.";
  return topBar("Trends", controls) +
    `<p class="muted" style="margin: -6px 0 16px">${esc(leaderboardScopeLabel())} · ${how}</p>
    <div style="display: flex; flex-wrap: wrap; gap: 16px">${col(ups, 1)}${col(downs, -1)}</div>
    <section class="card pad" style="margin-top: 16px"><div style="display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: baseline">
      <h2>Trend lines for the biggest movers</h2><span class="muted" style="font-size: 13px">Share by week · blue dot = week ${state.data.meta.week} · click for details</span></div>
      <div class="minis">${moversFor(M.trendsAll).map(miniChart).join("")}</div></section>`;
}
function trendLi(x, i, dir) {
  const wk = state.data.meta.week, k = M.tr.kind, unit = k === "tgt" ? "target" : "carry";
  const opp = oppOf(x.t.name);
  const vol = M.tr.span === "w2w" ? `${x.volBefore} → ${plural(x.vol, unit)}` : `${x.vol.toFixed(1)} ${unit === "carry" ? "carries" : "targets"} a game, was ${x.volBefore.toFixed(1)}`;
  const ctx = M.tr.span === "w2w"
    ? (opp ? ` · vs. ${esc(opp.name)} ${chip(opp.name, wk, k === "tgt" ? "pass" : "run")}` : "")
    : esc(recentOpp(M.hist, x, k === "tgt" ? "pass" : "run"));
  return `<li class="${dir > 0 ? "up" : "down"}"><span class="num">${i + 1}</span><div>${pbtn(x.p.id, x.p.name)} <span class="pos">${esc(abbr(x.t))} · ${esc(x.p.pos)}</span>
    <div class="l2"><b>${R(x.before)}% → ${R(x.now)}%</b> (${signed(x.d)}) · ${vol}${ctx}</div></div></li>`;
}
function miniChart(m) {
  const wk = state.data.meta.week, key = m.kind === "tgt" ? "ts" : "cs";
  const series = playerSeries(M.hist, m.p.id, wk), played = M.hist?.teams?.[m.t.name]?.w || {};
  const W = 220, H = 90, x = (w) => 12 + ((w - 1) / Math.max(wk - 1, 1)) * (W - 30), y = (v) => H - 12 - (v / 100) * (H - 26);
  const pts = series.filter((r) => r[key] != null);
  const line = pts.map((r) => `${x(r.w).toFixed(1)},${y(r[key]).toFixed(1)}`).join(" ");
  const marks = [];
  for (let w = 1; w <= wk; w++) {
    const r = series.find((q) => q.w === w);
    if (r && r[key] != null) marks.push(`<circle cx="${x(w)}" cy="${y(r[key])}" r="${w === wk ? 5 : 3}" fill="${w === wk ? "#3B6FE0" : "#A9BCE9"}"></circle>`);
    else if (!played[w]) marks.push(`<circle cx="${x(w)}" cy="${y(0)}" r="3.5" fill="none" stroke="#A9BCE9" stroke-width="1.5"></circle>`);
    else marks.push(`<path d="M${x(w) - 3.5} ${y(0) - 3.5}l7 7m0 -7l-7 7" stroke="#A9BCE9" stroke-width="1.8"></path>`);
  }
  const last = pts[pts.length - 1];
  const label = last ? `<text x="${Math.min(x(last.w), W - 22)}" y="${Math.max(12, y(last[key]) - 9)}" font-size="11" font-weight="700" fill="#2449A6" text-anchor="middle">${R(last[key])}%</text>` : "";
  const desc = pts.map((r) => `week ${r.w} ${R(r[key])}%`).join(", ");
  return `<button type="button" class="mini" data-player="${m.p.id}" data-kind="${m.kind}"><div class="cap">${esc(m.p.name)} <span class="pos">${esc(abbr(m.t))} · ${m.kind === "tgt" ? "targets" : "carries"}</span></div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(desc)}"><line x1="6" y1="${y(0)}" x2="${W - 6}" y2="${y(0)}" stroke="#E3E8EF"></line>
    <polyline points="${line}" fill="none" stroke="#A9BCE9" stroke-width="2.5" stroke-linejoin="round"></polyline>${marks.join("")}${label}</svg></button>`;
}

// ---------------------------------------------------------------- defenses
function renderDefenses() {
  const d = DEF.data;
  if (!d) return topBar("Defenses") + `<div class="card empty">Defense ranks aren't available for this season yet.</div>`;
  const mm = DM[state.dm], sorts = { pass: (r) => r[mm.rank], run: (r) => r[mm.rank + 1] };
  const q = M.def.q.trim().toLowerCase();
  let rows = Object.entries(d.season).filter(([name]) => !q || name.toLowerCase().includes(q));
  rows = M.def.sort === "team" ? rows.sort((a, b) => a[0].localeCompare(b[0])) : rows.sort((a, b) => sorts[M.def.sort](a[1]) - sorts[M.def.sort](b[1]));
  const n = Object.keys(d.season).length;
  const cell = (name, r, kind) => {
    const rank = r[mm.rank + (kind === "pass" ? 0 : 1)], val = r[kind === "pass" ? mm.pass : mm.run];
    return `<td><span class="chip d${defBand(rank, n)}">${ordinal(rank)}</span></td><td>${mm.fmt(val)}</td>`;
  };
  const sortBtn = (key, label) => `<button type="button" data-act="def-sort" data-val="${key}" aria-label="Sort by ${label}">${label}${M.def.sort === key ? " ▾" : ""}</button>`;
  const controls = `<label><span class="sr">Search defenses</span><input type="search" id="dq" placeholder="Search teams" value="${esc(M.def.q)}"></label>`;
  return topBar("Defenses", controls) +
    `<p class="muted" style="margin: -6px 0 16px">${n} FBS defenses ranked by ${mm.label} allowed through week ${d.through}, in games against FBS offenses. 1st = toughest. Switch the measure in the sidebar.</p>
    <section class="card"><div class="tbl" style="border: 0; border-radius: 16px"><table><thead><tr>
      <th scope="col">${sortBtn("team", "Team")}</th><th scope="col">${sortBtn("pass", "Pass D")}</th><th scope="col">${mm.label}</th>
      <th scope="col">${sortBtn("run", "Run D")}</th><th scope="col">${mm.label}</th><th scope="col">Games</th></tr></thead>
    <tbody>${rows.map(([name, r]) => `<tr><td><b>${esc(name)}</b> <span class="pos">${esc(M.hist?.teams?.[name]?.c || "")}</span></td>${cell(name, r, "pass")}${cell(name, r, "run")}<td>${r[8]}</td></tr>`).join("") || `<tr><td colspan="6" class="dim">No team matches.</td></tr>`}</tbody></table></div></section>`;
}

// ---------------------------------------------------------------- player drawer
function openPlayer(id, kind) {
  M.lastFocus = document.activeElement;
  M.player = String(id); M.pkind = kind || null;
  writeHash();
  renderDrawer(true);
}
function closeDrawer(restore = true) {
  $("drawerRoot").innerHTML = "";
  M.player = null;
  hideTip();
  writeHash();
  if (restore && M.lastFocus && document.contains(M.lastFocus)) M.lastFocus.focus();
}
function renderDrawer(focus = false) {
  const e = M.hist?.players?.[M.player];
  if (!e) { $("drawerRoot").innerHTML = ""; return; }
  const wk = state.data.meta.week, tm = M.hist.teams?.[e.t];
  // QBs have no target or carry share, so their bars show share of team yards.
  const kind = M.pkind || (e.p === "RB" ? "car" : e.p === "QB" ? "yds" : "tgt"), dkind = kind === "car" ? "run" : "pass";
  const idx = kind === "tgt" ? { share: 1, vol: 0 } : kind === "car" ? { share: 3, vol: 2 } : { share: 4, vol: 2 };
  const unit = kind === "tgt" ? "targets" : kind === "car" ? "RB carries" : "team yards";
  const weeks = [];
  for (let w = 1; w <= wk; w++) {
    const a = e.w[String(w)], tw = tm?.w?.[String(w)];
    weeks.push({ w, a, opp: tw?.[9] || null, status: a ? "played" : tw ? "dnp" : "bye" });
  }
  const shares = weeks.filter((x) => x.a && x.a[idx.share] != null);
  const recent = shares.slice(-3), before = shares.slice(0, -3);
  const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x.a[idx.share], 0) / xs.length : null);
  const volPer = shares.length ? shares.reduce((s, x) => s + (x.a[idx.vol] || 0), 0) / shares.length : null;
  const sdom = e.p !== "RB" && e.p !== "QB" ? seasonDominator(M.hist, M.player, wk) : null;
  const cols = `grid-template-columns: repeat(${wk}, minmax(0, 1fr))`;
  // Bars scale to the player's own range (at least 0–40%) so small shares stay readable.
  const top = Math.max(40, ...shares.map((x) => x.a[idx.share] * 1.15));
  const h = (v) => Math.max(2, Math.min(100, (100 * v) / top));
  const bars = weeks.map((x) => {
    const cur = x.w === wk ? " cur" : "";
    if (x.status !== "played" || x.a[idx.share] == null) {
      const label = x.status === "bye" ? "Bye" : x.status === "dnp" ? "Out" : "–";
      const t = x.status === "bye" ? `<b>Week ${x.w}</b>\nTeam bye` : `<b>Week ${x.w}${x.opp ? ` vs. ${esc(x.opp)}` : ""}</b>\n${x.status === "dnp" ? "No touches (didn't play or no role)" : "No share recorded"}`;
      return `<button type="button" class="wk${cur}" ${tipAttr(t)} aria-label="${esc(t.replace(/<[^>]+>/g, ""))}"><span class="miss">${label}</span></button>`;
    }
    const a = x.a, share = a[idx.share];
    const r = x.opp && defRank(x.opp, x.w, dkind);
    const dline = r ? `${esc(x.opp)} ${dkind} D: ${r.inn ? `${ordinal(r.inn.rank)} going in` : "no earlier games"}${r.season ? ` · ${ordinal(r.season.rank)} season` : ""}` : x.opp ? `${esc(x.opp)}: not ranked (FCS)` : "";
    const t = `<b>Week ${x.w}${x.opp ? ` vs. ${esc(x.opp)}` : ""}</b>\n${R(share)}% of ${unit}${kind === "yds" ? "" : ` (${a[idx.vol]})`}\n${a[5]} rec, ${a[6]} yds · ${a[2]} car, ${a[7]} rush yds${dline ? `\n${dline}` : ""}`;
    return `<button type="button" class="wk${cur}" ${tipAttr(t)} aria-label="${esc(t.replace(/<[^>]+>/g, "").replace(/\n/g, ". "))}">
      <span class="lbl" style="bottom: calc(${h(share)}% + 4px)">${R(share)}%</span><i style="height: ${h(share)}%"></i></button>`;
  }).join("");
  const strip = weeks.map((x) => `<span class="${x.opp ? bandFor(x.opp, x.w, dkind) : "none"}" ${tipAttr(x.opp ? `<b>Week ${x.w}: ${esc(x.opp)}</b>\n${dkind} D going in` : `<b>Week ${x.w}</b>\nBye`)}></span>`).join("");
  const opps = recent.map((x) => { const r = x.opp && defRank(x.opp, x.w, dkind), m = r && (r.inn || r.season); return m ? m.rank : null; }).filter((v) => v != null);
  const initials = e.n.split(" ").filter((s) => /^[A-Z]/.test(s)).slice(0, 2).map((s) => s[0]).join("");
  const kindSw = e.p === "RB" ? `<div class="seg kindsw" role="group" aria-label="Measure">
      <button type="button" data-act="pk" data-val="car" aria-pressed="${kind === "car"}">Carry share</button>
      <button type="button" data-act="pk" data-val="tgt" aria-pressed="${kind === "tgt"}">Target share</button></div>` : "";
  const nextOpp = oppOf(e.t);
  $("drawerRoot").innerHTML = `<div class="scrim" data-act="close"></div>
  <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="pTitle">
    <div class="d-top"><div class="avatar" aria-hidden="true">${esc(initials)}</div>
      <div style="flex: 1; min-width: 0"><h2 id="pTitle">${esc(e.n)}</h2><div class="muted" style="font-size: 13px">${esc(e.t)} · ${esc(e.p)}${sdom != null ? ` · season dominator ${R(sdom)}%` : ""}</div></div>
      <button type="button" class="x" data-act="close" aria-label="Close player detail">${ICON_X}</button></div>
    ${kindSw}
    <div class="tiles">
      <div class="tile"><div class="k">Last ${recent.length || 3}</div><div class="v" style="color: var(--up)">${pct(avg(recent))}</div></div>
      <div class="tile"><div class="k">Before</div><div class="v">${pct(avg(before))}</div></div>
      <div class="tile"><div class="k">${kind === "tgt" ? "Tgt" : "Car"} / game</div><div class="v">${volPer == null ? "–" : volPer.toFixed(1)}</div></div>
    </div>
    <h3 style="margin: 18px 0 0; font-size: 13px">${kind === "tgt" ? "Target share" : kind === "car" ? "RB carry share" : "Share of team yards"} by week <span class="muted" style="font-weight: 400">· hover or tap a week</span></h3>
    <div class="weeks" style="${cols}">${bars}</div>
    <div class="wkx" style="${cols}">${weeks.map((x) => `<span>W${x.w}</span>`).join("")}</div>
    <div class="strip" style="${cols}">${strip}</div>
    <div class="muted" style="margin-top: 6px; font-size: 11px">Strip = opponent ${dkind} D going in (red = tougher, green = softer)</div>
    <div class="callout">${shares.length ? `${R(avg(shares))}% of ${unit} over ${plural(shares.length, "game")} this season.` : "No usage recorded yet."}
      ${opps.length ? ` His last ${opps.length} opponents averaged <b>${ordinal(R(mean(opps)))}</b> vs. the ${dkind}.` : ""}
      ${nextOpp ? `<br>Week ${wk}: vs. ${esc(nextOpp.name)} ${chip(nextOpp.name, wk, dkind)}` : ""}</div>
  </aside>`;
  if (focus) $("drawerRoot").querySelector(".x").focus();
}

// ---------------------------------------------------------------- events
document.addEventListener("click", (ev) => {
  const p = ev.target.closest("[data-player]");
  if (p) { openPlayer(p.dataset.player, p.dataset.kind); return; }
  const a = ev.target.closest("[data-act]");
  if (!a) return;
  const act = a.dataset.act, val = a.dataset.val;
  if (act === "close") return closeDrawer();
  if (act === "pk") { M.pkind = val; return renderDrawer(); }
  if (act === "ap") { state.ap = !state.ap; return render(); }
  if (act === "more") { M.games.limit += 16; return render(); }
  if (act === "toggle") {
    const id = a.dataset.game;
    M.games.open.has(id) ? M.games.open.delete(id) : M.games.open.add(id);
    render();
    document.querySelector(`[data-act="toggle"][data-game="${id}"]`)?.focus();
    return;
  }
  if (act.startsWith("lb-")) { M.lb[act.slice(3)] = val; return render(); }
  if (act.startsWith("tr-")) { M.tr[act.slice(3)] = val; return render(); }
  if (act === "def-sort") { M.def.sort = val; render(); document.querySelector(`[data-act="def-sort"][data-val="${val}"]`)?.focus(); }
});
document.addEventListener("input", (ev) => {
  if (ev.target.id === "q") {
    state.q = ev.target.value; const pos = ev.target.selectionStart; render();
    const q = $("q"); q.focus(); q.setSelectionRange(pos, pos);
  } else if (ev.target.id === "dq") {
    M.def.q = ev.target.value; const pos = ev.target.selectionStart; render();
    const q = $("dq"); q.focus(); q.setSelectionRange(pos, pos);
  }
});
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && M.player) closeDrawer(); });
$("conf").addEventListener("change", (e) => { state.conf = e.target.value; render(); });
$("dm").addEventListener("change", (e) => { state.dm = e.target.value; render(); if (M.player) renderDrawer(); });
$("week").addEventListener("change", (e) => loadMembersWeek(e.target.value));

readHash();
boot();
