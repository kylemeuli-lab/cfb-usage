// Freshman Watch (Pro): true freshmen (this year's recruiting class) at WR, TE and RB, ranked by
// their share of the offense, with week-by-week trend and recruiting profile.
"use strict";

const FR_TITLE = `Freshman Watch <span class="pro" aria-label="Pro feature">Pro</span>`;
const FR = { data: undefined, pos: "WR", sort: "last3", q: "" };

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
    if (state.conf === "fbs" && tm?.k !== "fbs") continue;
    if (!["fbs", "all"].includes(state.conf) && tm?.c !== state.conf) continue;
    if (!anyPos && e.p !== FR.pos) continue;
    const isRb = e.p === "RB", si = isRb ? 3 : 1;
    const games = Object.entries(e.w).filter(([w]) => +w <= wk).map(([w, a]) => ({ w: +w, a })).sort((a, b) => a.w - b.w);
    const sh = games.filter((g) => g.a[si] != null);
    if (!sh.length) continue;
    const avg = (xs) => (xs.length ? xs.reduce((s, g) => s + g.a[si], 0) / xs.length : null);
    const last3 = sh.slice(-3), before = sh.slice(0, -3);
    const n = games.length, sum = (i) => games.reduce((s, g) => s + (g.a[i] || 0), 0);
    out.push({
      id, e, rec, isRb, si, games, n,
      season: avg(sh), last3: avg(last3), before: avg(before),
      delta: before.length ? avg(last3) - avg(before) : null,
      tgtPg: sum(0) / n, carPg: sum(2) / n, ydsPg: (sum(6) + sum(7)) / n, td: sum(8),
      lastWeek: games[games.length - 1].w,
    });
  }
  const key = {
    last3: (r) => -r.last3, season: (r) => -r.season, delta: (r) => -(r.delta ?? -999),
    yds: (r) => -r.ydsPg, usage: (r) => -(r.rec.usage ?? -1), stars: (r) => -(r.rec.stars * 10000 - (r.rec.rank ?? 9999)),
  }[FR.sort] || ((r) => -r.last3);
  return out.sort((a, b) => key(a) - key(b));
}

function frSpark(r) {
  const wk = state.data.meta.week, W = 120, H = 30, bw = W / wk;
  const bars = [];
  for (let w = 1; w <= wk; w++) {
    const g = r.games.find((x) => x.w === w), v = g?.a[r.si];
    if (v == null) { bars.push(`<rect x="${(w - 1) * bw + 1}" y="${H - 2}" width="${bw - 2}" height="2" fill="#E3E8EF"></rect>`); continue; }
    const h = Math.max(2, Math.min(H, (H * v) / 60));
    bars.push(`<rect x="${(w - 1) * bw + 1}" y="${H - h}" width="${bw - 2}" height="${h}" rx="1.5" fill="${w === wk ? "#3B6FE0" : "#A9BCE9"}"></rect>`);
  }
  const desc = r.games.filter((g) => g.a[r.si] != null).map((g) => `week ${g.w} ${R(g.a[r.si])}%`).join(", ");
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(desc)}">${bars.join("")}</svg>`;
}

const starsOf = (n) => (n ? `<span class="stars" aria-label="${n}-star recruit">${"★".repeat(n)}</span>` : `<span class="dim">Unrated</span>`);

function renderFreshmen() {
  if (FR.data === undefined) { FR.data = null; loadFreshmen(); return topBar(FR_TITLE) + `<div class="loading">Loading…</div>`; }
  if (!FR.data) return topBar(FR_TITLE) + `<div class="card empty">Freshman data isn't available yet.</div>`;
  const q = FR.q.trim().toLowerCase();
  const all = freshmanRows();
  const rows = all.filter((r) => !q || r.e.n.toLowerCase().includes(q) || r.e.t.toLowerCase().includes(q));
  const shown = rows.slice(0, 100);
  const wk = state.data.meta.week;
  const segF = (key, opts, label) => `<div class="seg" role="group" aria-label="${label}">${opts.map(([v, t]) =>
    `<button type="button" data-act="fr" data-key="${key}" data-val="${v}" aria-pressed="${FR[key] === v}">${t}</button>`).join("")}</div>`;
  const controls = segF("pos", [["WR", "WR"], ["TE", "TE"], ["RB", "RB"]], "Position") +
    `<label><span class="sr">Search freshmen</span><input type="search" id="frq" placeholder="Search players or teams" value="${esc(FR.q)}"></label>`;
  // headline cards across all positions (ignoring the search box)
  const pool = freshmanRows(true);
  const best = (f) => pool.filter(f).sort((a, b) => b.last3 - a.last3)[0];
  const rec = best((r) => !r.isRb && r.n >= 2), back = best((r) => r.isRb && r.n >= 2);
  const riser = pool.filter((r) => r.delta != null && r.games.slice(-3).reduce((s, g) => s + g.a[r.isRb ? 2 : 0], 0) >= (r.isRb ? 15 : 9)).sort((a, b) => b.delta - a.delta)[0];
  const card = (r, k, v, s, cls = "") => r ? `<button type="button" class="head ${cls}" data-player="${r.id}"><div class="k">${k}</div>
      <div class="n">${esc(r.e.n)} <span class="muted">${esc(teamAbbr(r.e.t))} ${r.e.p}</span></div><div class="v">${v}</div><div class="s">${s}</div></button>` : "";
  const cards = `<div class="heads">
    ${card(rec, "Top freshman receiver", `${R(rec?.last3)}%`, `of team targets, last ${Math.min(3, rec?.n || 0)} games · ${rec ? starsOf(rec.rec.stars) : ""}`)}
    ${card(back, "Top freshman back", `${R(back?.last3)}%`, `of RB carries, last ${Math.min(3, back?.n || 0)} games · ${back ? starsOf(back.rec.stars) : ""}`)}
    ${card(riser, "Biggest riser", riser ? `${R(riser.before)}% → ${R(riser.last3)}%` : "", riser ? `of ${riser.isRb ? "RB carries" : "team targets"}: earlier games → last 3 games` : "", "tan")}
    ${card(pool.length ? pool.slice().sort((a, b) => (b.rec.usage ?? 0) - (a.rec.usage ?? 0))[0] : null, "Highest usage rate", pool.length ? `${R(100 * (pool.slice().sort((a, b) => (b.rec.usage ?? 0) - (a.rec.usage ?? 0))[0].rec.usage || 0))}%` : "", "of his team's plays: a run, catch or target for him")}
  </div>`;
  const th = (k, label, tip) => `<th scope="col" ${tip ? tipAttr(tip) : ""}><button type="button" data-act="fr" data-key="sort" data-val="${k}" aria-label="Sort by ${label}">${label}${FR.sort === k ? " ▾" : ""}</button></th>`;
  const body = shown.map((r, i) => {
    const d = r.delta;
    const trend = d == null || Math.abs(d) < 0.5 ? `<span class="dim">–</span>` : `<span style="color: var(${d >= 0 ? "--up" : "--down"}); font-weight: 700">${d >= 0 ? "▲" : "▼"} ${R(Math.abs(d))}</span>`;
    const unit = r.isRb ? "car" : "tgt";
    return `<tr><td class="dim">${i + 1}</td>
      <td class="l">${pbtn(r.id, r.e.n)} <span class="pos">${esc(teamAbbr(r.e.t))} ${esc(r.e.p)}</span>
        <div class="sub">${starsOf(r.rec.stars)}${r.rec.rank && r.rec.rank <= 500 ? ` · No. ${r.rec.rank} nationally` : ""}${r.rec.rpos && r.rec.rpos !== r.e.p ? ` · recruited as ${esc(r.rec.rpos)}` : ""}</div></td>
      <td class="l">${frSpark(r)}</td>
      <td><b>${pct(r.last3)}</b></td><td>${pct(r.season)}</td><td>${trend}</td>
      <td>${(r.isRb ? r.carPg : r.tgtPg).toFixed(1)} <span class="dim">${unit}</span></td>
      <td>${r.ydsPg.toFixed(1)}</td><td>${r.rec.usage == null ? `<span class="dim">–</span>` : `${R(100 * r.rec.usage)}%`}</td><td>${r.n}</td></tr>`;
  }).join("");
  const table = `<section class="card"><div class="tbl" style="border: 0; border-radius: 16px"><table><thead><tr>
      <th scope="col">#</th><th scope="col" class="l">Player</th>
      <th scope="col" class="l" ${tipAttr("<b>Share by week</b>\nOne bar per week: target share for WR/TE, carry share for RB. Blue = the latest week; a flat gray line = no touches that week.")}>By week</th>
      ${th("last3", "Last 3", "<b>Share, last 3 games</b>\nTarget share (WR/TE) or carry share (RB)")}
      ${th("season", "Season", "<b>Share, season average</b>")}
      ${th("delta", "Trend", "<b>Change in share</b>\nLast 3 games minus his earlier games, in percentage points. ▲ 8 = 8 points higher lately.")}
      <th scope="col" ${tipAttr("<b>Targets (WR/TE) or carries (RB) per game</b>\nGames he played")}>Per game</th>
      ${th("yds", "Yds/g", "<b>Rushing + receiving yards per game</b>")}
      ${th("usage", "Usage", "<b>Usage rate</b>\nThe share of all his team's plays that went to him: a carry, a catch or a target. Season to date, from CollegeFootballData.")}
      <th scope="col" ${tipAttr("<b>Games played</b>\nGames with at least one touch")}>Games</th></tr></thead>
    <tbody>${body || `<tr><td colspan="10" class="dim">No freshmen match.</td></tr>`}</tbody></table></div>
    ${rows.length > shown.length ? `<p class="muted" style="margin: 0; padding: 12px 16px; font-size: 12px">Showing 100 of ${rows.length}. Search to find anyone else.</p>` : ""}</section>`;
  const side = `<section class="card pad"><h2 style="font-size: 18px">Why freshmen</h2>
      <p style="margin: 6px 0 0; font-size: 13px; color: var(--ink2); line-height: 1.55">Earning a real share of the offense as a true freshman is one of the better early signs of a future star: it shows up in our prospect model, and high recruiting rank is one of its biggest inputs. This page tracks every ${FR.data.class} recruit at WR, TE and RB with a touch this season. Sort by Trend to find the ones whose role is growing.</p></section>
    <section class="card pad"><h2 style="font-size: 18px">How to read it</h2>
      <p style="margin: 6px 0 0; font-size: 13px; color: var(--ink2); line-height: 1.55">Shares are target share for receivers and tight ends, carry share for backs. Last 3 is his last three games with a touch; Trend compares that with his earlier games. Usage is CFBD's rate of plays involving him, updated with the weekly refresh. Snap counts aren't available for college.</p></section>`;
  return topBar(FR_TITLE, controls) +
    `<p class="muted" style="margin: -6px 0 16px">${all.length} true freshman ${FR.pos}s (${FR.data.class} recruiting class) with a touch through week ${wk}. Click a player for his card.</p>
    ${cards}<div class="cols"><div class="wide">${table}</div><div class="narrow">${side}</div></div>`;
}

PAGES.freshmen = renderFreshmen;
CLICK_ACTS.fr = (val, a) => {
  FR[a.dataset.key] = val; render();
  document.querySelector(`[data-act="fr"][data-key="${a.dataset.key}"][data-val="${val}"]`)?.focus();
};
document.addEventListener("input", (ev) => {
  if (ev.target.id !== "frq") return;
  FR.q = ev.target.value; const pos = ev.target.selectionStart; render();
  const el = $("frq"); el.focus(); el.setSelectionRange(pos, pos);
});
