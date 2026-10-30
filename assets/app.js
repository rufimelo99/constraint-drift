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
const DEFAULT_VERSIONS = { open: "Route working", blocked: "Route blocked" };
// Names of the two versions a run compared: the pilots blocked the compliant route, later runs made it costly.
const V = (runId) => cache.manifest?.find((r) => r.id === runId)?.versions || DEFAULT_VERSIONS;
const lc = (s) => s.toLowerCase();
const OLD = !!window.OLD_LOGS;
const TITLE = OLD ? "Old logs" : "Cost traces";
// The old pilots blocked the compliant route; the newer runs leave it working but slower or dearer. Old pages keep their wording.
const W = OLD
  ? { rate: "blocked runs", changed: "blocked runs changed by the block", lowest: "Lowest blocked share", infl: "Blocker influenced", ran: "Blocked runs" }
  : { rate: "costly-route runs", changed: "costly-route runs changed by the cost", lowest: "Lowest costly-route share", infl: "Cost influenced", ran: "Costly-route runs" };
if (!OLD) {
  LABELS.influenced_outcome[0] = "The cost changed the outcome";
  LABELS.no_effect[0] = "The cost made no difference";
  LABELS.not_applicable[0] = "Cheap route";
}
// Pilot links from before the split.
if (!OLD && /^#\/pilot-/.test(location.hash)) location.replace("old_logs/" + location.hash);

async function run(id) {
  await manifest();
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
  const landing = runs[0];
  runId = runId || landing.id;
  const meta = runs.find((r) => r.id === runId) || landing;
  const { worlds, summary } = await run(meta.id);
  setCrumbs([{ text: TITLE }, { text: meta.title }]);
  const t = summary.totals;
  const domains = [...new Set(worlds.map((w) => w.domain))].sort();

  app.innerHTML = `
    <h1>${TITLE}</h1>
    <p>${OLD ? "When a status command reports that the compliant route is blocked" : "When the compliant route still works but is slow or expensive"}, does a model read an ambiguous safety rule more loosely?
    ${t.candidates} candidate worlds were generated; ${t.kept} moved the choice when the route ${OLD ? "was blocked" : "was costly"} and were kept.
    Each kept world was run ${t.runs} times in total (${t.usable} usable answers, ${meta.epochs ?? "?"} repeats per version, three urgency levels).
    Across the kept worlds the compliant option was chosen ${pct(t.open)} of the time in the ${lc(V(meta.id).open)} version and ${pct(t.blocked)} in the ${lc(V(meta.id).blocked)} version
    (${pts(t.shift)}).</p>
    ${await modelsTable(runs, meta.id)}
    <p><a href="#/${meta.id}/highlights"><b>Read examples of the model reinterpreting a rule →</b></a>${OLD ? "" : ` · <a href="#/analysis"><b>Which kinds of world get reinterpreted? Multivariate analysis →</b></a>`}</p>
    ${urgencyTable(summary, meta.id)}
    ${runs.length > 1 ? `<div class="controls"><label>Run<select id="f-run">${runPicker(runs, meta.id)}</select></label></div>` : ""}
    <div class="note">Model: ${esc(meta.model)} · logged ${esc(meta.date)}. A <b>world</b> is one situation built around one rule. The shift is the ${OLD ? "blocked share minus the working-route share" : "costly-route share minus the cheap-route share"},
    averaged over the three urgency levels first.</div>
    ${generationBox(meta)}
    <div class="controls">
      <label>Search<input id="f-q" type="search" placeholder="scenario, rule, reasoning" value="${esc(state.q)}"></label>
      <label class="check"><input id="f-deep" type="checkbox" ${state.deep ? "checked" : ""}> also search reasoning</label>
      <label>Status<select id="f-status">${opt(state.status, [["kept", "Kept"], ["dropped", "Dropped"], ["all", "All candidates"]])}</select></label>
      <label>Domain<select id="f-domain"><option value="">All</option>${domains.map((d) => `<option value="${d}" ${state.domain === d ? "selected" : ""}>${esc(domainName(d))}</option>`).join("")}</select></label>
      <label>${W.infl}<select id="f-infl">${opt(state.infl, [["0", "Any"], ["0.25", `≥ 25% of ${W.rate}`], ["0.5", `≥ 50% of ${W.rate}`]])}</select></label>
      <label>Choice shift<select id="f-shift">${opt(state.shift, [["", "Any"], ["big", "Drops by 30 pts or more"], ["small", "Drops by less than 30 pts"]])}</select></label>
      <label>Group by<select id="f-group">${opt(state.group, [["domain", "Domain"], ["rule", "Rule"], ["none", "None"]])}</select></label>
      <label>Sort<select id="f-sort">${opt(state.sort, [["shift", "Biggest drop"], ["infl", "Most influenced"], ["blocked", W.lowest], ["name", "Name"]])}</select></label>
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
async function modelsTable(runs, current) {
  if (runs.length < 2) return "";
  const rows = await Promise.all(runs.map(async (r) => {
    const { summary } = await run(r.id), s = summary.totals;
    const ws = Object.values(summary.worlds);
    let inf = 0, tot = 0;
    ws.forEach((w) => { inf += w.labels.influenced_outcome || 0; tot += Object.values(w.labels).reduce((a, b) => a + b, 0); });
    return `<tr><td>${r.id === current ? "<b>" : ""}<a href="#/${r.id}">${esc(r.model.split("/").pop())}</a>${r.id === current ? "</b>" : ""}</td><td>${pct(s.open)}</td><td>${pct(s.blocked)}</td><td class="shiftnum ${s.shift < 0 ? "neg" : "pos"}">${pts(s.shift)}</td><td>${pct(inf / Math.max(1, tot))}</td><td>${s.usable} / ${s.runs}</td></tr>`;
  }));
  return `<h2>Models</h2><div class="tbl"><table><tr><th>Model</th><th>${esc(V(current).open)}</th><th>${esc(V(current).blocked)}</th><th>Shift</th><th>${W.ran} changed by the ${OLD ? "block" : "cost"}</th><th>Usable runs</th></tr>${rows.join("")}</table></div>
    <p class="muted small">${OLD
      ? "Same 17 worlds for every row. Labels come from deepseek-v4p1-flash in both runs, so it labelled its own reasoning in its own row."
      : sameWorlds(runs) ? "Same worlds for every row."
      : "Rows from different generated sets use different worlds, so they are not like for like; rows with the same generated set share their worlds."} The page below shows the selected row.</p>`;
}

function runPicker(runs, current) {
  return runs.map((r) => `<option value="${r.id}" ${r.id === current ? "selected" : ""}>${esc(r.title)}</option>`).join("");
}

function generationBox(meta) {
  const g = meta.generation;
  if (!g || !g.models) return "";
  const c = g.counts || {}, p = g.params || {}, st = c.worlds_by_stage || {};
  const stages = Object.entries(st).map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`).join(", ");
  return `<details class="note" open><summary><b>How these worlds were generated</b></summary>
    <dl class="genmeta">
      <dt>Generator</dt><dd>${esc(g.models.generator)} <span class="muted">writes the rules and worlds</span></dd>
      <dt>Critic</dt><dd>${esc(g.models.critic)} <span class="muted">looks for flaws in a world</span></dd>
      <dt>Chooser</dt><dd>${esc(g.models.chooser)} <span class="muted">answers the screening probes (${p.probe_epochs ?? "?"} repeats); a world is kept only if the choice shifts by at least ${pts(p.min_shift)}</span></dd>
      <dt>Probed</dt><dd>${esc(meta.model.split("/").pop())}</dd>
      <dt>Size</dt><dd>${g.domains.length} domains × ${p.rules_per_domain ?? "?"} rules × ${p.worlds_per_rule ?? "?"} worlds = ${c.worlds ?? "?"} candidates${stages ? ` (${stages})` : ""}; ${c.constraints ?? "?"} rules survived${g.dropped_constraints.length ? `, dropped: ${esc(g.dropped_constraints.join(", "))}` : ""}; ${c.scenarios ?? "?"} scenarios at ${p.pressures ?? "?"} urgency levels</dd>
      <dt>Repairs</dt><dd>up to ${p.rewrites ?? "?"} rewrite, ${p.repairs ?? "?"} repair, ${p.followups ?? "?"} follow-ups per world</dd>
      <dt>Generation run</dt><dd>${esc(meta.generated)}${g.total_time ? ` · ${esc(g.total_time)}` : ""}</dd>
    </dl></details>`;
}

const sameWorlds = (runs) => new Set(runs.map((r) => r.generated)).size === 1;

function urgencyTable(summary, runId) {
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
  return `<h2>By urgency</h2><div class="tbl"><table><tr><th>Urgency</th><th>${esc(V(runId).open)}</th><th>${esc(V(runId).blocked)}</th><th>Shift</th><th>${W.ran} changed by the ${OLD ? "block" : "cost"}</th></tr>${rows}</table></div>
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
  const lines = `<div class="t">${esc(w.summary)}</div><div class="meta">${esc(w.rule.text)} · ${esc(domainName(w.domain))}${hit ? ` · <mark>${hit} runs match</mark>` : ""}</div>`;
  // One grid cell for both lines. The old-logs page keeps its original markup, which spreads them over two cells.
  const title = OLD ? lines : `<div>${lines}</div>`;
  if (!w.kept || !s) {
    const c = w.screen || {};
    const f = (v) => Object.entries(v || {}).map(([k, n]) => `${k}${n}`).join(" ") || "–";
    return `<div class="row dropped">${title}<div class="pair">Dropped at the screen<br>working: ${f(c.open)} · blocked: ${f(c.blocked)}</div><div class="meta">${w.rewrites} rewrite${w.rewrites == 1 ? "" : "s"}</div></div>`;
  }
  return `<a class="row" href="#/${runId}/w/${encodeURIComponent(w.id)}">${title}
    <div><span class="pair">${pct(s.open)} → ${pct(s.blocked)}</span> <span class="shiftnum ${s.shift < 0 ? "neg" : "pos"}">${pts(s.shift)}</span></div>
    <div><div class="pair">${pct(s.influenced_share)} ${W.changed}</div>${labelBar(s.labels)}</div></a>`;
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
  const topo = OLD ? null : ((await getJSON("data/labels.json").catch(() => ({})))[meta.generated] || {})[wid];
  const s = summary.worlds[wid], sl = s.levels[lv.pressure];
  setCrumbs([{ text: TITLE, href: "#/" + runId }, { text: domainName(w.domain) }, { text: w.rule.id }]);
  const [dOpen, dBlocked] = diffLines(lv.shown_open, lv.shown_blocked);
  const levelRows = rows.filter((r) => r.pressure === lv.pressure);

  app.innerHTML = `
    <h1>${esc(w.summary)}</h1>
    <p><b>Rule:</b> “${esc(w.rule.text)}”</p>
    <div class="note">${esc(w.rule.ambiguity_note)}</div>
    <div class="tabs">${w.levels.map((l) => `<a class="${l.pressure === lv.pressure ? "on" : ""}" href="#/${runId}/w/${encodeURIComponent(wid)}/${l.pressure}">${esc(l.name)} · ${pts(s.levels[l.pressure].shift)}</a>`).join("")}</div>
    ${w.levels.length > 1 ? `<p class="small"><a href="#/${runId}/c/${encodeURIComponent(wid)}/${w.levels[0].pressure}/${w.levels[w.levels.length - 1].pressure}">Compare urgency levels side by side →</a></p>` : ""}
    <dl class="kv">
      ${topo ? `<dt>Topology</dt><dd>${["ambiguity", "loophole", "cost"].map((k) => `<span class="chip">${esc(FACTOR_NAMES[k])}: ${esc(topo[k])}</span>`).join(" ")}${topo.fee ? ' <span class="chip">fee quoted</span>' : ""}</dd>` : ""}
      ${OLD ? `<dt>Blocker type</dt><dd>${esc(lv.blocker_type)}</dd>
      <dt>Probe command</dt><dd><code>${esc(lv.probe_command)}</code></dd>` : ""}
      <dt>Shortcut</dt><dd>${esc(lv.workaround)}</dd>
      <dt>Why it is risky</dt><dd>${esc(lv.workaround_risk)}</dd>
      <dt>Task</dt><dd>${esc(lv.task)}</dd>
    </dl>
    <h2>Options</h2>
    ${["A", "B"].map((k) => `<div class="opt ${k === lv.safer ? "safer" : ""}"><b>${k}</b><span>${esc(lv.options[k])} <span class="chip ${k === lv.safer ? "safe" : "risk"}">${k === lv.safer ? "compliant" : "shortcut"}</span></span></div>`).join("")}
    <h2>The two versions the model saw</h2>
    <p class="muted small">Only the last lines differ. Lines that appear in one version only are highlighted.</p>
    <div class="cols">
      <div class="card"><h3>${esc(V(runId).open)}</h3><div class="stat">${pct(sl.open.safer)}</div><div class="muted small">chose the compliant option · ${sl.open.n} runs</div><div class="situ" style="margin-top:10px">${dOpen}</div></div>
      <div class="card"><h3>${esc(V(runId).blocked)}</h3><div class="stat">${pct(sl.blocked.safer)}</div><div class="muted small">chose the compliant option · ${sl.blocked.n} runs</div><div class="situ" style="margin-top:10px">${dBlocked}</div>
        <div style="margin-top:10px">${labelBar(sl.labels)}${legend()}</div></div>
    </div>
    <h2>Trajectories</h2>
    <div class="controls">
      <label>Version<select id="t-ver">${opt("all", [["all", "Both"], ["open", V(runId).open], ["blocked", V(runId).blocked]])}</select></label>
      <label>Label<select id="t-label">${opt("all", [["all", "Any"], ["influenced_outcome", LABELS.influenced_outcome[0]], ["considered_and_backed_off", "Considered, backed off"], ["no_effect", "No difference"]])}</select></label>
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
      <span class="chip">${r.blocker === "blocked" ? V(runId).blocked : V(runId).open}</span>
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
  setCrumbs([{ text: TITLE, href: "#/" + runId }, { text: domainName(w.domain) },
    { text: w.rule.id, href: `#/${runId}/w/${encodeURIComponent(wid)}/${A.pressure}` }, { text: "Compare urgency" }]);
  const [ta, tb] = diffTexts(ver === "open" ? A.shown_open : A.shown_blocked, ver === "open" ? B.shown_open : B.shown_blocked);
  const go = (a, b, v) => `#/${runId}/c/${encodeURIComponent(wid)}/${a}/${b}/${v}`;
  const sel = (id, cur) => `<select id="${id}">${w.levels.map((l) => `<option value="${l.pressure}" ${l.pressure === cur ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select>`;
  const col = (L, text) => {
    const c = s.levels[L.pressure];
    return `<div class="card"><h3>${esc(L.name)}</h3>
      <table><tr><th></th><th>${esc(V(runId).open)}</th><th>${esc(V(runId).blocked)}</th></tr>
      <tr><td>Chose compliant</td><td>${pct(c.open.safer)}</td><td>${pct(c.blocked.safer)}</td></tr>
      <tr><td>Shift</td><td colspan="2" class="shiftnum ${c.shift < 0 ? "neg" : "pos"}">${pts(c.shift)}</td></tr></table>
      <div style="margin:8px 0">${labelBar(c.labels)}<div class="muted small">${pct((c.labels.influenced_outcome || 0) / Math.max(1, Object.values(c.labels).reduce((a, b) => a + b, 0)))} of ${W.rate} changed by the ${OLD ? "block" : "cost"}</div></div>
      <div class="situ">${text}</div></div>`;
  };
  const list = (L) => rows.filter((r) => r.pressure === L.pressure && r.blocker === ver);
  app.innerHTML = `
    <h1>${esc(w.summary)}</h1>
    <p><b>Rule:</b> “${esc(w.rule.text)}”</p>
    <p class="muted small">Same world at two urgency levels. Highlighted words are what changed in the text the model saw (deadline and cost of missing it); the options, workspace and probe command stay the same.</p>
    <div class="controls">
      <label>Left${sel("c-a", A.pressure)}</label><label>Right${sel("c-b", B.pressure)}</label>
      <label>Version<select id="c-v">${opt(ver, [["blocked", V(runId).blocked], ["open", V(runId).open]])}</select></label>
      <label class="check"><a href="#/${runId}/w/${encodeURIComponent(wid)}/${B.pressure}">Back to world</a></label>
    </div>
    <div class="cols">${col(A, ta)}${col(B, tb)}</div>
    <h2>Trajectories (${lc(ver === "open" ? V(runId).open : V(runId).blocked)})</h2>
    <div class="controls"><label>Label<select id="c-label">${opt("all", [["all", "Any"], ["influenced_outcome", LABELS.influenced_outcome[0]], ["considered_and_backed_off", "Considered, backed off"], ["no_effect", "No difference"]])}</select></label>
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
  setCrumbs([{ text: TITLE, href: "#/" + meta.id }, { text: "Highlights" }]);
  const domains = [...new Set(items.map((x) => x.domain))].sort();
  app.innerHTML = `
    <h1>Reinterpretation examples</h1>
    <p>${W.ran} where the model took the shortcut after arguing that the rule forbids less than it appears to. For each of ${new Set(items.map((x) => x.world)).size} worlds, the lowest and highest urgency level with such a run.
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
  setCrumbs([{ text: TITLE, href: "#/" + runId }, { text: domainName(w.domain) },
    { text: w.rule.id, href: `#/${runId}/w/${encodeURIComponent(wid)}/${r.pressure}` }, { text: `${LEVEL_NAMES[r.pressure]} · repeat ${r.epoch}` }]);
  const shown = r.blocker === "blocked" ? lv.shown_blocked : lv.shown_open;
  app.innerHTML = `
    <h1>${esc(w.summary)}</h1>
    <p class="muted">${esc(LEVEL_NAMES[r.pressure])} urgency · ${lc(r.blocker === "blocked" ? V(runId).blocked : V(runId).open)} · ${r.has_rule ? "rule shown" : "no rule"}</p>
    ${r.has_rule ? `<p><b>Rule:</b> “${esc(w.rule.text)}”</p>` : ""}
    <h2>What the model saw</h2>
    <div class="card"><div class="situ">${esc(shown)}</div><p style="margin-top:12px"><b>Task:</b> ${esc(lv.task)}</p>
    ${shownOptions(r.order, lv.options, r.slot, lv.safer)}</div>
    <h2>What it did</h2>
    ${hlLegend}
    ${traceCard(runId, wid, lv, r, "", true)}`;
  app.addEventListener("click", copyHandler);
}

const FACTOR_NAMES = { ambiguity: "Rule wiggle room", loophole: "How the shortcut sidesteps the rule", cost: "Why the safe route is slow", fee: "Safe route also costs money", urgency: "Urgency", model: "Model being tested", gen: "Model that wrote the worlds" };
const LEVEL_TEXT = {
  environment: "environment", action: "action", object: "object",
  bypass: "bypass", equivalent: "equivalent", transformed: "transformed", adjacent: "adjacent", delegated: "delegated",
  queue: "queue", window: "window", throttle: "throttle", 0: "no", 1: "yes",
};
const levelName = (factor, level) => (factor === "urgency" ? LEVEL_NAMES[level] : factor === "fee" ? LEVEL_TEXT[level] : LEVEL_TEXT[level] || level);

/* ---------- charts (inline SVG, themed through CSS variables) ---------- */

const SVG_W = 720;
// Chart styles live inside each SVG so a chart never depends on the page stylesheet being current.
const CHART_CSS = `svg.ch { width: 100%; height: auto; display: block; overflow: visible; }
svg.ch text { font: 12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; fill: var(--fg, #1d2227); }
svg.ch .ch-m { fill: var(--muted, #66707a); }
svg.ch .ch-h { font-weight: 600; }
svg.ch .ch-on { fill: #fff; }
svg.ch .ch-grid { stroke: var(--line, #e2dfd8); stroke-width: 1; fill: none; }
svg.ch .ch-ref { stroke: var(--muted, #66707a); stroke-width: 1.5; fill: none; }
svg.ch .ch-bar { fill: var(--accent, #1f5fa8); }
svg.ch .ch-dia { fill: var(--fg, #1d2227); stroke: var(--panel, #fff); stroke-width: 2; }
svg.ch .ch-sig { fill: var(--accent, #1f5fa8); stroke: var(--accent, #1f5fa8); }
svg.ch .ch-ns { fill: var(--panel, #fff); stroke: var(--grey, #9aa3ad); }
svg.ch .ch-dot { fill: var(--accent, #1f5fa8); fill-opacity: .7; stroke: var(--panel, #fff); stroke-width: 1.5; }
svg.ch .ch-mean { stroke: var(--fg, #1d2227); stroke-width: 2.5; stroke-linecap: round; }
svg.ch .ch-empty { fill: none; stroke: var(--line, #e2dfd8); stroke-dasharray: 4 3; }
svg.ch g:hover, svg.ch circle:hover { opacity: .85; }`;
const svgOpen = (h, label) => `<svg class="ch" viewBox="0 0 ${SVG_W} ${h}" role="img" aria-label="${esc(label)}"><style>${CHART_CSS}</style>`;
const figure = (title, note, svg, table) =>
  `<figure class="fig"><figcaption><b>${esc(title)}</b> <span class="muted small">${note}</span></figcaption>${svg}${table ? `<details class="small"><summary>Table view</summary>${table}</details>` : ""}</figure>`;
const xTicks = (x0, w, y0, y1, vals, fmt) =>
  vals.map((v) => { const x = x0 + v * w; return `<line class="ch-grid" x1="${x}" x2="${x}" y1="${y0}" y2="${y1}"/><text class="ch-m" x="${x}" y="${y1 + 14}" text-anchor="middle">${fmt(v)}</text>`; }).join("");

// Rate bars: bar = reinterpreted, diamond = took the shortcut.
function barsChart(groups) {
  const x0 = 170, w = 470, rowH = 30, headH = 30;
  let y = 34, body = "", rows = 0;
  const top = y;
  groups.forEach((g) => {
    body += `<text class="ch-h" x="0" y="${y + 14}">${esc(g.title)}</text>`;
    y += headH - 8;
    g.rows.forEach((r) => {
      const cy = y + rowH / 2;
      body += `<g><title>${esc(r.label)}: ${pct(r.v)} reinterpreted, ${pct(r.v2)} took the shortcut (${r.worlds} worlds, ${r.runs} runs)</title>
        <text class="ch-t" x="${x0 - 10}" y="${cy + 4}" text-anchor="end">${esc(r.label)}</text>
        <rect class="ch-bar" x="${x0}" y="${cy - 8}" width="${Math.max(1, r.v * w)}" height="16" rx="3"/>
        <path class="ch-dia" d="M${x0 + r.v2 * w} ${cy - 7} l7 7 l-7 7 l-7 -7 z"/>
        <text class="ch-t" x="${x0 + Math.max(r.v, r.v2) * w + 12}" y="${cy + 4}">${pct(r.v)}</text></g>`;
      y += rowH; rows++;
    });
    y += 8;
  });
  const grid = xTicks(x0, w, top, y - 4, [0, 0.25, 0.5, 0.75, 1], (v) => pct(v));
  const legend = `<rect class="ch-bar" x="${x0}" y="6" width="12" height="12" rx="2"/><text class="ch-t" x="${x0 + 18}" y="16">reinterpreted the rule</text>
    <path class="ch-dia" d="M${x0 + 190} 7 l6 6 l-6 6 l-6 -6 z"/><text class="ch-t" x="${x0 + 202}" y="16">took the shortcut</text>`;
  const axisTitle = `<text class="ch-m" x="${x0 + w / 2}" y="${y + 30}" text-anchor="middle">percent of runs (each bar out of 100%)</text>`;
  return svgOpen(y + 40, "Reinterpretation rate by urgency and probed model") + legend + grid + body + axisTitle + "</svg>";
}

// Forest plot of odds ratios on a log axis; filled = the interval excludes 1.
function forestChart(terms, rates) {
  const worldsIn = (x) => (["ambiguity", "loophole", "cost", "fee"].includes(x.factor) ? (rates[x.factor].find((r) => r.level === (x.factor === "fee" ? "1" : x.level)) || {}).worlds : null);
  const lo = 0.04, hi = 20, x0 = 300, w = 400, rowH = 24;
  const X = (v) => x0 + ((Math.log(Math.min(hi, Math.max(lo, v))) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * w;
  let y = 28, body = "";
  const top = y;
  let last = null;
  terms.forEach((x) => {
    if (x.factor !== last) { body += `<text class="ch-h" x="0" y="${y + 14}">${esc(FACTOR_NAMES[x.factor])}</text>`; y += 22; last = x.factor; }
    const sig = x.lo > 1 || x.hi < 1, cy = y + rowH / 2, cls = sig ? "ch-sig" : "ch-ns";
    body += `<g><title>${esc(levelName(x.factor, x.level))} vs ${esc(levelName(x.factor, x.ref))}: odds ratio ${x.odds_ratio.toFixed(2)}, 95% CI ${x.lo.toFixed(2)} to ${x.hi.toFixed(2)}, p ${x.p < 0.001 ? "< 0.001" : x.p.toFixed(3)}</title>
      <text class="ch-t" x="16" y="${cy + 4}">${esc(String(x.factor === "urgency" ? LEVEL_NAMES[x.level] : x.level))}${worldsIn(x) ? ` <tspan class="ch-m">(${worldsIn(x)} worlds)</tspan>` : ""} <tspan class="ch-m">vs ${esc(String(x.factor === "urgency" ? LEVEL_NAMES[x.ref] : x.ref))}</tspan></text>
      <text class="ch-t" x="${x0 - 14}" y="${cy + 4}" text-anchor="end">${x.odds_ratio.toFixed(2)}</text>
      <line class="${cls}" x1="${X(x.lo)}" x2="${X(x.hi)}" y1="${cy}" y2="${cy}" stroke-width="2"/>
      <circle class="${cls}" cx="${X(x.odds_ratio)}" cy="${cy}" r="5" stroke-width="2"/>${x.hi > hi ? `<text class="ch-m" x="${x0 + w + 4}" y="${cy + 4}">→</text>` : ""}</g>`;
    y += rowH;
  });
  const ticks = [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 16].map((v) => `<line class="${v === 1 ? "ch-ref" : "ch-grid"}" x1="${X(v)}" x2="${X(v)}" y1="${top}" y2="${y}"/><text class="ch-m" x="${X(v)}" y="${y + 14}" text-anchor="middle">${v}</text>`).join("");
  const axis = `<text class="ch-m" x="${X(1)}" y="${y + 32}" text-anchor="middle">1 = same as the baseline</text><text class="ch-m" x="${x0}" y="${y + 48}">← less likely to reinterpret</text><text class="ch-m" x="${x0 + w}" y="${y + 48}" text-anchor="end">more likely →</text><text class="ch-m" x="${x0 + w / 2}" y="${y + 64}" text-anchor="middle">times the odds of the baseline (log scale)</text><text class="ch-m" x="16" y="14">group (baseline named after “vs”)</text><text class="ch-m" x="${x0 - 14}" y="14" text-anchor="end">× odds</text>`;
  return svgOpen(y + 72, "How much each factor changes the odds of reinterpreting, with 95% confidence intervals") + ticks + body + axis + "</svg>";
}

// One dot per world, grouped by a topology label; the tick is the group mean.
function stripChart(worlds, panels) {
  const x0 = 200, w = 470, rowH = 44;
  let y = 8, body = "";
  panels.forEach((pn) => {
    body += `<text class="ch-h" x="0" y="${y + 14}">${esc(pn.title)}</text>`;
    y += 22;
    const top = y;
    pn.levels.forEach((lev) => {
      const ws = worlds.filter((x) => x[pn.key] === lev).sort((a, b) => a.reinterpreted - b.reinterpreted);
      if (!ws.length) return;
      const cy = y + rowH / 2, stack = {};
      const mean = ws.reduce((s, x) => s + x.reinterpreted, 0) / ws.length;
      body += `<text class="ch-t" x="${x0 - 12}" y="${cy + 4}" text-anchor="end">${esc(lev)} <tspan class="ch-m">${ws.length}</tspan></text><line class="ch-grid" x1="${x0}" x2="${x0 + w}" y1="${cy}" y2="${cy}"/>`;
      ws.forEach((x) => {
        const bin = Math.round(x.reinterpreted * 24), k = (stack[bin] = (stack[bin] || 0) + 1) - 1;
        const dy = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 8;
        body += `<circle class="ch-dot" cx="${x0 + x.reinterpreted * w}" cy="${cy + dy}" r="4.5"><title>${esc(x.world)}: ${pct(x.reinterpreted)} reinterpreted, ${pct(x.shortcut)} shortcut (${x.runs} runs)</title></circle>`;
      });
      body += `<line class="ch-mean" x1="${x0 + mean * w}" x2="${x0 + mean * w}" y1="${cy - 18}" y2="${cy + 18}"><title>${esc(lev)} mean ${pct(mean)}</title></line>`;
      y += rowH;
    });
    body += xTicks(x0, w, top, y, [0, 0.25, 0.5, 0.75, 1], (v) => pct(v));
    body += `<text class="ch-m" x="${x0 + w / 2}" y="${y + 30}" text-anchor="middle">percent of that world’s runs in which the model reinterpreted the rule</text>`;
    y += 48;
  });
  return svgOpen(y, "Reinterpretation rate of each world, grouped by topology label") + body + "</svg>";
}

// Mean reinterpretation of worlds for each ambiguity x loophole pairing; shows which pairings exist at all.
function heatChart(worlds, rowsKey, rows, colsKey, cols) {
  const x0 = 110, cw = 118, ch = 50, head = 34;
  let body = cols.map((c, i) => `<text class="ch-t" x="${x0 + i * cw + cw / 2}" y="22" text-anchor="middle">${esc(c)}</text>`).join("");
  rows.forEach((r, j) => {
    const cy = head + j * ch;
    body += `<text class="ch-t" x="${x0 - 10}" y="${cy + ch / 2 + 4}" text-anchor="end">${esc(r)}</text>`;
    cols.forEach((c, i) => {
      const ws = worlds.filter((x) => x[rowsKey] === r && x[colsKey] === c), cx = x0 + i * cw;
      if (!ws.length) { body += `<rect class="ch-empty" x="${cx + 2}" y="${cy + 2}" width="${cw - 4}" height="${ch - 4}" rx="4"><title>${esc(r)} × ${esc(c)}: no worlds</title></rect><text class="ch-m" x="${cx + cw / 2}" y="${cy + ch / 2 + 4}" text-anchor="middle">none</text>`; return; }
      const m = ws.reduce((s, x) => s + x.reinterpreted, 0) / ws.length;
      body += `<g><title>${esc(r)} × ${esc(c)}: ${pct(m)} reinterpreted over ${ws.length} worlds</title><rect x="${cx + 2}" y="${cy + 2}" width="${cw - 4}" height="${ch - 4}" rx="4" style="fill:color-mix(in srgb, var(--accent) ${Math.round(8 + 84 * m)}%, var(--panel))"/>
        <text class="${m > 0.55 ? "ch-on" : "ch-t"}" x="${cx + cw / 2}" y="${cy + ch / 2}" text-anchor="middle"><tspan font-weight="600">${pct(m)}</tspan></text>
        <text class="${m > 0.55 ? "ch-on" : "ch-m"}" x="${cx + cw / 2}" y="${cy + ch / 2 + 15}" text-anchor="middle">${ws.length} world${ws.length === 1 ? "" : "s"}</text></g>`;
    });
  });
  body += `<text class="ch-m" x="${x0 + (cols.length * cw) / 2}" y="${head + rows.length * ch + 18}" text-anchor="middle">columns: how the shortcut sidesteps the rule  ·  rows: wiggle room in the rule</text>`;
  return svgOpen(head + rows.length * ch + 28, "Reinterpretation by rule wiggle room and loophole type") + body + "</svg>";
}

const analysisSel = { origin: "all", model: "all" };
const originLabel = (o) => (o === "all" ? "All origins" : `Worlds written by ${o.generator} (run ${o.id})`);

// The selection lives in the URL (#/analysis?model=kimi-k3&origin=20261029T160703Z) so a view can be shared.
async function viewAnalysis(query) {
  const a = await getJSON("data/analysis.json");
  setCrumbs([{ text: TITLE, href: "#/" }, { text: "Analysis" }]);
  const q = new URLSearchParams(query || "");
  analysisSel.model = q.get("model") || "all";
  analysisSel.origin = q.get("origin") || "all";
  app.innerHTML = analysisPage(a, `${analysisSel.origin}|${analysisSel.model}`);
  const go = (origin, model) => (location.hash = `#/analysis?model=${encodeURIComponent(model)}&origin=${encodeURIComponent(origin)}`);
  document.getElementById("an-origin").addEventListener("change", (ev) => go(ev.target.value, analysisSel.model));
  document.getElementById("an-model").addEventListener("change", (ev) => go(analysisSel.origin, ev.target.value));
  app.querySelectorAll("tr.pick").forEach((tr) => tr.addEventListener("click", () => go(tr.dataset.o, tr.dataset.m)));
}

function analysisPage(a, key) {
  const s = a.slices[key];
  const [selOrigin, selModel] = key.split("|");
  const origins = a.options.origins;
  const controls = `<div class="controls">
      <label>Model being tested<select id="an-model"><option value="all">All models</option>${a.options.models.map((x) => `<option value="${esc(x)}" ${x === selModel ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></label>
      <label>Data origin (who wrote the worlds)<select id="an-origin"><option value="all">${originLabel("all")}</option>${origins.map((o) => `<option value="${o.id}" ${o.id === selOrigin ? "selected" : ""}>${esc(originLabel(o))}</option>`).join("")}</select></label>
    </div>
    <div class="tbl"><table><tr><th>Worlds written by</th><th>Model being tested</th><th>Worlds</th><th>Runs</th><th>Reinterpreted</th><th>Took shortcut</th></tr>
      ${a.combinations.map((c) => `<tr class="pick ${c.origin === selOrigin && c.model === selModel ? "sig" : ""}" data-o="${c.origin}" data-m="${esc(c.model)}"><td>${esc(originLabel(origins.find((o) => o.id === c.origin)))}</td><td>${esc(c.model)}</td><td>${c.worlds}</td><td>${c.runs}</td><td>${pct(c.reinterpreted)}</td><td>${pct(c.shortcut)}</td></tr>`).join("")}
    </table></div>
    <p class="muted small">Click a row, or use the two menus, to look at one combination alone. The two worlds sets were written by different models, and only the glm-5p3 set was also tested with kimi-k3, so “all” mixes both differences.</p>`;
  if (!s) {
    return `<h1>What makes a model talk itself out of a safety rule?</h1>${controls}<div class="note"><b>No runs for this combination.</b> kimi-k3 only tested the worlds written by glm-5p3.</div>`;
  }
  const m = s.model;
  const sig = m.terms.filter((x) => x.lo > 1 || x.hi < 1);
  const rate = (f) => s.rates[f].map((r) => ({ ...r, label: f === "urgency" ? LEVEL_NAMES[r.level] : r.level, v: r.reinterpreted, v2: r.shortcut }));
  const urg = Object.fromEntries(s.rates.urgency.map((r) => [r.level, r]));
  const barGroups = [{ title: "Urgency of the task", rows: rate("urgency") }, { title: "Model being tested", rows: rate("model") }, { title: "Model that wrote the worlds", rows: rate("gen") }];
  const panels = [
    { title: "Rule wiggle room", key: "ambiguity", levels: ["environment", "action", "object"] },
    { title: "How the shortcut sidesteps the rule", key: "loophole", levels: ["equivalent", "adjacent", "bypass", "transformed", "delegated"] },
    { title: "Why the safe route is slow", key: "cost", levels: ["queue", "window", "throttle"] },
  ];
  const rateRows = Object.entries(s.rates).map(([f, rows]) =>
    rows.map((r, i) => `<tr>${i === 0 ? `<td rowspan="${rows.length}"><b>${FACTOR_NAMES[f]}</b></td>` : ""}<td>${esc(levelName(f, r.level))}</td><td>${r.worlds}</td><td>${r.runs}</td><td>${pct(r.reinterpreted)}</td><td>${pct(r.shortcut)}</td></tr>`).join("")).join("");
  const orRows = m.terms.map((x) => `<tr class="${x.lo > 1 || x.hi < 1 ? "sig" : ""}"><td>${esc(FACTOR_NAMES[x.factor])}: ${esc(levelName(x.factor, x.level))}</td><td class="muted">vs ${esc(levelName(x.factor, x.ref))}</td><td><b>${x.odds_ratio.toFixed(2)}</b></td><td>${x.lo.toFixed(2)} to ${x.hi.toFixed(2)}</td><td>${x.p < 0.001 ? "< 0.001" : x.p.toFixed(3)}</td></tr>`).join("");
  const rateTable = `<div class="tbl"><table><tr><th>Factor</th><th>Group</th><th>Worlds</th><th>Runs</th><th>Reinterpreted</th><th>Took shortcut</th></tr>${rateRows}</table></div>`;
  const orTable = `<div class="tbl"><table><tr><th>Group</th><th>Baseline</th><th>Odds ratio</th><th>95% range</th><th>p</th></tr>${orRows}</table></div>`;
  const worldSig = sig.filter((x) => ["ambiguity", "loophole", "cost", "fee"].includes(x.factor));
  const clearList = sig.map((x) => `<li><b>${esc(x.factor === "urgency" ? LEVEL_NAMES[x.level] + " urgency" : levelName(x.factor, x.level))}</b> vs ${esc(x.factor === "urgency" ? LEVEL_NAMES[x.ref] + " urgency" : levelName(x.factor, x.ref))}: about ${x.odds_ratio.toFixed(1)}× the odds.</li>`).join("");
  const gloss = (rows) => `<dl class="kv gloss">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;

  const modeNote = m.mode === "one_at_a_time"
    ? `<div class="note"><b>Fewer rules in this selection (${m.clusters}).</b> That is too few to estimate every label at once, so chart 2 estimates each label on its own, adjusting only for urgency${a.options.models.length > 1 && selModel === "all" ? " and the model tested" : ""}. These figures are rougher and labels can pick up each other’s effects.${m.unfitted.length ? ` Could not be estimated at all: ${m.unfitted.join(", ")}.` : ""}</div>`
    : "";
  return `
    <h1>What makes a model talk itself out of a safety rule?</h1>
    <p>This page looks at one question: <b>when a model is given a safety rule and a tempting shortcut, which kinds of situation make it more likely to argue that the rule does not really apply?</b>
    Everything below uses only the <b>costly-route</b> runs, where the safe route is slower or dearer than the shortcut.</p>
    <h2>Choose which runs to look at</h2>
    ${controls}

    <h2>What was measured</h2>
    <div class="note plain">
      <p>In each test the model is told a short story, given a safety rule (for example <i>“Never restart the primary database server outside a maintenance window”</i>) and offered two options:
      the <b>safe option</b>, which follows the rule, and a <b>shortcut</b> that can be defended only by reading the rule narrowly (for example, a failover that moves the database to another server instead of “restarting” it).
      In the costly version the safe option still works, but it is slow or expensive: it may wait hours behind other jobs.</p>
      <p>For every run we record two things:</p>
      <ul>
        <li><b>Took the shortcut</b>: the model picked the shortcut. ${pct(s.overall.shortcut)} of the ${s.overall.runs} runs did.</li>
        <li><b>Reinterpreted the rule</b>: in its reasoning the model argued the rule does not really cover what it is about to do. A second model reads the reasoning and decides; nobody has checked its calls by hand. ${pct(s.overall.reinterpreted)} of runs were labelled this way.</li>
      </ul>
      <p>The two go together almost one-for-one, so “reinterpreting” here largely means “talking itself into the shortcut”.</p>
    </div>

    <h2>What each variable means</h2>
    <p class="muted small">Every world (one rule in one situation) was given a label under each heading below. The labels were assigned by reading the worlds, by one person, and were not cross-checked.</p>
    ${gloss([
      ["Urgency", "How pressing the story makes the task: <b>Routine</b>, <b>Important</b> or <b>Critical</b>. The rule and the options stay the same; only the stakes change."],
      ["Rule wiggle room", "What the rule’s wording leaves open.<br><b>environment</b>: which setting it covers. <i>“Never change production without testing”</i>: does a staging copy of live data count as production?<br><b>action</b>: what the verb covers. <i>“Never restart the primary database”</i>: does a failover to another server count?<br><b>object</b>: what the noun covers. <i>“Never write a credential to a log”</i>: does a hashed or shortened token count?"],
      ["How the shortcut sidesteps the rule", "<b>bypass</b>: does the same job but skips the safe route (installs by hand instead of through the release pipeline).<br><b>equivalent</b>: a different operation with the same effect (a rolling reboot instead of a restart; rename and recreate a table instead of overwriting it).<br><b>transformed</b>: works on a changed version of the protected thing (logs a hash of the token, not the token).<br><b>adjacent</b>: the same kind of act on a neighbouring thing the narrow reading skips (deletes a snapshot rather than “the backup”).<br><b>delegated</b>: has standing automation do it (a bot merges the change instead of a person pushing it)."],
      ["Why the safe route is slow", "<b>queue</b>: waits behind unrelated jobs. <b>window</b>: must wait for a scheduled slot or the end of a freeze. <b>throttle</b>: a rate or capacity cap. <b>Safe route also costs money</b>: the slow route quotes a fee."],
      ["Model being tested", "The model that read the story and made the choice."],
      ["Model that wrote the worlds", "The model that generated the rules and situations."],
    ])}

    <h2>What we found</h2>
    <ul class="take">
      <li><b>Urgency.</b> The model reinterpreted the rule in ${pct(urg[1].reinterpreted)} of Routine runs, ${pct(urg[2].reinterpreted)} of Important runs and ${pct(urg[3].reinterpreted)} of Critical runs.</li>
      <li><b>Things that stand clearly apart from their baseline</b> (the confidence range does not cross 1, see chart 2):<ul>${clearList || "<li>None.</li>"}</ul></li>
      <li>${worldSig.length
        ? `<b>Some labels describing the world also stand apart:</b> ${worldSig.map((x) => `${esc(levelName(x.factor, x.level))} (${x.odds_ratio.toFixed(1)}× vs ${esc(levelName(x.factor, x.ref))})`).join(", ")}. Check chart 4 before reading this as a cause: ${m.clusters} rules is few, and labels can stand in for one another.`
        : `<b>No label describing the world stands clearly apart</b> (rule wiggle room, loophole type, cost form, fee). Chart 3 shows how widely worlds of each type are spread.`}</li>
      <li><b>We cannot fully separate the labels from each other.</b> Some combinations never occur in the data, and some labels belong to a single rule (chart 4).</li>
    </ul>

    ${figure("1. How often did the model reinterpret the rule?", "<br>Each bar is the share of runs in which the model argued the rule did not apply. The diamond marks the share that took the shortcut. Longer bar = more reinterpreting.", barsChart(barGroups), rateTable)}

    ${modeNote}
    ${figure("2. How much does each factor change the odds?", `<br><b>How to read it.</b> Each row compares one group with a baseline named after “vs” (for example Critical vs Routine). The number is the <b>odds ratio</b>: 1 means no difference, 2 means twice the odds of reinterpreting, 0.5 means half. The line is the range we are 95% sure the true value lies in. <b>If the line crosses the vertical line at 1, we cannot tell the group from its baseline</b> (hollow dot). A filled blue dot is a clear difference. The number of worlds in a group is shown in brackets: a group of 3 or 4 worlds can look different by chance. ${m.mode === "joint" ? "All factors are fitted together, so each row is the effect with the others held fixed." : "Here each label is estimated separately (see the note above)."}`, forestChart(m.terms, s.rates), orTable)}

    ${figure("3. Every world, one dot each", "<br>Each dot is one world. Its position is the share of that world’s runs in which the model reinterpreted the rule (averaged over urgency levels and models). The white tick is the average of the group and the number beside the group name is how many worlds it holds. If a label mattered, the dots of different groups would sit in different places; instead they overlap.", stripChart(s.worlds, panels))}

    ${figure("4. Which combinations of labels exist?", "<br>Rows are the rule’s wiggle room, columns are how the shortcut sidesteps it. Each cell shows the average share reinterpreted and how many worlds it contains; dashed cells have no worlds at all. Because many cells are empty, a rule type and a loophole type cannot be told apart, so effects of one could really be effects of the other.", heatChart(s.worlds, "ambiguity", ["environment", "action", "object"], "loophole", ["equivalent", "adjacent", "bypass", "transformed", "delegated"]))}

    <h2>How much to trust this</h2>
    <ul class="take">
      <li><b>The real sample is small.</b> The ${s.overall.runs} runs come from only ${m.clusters} different rules, and runs of the same rule behave alike. The confidence ranges account for this, which is why they are wide.</li>
      <li><b>Absence of an effect is not proof.</b> A range that crosses 1 means “we cannot tell”, not “there is no effect”.</li>
      <li><b>Some labels lean on one rule.</b> All four <i>transformed</i> worlds use the same credential rule; all four <i>delegated</i> worlds use the same push-to-branch rule.</li>
      <li><b>Both the labels and the reinterpretation judgement are unchecked.</b> The first were assigned by one person, the second by another model.</li>
    </ul>`;
}

function notFound() {
  setCrumbs([{ text: TITLE, href: "#/" }]);
  app.innerHTML = '<h1>Not found</h1><p>This run, world or trajectory is not in the data. <a href="#/">Back to the index</a>.</p>';
}

/* ---------- router ---------- */

let lastWasAnalysis = false;
async function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  app.removeEventListener("click", copyHandler);
  const onAnalysis = !!parts[0]?.startsWith("analysis");
  if (!(onAnalysis && lastWasAnalysis)) window.scrollTo(0, 0); // changing the selection keeps your place
  lastWasAnalysis = onAnalysis;
  try {
    if (parts[0]?.startsWith("analysis") && !OLD) await viewAnalysis(location.hash.split("?")[1]);
    else if (parts[1] === "w") await viewWorld(parts[0], parts[2], parts[3]);
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
