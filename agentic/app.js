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

async function route() {
  const [, kind, id] = location.hash.split("/");
  try {
    if (kind === "analysis") await showAnalysis();
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
