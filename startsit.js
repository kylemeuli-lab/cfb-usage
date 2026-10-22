// Who to start? (Pro): compare up to four players for next week in the reader's scoring
// format. Recommends the highest projection and explains the gap in plain words.
"use strict";

const SS = { ids: [], msg: "" };
try { const v = JSON.parse(localStorage.getItem("cff-startsit") || "[]"); if (Array.isArray(v)) SS.ids = v.slice(0, 4); } catch (_) {}
const saveSS = () => { try { localStorage.setItem("cff-startsit", JSON.stringify(SS.ids)); } catch (_) {} };

/** "Michael Hawkins Jr." -> "Hawkins" */
const lastName = (n) => { const w = n.split(" ").filter((x) => !/^(jr|sr|ii|iii|iv|v)\.?$/i.test(x)); return w[w.length - 1] || n; };
/** Everything the comparison needs for one player. */
function ssFacts(p) {
  if (p.pos === "QB") return ssQbFacts(p);
  const n = p.next, isRb = p.pos === "RB", kind = isRb ? "run" : "pass";
  const r = n ? defRank(n.opp, 0, kind) : null;
  // role trend from the season history: share over his last 3 games vs. his earlier games
  const e = M.hist?.players?.[p.id], si = isRb ? 3 : 1;
  const sh = e ? Object.entries(e.w).map(([w, a]) => [+w, a[si]]).filter(([, v]) => v != null).sort((a, b) => a[0] - b[0]) : [];
  const avg = (xs) => (xs.length ? xs.reduce((t, [, v]) => t + v, 0) / xs.length : null);
  const last3 = avg(sh.slice(-3)), before = avg(sh.slice(0, -3));
  return {
    p, n, isRb, kind, pts: nextPts(p), touches: n ? n.tgt + n.car : 0,
    oppRank: r?.season?.rank ?? null, oppN: r?.n ?? null, implied: n?.implied ?? null, td: n?.td ?? 0, rec: n?.rec ?? 0,
    last3, before, trend: last3 != null && before != null ? last3 - before : null, share: isRb ? "carries" : "targets",
  };
}

/** QBs: the role trend is his share of team pass attempts; yards are passing + rushing. */
function ssQbFacts(p) {
  const n = p.next, r = n ? defRank(n.opp, 0, "pass") : null;
  const g = typeof qbGames === "function" ? qbGames(p.id) : [];
  const avg = (xs) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : null);
  const sh = g.filter((x) => x.tAtt).map((x) => (100 * x.att) / x.tAtt);
  const last3 = avg(sh.slice(-3)), before = avg(sh.slice(0, -3));
  return {
    p, n, isRb: false, isQb: true, kind: "pass", pts: nextPts(p), touches: n ? n.att : 0,
    oppRank: r?.season?.rank ?? null, oppN: r?.n ?? null, implied: n?.implied ?? null,
    td: n ? n.passTd + n.rushTd : 0, rec: 0, passYds: n?.passYds ?? 0, rushYds: n?.rushYds ?? 0,
    last3, before, trend: last3 != null && before != null ? last3 - before : null, share: "his team's pass attempts",
  };
}
const ssWhy = (a, b) => {
  // Reasons a (higher projection) is ahead of b, biggest first.
  const out = [];
  if (a.isQb && b.isQb) {
    if (a.rushYds - b.rushYds >= 15) out.push(`More running: about ${a.rushYds} rushing yards projected vs. ${b.rushYds}`);
    if (a.passYds - b.passYds >= 30) out.push(`More passing: about ${a.passYds} passing yards projected vs. ${b.passYds}`);
  } else if (a.isQb !== b.isQb) {
    if (a.isQb) out.push(`QBs score more: he's projected for ${a.passYds} passing and ${a.rushYds} rushing yards`);
  } else
  // Touches compare like for like (back vs. back, receiver vs. receiver); across positions, yards do.
  if (a.isQb || b.isQb) { /* handled above */ }
  else if (a.isRb === b.isRb) { if (a.touches - b.touches >= 1.5) out.push(`More work: about ${a.touches.toFixed(0)} ${a.isRb ? "touches (carries + targets)" : "targets"} vs. ${b.touches.toFixed(0)}`); }
  else if (a.n && b.n && a.n.yds - b.n.yds >= 15) out.push(`More yards: about ${a.n.yds} projected vs. ${b.n.yds}`);
  if (a.oppRank != null && b.oppRank != null && a.oppRank - b.oppRank >= 20)
    out.push(`Softer matchup: ${a.n.opp}'s ${a.kind} D ranks ${ordinal(a.oppRank)}, ${b.n.opp}'s ${b.kind} D ranks ${ordinal(b.oppRank)}`);
  if (a.implied != null && b.implied != null && a.implied - b.implied >= 3)
    out.push(`Higher-scoring game: his team is expected to score ${Math.round(a.implied)}, ${lastName(b.p.name)}'s ${Math.round(b.implied)}`);
  if (a.td - b.td >= 0.15) out.push(`More TD chances: ${a.td.toFixed(1)} projected TDs vs. ${b.td.toFixed(1)}`);
  if (FORMATS[PR.fmt][1] > 0 && a.rec - b.rec >= 1.5) out.push(`More catches (${a.rec.toFixed(1)} vs. ${b.rec.toFixed(1)}), which count in ${FORMATS[PR.fmt][0]}`);
  if (PR.tep && a.p.pos === "TE" && b.p.pos !== "TE") out.push("TE premium adds 0.5 per catch for him");
  if (a.trend != null && a.trend >= 5 && (b.trend == null || b.trend < a.trend - 5))
    out.push(`Role growing: ${Math.round(a.last3)}% of ${a.share} his last 3 games, up from ${Math.round(a.before)}%`);
  return out;
};
const ssFlags = (f) => {
  const out = [];
  if (!f.n) out.push("On a bye this week");
  if (f.p.missedLast) out.push("Missed his team's last game: check his status");
  else if (f.isQb && f.p.startedLast === false) out.push("Didn't lead his team in pass attempts last game: check who's starting");
  if (f.oppRank != null && f.oppN && f.oppRank <= f.oppN / 5) out.push(`Tough matchup: ${f.n.opp}'s ${f.kind} D ranks ${ordinal(f.oppRank)}`);
  if (f.trend != null && f.trend <= -5) out.push(`Role shrinking: ${Math.round(f.last3)}% of ${f.share} his last 3 games, down from ${Math.round(f.before)}%`);
  return out;
};

function renderStartSit() {
  if (!PR.ready) { loadPremium().then(render); return topBar(`Who to start? ${PRO_BADGE}`) + `<div class="loading">Loading…</div>`; }
  if (!PR.proj) return topBar(`Who to start? ${PRO_BADGE}`) + notReady("Projections");
  const d = PR.proj;
  const picks = SS.ids.map((id) => PR.jById.get(String(id))).filter(Boolean);
  const facts = picks.map(ssFacts).sort((a, b) => (b.pts ?? -1) - (a.pts ?? -1));
  const list = d.players.map((p) => `<option value="${esc(`${p.name} — ${teamAbbr(p.team)} ${p.pos}`)}"></option>`).join("");
  const add = `<form id="ssForm" class="ss-add" role="search"><label><span class="sr">Add a player</span>
      <input type="search" id="ssq" list="ssList" placeholder="${picks.length >= 4 ? "Four players max: remove one to add another" : "Add a player: name or team"}" autocomplete="off" ${picks.length >= 4 ? "disabled" : ""}></label>
      <datalist id="ssList">${list}</datalist><button type="submit" class="btn" ${picks.length >= 4 ? "disabled" : ""}>Add</button>
      ${SS.msg ? `<span class="muted" style="font-size: 12px">${esc(SS.msg)}</span>` : ""}</form>`;
  let verdict = "", cards = "";
  if (facts.length) {
    const top = facts[0], second = facts[1];
    if (!second) verdict = `<p class="muted">Add at least one more player to compare.</p>`;
    else if (top.pts == null) verdict = `<div class="verdict">None of these players has a game in week ${d.nextWeek}.</div>`;
    else {
      const gap = top.pts - (second.pts ?? 0), why = ssWhy(top, second);
      const close = gap < 1;
      verdict = `<div class="verdict${close ? " close" : ""}"><div class="k">${close ? "Close call" : "Start"}</div>
        <div class="v">${esc(top.p.name)} ${tb(top.p.team)}</div>
        <p>${close ? `He and ${esc(second.p.name)} are within a point (${pf1(top.pts)} vs. ${pf1(second.pts)}), so either is a fine play.` : `Projected ${pf1(top.pts)} points, ${gap.toFixed(1)} more than ${esc(second.p.name)}.`}
          ${why.length ? ` The edge: ${esc(why[0].charAt(0).toLowerCase() + why[0].slice(1))}.` : ""}</p></div>`;
    }
    cards = `<div class="ss-grid">${facts.map((f, i) => {
      const n = f.n, isTop = i === 0 && f.pts != null && facts.length > 1;
      // the starter: why he's ahead of the next-best; everyone else: what he has going for him, and the gap
      const reasons = isTop ? ssWhy(f, facts[1] || f) : facts[0].pts != null && f.pts != null && f.n && facts[0].n ? ssWhy(f, facts[0]) : [];
      const behind = !isTop && facts[0].pts != null && f.pts != null ? `${(facts[0].pts - f.pts).toFixed(1)} points behind ${facts[0].p.name}` : "";
      const flags = ssFlags(f);
      const badge = facts.length < 2 ? "" : isTop ? `<span class="ss-badge start">${facts[1] && f.pts - facts[1].pts < 1 ? "Slight edge" : "Start"}</span>` : `<span class="ss-badge bench">Bench</span>`;
      return `<article class="card ss-card${isTop ? " is-top" : ""}">
        <div class="ss-head">${badge}<button type="button" class="x sm" data-act="ss-remove" data-val="${esc(f.p.id)}" aria-label="Remove ${esc(f.p.name)}">${ICON_X}</button></div>
        <h3>${pbtn(f.p.id, f.p.name)}</h3><div class="muted" style="font-size: 13px">${tb(f.p.team)} ${esc(f.p.pos)}${n ? ` · ${n.home ? "vs." : "at"} ${esc(n.opp)} ${nextChip(n.opp, f.kind)}` : " · bye"}</div>
        <div class="ss-pts"><b>${f.pts == null ? "–" : pf1(f.pts)}</b><span>projected points</span></div>
        ${n ? `<div class="ss-line">${f.isQb ? `${R(n.att)} att · ${n.passYds} pass yds · ${(+n.passTd).toFixed(1)} TD · ${(+n.int).toFixed(1)} INT · ${R(n.car)} car · ${n.rushYds} rush yds`
            : `${f.isRb ? `${pf1(n.car)} car · ` : ""}${pf1(n.tgt)} tgt · ${pf1(n.rec)} rec · ${n.yds} yds · ${(+n.td).toFixed(1)} TD`}</div>
          <div class="ss-line muted">${f.implied != null ? `Team expected to score ${Math.round(f.implied)}` : "No betting line yet"}${f.last3 != null ? ` · ${Math.round(f.last3)}% of ${f.share} last 3` : ""}</div>` : ""}
        ${behind ? `<div class="ss-line" style="margin-top: 10px; font-weight: 600">${esc(behind)}</div>` : ""}
        ${reasons.length || flags.length ? `<ul class="ss-why">${reasons.map((r) => `<li class="good">${esc(r)}</li>`).join("")}${flags.map((r) => `<li class="bad">${esc(r)}</li>`).join("")}</ul>` : ""}
      </article>`;
    }).join("")}</div>`;
  }
  const empty = !facts.length ? `<section class="card pad"><h2 style="font-size: 18px">Compare up to four players</h2>
      <p style="margin: 6px 0 0; font-size: 13px; color: var(--ink2)">Search for the players you're deciding between. We'll show each one's week ${d.nextWeek} projection in your scoring format and tell you who to start and why: workload, matchup, how many points his team is expected to score, TD chances and whether his role is growing.</p></section>` : "";
  const hasQb = picks.some((p) => p.pos === "QB");
  return topBar(`Who to start? ${PRO_BADGE}`, fmtControls() + (hasQb ? ptdControls() : "")) +
    `<p class="muted" style="margin: -6px 0 16px">Week ${d.nextWeek} · ${esc(fmtName())} (${esc(fmtRule())})${hasQb ? `; QBs ${esc(qbRule())}` : ""}. Based on our projections, which assume each player plays.</p>
    ${add}${empty}${verdict}${cards}`;
}

function ssAdd(text) {
  const t = text.trim().toLowerCase();
  if (!t) return;
  const label = (p) => `${p.name} — ${teamAbbr(p.team)} ${p.pos}`.toLowerCase();
  const all = PR.proj?.players || [];
  const hit = all.find((p) => label(p) === t) || all.find((p) => label(p).startsWith(t)) || all.find((p) => label(p).includes(t));
  if (!hit) SS.msg = "No player found with that name.";
  else if (SS.ids.includes(hit.id)) SS.msg = `${hit.name} is already in the comparison.`;
  else { SS.ids.push(hit.id); SS.ids = SS.ids.slice(0, 4); SS.msg = ""; saveSS(); }
  render();
  document.getElementById("ssq")?.focus();
}

PAGES.startsit = renderStartSit;
CLICK_ACTS["ss-remove"] = (val) => { SS.ids = SS.ids.filter((x) => String(x) !== String(val)); saveSS(); render(); };
document.addEventListener("submit", (ev) => {
  if (ev.target.id !== "ssForm") return;
  ev.preventDefault();
  ssAdd(document.getElementById("ssq").value);
});
document.addEventListener("change", (ev) => {
  if (ev.target.id !== "ssq") return;
  const v = ev.target.value, all = PR.proj?.players || [];
  if (all.some((p) => `${p.name} — ${teamAbbr(p.team)} ${p.pos}` === v)) ssAdd(v);
});
