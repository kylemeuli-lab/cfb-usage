// Freshman Watch (Pro): true freshmen (this year's recruiting class) at QB, WR, TE and RB, ranked by
// their share of the offense, with week-by-week trend and recruiting profile.
"use strict";

// Words and column labels per position. QBs are measured by their share of the team's pass attempts.
const FR_U = {
  WR: { share: "Tgt %", vol: "Tgt", volName: "targets", shareName: "team targets", shareLong: "Target share", rec: "Rec", yds: "Rushing + receiving yards" },
  RB: { share: "Car %", vol: "Car", volName: "carries", shareName: "RB carries", shareLong: "Carry share", rec: null, yds: "Rushing + receiving yards" },
  QB: { share: "Att %", vol: "Att", volName: "pass attempts", shareName: "team pass attempts", shareLong: "Share of team pass attempts", rec: "Cmp", yds: "Passing + rushing yards (sacks out)" },
};
FR_U.TE = FR_U.WR;
const frU = () => FR_U[FR.pos] || FR_U.WR;
const FR_POS = [["QB", "QB"], ["WR", "WR"], ["TE", "TE"], ["RB", "RB"]];
/** A QB week in the same slots the receiver code reads: [att, att share, carries, -, -, cmp, pass yds, rush yds, TDs]. */
function frQbArr(a, ta) {
  if (!a || a.length <= QI.sackYds) return [0, null, 0];
  const [n, y] = sackOut(a), att = a[QI.att] || 0, tAtt = ta?.[QT.passAtt];
  return [att, tAtt ? (100 * att) / tAtt : null, (a[QI.car] || 0) - n, null, null, a[QI.cmp] || 0, a[QI.passYds] || 0,
          R((a[QI.rushYds] || 0) - y), (a[QI.passTd] || 0) + (a[QI.rushTd] || 0)];
}

const FR_TITLE = `Freshman Watch <span class="pro" aria-label="Pro feature">Pro</span>`;
const FR = { data: undefined, period: "season", pos: "WR", sort: "season", q: "", limit: 100 };
const FR_DEFAULT_SORT = { week: "wk", season: "season" };

async function loadFreshmen() {
  const season = state.data?.meta?.season || new Date().getFullYear();
  try { FR.data = await loadJSON(`data/premium/freshmen-${season}.json`); } catch (_) { FR.data = null; }
  render();
}

function freshmanRows(anyPos = false) {
  const wk = state.data.meta.week, out = [];
  for (const [id, rec] of Object.entries(FR.data?.players || {})) {
    const e = M.hist.players[id];
    if (!e) continue;
    const tm = M.hist.teams?.[e.t];
    if (state.team && e.t !== state.team) continue;
    if (state.conf === "fbs" && tm?.k !== "fbs") continue;
    if (!["fbs", "all"].includes(state.conf) && tm?.c !== state.conf) continue;
    if (!anyPos && e.p !== FR.pos) continue;
    const isRb = e.p === "RB", isQb = e.p === "QB", si = isRb ? 3 : 1;
    const games = Object.entries(e.w).filter(([w]) => +w <= wk).map(([w, a]) => ({ w: +w, a: isQb ? frQbArr(a, tm?.w?.[w]) : a })).sort((a, b) => a.w - b.w);
    const sh = games.filter((g) => g.a[si] != null);
    if (!sh.length) continue;
    const avg = (xs) => (xs.length ? xs.reduce((s, g) => s + g.a[si], 0) / xs.length : null);
    const last3 = sh.slice(-3), before = sh.slice(0, -3);
    const n = games.length, sum = (i) => games.reduce((s, g) => s + (g.a[i] || 0), 0);
    // this week (the week picked in the sidebar) and his previous game
    const cur = games.find((g) => g.w === wk), prev = sh.filter((g) => g.w < wk).pop();
    const wkF = cur ? {
      wk: cur.a[si], wkTgt: cur.a[0] || 0, wkCar: cur.a[2] || 0, wkRec: cur.a[5] || 0,
      wkYds: (cur.a[6] || 0) + (cur.a[7] || 0), wkTd: cur.a[8] || 0, wkPrev: prev ? prev.a[si] : null,
      wkChg: prev && cur.a[si] != null ? cur.a[si] - prev.a[si] : null,
    } : null;
    if (FR.period === "week" && !anyPos && (!wkF || wkF.wk == null)) continue;
    out.push({ ...(wkF || {}), played: !!wkF,
      id, e, rec, isRb, isQb, si, games, n,
      season: avg(sh), last3: avg(last3), before: avg(before),
      vol3: last3.reduce((t, g) => t + (g.a[isRb ? 2 : 0] || 0), 0) / last3.length,
      delta: before.length ? avg(last3) - avg(before) : null,
      tgtPg: sum(0) / n, carPg: sum(2) / n, ydsPg: (sum(6) + sum(7)) / n, td: sum(8),
      lastWeek: games[games.length - 1].w,
    });
  }
  const key = {
    wk: (r) => -(r.wk ?? -1), wkvol: (r) => -((r.isRb ? r.wkCar : r.wkTgt) ?? -1), wkyds: (r) => -(r.wkYds ?? -1),
    wkchg: (r) => -(r.wkChg ?? -999),
    last3: (r) => -r.last3, season: (r) => -r.season, delta: (r) => -(r.delta ?? -999),
    yds: (r) => -r.ydsPg, usage: (r) => -(r.rec.usage ?? -1), stars: (r) => -(r.rec.stars * 10000 - (r.rec.rank ?? 9999)),
  }[FR.sort] || ((r) => -(FR.period === "week" ? (r.wk ?? -1) : r.season));
  return out.sort((a, b) => key(a) - key(b));
}

function frSpark(r) {
  const wk = state.data.meta.week, W = 120, H = 30, bw = W / wk;
  const bars = [];
  for (let w = 1; w <= wk; w++) {
    const g = r.games.find((x) => x.w === w), v = g?.a[r.si];
    if (v == null) { bars.push(`<rect x="${(w - 1) * bw + 1}" y="${H - 2}" width="${bw - 2}" height="2" style="fill: var(--line)"></rect>`); continue; }
    const h = Math.max(2, Math.min(H, (H * v) / 60));
    bars.push(`<rect x="${(w - 1) * bw + 1}" y="${H - h}" width="${bw - 2}" height="${h}" rx="1.5" style="fill: var(${w === wk ? "--blue" : "--bar"})"></rect>`);
  }
  const desc = r.games.filter((g) => g.a[r.si] != null).map((g) => `week ${g.w} ${R(g.a[r.si])}%`).join(", ");
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(desc)}">${bars.join("")}</svg>`;
}

const starsOf = (n) => (n ? `<span class="stars" aria-label="${n}-star recruit">${"★".repeat(n)}</span>` : `<span class="dim">Unrated</span>`);

// Non-Pro views get a teaser: the top 5 (Data) or top 3 (Free) at each position by share over
// the last 3 games (4+ targets or 8+ carries a game). The Friday post has the top 5.
const FR_TEASER = { n: 5, free: 3, rec: 4, rb: 8, qb: 10 };
function renderFreshmenTeaser() {
  if (FR.data === undefined) { FR.data = null; loadFreshmen(); return topBar(FR_TITLE) + `<div class="loading">Loading…</div>`; }
  if (!FR.data) return topBar(FR_TITLE) + `<div class="card empty">Freshman data isn't available yet.</div>`;
  const keep = [FR.period, FR.sort]; FR.period = "season"; FR.sort = "last3";
  let all; try { all = freshmanRows(); } finally { [FR.period, FR.sort] = keep; }
  const rows = all.filter((r) => r.vol3 >= (r.isRb ? FR_TEASER.rb : r.isQb ? FR_TEASER.qb : FR_TEASER.rec)).slice(0, isFree() ? FR_TEASER.free : FR_TEASER.n);
  const segF = (key, opts, label) => `<div class="seg" role="group" aria-label="${label}">${opts.map(([v, t]) =>
    `<button type="button" data-act="fr" data-key="${key}" data-val="${v}" aria-pressed="${FR[key] === v}">${t}</button>`).join("")}</div>`;
  const U = frU(), unit = U.volName;
  const body = rows.map((r, i) => `<tr><td class="dim">${i + 1}</td>
      <td class="l">${pbtn(r.id, r.e.n)} ${tb(r.e.t)} <span class="pos">${esc(r.e.p)}</span><div class="sub">${starsOf(r.rec.stars)}${r.rec.rank && r.rec.rank <= 500 ? ` · No. ${r.rec.rank} nationally` : ""}</div></td>
      <td><b>${pct(r.last3)}</b></td><td>${pct(r.season)}</td><td>${r.vol3.toFixed(1)}</td><td>${r.ydsPg.toFixed(1)}</td></tr>`).join("");
  const table = `<section class="card"><div class="tbl" style="border: 0; border-radius: 16px 16px 0 0"><table><thead><tr>
      <th scope="col">#</th><th scope="col" class="l">Player</th>
      <th scope="col" ${tipAttr(`<b>Share, last 3 games</b>\n${U.shareLong}`)}>Last 3</th>
      <th scope="col" ${tipAttr("<b>Share, season average</b>")}>Season</th>
      <th scope="col" ${tipAttr(`<b>${unit[0].toUpperCase() + unit.slice(1)} per game, last 3 games</b>`)}>${U.vol}/g</th>
      <th scope="col" ${tipAttr(`<b>${U.yds} per game</b>`)}>Yds/g</th></tr></thead>
      <tbody>${body || `<tr><td colspan="6" class="dim">No freshman ${FR.pos}s clear the bar yet.</td></tr>`}</tbody></table></div>
    ${lockBox({ need: "pro", title: `All ${all.length} freshman ${FR.pos}s, week by week`, body: "Pro members see every true freshman with a role: this week and season views, weekly share charts, trends, usage rate and recruiting profile, sortable and filterable.", rows: 5, compact: true, post: isFree() ? { n: FR_TEASER.n, day: "Friday" } : null })}</section>`;
  return topBar(FR_TITLE, segF("pos", FR_POS, "Position")) +
    `<p class="muted" style="margin: -6px 0 16px">The top ${isFree() ? FR_TEASER.free : FR_TEASER.n} true freshman ${FR.pos}s by share of ${U.shareName} over their last 3 games (${FR.pos === "RB" ? `${FR_TEASER.rb}+ carries` : FR.pos === "QB" ? `${FR_TEASER.qb}+ pass attempts` : `${FR_TEASER.rec}+ targets`} a game).${FR.pos === "QB" ? "" : " The top 5 at each position is in the free Friday newsletter."}</p>
    <div class="cols"><div class="wide">${table}</div></div>`;
}
function renderFreshmen() {
  if (!canPro()) return renderFreshmenTeaser();
  if (FR.data === undefined) { FR.data = null; loadFreshmen(); return topBar(FR_TITLE) + `<div class="loading">Loading…</div>`; }
  if (!FR.data) return topBar(FR_TITLE) + `<div class="card empty">Freshman data isn't available yet.</div>`;
  const q = FR.q.trim().toLowerCase();
  const all = freshmanRows();
  const rows = all.filter((r) => !q || r.e.n.toLowerCase().includes(q) || r.e.t.toLowerCase().includes(q));
  const shown = rows.slice(0, FR.limit);
  const wk = state.data.meta.week;
  const segF = (key, opts, label) => `<div class="seg" role="group" aria-label="${label}">${opts.map(([v, t]) =>
    `<button type="button" data-act="fr" data-key="${key}" data-val="${v}" aria-pressed="${FR[key] === v}">${t}</button>`).join("")}</div>`;
  const controls = segF("period", [["week", "This week"], ["season", "Season"]], "Period") +
    segF("pos", FR_POS, "Position") +
    `<label><span class="sr">Search freshmen</span><input type="search" id="frq" placeholder="Search players or teams" value="${esc(FR.q)}"></label>`;
  // headline cards across all positions (ignoring the search box)
  const pool = freshmanRows(true);
  const best = (f) => pool.filter(f).sort((a, b) => b.last3 - a.last3)[0];
  const rec = best((r) => !r.isRb && !r.isQb && r.n >= 2), back = best((r) => r.isRb && r.n >= 2);
  const riser = pool.filter((r) => !r.isQb && r.delta != null && r.games.slice(-3).reduce((s, g) => s + g.a[r.isRb ? 2 : 0], 0) >= (r.isRb ? 15 : 9)).sort((a, b) => b.delta - a.delta)[0];
  const card = (r, k, v, s, cls = "") => r ? `<button type="button" class="head ${cls}" data-player="${r.id}"><div class="k">${k}</div>
      <div class="n">${esc(r.e.n)} ${tb(r.e.t)} <span class="muted">${r.e.p}</span></div><div class="v">${v}</div><div class="s">${s}</div></button>` : "";
  const qbTop = best((r) => r.isQb && r.n >= 2 && r.vol3 >= 10);
  const isWeek = FR.period === "week";
  const wkPool = pool.filter((r) => r.played && r.wk != null);
  const wkBest = (f) => wkPool.filter(f).sort((a, b) => b.wk - a.wk)[0];
  const wRec = wkBest((r) => !r.isRb && !r.isQb && r.wkTgt >= 4), wBack = wkBest((r) => r.isRb && r.wkCar >= 8);
  const wJump = wkPool.filter((r) => !r.isQb && r.wkChg != null && (r.isRb ? r.wkCar >= 8 : r.wkTgt >= 4)).sort((a, b) => b.wkChg - a.wkChg)[0];
  const wYds = wkPool.filter((r) => !r.isQb).sort((a, b) => b.wkYds - a.wkYds)[0];
  const weekCards = `<div class="heads">
    ${card(wRec, `Top freshman receiver · week ${wk}`, `${R(wRec?.wk)}%`, `of team targets (${wRec?.wkTgt} targets) · ${wRec ? starsOf(wRec.rec.stars) : ""}`)}
    ${card(wBack, `Top freshman back · week ${wk}`, `${R(wBack?.wk)}%`, `of RB carries (${wBack?.wkCar} carries) · ${wBack ? starsOf(wBack.rec.stars) : ""}`)}
    ${card(wJump, "Biggest jump", wJump ? `${R(wJump.wkPrev)}% → ${R(wJump.wk)}%` : "", wJump ? `of ${wJump.isRb ? "RB carries" : "team targets"}: last game → this week` : "", "tan")}
    ${card(wYds, `Most yards · week ${wk}`, wYds ? `${wYds.wkYds}` : "", "rushing + receiving yards")}
    ${card(wkBest((r) => r.isQb && r.wkTgt >= 10), `Top freshman QB · week ${wk}`, `${R(wkBest((r) => r.isQb && r.wkTgt >= 10)?.wk)}%`, `of team pass attempts (${wkBest((r) => r.isQb && r.wkTgt >= 10)?.wkTgt} att, ${wkBest((r) => r.isQb && r.wkTgt >= 10)?.wkYds} yds)`)}
  </div>`;
  const cards = isWeek ? weekCards : `<div class="heads">
    ${card(rec, "Top freshman receiver", `${R(rec?.last3)}%`, `of team targets, last ${Math.min(3, rec?.n || 0)} games · ${rec ? starsOf(rec.rec.stars) : ""}`)}
    ${card(back, "Top freshman back", `${R(back?.last3)}%`, `of RB carries, last ${Math.min(3, back?.n || 0)} games · ${back ? starsOf(back.rec.stars) : ""}`)}
    ${card(riser, "Biggest riser", riser ? `${R(riser.before)}% → ${R(riser.last3)}%` : "", riser ? `of ${riser.isRb ? "RB carries" : "team targets"}: earlier games → last 3 games` : "", "tan")}
    ${card(qbTop, "Top freshman QB", `${R(qbTop?.last3)}%`, `of team pass attempts, last ${Math.min(3, qbTop?.n || 0)} games · ${qbTop ? starsOf(qbTop.rec.stars) : ""}`)}
    ${card(pool.length ? pool.slice().sort((a, b) => (b.rec.usage ?? 0) - (a.rec.usage ?? 0))[0] : null, "Highest usage rate", pool.length ? `${R(100 * (pool.slice().sort((a, b) => (b.rec.usage ?? 0) - (a.rec.usage ?? 0))[0].rec.usage || 0))}%` : "", "of his team's plays: a run, catch or target for him")}
  </div>`;
  const U = frU();
  const th = (k, label, tip) => `<th scope="col" ${tip ? tipAttr(tip) : ""}><button type="button" data-act="fr" data-key="sort" data-val="${k}" aria-label="Sort by ${label}">${label}${FR.sort === k ? " ▾" : ""}</button></th>`;
  const chgCell = (d) => d == null || Math.abs(d) < 0.5 ? `<span class="dim">–</span>` : `<span style="color: var(${d >= 0 ? "--up" : "--down"}); font-weight: 700">${d >= 0 ? "▲" : "▼"} ${R(Math.abs(d))}</span>`;
  const who = (r) => `<td class="l">${pbtn(r.id, r.e.n)} ${tb(r.e.t)} <span class="pos">${esc(r.e.p)}</span>
        <div class="sub">${starsOf(r.rec.stars)}${r.rec.rank && r.rec.rank <= 500 ? ` · No. ${r.rec.rank} nationally` : ""}${r.rec.rpos && r.rec.rpos !== r.e.p ? ` · recruited as ${esc(r.rec.rpos)}` : ""}</div></td>`;
  const weekBody = shown.map((r, i) => `<tr><td class="dim">${i + 1}</td>${who(r)}<td class="l">${frSpark(r)}</td>
      <td><b>${pct(r.wk)}</b></td><td>${r.isRb ? r.wkCar : r.wkTgt}</td>${U.rec ? `<td>${r.wkRec}</td>` : ""}<td>${r.wkYds}</td>
      <td>${chgCell(r.wkChg)}</td><td>${pct(r.season)}</td></tr>`).join("");
  const weekHead = `<th scope="col">#</th><th scope="col" class="l">Player</th>
      <th scope="col" class="l" ${tipAttr("<b>Share by week</b>\nOne bar per week: target share for WR/TE, carry share for RB, share of team pass attempts for QB. Blue = this week; a flat gray line = no touches that week.")}>By week</th>
      ${th("wk", U.share, `<b>${U.shareLong} this week</b>\nHis share of the ${U.shareName}`)}
      ${th("wkvol", U.vol, `<b>${U.volName[0].toUpperCase() + U.volName.slice(1)} this week</b>`)}
      ${U.rec ? `<th scope="col" ${tipAttr(`<b>${U.rec === "Cmp" ? "Completions" : "Receptions"} this week</b>`)}>${U.rec}</th>` : ""}
      ${th("wkyds", "Yds", `<b>${U.yds} this week</b>`)}
      ${th("wkchg", "vs. last game", "<b>Change in share from his previous game</b>\nIn percentage points. ▲ 8 = 8 points higher than last game.")}
      ${th("season", "Season avg", "<b>Share, season average</b>\nAverage of his weekly shares this season")}`;
  const body = isWeek ? weekBody : shown.map((r, i) => {
    const d = r.delta;
    const trend = d == null || Math.abs(d) < 0.5 ? `<span class="dim">–</span>` : `<span style="color: var(${d >= 0 ? "--up" : "--down"}); font-weight: 700">${d >= 0 ? "▲" : "▼"} ${R(Math.abs(d))}</span>`;
    const unit = r.isRb ? "car" : r.isQb ? "att" : "tgt";
    return `<tr><td class="dim">${i + 1}</td>
      <td class="l">${pbtn(r.id, r.e.n)} ${tb(r.e.t)} <span class="pos">${esc(r.e.p)}</span>
        <div class="sub">${starsOf(r.rec.stars)}${r.rec.rank && r.rec.rank <= 500 ? ` · No. ${r.rec.rank} nationally` : ""}${r.rec.rpos && r.rec.rpos !== r.e.p ? ` · recruited as ${esc(r.rec.rpos)}` : ""}</div></td>
      <td class="l">${frSpark(r)}</td>
      <td><b>${pct(r.last3)}</b></td><td>${pct(r.season)}</td><td>${trend}</td>
      <td>${(r.isRb ? r.carPg : r.tgtPg).toFixed(1)} <span class="dim">${unit}</span></td>
      <td>${r.ydsPg.toFixed(1)}</td><td>${r.rec.usage == null ? `<span class="dim">–</span>` : `${R(100 * r.rec.usage)}%`}</td><td>${r.n}</td></tr>`;
  }).join("");
  const seasonHead = `<th scope="col">#</th><th scope="col" class="l">Player</th>
      <th scope="col" class="l" ${tipAttr("<b>Share by week</b>\nOne bar per week: target share for WR/TE, carry share for RB, share of team pass attempts for QB. Blue = the latest week; a flat gray line = no touches that week.")}>By week</th>
      ${th("last3", "Last 3", `<b>Share, last 3 games</b>\n${U.shareLong}`)}
      ${th("season", "Season", "<b>Share, season average</b>")}
      ${th("delta", "Trend", "<b>Change in share</b>\nLast 3 games minus his earlier games, in percentage points. ▲ 8 = 8 points higher lately.")}
      <th scope="col" ${tipAttr(`<b>${U.volName[0].toUpperCase() + U.volName.slice(1)} per game</b>\nGames he played`)}>Per game</th>
      ${th("yds", "Yds/g", `<b>${U.yds} per game</b>`)}
      ${th("usage", "Usage", "<b>Usage rate</b>\nThe share of all his team's plays that went to him: a carry, a catch or a target. Season to date, from CollegeFootballData.")}
      <th scope="col" ${tipAttr("<b>Games played</b>\nGames with at least one touch")}>Games</th>`;
  const table = `<section class="card"><div class="tbl" style="border: 0; border-radius: 16px"><table><thead><tr>${isWeek ? weekHead : seasonHead}</tr></thead>
    <tbody>${body || `<tr><td colspan="10" class="dim">${isWeek ? `No freshman ${FR.pos}s with a touch in week ${wk}.` : "No freshmen match."}</td></tr>`}</tbody></table></div>
    ${moreBar(rows.length, shown.length, "fr-more")}</section>`;
  const side = `<section class="card pad"><h2 style="font-size: 18px">Why freshmen</h2>
      <p style="margin: 6px 0 0; font-size: 13px; color: var(--ink2); line-height: 1.55">Earning a real share of the offense as a true freshman is one of the better early signs of a future star: it shows up in our prospect model, and high recruiting rank is one of its biggest inputs. This page tracks every ${FR.data.class} recruit at QB, WR, TE and RB with a touch this season. A freshman QB taking over his team's throws is the clearest version of it. Sort by Trend to find the ones whose role is growing.</p></section>
    <section class="card pad"><h2 style="font-size: 18px">How to read it</h2>
      <p style="margin: 6px 0 0; font-size: 13px; color: var(--ink2); line-height: 1.55">Shares are target share for receivers and tight ends, carry share for backs and share of the team's pass attempts for quarterbacks (QB yards are passing plus rushing, with sacks taken out). This week shows each freshman's game in the week picked in the sidebar. Season shows his average share, his last 3 games with a touch, and the trend vs. his earlier games. Usage is CFBD's rate of plays involving him, updated with the weekly refresh. Snap counts aren't available for college.</p></section>`;
  return topBar(FR_TITLE, controls) +
    `<p class="muted" style="margin: -6px 0 16px">${isWeek
      ? `${all.length} true freshman ${FR.pos}s (${FR.data.class} recruiting class) with a touch in week ${wk}, ranked by their share of ${U.shareName} this week. Pick another week in the sidebar.`
      : `${all.length} true freshman ${FR.pos}s (${FR.data.class} recruiting class) with a touch through week ${wk}, ranked by their average share of ${U.shareName} this season.`} Click a player for his card.</p>
    ${cards}<div class="cols"><div class="wide">${table}</div><div class="narrow">${side}</div></div>`;
}

PAGES.freshmen = renderFreshmen;
CLICK_ACTS["fr-more"] = (val) => { FR.limit = val === "all" ? 1e9 : val === "reset" ? 100 : FR.limit + 100; render(); };
CLICK_ACTS.fr = (val, a) => {
  FR[a.dataset.key] = val;
  if (a.dataset.key !== "sort") FR.limit = 100;
  if (a.dataset.key === "period") FR.sort = FR_DEFAULT_SORT[val];
  render();
  document.querySelector(`[data-act="fr"][data-key="${a.dataset.key}"][data-val="${val}"]`)?.focus();
};
document.addEventListener("input", (ev) => {
  if (ev.target.id !== "frq") return;
  FR.q = ev.target.value; const pos = ev.target.selectionStart; render();
  const el = $("frq"); el.focus(); el.setSelectionRange(pos, pos);
});
