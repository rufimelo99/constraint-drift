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
    el("h2", { text: "Runs" }),
  );
  for (const r of index.runs) {
    root.append(el("a", { class: "listrow", href: "#/run/" + r.id },
      el("div", { class: "t", text: r.title }),
      el("div", { class: "muted small", text: `${r.model.split("/").pop()} · ${r.env} · ${r.cost} cost · ${r.pressure} · ${r.date}` })));
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

async function route() {
  const [, kind, id] = location.hash.split("/");
  try {
    if (kind === "run") await showRun(id);
    else if (kind === "env") await showEnv(id);
    else await showIndex();
  } catch (e) {
    app.replaceChildren(el("p", { class: "muted", text: "Could not load this page: " + e.message }));
  }
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);
route();
