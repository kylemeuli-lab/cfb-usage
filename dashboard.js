// Dashboard (index.html) page wiring; shared code is in app.js.
"use strict";
// ---------------------------------------------------------------- events
$("conf").addEventListener("change", (e) => { state.conf = e.target.value; render(); });
$("ap").addEventListener("change", (e) => { state.ap = e.target.checked; render(); });
$("allp").addEventListener("change", (e) => { state.all = e.target.checked; render(); });
$("sort").addEventListener("change", (e) => { state.sort = e.target.value; render(); });
$("dm").addEventListener("change", (e) => { state.dm = e.target.value; render(); });
$("q").addEventListener("input", (e) => { state.q = e.target.value; render(); });
$("week").addEventListener("change", (e) => loadWeek(e.target.value));
$("grid").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-post]");
  if (!btn) return;
  const g = state.data.games.find((x) => String(x.id) === btn.dataset.post);
  openPost(btn.dataset.kind, [g]);
});
document.querySelectorAll("[data-postall]").forEach((b) =>
  b.addEventListener("click", (e) => {
    // Pickups needs a Fantrax export; shift-click (or no file yet) picks a new one.
    if (b.dataset.postall === "pickups" && (!FANTRAX.rows || e.shiftKey)) { $("fantraxFile").click(); return; }
    openPost(b.dataset.postall, visibleGames());
  }));
$("fantraxFile").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try { loadFantrax(await f.text(), f.name, f.lastModified); }
  catch (err) { alert(`Couldn't read that file: ${err.message}`); return; }
  e.target.value = "";
  openPost("pickups", visibleGames());
});
$("postClose").addEventListener("click", () => $("postDialog").close());
$("postDialog").addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

init();
