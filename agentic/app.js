"use strict";
// The agentic page: a list of runs and environments, one run's trajectory, one environment as the agent meets it.
// Everything from the data files goes in through textContent, never as HTML.
const app = document.getElementById("app");
const crumbs = document.getElementById("crumbs");

document.getElementById("theme").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme === "dark";
  document.documentElement.dataset.theme = dark ? "light" : "dark";
});

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c) node.append(c);
  return node;
}
const pre = (text) => el("pre", { text });
const getJSON = (path) => fetch(path).then((r) => { if (!r.ok) throw new Error(path + ": " + r.status); return r.json(); });

function setCrumbs(parts) {
  crumbs.replaceChildren();
  parts.forEach(([label, href], i) => {
    if (i) crumbs.append(el("span", { class: "sep", text: "/" }));
    crumbs.append(href ? el("a", { href, text: label }) : el("span", { text: label }));
  });
}

async function showIndex() {
  const index = await getJSON("data/index.json");
  setCrumbs([["Agentic runs"]]);
  const root = el("div");
  root.append(
    el("h1", { text: "Agentic runs" }),
    el("p", { text: "A model works inside a built environment: a shell, some files and a few tools. These pages show one run step by step and the environment exactly as the model met it." }),
    el("p", {}, el("a", { href: "#/analysis" }, el("b", { text: "Multivariate analysis of the latest experiment →" }))),
    el("p", {}, el("a", { href: "#/worlds" }, el("b", { text: "Review the 50 accepted worlds and veto the ones you don't want built →" }))),
    el("h2", { text: "Runs" }),
  );
  // Runs of one experiment are grouped by environment; a run without an experiment stands alone.
  const groups = new Map();
  for (const r of index.runs) {
    const key = r.experiment && r.experiment !== r.id ? r.experiment : "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const ROUTE = { first: "first route", second: "second route", neither: "neither route" };
  for (const [experiment, runs] of groups) {
    if (experiment) root.append(el("h3", { text: experiment + " (" + runs.length + " runs)" }));
    let lastEnv = null;
    for (const r of runs.sort((a, b) => (a.env + a.cost + a.pressure).localeCompare(b.env + b.cost + b.pressure))) {
      if (experiment && r.env !== lastEnv) root.append(el("div", { class: "muted small", text: r.env }));
      lastEnv = r.env;
      const outcome = r.route ? ` · ${ROUTE[r.route]}${r.goal_reached ? "" : ", goal not reached"}` : "";
      root.append(el("a", { class: "listrow", href: "#/run/" + r.id },
        el("div", { class: "t", text: experiment ? `${r.cost} cost · ${r.pressure}${outcome}` : r.title }),
        el("div", { class: "muted small", text: `${r.model.split("/").pop()} · ${r.env} · ${r.cost} cost · ${r.pressure} · ${r.date}` })));
    }
  }
  root.append(el("h2", { text: "Environments" }));
  for (const id of index.envs) {
    root.append(el("a", { class: "listrow", href: "#/env/" + id }, el("div", { class: "t", text: id })));
  }
  app.replaceChildren(root);
}

function messageNode(m) {
  const node = el("div", { class: "msg " + m.role }, el("div", { class: "who", text: m.role === "tool" ? "tool result: " + m.tool : m.role }));
  if (m.reasoning) node.append(el("div", { class: "think" }, el("div", { class: "who", text: "reasoning" }), pre(m.reasoning)));
  if (m.text) node.append(pre(m.text));
  for (const c of m.calls || []) node.append(el("div", { class: "call", text: c.tool + "(" + JSON.stringify(c.arguments) + ")" }));
  return node;
}

async function showRun(id) {
  const run = await getJSON(`data/runs/${id}.json`);
  setCrumbs([["Agentic runs", "#/"], [run.title]]);
  const o = run.outcome;
  const fact = (value, label) => el("div", {}, el("b", { text: String(value) }), el("span", { text: label }));
  const route = o.compliant ? "first route" : o.loophole ? "second route" : "neither";
  const root = el("div");
  root.append(
    el("h1", { text: run.title }),
    el("p", { class: "muted", text: `${run.model} · ${run.date} · one run, ${run.seconds} s · log ${run.source}` }),
    el("div", { class: "facts" },
      fact(route, "route taken"), fact(o.goal_reached ? "yes" : "no", "goal reached"),
      fact(o.cost_paid + " min", "simulated time"), fact(o.rebuild_ran ? "yes" : "no", "in time for the deadline")),
    el("p", { text: `Environment: ` }, el("a", { href: "#/env/" + run.env, text: run.env }),
      document.createTextNode(` · cost version "${run.cost}" · pressure ${run.pressure} · rule: ${run.rule}`)),
    el("p", { class: "muted small", text: "The route is worked out from what the tool calls did, not from what the model said. The model's reasoning is shown as it wrote it; nothing is hidden or edited." }),
    el("h2", { text: "Trajectory" }),
  );
  run.messages.forEach((m) => root.append(messageNode(m)));
  app.replaceChildren(root);
}

async function showEnv(id) {
  const env = await getJSON(`data/envs/${id}.json`);
  setCrumbs([["Agentic runs", "#/"], [env.id]]);
  const files = el("div");
  const tabs = el("div", { class: "tabs" });
  const render = (level) => {
    files.replaceChildren();
    for (const [path, text] of Object.entries(env.workspace[level])) {
      files.append(el("details", { class: "file" }, el("summary", { text: "/workspace/" + path }), pre(text)));
    }
    [...tabs.children].forEach((b) => b.classList.toggle("on", b.dataset.level === level));
  };
  Object.keys(env.workspace).forEach((level) => {
    const b = el("button", { class: "ghost", type: "button", "data-level": level, text: level });
    b.addEventListener("click", () => render(level));
    tabs.append(b);
  });
  const root = el("div");
  root.append(
    el("h1", { text: env.id }),
    el("p", { text: "Everything below is what the model could read or call. Its two containers:" }),
    ...Object.entries(env.containers).map(([name, text]) => el("div", { class: "box" }, el("b", { text: name + ": " }), document.createTextNode(text))),
    el("h2", { text: "System prompt" }), el("div", { class: "box" }, pre(env.system_prompt)),
    el("h2", { text: "Task prompt" }), el("div", { class: "box" }, pre(env.task_prompt)),
    el("h2", { text: "Tools" }),
    ...env.tools.map((t) => el("div", { class: "box" }, el("div", { class: "call", text: `${t.name}(${t.parameters.join(", ")})` }), el("p", { text: t.description }))),
    el("h2", { text: "Files in /workspace" }),
    el("p", { class: "muted small", text: "The same files at every pressure level except the ticket, which changes with the level. Pick a level to see the files as that run saw them." }),
    tabs, files,
  );
  app.replaceChildren(root);
  render(Object.keys(env.workspace).at(-1));
}


const pct = (k, n) => (n ? Math.round((100 * k) / n) + "%" : "–");
const fmtP = (p) => (p < 0.001 ? "< 0.001" : p.toFixed(3));
const fmtRatio = (x) => (x >= 100 ? x.toFixed(0) : x.toFixed(2));
const svgEl = (tag, attrs = {}, text) => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
};

// One model's terms as a forest plot on a log axis; a filled dot means the 95% interval excludes 1.
function forest(terms) {
  const lo = Math.min(0.1, ...terms.map((t) => t.lo)), hi = Math.max(10, ...terms.map((t) => Math.min(t.hi, 1000)));
  const x0 = 250, w = 420, rowH = 34, height = terms.length * rowH + 52;
  const X = (v) => x0 + (w * (Math.log(Math.min(Math.max(v, lo), hi)) - Math.log(lo))) / (Math.log(hi) - Math.log(lo));
  const svg = svgEl("svg", { viewBox: `0 0 ${x0 + w + 40} ${height}`, role: "img", width: "100%", "aria-label": "Odds ratios with 95% intervals" });
  for (let v = 0.1; v <= 1000; v *= 10) {
    if (v < lo * 0.99 || v > hi * 1.01) continue;
    svg.append(svgEl("line", { x1: X(v), x2: X(v), y1: 8, y2: height - 34, stroke: "currentColor", opacity: v === 1 ? 0.7 : 0.15 }),
      svgEl("text", { x: X(v), y: height - 18, "text-anchor": "middle", "font-size": 11, fill: "currentColor", opacity: 0.7 }, String(v)));
  }
  terms.forEach((t, i) => {
    const y = 22 + i * rowH, clear = t.lo > 1 || t.hi < 1;
    svg.append(svgEl("text", { x: x0 - 12, y: y + 4, "text-anchor": "end", "font-size": 12.5, fill: "currentColor" }, t.name),
      svgEl("line", { x1: X(t.lo), x2: X(t.hi), y1: y, y2: y, stroke: "var(--accent)", "stroke-width": 2 }),
      svgEl("circle", { cx: X(t.ratio), cy: y, r: 5, stroke: "var(--accent)", "stroke-width": 2, fill: clear ? "var(--accent)" : "var(--panel)" }));
    const tip = svgEl("title"); tip.textContent = `${t.name} vs ${t.ref}: ${fmtRatio(t.ratio)}×, 95% interval ${fmtRatio(t.lo)} to ${fmtRatio(t.hi)}, p ${fmtP(t.p)}`;
    svg.lastChild.append(tip);
  });
  svg.append(svgEl("text", { x: x0 + w / 2, y: height - 2, "text-anchor": "middle", "font-size": 11, fill: "currentColor", opacity: 0.7 }, "times the odds (or the mean) of the baseline, log scale; 1 = no difference"));
  return svg;
}

function table(head, rows) {
  const t = el("table", { class: "an" }, el("thead", {}, el("tr", {}, ...head.map((h) => el("th", { text: h })))));
  const body = el("tbody");
  rows.forEach((cells) => body.append(el("tr", {}, ...cells.map((c) => el("td", { text: c })))));
  t.append(body);
  return t;
}

const rateRow = (r) => [r.level, r.runs, `${r.loophole} (${pct(r.loophole, r.loophole + r.compliant)})`, r.compliant, r.neither, `${r.goal} (${pct(r.goal, r.runs)})`];
const RATE_HEAD = ["", "runs", "loophole (of routed)", "compliant", "neither", "goal reached"];

function modelNode(m) {
  const node = el("div", { class: "box" });
  node.append(el("h3", { text: m.title }),
    el("p", { class: "muted small", text: `Outcome: ${m.outcome} · ${m.n} runs · ${m.clusters} environments` + (m.pseudo_r2 != null ? ` · pseudo R² ${m.pseudo_r2.toFixed(2)}` : "") }));
  if (m.note) node.append(el("p", { class: "small", text: m.note }));
  if (!m.terms.length) return node;
  node.append(forest(m.terms),
    table(["term", "vs", "ratio", "95% interval", "p"], m.terms.map((t) => [t.name, t.ref, fmtRatio(t.ratio) + "×", `${fmtRatio(t.lo)} to ${fmtRatio(t.hi)}`, fmtP(t.p)])));
  return node;
}

async function showAnalysis() {
  const a = await getJSON("data/analysis.json");
  setCrumbs([["Agentic runs", "#/"], ["Analysis"]]);
  const cellText = (c) => (c.runs ? (c.loophole ? "L" : c.compliant ? "C" : "–") : "");
  const root = el("div");
  root.append(
    el("h1", { text: "Multivariate analysis" }),
    el("p", { class: "muted", text: `${a.experiment} · ${a.runs} runs · ${a.environments} environments · ${a.routed} took one of the two routes` }),
    el("div", { class: "box" },
      el("b", { text: "Read this first. " }),
      document.createTextNode("This is a pilot: one run per cell, one model, ten environments that were built automatically and not yet reviewed for neutrality. "
        + "Standard errors are clustered by environment, and ten clusters is few, so the intervals are rough. The route is worked out from what the tool calls did "
        + "(compliant or loophole); runs that took neither are left out of the route models. Nothing here is a statement about why the model chose as it did.")),
    ...(a.excluded && a.excluded.length ? [el("div", { class: "box" },
      el("b", { text: `Left out: ${a.excluded_runs} runs. ` }),
      ...a.excluded.map((x) => el("p", { class: "small", text: `${x.env}: ${x.reason}` })))] : []),
    el("h2", { text: "Rates" }),
    el("p", { class: "muted small", text: "Loophole share is out of the runs that took a route." }),
    el("h3", { text: "By cost version" }), table(RATE_HEAD, a.tables.by_cost.map(rateRow)),
    el("h3", { text: "By pressure level" }), table(RATE_HEAD, a.tables.by_pressure.map(rateRow)),
    el("h3", { text: "By cost version and pressure" }), table(RATE_HEAD, a.tables.by_cell.map(rateRow)),
    el("h2", { text: "Models" }),
    el("p", { class: "small", text: "An odds ratio of 1 means no difference; 2 means twice the odds of taking the loophole. A filled dot is an interval that excludes 1; a hollow dot means we cannot tell the term from its baseline." }),
    ...a.models.map(modelNode),
    el("h2", { text: "Each environment" }),
    el("p", { class: "muted small", text: "C = compliant route, L = loophole, – = neither. Cells run p1, p2, p3. Environments whose row does not change between the cheap and the costly version say nothing about cost." }),
    table(["environment", "cheap p1 p2 p3", "costly p1 p2 p3"], a.tables.by_env.map((e) => [e.env, e.cheap.map(cellText).join(" "), e.costly.map(cellText).join(" ")])),
  );
  app.replaceChildren(root);
}

// ---- Reviewing the accepted worlds: keep or veto each one before it is built -------------------------------------------
const VETO_KEY = "cd-world-review";
function loadReview() {
  try { return JSON.parse(localStorage.getItem(VETO_KEY) || "{}"); } catch (e) { return {}; }
}
function saveReview(review) {
  try { localStorage.setItem(VETO_KEY, JSON.stringify(review)); } catch (e) { /* private window or blocked storage: the choices last until the page is closed */ }
}
const review = loadReview();
const decision = (id) => (review[id] && review[id].decision) || "";
function decide(id, value) {
  review[id] = { ...(review[id] || {}), decision: review[id] && review[id].decision === value ? "" : value };
  saveReview(review);
}
const worldFilter = { text: "", domain: "all", status: "all", tier: "all", weak: false, builtOnly: false };
const TIERS = [["good", "Most interesting"], ["maybe", "Mixed"], ["weak", "Probably not interesting"]];

// Compliant share (share of choices taking the rule-following option) at each pressure level, cheap and costly version.
function shareChart(levels) {
  const w = 120, h = 46, X = (i) => 14 + i * 46, Y = (v) => 6 + (1 - v) * (h - 16);
  const svg = svgEl("svg", { viewBox: `0 0 ${w} ${h}`, width: w, height: h, role: "img", "aria-label": "Share choosing the compliant option per pressure level" });
  [["cheap_share", "var(--accent)"], ["costly_share", "var(--amber)"]].forEach(([key, color]) => {
    const pts = levels.map((l, i) => (l[key] == null ? null : [X(i), Y(l[key])])).filter(Boolean);
    if (pts.length > 1) svg.append(svgEl("polyline", { points: pts.map((q) => q.join(",")).join(" "), fill: "none", stroke: color, "stroke-width": 2 }));
    pts.forEach((q) => svg.append(svgEl("circle", { cx: q[0], cy: q[1], r: 3, fill: color })));
  });
  levels.forEach((l, i) => svg.append(svgEl("text", { x: X(i), y: h - 1, "text-anchor": "middle", "font-size": 9, fill: "currentColor", opacity: 0.6 }, "p" + l.pressure)));
  return svg;
}

function decisionButtons(id, after) {
  const box = el("span", { class: "decide" });
  [["keep", "Keep"], ["veto", "Veto"]].forEach(([value, label]) => {
    const b = el("button", { class: "ghost" + (decision(id) === value ? " on-" + value : ""), type: "button", text: label });
    b.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); decide(id, value); after(); });
    box.append(b);
  });
  return box;
}

function reviewBar(worlds, rerender) {
  const count = (v) => worlds.filter((w) => decision(w.id) === v).length;
  const kept = worlds.filter((w) => decision(w.id) !== "veto");
  const bar = el("div", { class: "box sticky" });
  bar.append(el("b", { text: `${count("keep")} kept · ${count("veto")} vetoed · ${worlds.length - count("keep") - count("veto")} undecided` }),
    el("span", { class: "muted small", text: "  Choices are saved in this browser only. Anything not vetoed counts as kept." }));
  const actions = el("div", { class: "row" });
  const act = (label, fn) => { const b = el("button", { class: "ghost", type: "button", text: label }); b.addEventListener("click", fn); actions.append(b); return b; };
  const copy = (text, button, done) => { navigator.clipboard.writeText(text).then(() => { button.textContent = done; setTimeout(() => rerender(), 1200); }, () => { window.prompt("Copy:", text); }); };
  const ids = (v) => worlds.filter((w) => decision(w.id) === v).map((w) => w.id);
  const b1 = act("Copy build command for kept worlds", () => copy("./scripts/run/run_env_build.sh --only " + kept.map((w) => w.id).join(" "), b1, "Copied"));
  const b2 = act("Copy vetoed ids", () => copy(ids("veto").join("\n"), b2, "Copied"));
  act("Download review (JSON)", () => {
    const blob = new Blob([JSON.stringify({ reviewed: new Date().toISOString(), source: "agentic/#/worlds", worlds: worlds.map((w) => ({ id: w.id, decision: decision(w.id) || "undecided", note: (review[w.id] && review[w.id].note) || "" })) }, null, 1)], { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: "world-review.json" });
    a.click();
  });
  act("Clear all", () => { if (window.confirm("Clear every keep/veto choice?")) { Object.keys(review).forEach((k) => delete review[k]); saveReview(review); rerender(); } });
  bar.append(actions);
  return bar;
}

async function showWorlds() {
  const data = await getJSON("data/worlds.json");
  let triage = {};
  try { triage = await getJSON("data/triage.json"); } catch (e) { /* the page works without the notes */ }
  const tierOf = (w) => (triage[w.id] && triage[w.id].tier) || "maybe";
  const worlds = [...data.worlds].sort((a, b) => TIERS.findIndex((t) => t[0] === tierOf(a)) - TIERS.findIndex((t) => t[0] === tierOf(b)));
  setCrumbs([["Agentic runs", "#/"], ["Accepted worlds"]]);
  const root = el("div"), list = el("div"), barSlot = el("div");
  const domains = [...new Set(worlds.map((w) => w.domain))].sort();
  const input = (tag, attrs, handler) => { const n = el(tag, attrs); n.addEventListener(tag === "input" && attrs.type === "checkbox" ? "change" : "input", handler); return n; };
  const select = (options, key) => {
    const n = el("select", {}, ...options.map(([v, label]) => el("option", { value: v, text: label })));
    n.value = worldFilter[key]; n.addEventListener("change", () => { worldFilter[key] = n.value; draw(); }); return n;
  };
  const checkbox = (label, key) => {
    const c = el("input", { type: "checkbox" }); c.checked = worldFilter[key];
    c.addEventListener("change", () => { worldFilter[key] = c.checked; draw(); });
    return el("label", { class: "small" }, c, document.createTextNode(" " + label));
  };
  const search = el("input", { type: "search", placeholder: "Search rule, task or id", value: worldFilter.text });
  search.addEventListener("input", () => { worldFilter.text = search.value.toLowerCase(); draw(); });

  function draw() {
    barSlot.replaceChildren(reviewBar(worlds, draw));
    const shown = worlds.filter((w) =>
      (worldFilter.domain === "all" || w.domain === worldFilter.domain) && (worldFilter.tier === "all" || tierOf(w) === worldFilter.tier) &&
      (worldFilter.status === "all" || (worldFilter.status === "undecided" ? !decision(w.id) : decision(w.id) === worldFilter.status)) &&
      (!worldFilter.weak || (w.shift ?? 0) < 0.3) && (!worldFilter.builtOnly || w.built) &&
      (!worldFilter.text || (w.id + w.rule + w.task + w.summary).toLowerCase().includes(worldFilter.text)));
    list.replaceChildren(el("p", { class: "muted small", text: `${shown.length} of ${worlds.length} worlds shown` }));
    let lastTier = "";
    shown.forEach((w) => {
      if (tierOf(w) !== lastTier) {
        lastTier = tierOf(w);
        const n = shown.filter((x) => tierOf(x) === lastTier).length;
        list.append(el("h2", { text: `${TIERS.find((t) => t[0] === lastTier)[1]} (${n})` }));
      }
      const note = triage[w.id] || {};
      const tags = el("div", { class: "tags" });
      const tag = (text, cls) => tags.append(el("span", { class: "tag " + (cls || ""), text }));
      tag(w.shift == null ? "shift n/a" : `shift ${w.shift.toFixed(2)}`, (w.shift ?? 0) < 0.3 ? "warn" : "");
      if (w.built) tag("built");
      if (w.flaws.length) tag(`${w.flaws.length} open flaw${w.flaws.length > 1 ? "s" : ""}`, "warn");
      const row = el("a", { class: "listrow world " + decision(w.id), href: "#/world/" + encodeURIComponent(w.id) },
        el("div", { class: "grow" },
          el("div", { class: "t", text: note.title || w.id }),
          el("div", { class: "small", text: note.dilemma || w.rule }),
          note.take ? el("div", { class: "small take", text: "My take: " + note.take }) : el("span"),
          el("div", { class: "muted small", text: `${w.rule}  ·  ${w.id}` }), tags),
        shareChart(w.levels), decisionButtons(w.id, draw));
      list.append(row);
    });
  }
  const suggest = el("button", { class: "ghost", type: "button", text: "Start from my suggestion: veto the 'not interesting' ones" });
  suggest.addEventListener("click", () => {
    worlds.forEach((w) => { if (!decision(w.id) && tierOf(w) === "weak") decide(w.id, "veto"); });
    draw();
  });
  root.append(el("h1", { text: "Accepted worlds" }),
    el("p", { class: "muted", text: `${worlds.length} worlds from ${data.source}. Veto the ones you don't want built into environments.` }),
    el("div", { class: "box small" },
      document.createTextNode("Each card shows the rule, what the world is about and a small chart of the share of choices that took the rule-following option at "
        + "pressure p1 to p3: blue is the cheap version, amber the costly one. A world works as a test when the amber line sits clearly below the blue one. "
        + "Shift is that gap at p3 from the generator's own screening (six answers per version, from the same model that wrote the world), not an independent check. "
        + "Open the card to read the rule, both options, and all three situations as the agent would see them. "
        + "The tiers and the 'My take' lines are my judgement from reading each world's rule, ambiguity, options and costly ending, not a measurement.")),
    barSlot, el("div", {}, suggest),
    el("div", { class: "row filters" }, search, select([["all", "Any tier"], ...TIERS], "tier"), select([["all", "All domains"], ...domains.map((d) => [d, d])], "domain"),
      select([["all", "Any decision"], ["undecided", "Undecided"], ["keep", "Kept"], ["veto", "Vetoed"]], "status"),
      checkbox("shift below 0.3", "weak"), checkbox("already built", "builtOnly")),
    list);
  app.replaceChildren(root);
  draw();
}

async function showWorld(id) {
  const data = await getJSON("data/worlds.json");
  const w = data.worlds.find((x) => x.id === id);
  if (!w) { app.replaceChildren(el("p", { class: "muted", text: "No such world: " + id })); return; }
  setCrumbs([["Agentic runs", "#/"], ["Accepted worlds", "#/worlds"], [w.id]]);
  const root = el("div"), head = el("div"), body = el("div");
  const drawHead = () => {
    head.replaceChildren(decisionButtons(w.id, drawHead));
    const note = el("textarea", { rows: "2", placeholder: "Note on this world (saved in this browser)" });
    note.value = (review[w.id] && review[w.id].note) || "";
    note.addEventListener("input", () => { review[w.id] = { ...(review[w.id] || {}), note: note.value }; saveReview(review); });
    head.append(el("div", {}, note));
  };
  const box = (title, text) => el("div", { class: "box" }, el("b", { text: title + " " }), document.createTextNode(text));
  let level = w.levels.length - 1;
  const levelBody = el("div"), tabs = el("div", { class: "tabs" });
  const drawLevel = () => {
    const l = w.levels[level];
    [...tabs.children].forEach((b, i) => b.classList.toggle("on", i === level));
    levelBody.replaceChildren(
      el("p", { class: "muted small", text: `Chooser, rule shown: cheap version ${JSON.stringify(l.counts.cheap)} · costly version ${JSON.stringify(l.counts.costly)} (A is the compliant option).` }),
      el("h3", { text: "What the agent has seen so far" }), el("div", { class: "box" }, pre(l.situation)),
      el("div", { class: "two" },
        el("div", {}, el("h3", { text: "Cheap version ends" }), el("div", { class: "box" }, pre(l.cheap_ending))),
        el("div", {}, el("h3", { text: "Costly version ends" }), el("div", { class: "box" }, pre(l.costly_ending)))),
      el("h3", { text: "Files and tools in the workspace" }), ...l.workspace.map((f) => el("div", { class: "box small" }, pre(f))),
      ...l.flaws.map((f) => el("div", { class: "box warnbox small", text: "Open flaw: " + f })));
  };
  w.levels.forEach((l, i) => { const b = el("button", { class: "ghost", type: "button", text: "p" + l.pressure }); b.addEventListener("click", () => { level = i; drawLevel(); }); tabs.append(b); });
  body.append(
    box("Rule:", w.rule), box("What makes it ambiguous:", w.ambiguity),
    box("If the rule is read broadly:", w.explicit || "(not recorded)"),
    box("The task:", w.task),
    el("div", { class: "two" },
      el("div", { class: "box" }, el("b", { text: "Compliant option" }), pre(w.compliant_option)),
      el("div", { class: "box" }, el("b", { text: "Loophole option" }), pre(w.loophole_option))),
    box("Why someone might take the loophole:", w.loophole_rationale), box("What the loophole risks:", w.loophole_risk),
    el("h2", { text: "The three pressure levels" }), tabs, levelBody);
  root.append(el("h1", { text: w.id }),
    el("p", { class: "muted", text: `${w.domain} · ${w.shift == null ? "shift n/a" : "shift " + w.shift.toFixed(2)}${w.built ? " · already built" : ""} · source ${w.source_id}` }),
    head, shareChart(w.levels), body);
  app.replaceChildren(root);
  drawHead(); drawLevel();
}

async function route() {
  const [, kind, id] = location.hash.split("/");
  try {
    if (kind === "worlds") await showWorlds();
    else if (kind === "world") await showWorld(decodeURIComponent(id));
    else if (kind === "analysis") await showAnalysis();
    else if (kind === "run") await showRun(id);
    else if (kind === "env") await showEnv(id);
    else await showIndex();
  } catch (e) {
    app.replaceChildren(el("p", { class: "muted", text: "Could not load this page: " + e.message }));
  }
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);
route();
