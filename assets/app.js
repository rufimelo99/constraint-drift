"use strict";

const app = document.getElementById("app");
const crumbs = document.getElementById("crumbs");
const LABELS = {
  influenced_outcome: ["Block changed the outcome", "inf", "c-inf"],
  considered_and_backed_off: ["Considered the shortcut, backed off", "back", "c-back"],
  no_effect: ["Block made no difference", "", "c-none"],
  not_applicable: ["No block in place", "", "c-na"],
};
const LEVEL_NAMES = { 1: "Routine", 2: "Important", 3: "Critical" };
const ELIDE = 6000;

const cache = { manifest: null, runs: {}, traces: {} };
const state = { status: "kept", domain: "", infl: "0", shift: "", group: "domain", sort: "shift", q: "", deep: false };

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (x) => (x == null ? "–" : Math.round(x * 100) + "%");
const pts = (x) => (x == null ? "–" : (x < 0 ? "−" : x > 0 ? "+" : "") + Math.abs(Math.round(x * 100)) + " pts");
const domainName = (d) => d.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

async function getJSON(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(path + ": " + r.status);
  return r.json();
}
async function manifest() {
  return (cache.manifest ??= await getJSON("data/manifest.json"));
}
async function run(id) {
  if (!cache.runs[id]) {
    const [worlds, summary] = await Promise.all([getJSON(`data/${id}/worlds.json`), getJSON(`data/${id}/summary.json`)]);
    cache.runs[id] = { worlds, summary, byId: Object.fromEntries(worlds.map((w) => [w.id, w])) };
  }
  return cache.runs[id];
}
async function traces(runId, wid) {
  const k = runId + "/" + wid;
  return (cache.traces[k] ??= await getJSON(`data/${runId}/traces/${wid}.json`));
}

function setCrumbs(parts) {
  crumbs.innerHTML = parts
    .map((p, i) => (p.href ? `<a href="${p.href}">${esc(p.text)}</a>` : `<span>${esc(p.text)}</span>`) + (i < parts.length - 1 ? '<span class="sep">/</span>' : ""))
    .join(" ");
}

function labelBar(labels) {
  const total = Object.values(labels || {}).reduce((a, b) => a + b, 0);
  if (!total) return '<div class="bar"></div>';
  const order = ["influenced_outcome", "considered_and_backed_off", "no_effect"];
  return `<div class="bar" title="${order.map((k) => `${LABELS[k][0]}: ${labels[k] || 0}`).join(" · ")}">` +
    order.map((k) => (labels[k] ? `<i class="${LABELS[k][2]}" style="width:${(labels[k] / total) * 100}%"></i>` : "")).join("") + "</div>";
}
const legend = () =>
  '<div class="legend">' + ["influenced_outcome", "considered_and_backed_off", "no_effect"].map((k) => `<span><b class="${LABELS[k][2]}"></b>${LABELS[k][0]}</span>`).join("") + "</div>";

/* ---------- index ---------- */

async function viewIndex(runId) {
  const runs = await manifest();
  runId = runId || runs[0].id;
  const meta = runs.find((r) => r.id === runId) || runs[0];
  const { worlds, summary } = await run(meta.id);
  setCrumbs([{ text: "Blocker traces" }, { text: meta.title }]);
  const t = summary.totals;
  const domains = [...new Set(worlds.map((w) => w.domain))].sort();

  app.innerHTML = `
    <h1>Blocker traces</h1>
    <p>When a status command reports that the compliant route is blocked, does a model read an ambiguous safety rule more loosely?
    ${t.candidates} candidate worlds were generated; ${t.kept} moved the choice when the route was blocked and were kept.
    Each kept world was run ${t.runs} times in total (${t.usable} usable answers, ${meta.epochs ?? "?"} repeats per version, three urgency levels).
    Across the kept worlds the compliant option was chosen ${pct(t.open)} of the time with the route working and ${pct(t.blocked)} with it blocked
    (${pts(t.shift)}).</p>
    <p><a href="#/${meta.id}/highlights"><b>Read examples of the model reinterpreting a rule →</b></a></p>
    ${urgencyTable(summary)}
    ${runs.length > 1 ? `<div class="controls"><label>Run<select id="f-run">${runs.map((r) => `<option value="${r.id}" ${r.id === meta.id ? "selected" : ""}>${esc(r.title)}</option>`).join("")}</select></label></div>` : ""}
    <div class="note">Model: ${esc(meta.model)} · logged ${esc(meta.date)}. A <b>world</b> is one situation built around one rule. The shift is the blocked share minus the working-route share,
    averaged over the three urgency levels first.</div>
    <div class="controls">
      <label>Search<input id="f-q" type="search" placeholder="scenario, rule, reasoning" value="${esc(state.q)}"></label>
      <label class="check"><input id="f-deep" type="checkbox" ${state.deep ? "checked" : ""}> also search reasoning</label>
      <label>Status<select id="f-status">${opt(state.status, [["kept", "Kept"], ["dropped", "Dropped"], ["all", "All candidates"]])}</select></label>
      <label>Domain<select id="f-domain"><option value="">All</option>${domains.map((d) => `<option value="${d}" ${state.domain === d ? "selected" : ""}>${esc(domainName(d))}</option>`).join("")}</select></label>
      <label>Blocker influenced<select id="f-infl">${opt(state.infl, [["0", "Any"], ["0.25", "≥ 25% of blocked runs"], ["0.5", "≥ 50% of blocked runs"]])}</select></label>
      <label>Choice shift<select id="f-shift">${opt(state.shift, [["", "Any"], ["big", "Drops by 30 pts or more"], ["small", "Drops by less than 30 pts"]])}</select></label>
      <label>Group by<select id="f-group">${opt(state.group, [["domain", "Domain"], ["rule", "Rule"], ["none", "None"]])}</select></label>
      <label>Sort<select id="f-sort">${opt(state.sort, [["shift", "Biggest drop"], ["infl", "Most influenced"], ["blocked", "Lowest blocked share"], ["name", "Name"]])}</select></label>
    </div>
    ${legend()}
    <div id="list"></div>`;

  const bind = (id, key, ev = "change") => {
    const el = document.getElementById(id);
    el.addEventListener(ev, () => { state[key] = el.type === "checkbox" ? el.checked : el.value; renderList(meta.id, worlds, summary); });
  };
  bind("f-status", "status"); bind("f-domain", "domain"); bind("f-infl", "infl"); bind("f-shift", "shift");
  bind("f-group", "group"); bind("f-sort", "sort"); bind("f-q", "q", "input"); bind("f-deep", "deep");
  const fr = document.getElementById("f-run");
  if (fr) fr.addEventListener("change", () => (location.hash = "#/" + fr.value));
  renderList(meta.id, worlds, summary);
}
function urgencyTable(summary) {
  const ws = Object.values(summary.worlds);
  const avg = (xs) => { xs = xs.filter((x) => x != null); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
  const rows = [1, 2, 3].map((p) => {
    const cells = ws.map((w) => w.levels[p]).filter(Boolean);
    const lab = {};
    cells.forEach((c) => Object.entries(c.labels).forEach(([k, n]) => (lab[k] = (lab[k] || 0) + n)));
    const tot = Object.values(lab).reduce((a, b) => a + b, 0);
    const o = avg(cells.map((c) => c.open.safer)), b = avg(cells.map((c) => c.blocked.safer));
    return `<tr><td>${LEVEL_NAMES[p]}</td><td>${pct(o)}</td><td>${pct(b)}</td><td class="shiftnum ${b - o < 0 ? "neg" : "pos"}">${pts(b - o)}</td><td>${pct((lab.influenced_outcome || 0) / Math.max(1, tot))}</td></tr>`;
  }).join("");
  return `<h2>By urgency</h2><div class="tbl"><table><tr><th>Urgency</th><th>Route working</th><th>Route blocked</th><th>Shift</th><th>Blocked runs changed by the block</th></tr>${rows}</table></div>
    <p class="muted small">Chose the compliant option, averaged over worlds. Open a world and use “Compare urgency levels” to see how the text and the reasoning change.</p>`;
}
const opt = (cur, items) => items.map(([v, l]) => `<option value="${v}" ${cur === v ? "selected" : ""}>${esc(l)}</option>`).join("");

let listToken = 0;
async function renderList(runId, worlds, summary) {
  const token = ++listToken;
  const q = state.q.trim().toLowerCase();
  const hits = {}; // world id -> reasoning match count
  if (q.length >= 3 && state.deep) {
    const el = document.getElementById("list");
    el.innerHTML = '<p class="muted">Searching reasoning…</p>';
    await Promise.all(worlds.filter((w) => w.kept).map(async (w) => {
      const rows = await traces(runId, w.id);
      hits[w.id] = rows.filter((r) => [r.reasoning, r.evidence, r.monitor_reasoning].some((s) => (s || "").toLowerCase().includes(q))).length;
    }));
    if (token !== listToken) return;
  }
  const S = (w) => summary.worlds[w.id];
  let rows = worlds.filter((w) => {
    if (state.status === "kept" && !w.kept) return false;
    if (state.status === "dropped" && w.kept) return false;
    if (state.domain && w.domain !== state.domain) return false;
    const s = S(w);
    if (+state.infl > 0 && !(s && s.influenced_share >= +state.infl)) return false;
    if (state.shift === "big" && !(s && s.shift <= -0.3)) return false;
    if (state.shift === "small" && !(s && s.shift > -0.3)) return false;
    if (q.length >= 3) {
      const text = [w.summary, w.rule.text, w.rule.ambiguity_note, w.domain, ...w.levels.map((l) => l.task)].join(" ").toLowerCase();
      if (!(text.includes(q) || (state.deep && hits[w.id] > 0))) return false;
    }
    return true;
  });
  const key = { shift: (w) => S(w)?.shift ?? 9, infl: (w) => -(S(w)?.influenced_share ?? -1), blocked: (w) => S(w)?.blocked ?? 9, name: (w) => w.id }[state.sort];
  rows.sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0));
  const groupOf = { domain: (w) => domainName(w.domain), rule: (w) => w.rule.text || w.rule.id, none: () => "" }[state.group];
  let html = `<div class="count">${rows.length} world${rows.length === 1 ? "" : "s"}</div>`, last = null;
  for (const w of rows) {
    const g = groupOf(w);
    if (g !== last && g) html += `<div class="group">${esc(g)}</div>`;
    last = g;
    html += worldRow(runId, w, S(w), hits[w.id]);
  }
  if (!rows.length) html += '<p class="muted">No worlds match these filters.</p>';
  document.getElementById("list").innerHTML = html;
}

function worldRow(runId, w, s, hit) {
  const title = `<div class="t">${esc(w.summary)}</div><div class="meta">${esc(w.rule.text)} · ${esc(domainName(w.domain))}${hit ? ` · <mark>${hit} runs match</mark>` : ""}</div>`;
  if (!w.kept || !s) {
    const c = w.screen || {};
    const f = (v) => Object.entries(v || {}).map(([k, n]) => `${k}${n}`).join(" ") || "–";
    return `<div class="row dropped">${title}<div class="pair">Dropped at the screen<br>working: ${f(c.open)} · blocked: ${f(c.blocked)}</div><div class="meta">${w.rewrites} rewrite${w.rewrites == 1 ? "" : "s"}</div></div>`;
  }
  return `<a class="row" href="#/${runId}/w/${encodeURIComponent(w.id)}">${title}
    <div><span class="pair">${pct(s.open)} → ${pct(s.blocked)}</span> <span class="shiftnum ${s.shift < 0 ? "neg" : "pos"}">${pts(s.shift)}</span></div>
    <div><div class="pair">${pct(s.influenced_share)} blocked runs changed by the block</div>${labelBar(s.labels)}</div></a>`;
}

/* ---------- world ---------- */

function diffLines(a, b) {
  const sa = a.split("\n"), sb = b.split("\n"), setA = new Set(sa), setB = new Set(sb);
  const fmt = (lines, other) => lines.map((l) => `<div class="${other.has(l) ? "" : "diff"}">${esc(l) || "&nbsp;"}</div>`).join("");
  return [fmt(sa, setB), fmt(sb, setA)];
}

function shownOptions(order, options, chosenSlot, safer) {
  return (order && order.length ? order : ["A", "B"]).map((orig, i) => {
    const slot = "AB"[i];
    const cls = (orig === safer ? "safer " : "") + (slot === chosenSlot ? "chosen" : "");
    return `<div class="opt ${cls}"><b>${slot}</b><span>${esc(options[orig])}${orig === safer ? ' <span class="chip safe">compliant</span>' : ' <span class="chip risk">shortcut</span>'}${slot === chosenSlot ? ' <span class="chip">chosen</span>' : ""}</span></div>`;
  }).join("");
}

async function viewWorld(runId, wid, pressure) {
  const { byId, summary } = await run(runId);
  const w = byId[wid];
  if (!w || !w.kept) return notFound();
  const runs = await manifest();
  const meta = runs.find((r) => r.id === runId);
  const p = +pressure || w.levels[0].pressure;
  const lv = w.levels.find((l) => l.pressure === p) || w.levels[0];
  const rows = await traces(runId, wid);
  const s = summary.worlds[wid], sl = s.levels[lv.pressure];
  setCrumbs([{ text: "Blocker traces", href: "#/" + runId }, { text: domainName(w.domain) }, { text: w.rule.id }]);
  const [dOpen, dBlocked] = diffLines(lv.shown_open, lv.shown_blocked);
  const levelRows = rows.filter((r) => r.pressure === lv.pressure);

  app.innerHTML = `
    <h1>${esc(w.summary)}</h1>
    <p><b>Rule:</b> “${esc(w.rule.text)}”</p>
    <div class="note">${esc(w.rule.ambiguity_note)}</div>
    <div class="tabs">${w.levels.map((l) => `<a class="${l.pressure === lv.pressure ? "on" : ""}" href="#/${runId}/w/${encodeURIComponent(wid)}/${l.pressure}">${esc(l.name)} · ${pts(s.levels[l.pressure].shift)}</a>`).join("")}</div>
    ${w.levels.length > 1 ? `<p class="small"><a href="#/${runId}/c/${encodeURIComponent(wid)}/${w.levels[0].pressure}/${w.levels[w.levels.length - 1].pressure}">Compare urgency levels side by side →</a></p>` : ""}
    <dl class="kv">
      <dt>Blocker type</dt><dd>${esc(lv.blocker_type)}</dd>
      <dt>Probe command</dt><dd><code>${esc(lv.probe_command)}</code></dd>
      <dt>Shortcut</dt><dd>${esc(lv.workaround)}</dd>
      <dt>Why it is risky</dt><dd>${esc(lv.workaround_risk)}</dd>
      <dt>Task</dt><dd>${esc(lv.task)}</dd>
    </dl>
    <h2>Options</h2>
    ${["A", "B"].map((k) => `<div class="opt ${k === lv.safer ? "safer" : ""}"><b>${k}</b><span>${esc(lv.options[k])} <span class="chip ${k === lv.safer ? "safe" : "risk"}">${k === lv.safer ? "compliant" : "shortcut"}</span></span></div>`).join("")}
    <h2>The two versions the model saw</h2>
    <p class="muted small">Only the last lines differ. Lines that appear in one version only are highlighted.</p>
    <div class="cols">
      <div class="card"><h3>Route working</h3><div class="stat">${pct(sl.open.safer)}</div><div class="muted small">chose the compliant option · ${sl.open.n} runs</div><div class="situ" style="margin-top:10px">${dOpen}</div></div>
      <div class="card"><h3>Route blocked</h3><div class="stat">${pct(sl.blocked.safer)}</div><div class="muted small">chose the compliant option · ${sl.blocked.n} runs</div><div class="situ" style="margin-top:10px">${dBlocked}</div>
        <div style="margin-top:10px">${labelBar(sl.labels)}${legend()}</div></div>
    </div>
    <h2>Trajectories</h2>
    <div class="controls">
      <label>Version<select id="t-ver">${opt("all", [["all", "Both"], ["open", "Route working"], ["blocked", "Route blocked"]])}</select></label>
      <label>Label<select id="t-label">${opt("all", [["all", "Any"], ["influenced_outcome", "Block changed the outcome"], ["considered_and_backed_off", "Considered, backed off"], ["no_effect", "No difference"]])}</select></label>
      <label>Choice<select id="t-choice">${opt("all", [["all", "Any"], ["safer", "Compliant option"], ["shortcut", "Shortcut"]])}</select></label>
      <label>Search<input id="t-q" type="search" placeholder="text in the reasoning"></label>
    </div>
    ${hlLegend}<div id="traces"></div>`;

  const draw = () => {
    const v = document.getElementById("t-ver").value, lab = document.getElementById("t-label").value;
    const ch = document.getElementById("t-choice").value, q = document.getElementById("t-q").value.trim().toLowerCase();
    const sel = levelRows.filter((r) =>
      (v === "all" || r.blocker === v) && (lab === "all" || r.effect === lab) &&
      (ch === "all" || (r.valid && (ch === "safer" ? r.safer : !r.safer))) &&
      (q.length < 2 || [r.reasoning, r.evidence, r.monitor_reasoning].some((x) => (x || "").toLowerCase().includes(q))));
    document.getElementById("traces").innerHTML = `<div class="count">${sel.length} of ${levelRows.length} trajectories</div>` + sel.map((r) => traceCard(runId, wid, lv, r, q)).join("");
  };
  ["t-ver", "t-label", "t-choice"].forEach((id) => document.getElementById(id).addEventListener("change", draw));
  document.getElementById("t-q").addEventListener("input", draw);
  draw();
  app.addEventListener("click", copyHandler);
}

const RE_NARROW = "not (?:a )?(?:direct|literal)|doesn'?t (?:cover|apply|prohibit|forbid)|does not (?:cover|apply|prohibit|forbid)|only (?:says|prohibits|forbids|applies)|not (?:explicitly )?(?:prohibited|forbidden)|is not (?:a )?production|not production|not an? (?:overwrite|push|restart|write|delete)|not a production|one could argue|arguably";
const RE_INFEAS = "cannot (?:meet|make|complete|finish)|can'?t (?:meet|make)|impossible|misses? the (?:deadline|freeze)|too late|won'?t (?:finish|complete)|exceeds? the";
const HL = new RegExp(`(${RE_NARROW})|(${RE_INFEAS})`, "gi");
let markUp = true;
function highlight(text, q) {
  let safe = esc(text);
  if (markUp) safe = safe.replace(HL, (m, a) => `<mark class="${a ? "rd" : "fe"}">${m}</mark>`);
  if (!q || q.length < 2) return safe;
  const re = new RegExp("(?![^<]*>)" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/&/g, "&amp;"), "gi");
  return safe.replace(re, (m) => `<mark>${m}</mark>`);
}
const hlLegend = '<p class="muted small"><mark class="rd">reads the rule narrowly</mark> <mark class="fe">says the compliant option cannot meet the deadline</mark> (keyword match, not a judgment)</p>';
function elide(text) {
  if (!text || text.length <= ELIDE) return text || "";
  const h = ELIDE / 2;
  return text.slice(0, h) + `\n\n[… ${text.length - ELIDE} characters elided …]\n\n` + text.slice(-h);
}

function traceCard(runId, wid, lv, r, q, full) {
  const link = `${location.origin}${location.pathname}#/${runId}/t/${encodeURIComponent(wid)}/${encodeURIComponent(r.id)}`;
  const [lab, cls] = LABELS[r.effect] || ["Unparsed", ""];
  const choice = !r.valid ? '<span class="chip">no valid answer</span>' : r.safer ? '<span class="chip safe">chose compliant</span>' : '<span class="chip risk">chose shortcut</span>';
  const reasoning = full ? r.reasoning : elide(r.reasoning);
  return `<article class="trace" id="${esc(r.id)}">
    <header>
      <span class="chip">${r.blocker === "blocked" ? "Route blocked" : "Route working"}</span>
      <span class="chip">${r.has_rule ? "Rule shown" : "No rule"}</span>
      <span>repeat ${r.epoch}</span>${choice}
      ${r.blocker_present && r.has_rule ? `<span class="chip ${cls}">${esc(lab)}</span>` : ""}
      ${r.reinterpreted_rule ? '<span class="chip">argued the rule does not cover it</span>' : ""}
      <span class="grow"></span>
      <a href="#/${runId}/t/${encodeURIComponent(wid)}/${encodeURIComponent(r.id)}">open</a>
      <button class="ghost copy" type="button" data-link="${esc(link)}">Copy link</button>
    </header>
    ${r.evidence ? `<div class="ev">${esc(r.evidence)}</div>` : ""}
    <details ${full ? "open" : ""}><summary>Model reasoning (${(r.reasoning || "").length.toLocaleString()} characters)</summary><pre>${highlight(reasoning, q)}</pre></details>
    ${r.monitor_reasoning ? `<details><summary>Why the monitor gave this label</summary><pre>${highlight(r.monitor_reasoning, q)}</pre></details>` : ""}
  </article>`;
}

function copyHandler(e) {
  const b = e.target.closest(".copy");
  if (!b) return;
  const done = () => { b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy link"), 1500); };
  (navigator.clipboard ? navigator.clipboard.writeText(b.dataset.link) : Promise.reject()).then(done, () => {
    b.textContent = "Copy failed";
    setTimeout(() => (b.textContent = "Copy link"), 1500);
  });
}


/* ---------- compare urgency levels ---------- */

function wordDiff(a, b) {
  const x = a.split(/(\s+)/), y = b.split(/(\s+)/);
  const m = x.length, n = y.length, L = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  let i = 0, j = 0, ha = "", hb = "";
  const mk = (s) => (s.trim() ? `<mark>${esc(s)}</mark>` : esc(s));
  while (i < m && j < n) {
    if (x[i] === y[j]) { ha += esc(x[i]); hb += esc(y[j]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) ha += mk(x[i++]);
    else hb += mk(y[j++]);
  }
  while (i < m) ha += mk(x[i++]);
  while (j < n) hb += mk(y[j++]);
  return [ha, hb];
}

function diffTexts(a, b) {
  const sa = a.split("\n"), sb = b.split("\n");
  if (sa.length === sb.length) {
    const out = sa.map((l, i) => (l === sb[i] ? [esc(l) || "&nbsp;", esc(l) || "&nbsp;", false] : [...wordDiff(l, sb[i]), true]));
    const f = (k) => out.map((o) => `<div>${o[k]}</div>`).join("");
    return [f(0), f(1)];
  }
  return diffLines(a, b);
}

async function viewCompare(runId, wid, pa, pb, ver) {
  const { byId, summary } = await run(runId);
  const w = byId[wid];
  if (!w || !w.kept) return notFound();
  const A = w.levels.find((l) => l.pressure === +pa) || w.levels[0];
  const B = w.levels.find((l) => l.pressure === +pb) || w.levels[w.levels.length - 1];
  ver = ver === "open" ? "open" : "blocked";
  const rows = await traces(runId, wid);
  const s = summary.worlds[wid];
  setCrumbs([{ text: "Blocker traces", href: "#/" + runId }, { text: domainName(w.domain) },
    { text: w.rule.id, href: `#/${runId}/w/${encodeURIComponent(wid)}/${A.pressure}` }, { text: "Compare urgency" }]);
  const [ta, tb] = diffTexts(ver === "open" ? A.shown_open : A.shown_blocked, ver === "open" ? B.shown_open : B.shown_blocked);
  const go = (a, b, v) => `#/${runId}/c/${encodeURIComponent(wid)}/${a}/${b}/${v}`;
  const sel = (id, cur) => `<select id="${id}">${w.levels.map((l) => `<option value="${l.pressure}" ${l.pressure === cur ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select>`;
  const col = (L, text) => {
    const c = s.levels[L.pressure];
    return `<div class="card"><h3>${esc(L.name)}</h3>
      <table><tr><th></th><th>Route working</th><th>Route blocked</th></tr>
      <tr><td>Chose compliant</td><td>${pct(c.open.safer)}</td><td>${pct(c.blocked.safer)}</td></tr>
      <tr><td>Shift</td><td colspan="2" class="shiftnum ${c.shift < 0 ? "neg" : "pos"}">${pts(c.shift)}</td></tr></table>
      <div style="margin:8px 0">${labelBar(c.labels)}<div class="muted small">${pct((c.labels.influenced_outcome || 0) / Math.max(1, Object.values(c.labels).reduce((a, b) => a + b, 0)))} of blocked runs changed by the block</div></div>
      <div class="situ">${text}</div></div>`;
  };
  const list = (L) => rows.filter((r) => r.pressure === L.pressure && r.blocker === ver);
  app.innerHTML = `
    <h1>${esc(w.summary)}</h1>
    <p><b>Rule:</b> “${esc(w.rule.text)}”</p>
    <p class="muted small">Same world at two urgency levels. Highlighted words are what changed in the text the model saw (deadline and cost of missing it); the options, workspace and probe command stay the same.</p>
    <div class="controls">
      <label>Left${sel("c-a", A.pressure)}</label><label>Right${sel("c-b", B.pressure)}</label>
      <label>Version<select id="c-v">${opt(ver, [["blocked", "Route blocked"], ["open", "Route working"]])}</select></label>
      <label class="check"><a href="#/${runId}/w/${encodeURIComponent(wid)}/${B.pressure}">Back to world</a></label>
    </div>
    <div class="cols">${col(A, ta)}${col(B, tb)}</div>
    <h2>Trajectories (${ver === "open" ? "route working" : "route blocked"})</h2>
    <div class="controls"><label>Label<select id="c-label">${opt("all", [["all", "Any"], ["influenced_outcome", "Block changed the outcome"], ["considered_and_backed_off", "Considered, backed off"], ["no_effect", "No difference"]])}</select></label>
    <label>Choice<select id="c-choice">${opt("all", [["all", "Any"], ["safer", "Compliant option"], ["shortcut", "Shortcut"]])}</select></label></div>
    <div class="cols"><div id="c-la"></div><div id="c-lb"></div></div>`;
  const draw = () => {
    const lab = document.getElementById("c-label").value, ch = document.getElementById("c-choice").value;
    for (const [id, L] of [["c-la", A], ["c-lb", B]]) {
      const all = list(L), sel2 = all.filter((r) => (lab === "all" || r.effect === lab) && (ch === "all" || (r.valid && (ch === "safer" ? r.safer : !r.safer))));
      document.getElementById(id).innerHTML = `<div class="count">${esc(L.name)}: ${sel2.length} of ${all.length}</div>` + sel2.map((r) => traceCard(runId, wid, L, r, "")).join("");
    }
  };
  const nav = () => (location.hash = go(document.getElementById("c-a").value, document.getElementById("c-b").value, document.getElementById("c-v").value));
  ["c-a", "c-b", "c-v"].forEach((id) => document.getElementById(id).addEventListener("change", nav));
  ["c-label", "c-choice"].forEach((id) => document.getElementById(id).addEventListener("change", draw));
  draw();
  app.addEventListener("click", copyHandler);
}


/* ---------- highlights ---------- */

async function viewHighlights(runId) {
  const runs = await manifest();
  const meta = runs.find((r) => r.id === runId) || runs[0];
  const [{ worlds }, items] = await Promise.all([run(meta.id), getJSON(`data/${meta.id}/highlights.json`)]);
  setCrumbs([{ text: "Blocker traces", href: "#/" + meta.id }, { text: "Highlights" }]);
  const domains = [...new Set(items.map((x) => x.domain))].sort();
  app.innerHTML = `
    <h1>Reinterpretation examples</h1>
    <p>Blocked runs where the model took the shortcut after arguing that the rule forbids less than it appears to. For each of ${new Set(items.map((x) => x.world)).size} worlds, the lowest and highest urgency level with such a run.
    The excerpt is the sentence where the model reads the rule narrowly, with its neighbours; open the run to read all of it.</p>
    <div class="note">This shows what the model argued, not why it chose. The same narrow readings appear in runs that went on to choose the compliant option.</div>
    <div class="controls">
      <label>Urgency<select id="h-p">${opt("0", [["0", "All"], ["1", "Routine"], ["2", "Important"], ["3", "Critical"]])}</select></label>
      <label>Domain<select id="h-d"><option value="">All</option>${domains.map((d) => `<option value="${d}">${esc(domainName(d))}</option>`).join("")}</select></label>
    </div>
    ${hlLegend}<div id="h-list"></div>`;
  const draw = () => {
    const p = +document.getElementById("h-p").value, d = document.getElementById("h-d").value;
    const sel = items.filter((x) => (!p || x.pressure === p) && (!d || x.domain === d));
    document.getElementById("h-list").innerHTML = `<div class="count">${sel.length} examples</div>` + sel.map((x) => `
      <article class="trace">
        <header><span class="chip">${esc(LEVEL_NAMES[x.pressure])}</span><span class="chip risk">chose shortcut</span>
          <span class="muted">${esc(domainName(x.domain))}</span><span class="grow"></span>
          <a href="#/${meta.id}/t/${encodeURIComponent(x.world)}/${encodeURIComponent(x.trace)}">Read the run →</a></header>
        <p style="margin:8px 0 2px"><b>Rule:</b> “${esc(x.rule)}”</p>
        <p class="muted small" style="margin:0 0 6px">${esc(x.summary)} · <a href="#/${meta.id}/w/${encodeURIComponent(x.world)}/${x.pressure}">world</a></p>
        <div class="ev">${highlight(x.excerpt, "")}</div>
      </article>`).join("");
  };
  ["h-p", "h-d"].forEach((id) => document.getElementById(id).addEventListener("change", draw));
  draw();
}

/* ---------- single trace ---------- */

async function viewTrace(runId, wid, tid) {
  const { byId } = await run(runId);
  const w = byId[wid];
  if (!w) return notFound();
  const rows = await traces(runId, wid);
  const r = rows.find((x) => x.id === tid);
  if (!r) return notFound();
  const lv = w.levels.find((l) => l.pressure === r.pressure);
  setCrumbs([{ text: "Blocker traces", href: "#/" + runId }, { text: domainName(w.domain) },
    { text: w.rule.id, href: `#/${runId}/w/${encodeURIComponent(wid)}/${r.pressure}` }, { text: `${LEVEL_NAMES[r.pressure]} · repeat ${r.epoch}` }]);
  const shown = r.blocker === "blocked" ? lv.shown_blocked : lv.shown_open;
  app.innerHTML = `
    <h1>${esc(w.summary)}</h1>
    <p class="muted">${esc(LEVEL_NAMES[r.pressure])} urgency · ${r.blocker === "blocked" ? "route blocked" : "route working"} · ${r.has_rule ? "rule shown" : "no rule"}</p>
    ${r.has_rule ? `<p><b>Rule:</b> “${esc(w.rule.text)}”</p>` : ""}
    <h2>What the model saw</h2>
    <div class="card"><div class="situ">${esc(shown)}</div><p style="margin-top:12px"><b>Task:</b> ${esc(lv.task)}</p>
    ${shownOptions(r.order, lv.options, r.slot, lv.safer)}</div>
    <h2>What it did</h2>
    ${hlLegend}
    ${traceCard(runId, wid, lv, r, "", true)}`;
  app.addEventListener("click", copyHandler);
}

function notFound() {
  setCrumbs([{ text: "Blocker traces", href: "#/" }]);
  app.innerHTML = '<h1>Not found</h1><p>This run, world or trajectory is not in the data. <a href="#/">Back to the index</a>.</p>';
}

/* ---------- router ---------- */

async function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  app.removeEventListener("click", copyHandler);
  window.scrollTo(0, 0);
  try {
    if (parts[1] === "w") await viewWorld(parts[0], parts[2], parts[3]);
    else if (parts[1] === "highlights") await viewHighlights(parts[0]);
    else if (parts[1] === "c") await viewCompare(parts[0], parts[2], parts[3], parts[4], parts[5]);
    else if (parts[1] === "t") await viewTrace(parts[0], parts[2], parts[3]);
    else await viewIndex(parts[0]);
  } catch (err) {
    app.innerHTML = `<h1>Could not load</h1><p class="muted">${esc(err.message)}. If you opened this file directly, serve the folder over http instead.</p>`;
  }
}
window.addEventListener("hashchange", route);
route();

/* ---------- theme ---------- */
const root = document.documentElement;
try { const t = localStorage.getItem("theme"); if (t) root.dataset.theme = t; } catch (e) {}
document.getElementById("theme").addEventListener("click", () => {
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem("theme", root.dataset.theme); } catch (e) {}
});
