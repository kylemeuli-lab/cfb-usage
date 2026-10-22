// Members site (members.html): the reader-facing view of the weekly usage data.
// All numbers come from the shared calculations in app.js, so they match the
// dashboard and the Substack posts. No post-building or upload controls here.
"use strict";

const M = {
  hist: null, trendsAll: null, route: "games",
  games: { open: new Set(), limit: 16 },
  lb: { period: "week", board: "share", pos: "WR", sort: null },
  tr: { span: "w2w", kind: "tgt" },
  def: { sort: "overall", q: "" },
  player: null, pkind: null, lastFocus: null,
};
const ICON_X = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>`;

// ---------------------------------------------------------------- tiers (staging preview)
// On this staging site you can view the site as each tier would see it. On the live site
// the tier will come from the member's login instead of this switch.
//   Free (not signed in): top 5 rows of each page.  Data: everything but the Pro pages and
//   the Pro part of the player card.  Pro: everything.  Admin: everything, plus a banner.
// Locked areas show grey placeholder bars, never blurred real numbers.
const SUBSTACK = "https://substack.com/@cffdatadawgs";
const TIERS = { admin: "Admin", pro: "Pro", data: "Data", free: "Free" };
const PRO_ROUTES = ["prospects", "projections", "startsit", "freshmen"];
const PRO_PAGE_INFO = {
  prospects: ["Prospects", "Prospect Score for every FBS WR, TE and RB: chance of being drafted, of a top-100 pick and of an NFL fantasy starter season, plus every draft class since 2019 next to how it was actually drafted."],
  projections: ["Projections", "Projections for next week and the rest of the season in standard, half PPR or PPR scoring (with a TE premium option), with projected targets, carries, yards and TDs, adjusted for the opponent and the betting line."],
  startsit: ["Who to start?", "Compare up to four players for this week in your league's scoring. We tell you who to start and why: workload, matchup, expected team points, TD chances and role trend."],
  freshmen: ["Freshman Watch", "Every true freshman with a role this season: weekly share of targets or carries, trends, usage rate and recruiting profile."],
};
let TIER = (() => {
  const u = new URLSearchParams(location.search).get("view");
  if (TIERS[u]) return u;
  try { const v = localStorage.getItem("cff-view"); if (TIERS[v]) return v; } catch (_) {}
  return "admin";
})();
const canPro = () => TIER === "admin" || TIER === "pro";
const isFree = () => TIER === "free";
// Free visitors (not signed in) see the top 5 of each list, plus the Top 25 games (the Monday
// recap). Where the full list is in a free Substack post, the lock points there first: the
// newsletter is the free way to see more, which builds the email list.
const FREE_ROWS = 5;
const lim = (n, free = FREE_ROWS) => (isFree() ? Math.min(n, free) : n);
function setTier(t) {
  TIER = t;
  try { localStorage.setItem("cff-view", t); } catch (_) {}
  fillViewSwitch(); render(); if (M.player) renderDrawer();
}
// ---------------------------------------------------------------- theme
function themeChoice() { try { const t = localStorage.getItem("cff-theme"); return t === "light" || t === "dark" ? t : "auto"; } catch (_) { return "auto"; } }
function setTheme(t) {
  try { t === "auto" ? localStorage.removeItem("cff-theme") : localStorage.setItem("cff-theme", t); } catch (_) {}
  if (t === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  fillThemeSwitch();
}
function fillThemeSwitch() {
  const el = $("themeSw"), cur = themeChoice();
  if (!el) return;
  el.innerHTML = [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]].map(([k, l]) =>
    `<button type="button" data-act="theme" data-val="${k}" aria-pressed="${cur === k}" ${k === "auto" ? tipAttr("Follow this device's light/dark setting") : ""}>${l}</button>`).join("");
}
function fillViewSwitch() {
  const el = $("viewSw");
  if (!el) return;
  el.innerHTML = Object.entries(TIERS).map(([k, label]) =>
    `<button type="button" data-act="tier" data-val="${k}" aria-pressed="${TIER === k}">${label}</button>`).join("");
  document.body.dataset.tier = TIER;
}
function tierBanner() {
  if (TIER === "admin") return `<div class="tier-banner admin" role="status"><b>Admin view</b> · staging site, you're seeing everything.
    Use "View as" in the sidebar to see what Pro, Data and Free visitors see. <a href="index.html">Open the admin dashboard →</a></div>`;
  const what = { pro: "a Pro member (everything)", data: "a Data member (Pro pages and Pro card sections locked)", free: "a visitor who isn't signed in (Top 25 games, top 5 of each list)" }[TIER];
  return `<div class="tier-banner preview" role="status"><b>Previewing as ${TIERS[TIER]}</b> · what ${what} sees. Switch back to Admin in the sidebar.</div>`;
}
/** Locked area: grey placeholder rows under a message. need = "pro" | "data". */
/** post = { n, day } when the full list is in a free Substack post: Free visitors get a
 *  "Get the top n free on Substack" button first. */
function lockBox({ need = "pro", title, body, rows = 5, compact = false, post = null }) {
  const widths = [62, 48, 70, 55, 66, 44, 58, 52];
  const fake = Array.from({ length: rows }, (_, i) =>
    `<div class="fk-row"><span class="fk" style="width: ${widths[i % widths.length]}%"></span><span class="fk sm"></span><span class="fk sm"></span><span class="fk sm"></span></div>`).join("");
  const btn = need === "pro" ? "Upgrade to Pro" : "Join to see everything";
  return `<div class="lock${compact ? " compact" : ""}"><div class="lock-fake" aria-hidden="true">${fake}</div>
    <div class="lock-msg"${compact ? "" : ` style="min-height: ${Math.max(180, rows * 36)}px"`}>${need === "pro" ? `<span class="pro">Pro</span>` : `<span class="pro data">Members</span>`}
      <h3>${esc(title)}</h3>${body ? `<p>${esc(body)}</p>` : ""}
      ${isFree() && post ? `<p class="post-note">${post.what || `The top ${post.n}`} is free in the ${post.day} newsletter.</p>
      <span class="lock-btns"><a class="btn cta sub" href="${SUBSTACK}" target="_blank" rel="noopener">${post.get || `Get the top ${post.n} free`} on Substack</a>
        <button type="button" class="btn" data-act="join" data-val="${need}">${need === "pro" ? "Upgrade to Pro" : "Join for full access"}</button></span>`
      : `<button type="button" class="btn cta" data-act="join" data-val="${need}">${btn}</button>
      ${isFree() ? `<span class="alt">Or get free weekly posts: <a href="${SUBSTACK}" target="_blank" rel="noopener">subscribe on Substack</a></span>` : ""}`}</div></div>`;
}
function lockedPage(route) {
  const [name, desc] = PRO_PAGE_INFO[route] || [route, ""];
  return topBar(`${esc(name)} <span class="pro" aria-label="Pro feature">Pro</span>`) +
    `<p class="muted" style="margin: -6px 0 16px">${esc(desc)}</p>` +
    lockBox({ need: "pro", title: `${name} is part of Pro`, body: isFree() ? "Pro includes everything in the Data tier plus Prospects, Projections, Who to start? and Freshman Watch." : "Upgrade to Pro to unlock it, along with the rest of the Pro pages and the Pro section of every player card.", rows: 10 });
}

// ---------------------------------------------------------------- team badges
// A small chip in the team's colors with its abbreviation (no logos: those are trademarks).
// Colors come from data/team-colors.json; teams without colors get a neutral chip.
let TEAM_COLORS = {};
loadJSON("data/team-colors.json").then((d) => { TEAM_COLORS = d || {}; if (state.data) { render(); if (M.player) renderDrawer(); } }).catch(() => {});
function lum(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const ch = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch(n >> 16) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
/** Text color for a badge: the team's second color if it reads well (4.5:1), else white or near-black. */
function inkOn(bg, alt) {
  const L = lum(bg);
  if (L == null) return "#1B2433";
  const La = lum(alt);
  if (La != null && contrast(L, La) >= 4.5) return alt;
  return contrast(L, 1) >= contrast(L, lum("#1B2433")) ? "#FFFFFF" : "#1B2433";
}
/** Badge for a team (name string or team object). */
function tb(team) {
  const name = typeof team === "string" ? team : team?.name;
  if (!name) return "";
  const c = TEAM_COLORS[name], label = (typeof team === "object" && abbr(team)) || teamAbbr(name);
  const bg = c?.c || "var(--line)", fg = c ? inkOn(c.c, c.a) : "var(--ink2)";
  return `<span class="tb" style="background: ${bg}; color: ${fg}" title="${esc(name)}">${esc(label)}</span>`;
}

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
  const ov = defRank(team, week, "overall"), ovm = ov && (ov.inn || ov.season);
  const lines = [`<b>${esc(team)} ${what} defense</b>`,
    r.inn ? `Going into week ${week}: ${ordinal(r.inn.rank)} of ${r.n} (${r.metric.fmt(r.inn.val)} ${r.metric.label})` : "No games before this one",
    r.season ? `Season: ${ordinal(r.season.rank)} (${r.metric.fmt(r.season.val)} ${r.metric.label})` : "",
    ovm ? `Overall D: ${ordinal(ovm.rank)}${ov.inn ? " going in" : " season"}` : ""];
  return `<span class="chip d${defBand(m.rank, r.n)}" tabindex="0" ${tipAttr(lines.filter(Boolean).join("\n"))}>${ordinal(m.rank)}${r.inn ? "" : "*"}</span>`;
}
function bandFor(team, week, kind) {
  const r = team && defRank(team, week, kind);
  if (!r) return "none";
  const m = r.inn || r.season;
  return `d${defBand(m.rank, r.n)}`;
}
function withScope(conf, ap, fn, team = "") {
  const s = [state.conf, state.ap, state.team];
  state.conf = conf; state.ap = ap; state.team = team;
  try { return fn(); } finally { [state.conf, state.ap, state.team] = s; }
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
  M.games.open.clear(); M.games.limit = 16; M.rk = null;
  fillPlayerSearch();
  fillConf();
  render();
  if (M.player) renderDrawer();
}
/** Team picker: teams in the chosen conference (or all FBS / all), alphabetical. */
function fillTeams() {
  const teams = Object.entries(M.hist?.teams || {})
    .filter(([, t]) => state.conf === "all" || (state.conf === "fbs" ? t.k === "fbs" : t.c === state.conf))
    .map(([name]) => name).sort((a, b) => a.localeCompare(b));
  if (state.team && !teams.includes(state.team)) state.team = "";
  $("team").innerHTML = `<option value="">All teams</option>` + teams.map((n) => `<option>${esc(n)}</option>`).join("");
  $("team").value = state.team || "";
}
function fillConf() {
  const confs = state.data.conferences || [];
  $("conf").innerHTML = `<option value="fbs">All FBS</option><option value="all">All games</option>` +
    `<optgroup label="Power 4">${POWER4.map((c) => `<option>${esc(c)}</option>`).join("")}</optgroup>` +
    `<optgroup label="Other">${confs.filter((c) => !POWER4.includes(c)).map((c) => `<option>${esc(c)}</option>`).join("")}</optgroup>`;
  if (![...$("conf").options].some((o) => o.value === state.conf)) state.conf = "fbs";
  $("conf").value = state.conf;
  fillTeams();
}

// ---------------------------------------------------------------- routing
// Pages by route. premium.js adds its own pages and drawer sections to these.
const PAGES = { games: () => renderGames(), leaderboards: () => renderLeaderboards(), trends: () => renderTrends(), defenses: () => renderDefenses() };
const DRAWER_EXTRAS = [];   // functions (id, entry) -> HTML, shown above "Where he ranks"
const CLICK_ACTS = {};      // data-act handlers added by other scripts
function readHash() {
  const [path, query] = location.hash.replace(/^#\/?/, "").split("?");
  M.route = Object.keys(PAGES).includes(path) ? path : "games";
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
  // Freshman Watch and Projections show non-Pro visitors a teaser (top freshmen; rankings
  // without numbers) instead of a full lock.
  const locked = PRO_ROUTES.includes(M.route) && !canPro() && !["freshmen", "projections"].includes(M.route);
  $("main").innerHTML = tierBanner() + (locked ? lockedPage(M.route) : PAGES[M.route]());
  const TITLES = { freshmen: "Freshman Watch", startsit: "Who to start" };
  document.title = `Week ${state.data.meta.week} ${TITLES[M.route] || M.route[0].toUpperCase() + M.route.slice(1)} · CFF Data Dawg`;
  writeHash();
}
function topBar(title, controls = "") {
  const m = state.data.meta;
  return `<div class="top"><div><div class="eyebrow">${m.season} ${m.seasonType === "postseason" ? "postseason" : "regular season"} · week ${m.week}</div>
    <h1>${title}</h1></div><div class="grow"></div>${controls}</div>`;
}

// ---------------------------------------------------------------- games
// The games page's headline cards and trend sidebar follow the conference and Top 25
// filters: trends among teams in that conference, or teams playing in a Top 25 game.
function apTeams() {
  return new Set(state.data.games.filter((g) => g.apGame).flatMap((g) => [g.home.name, g.away.name]));
}
function scopedTrends() {
  const key = `${state.file}|${state.conf}|${state.ap}|${state.team || ""}`;
  if (M.scoped?.key === key) return M.scoped.tr;
  let tr = withScope(state.conf, false, () => buildTrends(M.hist), state.team);
  if (state.ap) {
    const keep = apTeams(), f = (L) => L.filter((x) => keep.has(x.t.name));
    tr = { ...tr, w2w: Object.fromEntries(Object.entries(tr.w2w).map(([k, L]) => [k, f(L)])),
                  multi: Object.fromEntries(Object.entries(tr.multi).map(([k, L]) => [k, f(L)])) };
  }
  M.scoped = { key, tr };
  return tr;
}
function scopeLabel() {
  const c = state.team || (state.conf === "fbs" ? "all FBS" : state.conf === "all" ? "all teams" : state.conf);
  return state.ap ? `Top 25 games${state.conf === "fbs" ? "" : `, ${c}`}` : c;
}
function headlineCards() {
  const tr = scopedTrends(), wk = state.data.meta.week;
  const cards = [];
  const up = tr.w2w.tgtUp[0];
  if (up) {
    const opp = oppOf(up.t.name);
    cards.push(`<button type="button" class="head" data-player="${up.p.id}"><div class="k">Biggest target jump</div>
      <div class="n">${esc(up.p.name)} ${tb(up.t)} <span class="muted"></span></div>
      <div class="v" style="color: var(--up)">${R(up.before)}% → ${R(up.now)}%</div>
      <div class="s">of team targets, last game → this week${opp ? `<br>vs. ${esc(opp.name)} (pass D ${chip(opp.name, wk, "pass")})` : ""}</div></button>`);
  }
  const back = tr.w2w.carUp[0];
  if (back) cards.push(`<button type="button" class="head" data-player="${back.p.id}"><div class="k">Biggest backfield jump</div>
      <div class="n">${esc(back.p.name)} ${tb(back.t)} <span class="muted"></span></div>
      <div class="v" style="color: var(--up)">${R(back.before)}% → ${R(back.now)}%</div>
      <div class="s">of RB carries, last game → this week<br>${back.volBefore} → ${back.vol} carries</div></button>`);
  const downs = [tr.w2w.tgtDown[0], tr.w2w.carDown[0]].filter(Boolean).sort((a, b) => a.d - b.d);
  const down = downs[0];
  if (down) cards.push(`<button type="button" class="head" data-player="${down.p.id}"><div class="k">Biggest drop</div>
      <div class="n">${esc(down.p.name)} ${tb(down.t)} <span class="muted"></span></div>
      <div class="v" style="color: var(--down)">${R(down.before)}% → ${R(down.now)}%</div>
      <div class="s">of ${tr.w2w.tgtDown.includes(down) ? "team targets" : "RB carries"}, last game → this week<br>${down.volBefore} → ${down.vol} ${tr.w2w.tgtDown.includes(down) ? "targets" : "carries"}</div></button>`);
  const keep = state.ap ? apTeams() : null;
  const size = SEASON_LB.size; SEASON_LB.size = 9999;
  let sl; try { sl = withScope(state.conf, false, () => buildSeasonLeaders(M.hist), state.team); } finally { SEASON_LB.size = size; }
  const dom = sl.WR.find((x) => !keep || keep.has(x.t?.name ?? x.t));
  if (dom) cards.push(`<button type="button" class="head tan" data-player="${dom.id}"><div class="k">Season dominator · WR</div>
      <div class="n">${esc(dom.name)} ${tb(dom.t)} <span class="muted"></span></div>
      <div class="v">${R(dom.sdom)}%</div>
      <div class="s">average share of team receiving yards and TDs, this season<br>${R(dom.share)}% of targets, ${plural(dom.games, "game")}</div></button>`);
  return `<p class="muted" style="margin: -8px 0 8px; font-size: 12px">Highlights for ${esc(scopeLabel())}</p><div class="heads">${cards.join("")}</div>`;
}
function renderGames() {
  const all = visibleGames(), wk = state.data.meta.week;
  // Free: the Top 25 games, like the Monday recap post
  const games = isFree() ? all.filter((g) => g.apGame) : all, lockedN = all.length - games.length;
  const shown = isFree() ? games : games.slice(0, M.games.limit);
  const controls = `<button type="button" class="pill tan" data-act="ap" aria-pressed="${state.ap}">AP Top 25</button>
    <label><span class="sr">Search teams or players</span><input type="search" id="q" placeholder="Search players or teams" value="${esc(state.q)}"></label>`;
  return topBar("Week " + wk + " usage", controls) + headlineCards() +
    `<div class="cols"><div class="wide">${shown.length ? shown.map(gameCardM).join("") : `<div class="card empty">No games match these filters.</div>`}
      ${isFree() && lockedN > 0 ? lockBox({ need: "data", title: `${lockedN} more games this week`, body: "Free access covers the Top 25 games, like the Monday recap. Members see every FBS game's usage notes, player shares and opponent defense ranks.", rows: 4 }) : ""}
      ${!isFree() && games.length > shown.length ? `<div class="more"><button type="button" class="btn" data-act="more">Show ${Math.min(16, games.length - shown.length)} more games (${games.length - shown.length} left)</button></div>` : ""}</div>
      <div class="narrow">${trendSide()}${defLegend()}</div></div>`;
}
function gameCardM(g) {
  const wk = state.data.meta.week;
  const [w, l] = g.winner === "away" ? [g.away, g.home] : [g.home, g.away];
  const row = (t, cls) => `<div class="srow ${cls}">${t.apRank ? `<span class="rank" aria-label="AP rank">${t.apRank}</span>` : ""}${tb(t)}<span class="t">${esc(t.name)}</span><span>${t.points ?? "–"}</span></div>`;
  const d = g.startDate ? new Date(g.startDate).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "";
  const where = g.neutralSite ? "neutral site" : `at ${g.home.name}`;
  const note = usageNotes(g, M.hist, wk)[0];
  const open = M.games.open.has(String(g.id));
  const faced = (t, opp) => `<span><b>${esc(t.name)}</b> faced a pass D ranked ${chip(opp.name, wk, "pass")} and a run D ranked ${chip(opp.name, wk, "run")}</span>`;
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
    const yp = Math.max(0, Math.min(100, m.yds_pct || 0));
    const field = `<div class="yfield" role="img" aria-label="${pct(m.yds_pct)} of team yards" ${tipAttr(`<b>${pct(m.yds_pct)} of ${esc(t.name)}'s yards</b>\nPassing, rushing and receiving yards / team total`)}><i style="width: ${yp}%"></i></div>`;
    return `<tr><td>${pbtn(p.id, p.name)} <span class="pos">${esc(p.pos)}</span><div class="sub">${esc(plainStatLine(p))}</div>${field}${trend}</td>
      <td class="${m.tgt_share == null ? "dim" : m.tgt_share >= 20 ? "strong" : ""}">${pct(m.tgt_share)}</td>
      <td class="${m.carry_share == null ? "dim" : m.carry_share >= 50 ? "strong" : ""}">${pct(m.carry_share)}</td>
      <td>${pct(m.yds_pct)}</td>
      <td class="${m.dominator == null ? "dim" : ""}">${pct(m.dominator)}</td></tr>`;
  }).join("");
  const tl = plainTempo(t);
  return `<div class="team"><h3>${tb(t)} ${esc(t.name)}<span>${t.totals.totalYds} yds (${t.totals.passYds} pass, ${t.totals.rushYds} rush)${tl ? ` · ${tl}` : ""}</span></h3>
    <div class="tbl"><table><thead><tr><th scope="col">Player</th>
      <th scope="col" ${tipAttr(COL_TIPS["Tgt %"])}>Tgt %</th><th scope="col" ${tipAttr(COL_TIPS["Car %"])}>Car %</th>
      <th scope="col" ${tipAttr("<b>Share of team yards</b>\nHis passing + rushing + receiving yards as a share of the team's total yards (why QBs are high)")}>Yds %</th>
      <th scope="col" ${tipAttr(COL_TIPS["Dom %"])}>Dom %</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="5" class="dim">No skill-player stats.</td></tr>`}</tbody></table></div></div>`;
}
/** "5 rec on 8 tgt, 66 yds" style line for the games page. */
function plainStatLine(p) {
  const parts = [];
  if (p.passing) { const x = p.passing; parts.push(`passing ${x.cmp}/${x.att}, ${x.yds} yds, ${x.td} TD${x.int ? `, ${x.int} INT` : ""}`); }
  if (p.rushing) parts.push(`${plural(p.rushing.car, "carry")}, ${p.rushing.yds} yds${p.rushing.td ? `, ${p.rushing.td} TD` : ""}`);
  if (p.receiving) { const r = p.receiving; parts.push(`${r.rec} rec on ${plural(r.tgt, "target")}, ${r.yds} yds${r.td ? `, ${r.td} TD` : ""}`); }
  return parts.join(" · ");
}
/** Plays, pace and pass rate over expected, each with a plain hover explanation. */
function plainTempo(t) {
  const pc = t.pace, pr = t.proe, bits = [];
  const h = (txt, tip) => `<span class="help" tabindex="0" ${tipAttr(tip)}>${txt}</span>`;
  if (pc?.plays) bits.push(h(`${pc.plays} plays`, "<b>Offensive plays</b>\nRuns, passes and sacks"));
  if (pc?.secPerPlay != null) bits.push(h(`${pc.secPerPlay.toFixed(1)} sec/play`, `<b>Pace</b>\nTheir time of possession divided by plays: ${pc.secPerPlay.toFixed(1)} seconds per play. Lower = faster offense. Most FBS teams land between about 23 and 32; the median is about 27.`));
  if (pr?.proe != null) bits.push(h(`pass rate ${signedPct(pr.proe).replace("%", "")} pts vs. expected`,
    `<b>Pass rate over expected</b>\nIn neutral situations (1st/2nd down, score within 7) they passed ${pr.passRate}% of the time. An average team in the same downs, distances and field spots passes ${pr.expRate}%. Positive = more pass-heavy than usual.`));
  return bits.join(" · ");
}
function trendSide() {
  const tr = scopedTrends(), wk = state.data.meta.week;
  const li = (x, cls, i, unit) => {
    const opp = oppOf(x.t.name);
    return `<li class="${cls}"><span class="num">${i + 1}</span><div>${pbtn(x.p.id, x.p.name)} ${tb(x.t)} <span class="pos"></span>
      <div class="l2">${R(x.before)}% → ${R(x.now)}% of ${unit}${opp ? ` · vs. ${chip(opp.name, wk, unit === "targets" ? "pass" : "run")}` : ""}</div></div></li>`;
  };
  return `<section class="card pad"><h2>Trending up</h2><ol class="list" style="margin-top: 12px">${tr.w2w.tgtUp.slice(0, 4).map((x, i) => li(x, "up", i, "targets")).join("")}</ol>
    <h2 style="margin-top: 20px">Trending down</h2><ol class="list" style="margin-top: 12px">${tr.w2w.tgtDown.slice(0, 3).map((x, i) => li(x, "down", i, "targets")).join("")}</ol>
    <p style="margin: 16px 0 0"><a href="#/trends">All trends →</a></p></section>`;
}
function defLegend() {
  return `<section class="card pad"><h2 style="font-size: 18px">Defense rank colors</h2>
    <p class="muted" style="margin: 6px 0 10px; font-size: 13px">Where the opponent's defense ranked among ${DEF.data ? Object.keys(DEF.data.season).length : "FBS"} FBS defenses going into the game, by ${DM[state.dm].label} allowed (1st = toughest). Hover a chip for details.</p>
    <div class="legend"><span class="chip d1">Top fifth · tough</span><span class="chip d2">2nd</span><span class="chip d3">Middle</span><span class="chip d4">4th</span><span class="chip d5">Bottom fifth · soft</span></div>
    <p class="muted" style="margin: 10px 0 0; font-size: 12px">* = the defense hadn't played an FBS offense yet, so its season rank is shown.</p></section>`;
}

// ---------------------------------------------------------------- leaderboards
// Leaderboards: a period (this week / season) × a board (share / dominator / volume)
// × a position. Every column sorts; each board starts on its headline column.
const BOARD_LABEL = { share: "Share", dom: "Dominator", vol: "Volume" };
function renderLeaderboards() {
  const seg = (key, opts, label) => `<div class="seg" role="group" aria-label="${label}">${opts.map(([v, text]) =>
    `<button type="button" data-act="lb-${key}" data-val="${v}" aria-pressed="${M.lb[key] === v}">${text}</button>`).join("")}</div>`;
  const qb = M.lb.pos === "QB";
  const controls = seg("period", [["week", "This week"], ["season", "Season"]], "Period") +
    (qb ? seg("board", Object.entries(QB_BOARDS), "Board") : seg("board", [["share", "Share %"], ["dom", "Dominator %"], ["vol", "Volume"]], "Board")) +
    seg("pos", [["WR", "WR"], ["TE", "TE"], ["RB", "RB"], ["QB", "QB"]], "Position") + (qb && M.lb.board === "fpts" ? ptdControls() : "");
  return topBar("Leaderboards", controls) + `<div class="cols"><div class="wide">${boardTable(boardSpec())}</div><div class="narrow">${qb ? qbExplainer() : domExplainer()}${defLegend()}</div></div>`;
}
/** RB dominator: carry share plus receiving credit (20% of targets = full credit). */
const rbDomOf = (cs, ts) => (cs == null ? null : (cs + Math.min(100, (100 * (ts || 0)) / SEASON_LB.rbFullTgtShare)) / 2);
function weekRows(pos) {
  const wk = state.data.meta.week, rows = [];
  for (const t of leaderboardTeams()) for (const p of t.players) {
    if (p.pos !== pos) continue;
    const m = p.metrics, r = p.receiving || {}, ru = p.rushing || {}, ctx = priorContext(M.hist, p.id, wk);
    rows.push({ id: String(p.id), name: p.name, t, pbp: t.targetsSource === "pbp",
      tgtShare: m.tgt_share, carShare: m.carry_share, dom: pos === "RB" ? rbDomOf(m.carry_share, m.tgt_share) : m.dominator,
      tgt: r.tgt || 0, rec: r.rec || 0, recYds: r.yds || 0, recTd: r.td || 0, car: ru.car || 0, rushYds: ru.yds || 0, rushTd: ru.td || 0,
      scrim: (r.yds || 0) + (ru.yds || 0), tds: (r.td || 0) + (ru.td || 0),
      avgTs: ctx && ctx.games >= 2 ? ctx.avgTs : null, avgCs: ctx && ctx.games >= 2 ? ctx.avgCs : null });
  }
  return rows;
}
function seasonRows(pos) {
  // One team picked: show all of its players, so the volume minimums don't apply.
  const keep = JSON.stringify([SEASON_LB, VOL]);
  SEASON_LB.size = 9999;
  if (state.team) {
    Object.assign(SEASON_LB, { minTgtPerGame: { WR: 0.01, TE: 0.01 }, minCarPerGame: 0.01, minGameShare: 0 });
    Object.assign(VOL, { minTgtPerGame: { WR: 0.01, TE: 0.01 }, minTouchPerGame: 0.01 });
  }
  try {
    const sl = buildSeasonLeaders(M.hist)[pos], vol = new Map(buildSeasonVolume(M.hist)[pos].map((x) => [x.id, x]));
    return { sl, vol: [...vol.values()] };
  } finally { const [a, b] = JSON.parse(keep); Object.assign(SEASON_LB, a); Object.assign(VOL, b); }
}
function boardSpec() {
  if (M.lb.pos === "QB") return qbBoardSpec();
  const { period, board, pos } = M.lb, isRb = pos === "RB", wk = state.data.meta.week;
  const P = (v) => pct(v), F1 = (v) => (v == null ? "–" : v.toFixed(1)), N = (v) => (v == null ? "–" : v.toLocaleString("en-US"));
  const faced = { k: "faced", label: `Faced ${isRb ? "run" : "pass"} D`, nosort: true,
                  html: (x) => { const o = oppOf(x.t.name); return o ? chip(o.name, wk, isRb ? "run" : "pass") : "–"; } };
  // One team picked: everyone with a target or carry, so the weekly minimums don't apply.
  const minT = state.team ? 1 : LB.minTargets[pos], minC = state.team ? 1 : LB.minCarries;
  if (period === "week") {
    const all = weekRows(pos);
    if (board === "share") return isRb
      ? { post: { n: LB.size, day: "Thursday" }, title: `Top RBs by carry share · week ${wk}`, note: `${minC}+ carries this week`, rows: all.filter((x) => x.carShare != null && x.car >= minC),
          cols: [{ k: "carShare", label: "Car %", fmt: P, bar: 1 }, { k: "car", label: "Car" }, { k: "rushYds", label: "Rush yds", fmt: N },
                 { k: "tgtShare", label: "Tgt %", fmt: P }, { k: "avgCs", label: "Season avg", fmt: P }, faced] }
      : { post: { n: LB.size, day: "Thursday" }, title: `Top ${pos}s by target share · week ${wk}`, note: `${minT}+ targets this week`, rows: all.filter((x) => x.pbp && x.tgtShare != null && x.tgt >= minT),
          cols: [{ k: "tgtShare", label: "Tgt %", fmt: P, bar: 1 }, { k: "tgt", label: "Tgt" }, { k: "recYds", label: "Rec yds", fmt: N },
                 { k: "avgTs", label: "Season avg", fmt: P }, faced] };
    if (board === "dom") return isRb
      ? { title: `Top RBs by RB dominator · week ${wk}`, note: `${minC}+ carries this week`, rows: all.filter((x) => x.dom != null && x.car >= minC),
          cols: [{ k: "dom", label: "RB dom", fmt: P, bar: 1, tan: 1 }, { k: "carShare", label: "Car %", fmt: P }, { k: "tgtShare", label: "Tgt %", fmt: P },
                 { k: "car", label: "Car" }, { k: "tgt", label: "Tgt" }, faced] }
      : { title: `Top ${pos}s by dominator · week ${wk}`, note: `${minT}+ targets this week`, rows: all.filter((x) => x.dom != null && x.tgt >= minT),
          cols: [{ k: "dom", label: "Dom %", fmt: P, bar: 1, tan: 1 }, { k: "recYds", label: "Rec yds", fmt: N }, { k: "recTd", label: "Rec TD" },
                 { k: "tgtShare", label: "Tgt %", fmt: P }, faced] };
    return isRb
      ? { title: `Top RBs by scrimmage yards · week ${wk}`, note: "", rows: all.filter((x) => x.car + x.tgt > 0),
          cols: [{ k: "scrim", label: "Scrim yds", fmt: N, bar: 1 }, { k: "rushYds", label: "Rush yds", fmt: N }, { k: "car", label: "Car" },
                 { k: "tgt", label: "Tgt" }, { k: "recYds", label: "Rec yds", fmt: N }, { k: "tds", label: "TD" }, faced] }
      : { title: `Top ${pos}s by receiving yards · week ${wk}`, note: "", rows: all.filter((x) => x.tgt > 0),
          cols: [{ k: "recYds", label: "Rec yds", fmt: N, bar: 1 }, { k: "recTd", label: "Rec TD" }, { k: "rec", label: "Rec" }, { k: "tgt", label: "Tgt" },
                 { k: "tgtShare", label: "Tgt %", fmt: P }, faced] };
  }
  const { sl, vol } = seasonRows(pos), through = `through week ${wk} · played at least half his team's games`;
  if (board === "share") return isRb
    ? { title: "Season carry share", note: `${through} · ${SEASON_LB.minCarPerGame}+ carries a game`, rows: sl,
        cols: [{ k: "share", label: "Car %", fmt: P, bar: 1 }, { k: "perGame", label: "Car / g", fmt: F1 }, { k: "tgtShare", label: "Tgt %", fmt: P },
               { k: "rbDom", label: "RB dom", fmt: P }, { k: "games", label: "Games" }] }
    : { title: `Season ${pos} target share`, note: `${through} · ${SEASON_LB.minTgtPerGame[pos]}+ targets a game`, rows: sl,
        cols: [{ k: "share", label: "Tgt %", fmt: P, bar: 1 }, { k: "perGame", label: "Tgt / g", fmt: F1 }, { k: "sdom", label: "Dom %", fmt: P }, { k: "games", label: "Games" }] };
  if (board === "dom") return isRb
    ? { title: "Season RB dominator", note: `${through} · ${SEASON_LB.minCarPerGame}+ carries a game`, rows: sl,
        cols: [{ k: "rbDom", label: "RB dom", fmt: P, bar: 1, tan: 1 }, { k: "share", label: "Car %", fmt: P }, { k: "perGame", label: "Car / g", fmt: F1 },
               { k: "tgtShare", label: "Tgt %", fmt: P }, { k: "games", label: "Games" }] }
    : { title: `Season ${pos} dominator`, note: `${through} · ${SEASON_LB.minTgtPerGame[pos]}+ targets a game`, rows: sl,
        cols: [{ k: "sdom", label: "Dom %", fmt: P, bar: 1, tan: 1 }, { k: "share", label: "Tgt %", fmt: P }, { k: "perGame", label: "Tgt / g", fmt: F1 }, { k: "games", label: "Games" }] };
  return isRb
    ? { title: "Season RB volume", note: `${through} · ${VOL.minTouchPerGame}+ touches (carries + targets) a game`, rows: vol,
        cols: [{ k: "scrimPg", label: "Scrim yds / g", fmt: F1, bar: 1 }, { k: "rushYdsPg", label: "Rush yds / g", fmt: F1 }, { k: "carPg", label: "Car / g", fmt: F1 },
               { k: "tgtPg", label: "Tgt / g", fmt: F1 }, { k: "recYdsPg", label: "Rec yds / g", fmt: F1 }, { k: "games", label: "Games" }] }
    : { title: `Season ${pos} volume`, note: `${through} · ${VOL.minTgtPerGame[pos]}+ targets a game`, rows: vol,
        cols: [{ k: "recYdsPg", label: "Rec yds / g", fmt: F1, bar: 1 }, { k: "recYds", label: "Rec yds", fmt: N }, { k: "recTd", label: "Rec TD" },
               { k: "tgtPg", label: "Tgt / g", fmt: F1 }, { k: "rec", label: "Rec" }, { k: "games", label: "Games" }] };
}
// Plain-language hover text for every leaderboard column, keyed by column label.
const COL_TIPS = {
  "Tgt %": "<b>Target share</b>\nHis share of the passes thrown to his team's players (targets)",
  "Car %": "<b>Carry share</b>\nHis share of the team's running back carries (QB and receiver runs aren't counted)",
  "Tgt": "<b>Targets</b>\nPasses thrown his way", "Car": "<b>Carries</b>", "Rec": "<b>Receptions</b>",
  "Rec yds": "<b>Receiving yards</b>", "Rush yds": "<b>Rushing yards</b>", "Rec TD": "<b>Receiving touchdowns</b>", "TD": "<b>Touchdowns</b>\nRushing + receiving",
  "Scrim yds": "<b>Scrimmage yards</b>\nRushing + receiving yards",
  "Season avg": "<b>Season average</b>\nHis average share in his earlier games this season (needs 2+ games)",
  "Dom %": "<b>Dominator</b>\nThe average of his share of the team's receiving yards and receiving TDs. See \"What is dominator rating?\"",
  "RB dom": "<b>RB dominator</b>\nThe average of his carry share and a receiving score (20% of team targets = 100%). See \"What is dominator rating?\"",
  "Tgt / g": "<b>Targets per game</b>\nGames he played", "Car / g": "<b>Carries per game</b>\nGames he played",
  "Rec yds / g": "<b>Receiving yards per game</b>\nGames he played", "Rush yds / g": "<b>Rushing yards per game</b>\nGames he played",
  "Scrim yds / g": "<b>Scrimmage yards per game</b>\nRushing + receiving yards, per game he played",
  "Games": "<b>Games played</b>\nGames with at least one touch",
  "Faced pass D": "<b>Opponent's pass defense</b>\nIts rank among FBS defenses going into the game. 1st = toughest. Hover a chip for details.",
  "Faced run D": "<b>Opponent's run defense</b>\nIts rank among FBS defenses going into the game. 1st = toughest. Hover a chip for details.",
};
function boardTable(spec) {
  const sortable = spec.cols.filter((c) => !c.nosort);
  const key = sortable.some((c) => c.k === M.lb.sort) ? M.lb.sort : sortable[0].k;
  const val = (x) => (x[key] == null ? -Infinity : x[key]);
  const rows = spec.rows.slice().sort((a, b) => val(b) - val(a) || (b[sortable[0].k] ?? -1) - (a[sortable[0].k] ?? -1)).slice(0, lim(25));
  const more = isFree() && spec.rows.length > rows.length;
  const barCol = spec.cols.find((c) => c.bar), top = Math.max(1, ...rows.map((x) => x[barCol.k] ?? 0));
  const show = (c, x) => (c.html ? c.html(x) : c.fmt ? c.fmt(x[c.k]) : x[c.k] ?? "–");
  const head = `<tr><th scope="col">#</th><th scope="col" style="text-align: left">Player</th>${spec.cols.map((c) => c.nosort
    ? `<th scope="col" ${COL_TIPS[c.label] ? tipAttr(COL_TIPS[c.label]) : ""}>${c.label}</th>`
    : `<th scope="col" aria-sort="${c.k === key ? "descending" : "none"}" ${COL_TIPS[c.label] ? tipAttr(COL_TIPS[c.label]) : ""}><button type="button" data-act="lb-sort" data-val="${c.k}">${c.label}${c.k === key ? " ▾" : ""}</button></th>`).join("")}</tr>`;
  const body = rows.map((x, i) => `<tr><td class="muted strong">${i + 1}</td><td style="text-align: left">${pbtn(x.id, x.name)} ${tb(x.t)} <span class="pos"></span></td>
    ${spec.cols.map((c) => c.bar
      ? `<td><span class="barcell"><span class="bar${c.tan ? " tan" : ""}"><i style="width: ${Math.max(0, (100 * (x[c.k] ?? 0)) / top)}%"></i></span><b>${show(c, x)}</b></span></td>`
      : `<td class="${c.k === key ? "strong" : x[c.k] == null && !c.html ? "dim" : ""}">${show(c, x)}</td>`).join("")}</tr>`).join("");
  return `<section class="card"><div class="pad" style="display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px; padding-bottom: 12px">
      <h2>${esc(spec.title)}</h2><span class="muted" style="font-size: 12px">${esc([spec.note, leaderboardScopeLabel(), "click a column to sort"].filter(Boolean).join(" · "))}</span></div>
    <div class="tbl" style="border: 0; border-top: 1px solid var(--line); border-radius: 0 0 16px 16px"><table><thead>${head}</thead>
    <tbody>${body || `<tr><td colspan="${spec.cols.length + 2}" class="dim">${esc(spec.empty || "Nobody qualifies.")}</td></tr>`}</tbody></table></div>
    ${more ? lockBox({ need: "data", title: "See the full top 25", body: "Members see every leaderboard in full, for this week and the season.", rows: 4, compact: true, post: spec.post }) : ""}</section>`;
}
function domExplainer() {
  return `<section class="card pad"><h2 style="font-size: 18px">What is dominator rating?</h2>
    <p style="margin: 8px 0 0; font-size: 13px; color: var(--ink2)">How much of his team's passing game ran through him. It's the average of two shares: his share of the team's receiving yards and his share of its receiving touchdowns.</p>
    <p style="margin: 8px 0 0; font-size: 13px; color: var(--ink2)">Example: 90 of the team's 300 receiving yards (30%) and 2 of its 3 receiving TDs (67%) = (30 + 67) ÷ 2 = <b>48%</b>.</p>
    <p style="margin: 8px 0 0; font-size: 13px; color: var(--ink2)"><b>RB dominator</b> works the same way for backs: the average of his share of the team's RB carries and a receiving score, where catching 20% of the team's targets counts as 100%. Example: 60% of carries and 10% of targets (a receiving score of 50%) = <b>55%</b>.</p></section>`;
}

// ---------------------------------------------------------------- trends
function renderTrends() {
  const seg = (key, opts) => `<div class="seg" role="group">${opts.map(([v, label]) =>
    `<button type="button" data-act="tr-${key}" data-val="${v}" aria-pressed="${M.tr[key] === v}">${label}</button>`).join("")}</div>`;
  const controls = seg("span", [["w2w", "Week to week"], ["multi", "Last 3 games"]]) + seg("kind", [["tgt", "Target share"], ["car", "Carry share"], ["qb", "QBs"]]);
  if (M.tr.kind === "qb") return topBar("Trends", controls) + renderQbTrends();
  const tr = buildTrends(M.hist), g = tr[M.tr.span], k = M.tr.kind;
  const ups = g[`${k}Up`], downs = g[`${k}Down`];
  const col = (rows, dir) => `<section class="card pad" style="flex: 1 1 300px; min-width: 0"><h2>${dir > 0 ? "Trending up" : "Trending down"}</h2>
    <ol class="list" style="margin-top: 12px">${rows.slice(0, lim(rows.length)).map((x, i) => trendLi(x, i, dir)).join("") || `<li class="muted">Nobody cleared the volume floor.</li>`}</ol>
    ${isFree() && rows.length > FREE_ROWS ? lockBox({ need: "data", title: `${rows.length - FREE_ROWS} more ${dir > 0 ? "risers" : "fallers"}`, rows: 3, compact: true, post: { n: TR.size, day: "Wednesday" } }) : ""}</section>`;
  const how = M.tr.span === "w2w"
    ? `Each player's share this week compared with his previous game. To qualify he needs ${TR.tgt}+ targets (or ${TR.car}+ carries) in at least one of the two games. "pts" = percentage points.`
    : `Each player's average share over his last 3 games compared with his earlier games (he needs at least 2 earlier games). Same minimums as week to week.`;
  return topBar("Trends", controls) +
    `<p class="muted" style="margin: -6px 0 16px">${esc(leaderboardScopeLabel())} · ${how}</p>
    <div style="display: flex; flex-wrap: wrap; gap: 16px">${col(ups, 1)}${col(downs, -1)}</div>
    <section class="card pad" style="margin-top: 16px"><div style="display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: baseline">
      <h2>Trend lines for the biggest movers</h2><span class="muted" style="font-size: 13px">Share by week · blue dot = week ${state.data.meta.week} · click for details</span></div>
      ${isFree() ? lockBox({ need: "data", title: "Trend lines for the biggest movers", body: "Each mover's share week by week.", rows: 3, compact: true, post: { n: TR.size, day: "Wednesday", what: "This chart", get: "Get it free" } }) : `<div class="minis">${moversFor(M.trendsAll).map(miniChart).join("")}</div>`}</section>`;
}
function trendLi(x, i, dir) {
  const wk = state.data.meta.week, k = M.tr.kind, unit = k === "tgt" ? "target" : "carry";
  const opp = oppOf(x.t.name);
  const vol = M.tr.span === "w2w" ? `${x.volBefore} → ${plural(x.vol, unit)}` : `${x.vol.toFixed(1)} ${unit === "carry" ? "carries" : "targets"} a game, was ${x.volBefore.toFixed(1)}`;
  const ctx = M.tr.span === "w2w"
    ? (opp ? ` · vs. ${esc(opp.name)} ${chip(opp.name, wk, k === "tgt" ? "pass" : "run")}` : "")
    : esc(recentOpp(M.hist, x, k === "tgt" ? "pass" : "run"));
  return `<li class="${dir > 0 ? "up" : "down"}"><span class="num">${i + 1}</span><div>${pbtn(x.p.id, x.p.name)} ${tb(x.t)} <span class="pos">${esc(x.p.pos)}</span>
    <div class="l2"><b>${R(x.before)}% → ${R(x.now)}%</b> of ${k === "tgt" ? "team targets" : "RB carries"} (${signed(x.d)} pts) · ${vol}${ctx}</div></div></li>`;
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
    if (r && r[key] != null) marks.push(`<circle cx="${x(w)}" cy="${y(r[key])}" r="${w === wk ? 5 : 3}" style="fill: var(${w === wk ? "--blue" : "--bar"})"></circle>`);
    else if (!played[w]) marks.push(`<circle cx="${x(w)}" cy="${y(0)}" r="3.5" fill="none" style="stroke: var(--bar)" stroke-width="1.5"></circle>`);
    else marks.push(`<path d="M${x(w) - 3.5} ${y(0) - 3.5}l7 7m0 -7l-7 7" style="stroke: var(--bar)" stroke-width="1.8"></path>`);
  }
  const last = pts[pts.length - 1];
  const label = last ? `<text x="${Math.min(x(last.w), W - 22)}" y="${Math.max(12, y(last[key]) - 9)}" font-size="11" font-weight="700" style="fill: var(--blue-ink)" text-anchor="middle">${R(last[key])}%</text>` : "";
  const desc = pts.map((r) => `week ${r.w} ${R(r[key])}%`).join(", ");
  return `<button type="button" class="mini" data-player="${m.p.id}" data-kind="${m.kind}"><div class="cap">${esc(m.p.name)} ${tb(m.t)} <span class="pos">${m.kind === "tgt" ? "targets" : "carries"}</span></div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(desc)}"><line x1="6" y1="${y(0)}" x2="${W - 6}" y2="${y(0)}" style="stroke: var(--line)"></line>
    <polyline points="${line}" fill="none" style="stroke: var(--bar)" stroke-width="2.5" stroke-linejoin="round"></polyline>${marks.join("")}${label}</svg></button>`;
}

// ---------------------------------------------------------------- defenses
function renderDefenses() {
  const d = DEF.data;
  if (!d) return topBar("Defenses") + `<div class="card empty">Defense ranks aren't available for this season yet.</div>`;
  const mm = DM[state.dm], sorts = { overall: (r) => r[mm.orank] ?? 999, pass: (r) => r[mm.rank], run: (r) => r[mm.rank + 1] };
  const q = M.def.q.trim().toLowerCase();
  const inConf = (name) => state.team ? name === state.team
    : ["fbs", "all"].includes(state.conf) || M.hist?.teams?.[name]?.c === state.conf;
  let rows = Object.entries(d.season).filter(([name]) => inConf(name) && (!q || name.toLowerCase().includes(q)));
  rows = M.def.sort === "team" ? rows.sort((a, b) => a[0].localeCompare(b[0])) : rows.sort((a, b) => sorts[M.def.sort](a[1]) - sorts[M.def.sort](b[1]));
  const n = Object.keys(d.season).length;
  const cell = (name, r, kind) => {
    const rank = r[mm.rank + (kind === "pass" ? 0 : 1)], val = r[kind === "pass" ? mm.pass : mm.run];
    return `<td><span class="chip d${defBand(rank, n)}">${ordinal(rank)}</span></td><td>${mm.fmt(val)}</td>`;
  };
  const sortBtn = (key, label) => `<button type="button" data-act="def-sort" data-val="${key}" aria-label="Sort by ${label}">${label}${M.def.sort === key ? " ▾" : ""}</button>`;
  const ovCell = (r) => r[mm.orank] == null ? `<td class="dim">–</td><td class="dim">–</td>`
    : `<td><span class="chip d${defBand(r[mm.orank], n)}" style="font-size: 13px">${ordinal(r[mm.orank])}</span></td><td>${fmtScore(r[mm.overall])}</td>`;
  const controls = `<label><span class="sr">Search defenses</span><input type="search" id="dq" placeholder="Search teams" value="${esc(M.def.q)}"></label>`;
  return topBar("Defenses", controls) +
    `<p class="muted" style="margin: -6px 0 16px">${n} FBS defenses ranked by ${mm.label} allowed through week ${d.through}, in games against FBS offenses. 1st = toughest. Switch the measure in the sidebar.</p>
    <section class="card pad" style="margin-bottom: 16px"><h2 style="font-size: 18px">How Overall D works</h2>
      <p style="margin: 6px 0 0; font-size: 13px; color: var(--ink2)">One number for the whole defense. We take its pass and run ${mm.label} allowed, compare each with the FBS average (adjusting for the fact that pass plays gain more yards than runs), and blend them by how often FBS offenses pass vs. run.</p>
      <p style="margin: 8px 0 0; font-size: 13px; color: var(--ink2)"><b>Score:</b> 0 = an average FBS defense. Below zero is tougher, above zero is softer. Roughly, −1.00 or lower puts a defense in the top 10-15%, and +1.00 or higher in the bottom 10-15%.</p></section>
    <section class="card"><div class="tbl" style="border: 0; border-radius: 16px"><table><thead><tr>
      <th scope="col">${sortBtn("team", "Team")}</th><th scope="col">${sortBtn("overall", "Overall D")}</th><th scope="col" ${tipAttr("<b>Overall score</b>\n0 = average FBS defense. Below zero = tougher (−1.00 or lower ≈ top 10-15%), above zero = softer.")}>Score</th>
      <th scope="col" ${tipAttr("<b>Pass defense rank</b>\nAmong FBS defenses. 1st = toughest")}>${sortBtn("pass", "Pass D")}</th><th scope="col" ${tipAttr(`<b>Pass ${mm.label} allowed</b>${mm.label.includes("EPA") ? "\nEPA = expected points added: how much each play changed the offense's expected points. Lower is better for the defense." : ""}`)}>${mm.label}</th>
      <th scope="col" ${tipAttr("<b>Run defense rank</b>\nAmong FBS defenses. 1st = toughest")}>${sortBtn("run", "Run D")}</th><th scope="col" ${tipAttr(`<b>Run ${mm.label} allowed</b>`)}>${mm.label}</th><th scope="col" ${tipAttr("<b>Games counted</b>\nGames against FBS offenses")}>Games</th></tr></thead>
    <tbody>${rows.slice(0, lim(rows.length)).map(([name, r]) => `<tr><td>${tb(name)} <b>${esc(name)}</b> <span class="pos">${esc(M.hist?.teams?.[name]?.c || "")}</span></td>${ovCell(r)}${cell(name, r, "pass")}${cell(name, r, "run")}<td>${r[8]}</td></tr>`).join("") || `<tr><td colspan="8" class="dim">No team matches.</td></tr>`}</tbody></table></div>
    ${isFree() && rows.length > FREE_ROWS ? lockBox({ need: "data", title: `All ${rows.length} defenses`, body: "Members see every FBS defense ranked, with pass, run and overall scores.", rows: 4, compact: true }) : ""}</section>`;
}

// ---------------------------------------------------------------- where he ranks
// Every list a player can appear on, ranked in full (all FBS), so the drawer can say
// where he stands, what the cutoff was, and why he is or isn't on a list.
function rankData() {
  if (M.rk) return M.rk;
  return (M.rk = withScope("fbs", false, () => {
    const keep = [SEASON_LB.size, LB.size, TR.size];
    SEASON_LB.size = 9999; LB.size = 9999; TR.size = 9999;
    try {
      const sl = buildSeasonLeaders(M.hist), vol = buildSeasonVolume(M.hist), lb = buildLeaderboard(M.hist), tr = buildTrends(M.hist);
      const byShare = (L) => L.slice().sort((a, b) => b.share - a.share);
      return { sl, vol, lb, tr, share: { WR: byShare(sl.WR), TE: byShare(sl.TE), RB: byShare(sl.RB) } };
    } finally { [SEASON_LB.size, LB.size, TR.size] = keep; }
  }));
}
/** Why a player isn't on a season list: games played or per-game volume. */
function seasonMiss(e, id, kind) {
  const wk = state.data.meta.week;
  const teamGames = Object.keys(M.hist.teams?.[e.t]?.w || {}).filter((w) => +w <= wk).length;
  const weeks = Object.entries(e.w).filter(([w]) => +w <= wk), g = weeks.length;
  const need = Math.max(3, Math.ceil(teamGames * 0.5));
  if (g < need) return `Has played ${plural(g, "game")} of ${teamGames}; needs ${need}.`;
  const tgt = weeks.reduce((s, [, a]) => s + (a[0] || 0), 0) / g, car = weeks.reduce((s, [, a]) => s + (a[2] || 0), 0) / g;
  if (kind === "dom") {
    if (e.p === "RB") return `${car.toFixed(1)} carries a game; needs ${SEASON_LB.minCarPerGame}+.`;
    return `${tgt.toFixed(1)} targets a game; needs ${SEASON_LB.minTgtPerGame[e.p]}+.`;
  }
  if (e.p === "RB") return `${(car + tgt).toFixed(1)} touches a game; needs ${VOL.minTouchPerGame}+.`;
  return `${tgt.toFixed(1)} targets a game; needs ${VOL.minTgtPerGame[e.p]}+.`;
}
function playerRanks(id) {
  const e = M.hist?.players?.[id];
  if (!e || !["WR", "TE", "RB"].includes(e.p)) return null;
  const rk = rankData(), pos = e.p, isRb = pos === "RB", rows = [];
  const add = (row) => rows.push(row);
  const at = (L, f) => L.findIndex(f);
  const f1 = (v) => v.toFixed(1);
  // Season dominator
  {
    const L = rk.sl[pos], i = at(L, (x) => x.id === id), val = (x) => (isRb ? x.rbDom : x.sdom);
    add({ list: isRb ? "Season RB dominator" : "Season dominator", top: 5, i, n: L.length,
          value: i >= 0 ? pct(val(L[i])) : null, cut: L[4] ? pct(val(L[4])) : null, miss: i < 0 ? seasonMiss(e, id, "dom") : "" });
  }
  // Season share
  {
    const L = rk.share[pos], i = at(L, (x) => x.id === id);
    add({ list: isRb ? "Season carry share" : "Season target share", top: 10, i, n: L.length,
          value: i >= 0 ? pct(L[i].share) : null, cut: L[9] ? pct(L[9].share) : null, miss: i < 0 ? seasonMiss(e, id, "dom") : "" });
  }
  // Season volume
  {
    const L = rk.vol[pos], i = at(L, (x) => x.id === id), val = (x) => (isRb ? x.scrimPg : x.recYdsPg);
    add({ list: isRb ? "Scrimmage yards a game" : "Receiving yards a game", top: 5, i, n: L.length,
          value: i >= 0 ? f1(val(L[i])) : null, cut: L[4] ? f1(val(L[4])) : null, miss: i < 0 ? seasonMiss(e, id, "vol") : "" });
  }
  // This week's leaderboard
  {
    const L = pos === "WR" ? rk.lb.wr : pos === "TE" ? rk.lb.te : rk.lb.car, i = at(L, (x) => String(x.p.id) === id);
    const share = (x) => (isRb ? x.p.metrics.carry_share : x.p.metrics.tgt_share);
    const wkRow = e.w[String(state.data.meta.week)];
    const miss = !wkRow ? "Didn't play this week." : isRb ? `${wkRow[2]} carries this week; needs ${LB.minCarries}+.` : `${wkRow[0]} targets this week; needs ${LB.minTargets[pos]}+.`;
    add({ list: `Week ${state.data.meta.week} ${isRb ? "carry" : "target"} share`, top: LB.size, i, n: L.length,
          value: i >= 0 ? pct(share(L[i])) : null, cut: L[LB.size - 1] ? pct(share(L[LB.size - 1])) : null, miss: i < 0 ? miss : "" });
  }
  // Trends (target trends for everyone; carry trends for backs too)
  for (const kind of isRb ? ["car", "tgt"] : ["tgt"]) for (const span of ["w2w", "multi"]) {
    const up = rk.tr[span][`${kind}Up`], down = rk.tr[span][`${kind}Down`];
    const iu = at(up, (x) => String(x.p.id) === id), id2 = at(down, (x) => String(x.p.id) === id);
    const label = `${span === "w2w" ? "Week to week" : "Last 3 games"}: ${kind === "tgt" ? "target" : "carry"} share`;
    const fmtD = (x) => `${R(x.before)}% → ${R(x.now)}%, ${signed(x.d)} pts`;
    if (iu >= 0) add({ list: `${label}, up`, top: TR.size, i: iu, n: up.length, value: fmtD(up[iu]), cut: up[TR.size - 1] ? signed(up[TR.size - 1].d) : null, trend: 1 });
    else if (id2 >= 0) add({ list: `${label}, down`, top: TR.size, i: id2, n: down.length, value: fmtD(down[id2]), cut: down[TR.size - 1] ? signed(down[TR.size - 1].d) : null, trend: -1 });
    else add({ list: label, top: TR.size, i: -1, n: up.length, value: null, cut: null,
               miss: !e.w[String(state.data.meta.week)] ? "Didn't play this week." : span === "w2w" ? `Needs ${kind === "tgt" ? TR.tgt + "+ targets" : TR.car + "+ carries"} on the busier side of the two games.` : `Needs ${TR.recent + TR.minEarlier}+ games with touches and ${kind === "tgt" ? TR.tgt + "+ targets" : TR.car + "+ carries"} a game.` });
  }
  return { e, rows, why: rankWhy(e, rows) };
}
/** One or two plain sentences on the pattern in his ranks. */
function rankWhy(e, rows) {
  const r = (name) => rows.find((x) => x.list.startsWith(name));
  const isRb = e.p === "RB";
  const dom = r(isRb ? "Season RB dominator" : "Season dominator"), vol = r(isRb ? "Scrimmage" : "Receiving"), sh = r(isRb ? "Season carry" : "Season target");
  const out = [];
  if (dom.i >= 0 && dom.i < 5) out.push(`Top 5 in ${isRb ? "RB dominator" : "season dominator"} (${ordinal(dom.i + 1)}).`);
  else if (dom.i >= 0 && vol.i >= 0 && vol.i < 10)
    out.push(`${ordinal(vol.i + 1)} in ${isRb ? "scrimmage" : "receiving"} yards a game but ${ordinal(dom.i + 1)} in ${isRb ? "RB dominator" : "dominator"}: his production is near the top, but ${isRb ? "his share of the work" : "his share of the team's targets and yards"} isn't, so he misses the top 5 (cutoff ${dom.cut}).`);
  else if (dom.i >= 5) out.push(`${ordinal(dom.i + 1)} in ${isRb ? "RB dominator" : "season dominator"}; the top 5 cutoff is ${dom.cut}, he's at ${dom.value}.`);
  else if (dom.miss) out.push(`Not on the season lists yet. ${dom.miss}`);
  if (sh.i >= 0 && sh.i < 10 && !(dom.i >= 0 && dom.i < 5)) out.push(`Still ${ordinal(sh.i + 1)} in season ${isRb ? "carry" : "target"} share.`);
  const t = rows.find((x) => x.trend === 1 && x.i < TR.size) || rows.find((x) => x.trend === -1 && x.i < TR.size);
  if (t) out.push(`On this week's trends: ${ordinal(t.i + 1)} in ${t.list.replace(/, (up|down)$/, "")} ${t.trend > 0 ? "risers" : "fallers"}.`);
  else {
    const near = rows.find((x) => x.trend === 1);
    if (near) {
      const what = near.list.replace(/, up$/, "").replace(/^Week to week: /, "this week's ").replace(/^Last 3 games: /, "last-3-game ");
      out.push(`Up in ${what} (${near.value}), but ${ordinal(TR.size)} place on the trends list was ${near.cut}; he's ${ordinal(near.i + 1)}.`);
    }
  }
  return out.join(" ");
}
function ranksSection(id) {
  const pr = playerRanks(id);
  if (!pr) return "";
  const row = (x) => {
    const on = x.i >= 0 && x.i < x.top;
    const rank = x.i >= 0 ? `<b>${ordinal(x.i + 1)}</b> <span class="muted">of ${x.n}</span>` : `<span class="muted">Not ranked</span>`;
    const badge = on ? `<span class="chip d5" style="cursor: default">On the list</span>` : x.i >= 0 ? `<span class="chip none" style="cursor: default">Outside top ${x.top}</span>` : "";
    return `<tr><td style="text-align: left">${esc(x.list)}<div class="sub">${x.i >= 0 ? `${esc(x.value || "")}${x.cut && !on ? ` · ${ordinal(x.top)} place had ${esc(x.cut)}` : ""}` : esc(x.miss || "")}</div></td>
      <td>${rank}</td><td>${badge}</td></tr>`;
  };
  return `<h3 style="margin: 20px 0 8px; font-size: 13px">Where he ranks <span class="muted" style="font-weight: 400">· on each list on this site, among all FBS players, through week ${state.data.meta.week}</span></h3>
    ${pr.why ? `<p style="margin: 0 0 10px; font-size: 13px; line-height: 1.5; color: var(--ink2)">${esc(pr.why)}</p>` : ""}
    <div class="tbl"><table style="min-width: 0"><tbody>${pr.rows.map(row).join("")}</tbody></table></div>`;
}

// ---------------------------------------------------------------- player search
function fillPlayerSearch() {
  const dl = $("playerList");
  if (!dl || !M.hist) return;
  const wk = state.data.meta.week;
  M.searchIndex = Object.entries(M.hist.players)
    .filter(([, e]) => ["WR", "TE", "RB", "QB"].includes(e.p) && Object.keys(e.w).some((w) => +w <= wk))
    .map(([id, e]) => ({ id, label: `${e.n} — ${teamAbbr(e.t)} ${e.p}` }))
    .sort((a, b) => a.label.localeCompare(b.label));
  dl.innerHTML = M.searchIndex.map((x) => `<option value="${esc(x.label)}"></option>`).join("");
}
function findPlayer(text) {
  const t = text.trim().toLowerCase();
  if (!t || !M.searchIndex) return null;
  return M.searchIndex.find((x) => x.label.toLowerCase() === t) ||
         M.searchIndex.find((x) => x.label.toLowerCase().startsWith(t)) ||
         M.searchIndex.find((x) => x.label.toLowerCase().includes(t)) || null;
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
  if (e.p === "QB" && qbHasData()) return renderQbDrawer(focus);
  const wk = state.data.meta.week, tm = M.hist.teams?.[e.t];
  // QBs have no target or carry share, so their bars show share of team yards.
  const kind = M.pkind || (e.p === "RB" ? "car" : e.p === "QB" ? "yds" : "tgt"), dkind = kind === "car" ? "run" : "pass";
  const idx = kind === "tgt" ? { share: 1, vol: 0 } : kind === "car" ? { share: 3, vol: 2 } : { share: 4, vol: 2 };
  const unit = kind === "tgt" ? "targets" : kind === "car" ? "RB carries" : "team yards";
  const shareName = kind === "tgt" ? "Target share" : kind === "car" ? "Carry share" : "Share of team yards";
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
    const ov = x.opp && defRank(x.opp, x.w, "overall"), ovm = ov && (ov.inn || ov.season);
    const dline = r ? `${esc(x.opp)} ${dkind} D: ${r.inn ? `${ordinal(r.inn.rank)} going in` : "no earlier games"}${r.season ? ` · ${ordinal(r.season.rank)} season` : ""}${ovm ? `\nOverall D: ${ordinal(ovm.rank)}${ov.inn ? " going in" : " season"}` : ""}` : x.opp ? `${esc(x.opp)}: not ranked (FCS)` : "";
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
      <div style="flex: 1; min-width: 0"><h2 id="pTitle">${esc(e.n)}</h2><div class="muted" style="font-size: 13px">${tb(e.t)} ${esc(e.t)} · ${esc(e.p)}${sdom != null ? ` · season dominator ${R(sdom)}%` : ""}</div></div>
      <button type="button" class="x" data-act="close" aria-label="Close player detail">${ICON_X}</button></div>
    ${kindSw}
    <div class="tiles">
      <div class="tile" ${tipAttr(`<b>${shareName}, last ${recent.length || 3} games</b>\nAverage of his weekly shares`)}><div class="k">Last ${recent.length || 3} games</div><div class="v" style="color: var(--up)">${pct(avg(recent))}</div><div class="muted" style="font-size: 11px">${shareName.toLowerCase()}</div></div>
      <div class="tile" ${tipAttr(`<b>${shareName}, earlier games</b>\nAverage of his weekly shares before his last 3 games`)}><div class="k">Earlier games</div><div class="v">${pct(avg(before))}</div><div class="muted" style="font-size: 11px">${shareName.toLowerCase()}</div></div>
      <div class="tile"><div class="k">${kind === "tgt" ? "Targets" : kind === "car" ? "Carries" : "Carries"} / game</div><div class="v">${volPer == null ? "–" : volPer.toFixed(1)}</div><div class="muted" style="font-size: 11px">games played</div></div>
    </div>
    <h3 style="margin: 18px 0 0; font-size: 13px">${kind === "tgt" ? "Target share" : kind === "car" ? "Carry share" : "Share of team yards"} by week <span class="muted" style="font-weight: 400">· hover or tap a week</span></h3>
    <div class="weeks" style="${cols}">${bars}</div>
    <div class="wkx" style="${cols}">${weeks.map((x) => `<span>W${x.w}</span>`).join("")}</div>
    <div class="strip" style="${cols}">${strip}</div>
    <div class="muted" style="margin-top: 6px; font-size: 11px">Color strip = how tough each opponent's ${dkind} defense was going into the game (red = tough, green = soft)</div>
    <div class="callout">${shares.length ? `${R(avg(shares))}% of ${unit} over ${plural(shares.length, "game")} this season.` : "No usage recorded yet."}
      ${opps.length ? ` His last ${opps.length} opponents' ${dkind} defenses ranked <b>${ordinal(R(mean(opps)))}</b> on average (1st = toughest).` : ""}
      ${nextOpp ? `<br>Week ${wk} opponent: ${esc(nextOpp.name)}, ${dkind} D ranked ${chip(nextOpp.name, wk, dkind)}` : ""}</div>
    ${DRAWER_EXTRAS.map((f) => f(M.player, e)).join("")}
    ${isFree() ? lockBox({ need: "data", title: "Where he ranks", body: "Members see where every player ranks on each list, and why he's on or off it.", rows: 4, compact: true }) : ranksSection(M.player)}
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
  if (CLICK_ACTS[act]) return CLICK_ACTS[act](val, a);
  if (act === "close") return closeDrawer();
  if (act === "tier") return setTier(val);
  if (act === "theme") return setTheme(val);
  if (act === "join") { a.textContent = "Sign-up opens soon"; a.disabled = true; return; }
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
  if (act.startsWith("lb-")) {
    const k = act.slice(3);
    M.lb[k] = val;
    if (k !== "sort") M.lb.sort = null;      // a new board starts on its headline column
    // QBs have their own boards; switching position in or out of QB picks a matching board.
    if (M.lb.pos === "QB" && !QB_BOARDS[M.lb.board]) M.lb.board = "pass";
    if (M.lb.pos !== "QB" && !BOARD_LABEL[M.lb.board]) M.lb.board = "share";
    render();
    document.querySelector(`[data-act="${act}"][data-val="${val}"]`)?.focus();
    return;
  }
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
$("findForm").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const hit = findPlayer($("find").value);
  $("findMsg").textContent = hit ? "" : "No player found with that name.";
  if (hit) { $("find").value = ""; openPlayer(hit.id); }
});
$("find").addEventListener("change", () => { const hit = M.searchIndex?.find((x) => x.label === $("find").value); if (hit) { $("find").value = ""; openPlayer(hit.id); } });
$("conf").addEventListener("change", (e) => { state.conf = e.target.value; fillTeams(); render(); });
$("team").addEventListener("change", (e) => { state.team = e.target.value; render(); });
$("dm").addEventListener("change", (e) => { state.dm = e.target.value; render(); if (M.player) renderDrawer(); });
$("week").addEventListener("change", (e) => loadMembersWeek(e.target.value));

// premium.js (loaded after this file) registers its pages, then calls start().
function start() { readHash(); fillViewSwitch(); fillThemeSwitch(); boot(); }
if (!window.PREMIUM_PENDING) start();
