// Theme toggle and the run viewer of the breakdown page. Runs are fetched from runs/<task>.json when a cell is clicked.
const RULE_WORDS = /\b(rule|policy|forbid\w*|prohibit\w*|retention hold|must not|not allowed|violat\w*|permitted|restriction|constraint)\b/gi;
const KIND = { l: "Reads or inspects", a: "Changes something", s: "Final report" };
const cache = {};
const el = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text !== undefined) x.textContent = text; return x; };

function marked(text) {
  const p = el("p", "think");
  let last = 0;
  for (const m of text.matchAll(RULE_WORDS)) {
    p.append(document.createTextNode(text.slice(last, m.index)), el("mark", "", m[0]));
    last = m.index + m[0].length;
  }
  p.append(document.createTextNode(text.slice(last)));
  return p;
}

function timeline(run, steps) {
  const bar = el("div", "tl");
  run.steps.forEach((s, k) => {
    const g = el("span", "tlg" + (s.rule ? " rule" : ""));
    s.calls.forEach(c => {
      const b = el("button", "tlc " + c.k);
      b.title = "Step " + (k + 1) + ": " + c.tool + " (" + KIND[c.k] + ")";
      b.onclick = () => { steps[k].open = true; steps[k].scrollIntoView({ block: "center", behavior: "smooth" }); };
      g.append(b);
    });
    if (!s.calls.length) g.append(el("span", "tlc none"));
    bar.append(g);
  });
  return bar;
}

function stepCard(s, k, last) {
  const d = el("details", "stp");
  const acts = s.calls.some(c => c.k !== "l");
  d.open = k === 0 || acts || last;
  const sum = el("summary");
  sum.append(el("span", "n", "Step " + (k + 1)));
  const names = [...new Set(s.calls.map(c => c.tool))].join(", ");
  sum.append(el("span", "tools", names || "no tool call"));
  if (s.rule) sum.append(el("span", "badge", "mentions the rule"));
  d.append(sum);
  if (s.think) d.append(marked(s.think));
  if (s.say) d.append(el("p", "say", s.say));
  s.calls.forEach(c => {
    const l = el("div", "call " + c.k);
    l.append(el("span", "ck", c.k === "l" ? "read" : c.k === "a" ? "act" : "submit"), el("strong", "", c.tool), document.createTextNode(" " + c.args));
    if (c.result) l.append(el("div", "res", "→ " + c.result));
    d.append(l);
  });
  return d;
}

async function open_run(t, i, button) {
  const box = document.getElementById("tr" + t);
  document.querySelectorAll('.cell.on[data-t="' + t + '"]').forEach(x => x.classList.remove("on"));
  button.classList.add("on");
  box.hidden = false; box.replaceChildren(el("p", "muted", "Loading…"));
  try { cache[t] = cache[t] || await (await fetch("runs/" + t + ".json")).json(); }
  catch (_) { box.replaceChildren(el("p", "muted", "Could not load this run.")); return; }
  const runs = cache[t].runs, r = runs[i];
  const head = el("div", "hd");
  head.append(el("span", "badge " + r.outcome, r.outcome),
    el("strong", "", r.model), el("span", "", r.cost + " · " + r.pressure.toUpperCase()),
    el("span", "muted", r.calls + " tool calls · " + (r.goal ? "goal reached" : "goal not reached") + (r.cancelled ? " · cut short" : "")));
  const nav = el("div", "nav");
  const go = d => { const j = (i + d + runs.length) % runs.length; const b = document.querySelector('.cell[data-t="' + t + '"][data-i="' + j + '"]'); history.replaceState(null, "", "#t" + t + "-r" + j); open_run(t, j, b); };
  const prev = el("button", "ghost", "‹ Previous run"), next = el("button", "ghost", "Next run ›");
  prev.onclick = () => go(-1); next.onclick = () => go(1);
  const all = el("button", "ghost", "Expand all steps");
  nav.append(prev, next, all, el("span", "muted small", "Run " + (i + 1) + " of " + runs.length + " (←/→ keys)"));
  const cards = r.steps.map((s, k) => stepCard(s, k, k === r.steps.length - 1));
  all.onclick = () => { const open = cards.some(c => !c.open); cards.forEach(c => c.open = open); all.textContent = open ? "Collapse all steps" : "Expand all steps"; };
  const legend = el("div", "key");
  legend.append(el("span", "tlc l"), " reads or inspects  ", el("span", "tlc a"), " changes something  ", el("span", "tlc s"), " final report  ", el("span", "tlg rule sample"), " step mentions the rule (keyword match)");
  const out = [head, nav, timeline(r, cards), legend, ...cards];
  if (r.report) { const f = el("div", "final"); f.append(el("div", "lbl", "Final report"), el("p", "", r.report)); out.push(f); }
  box.replaceChildren(...out);
  box.dataset.i = i;
}

document.addEventListener("click", ev => {
  const b = ev.target.closest(".cell"); if (!b) return;
  history.replaceState(null, "", "#t" + b.dataset.t + "-r" + b.dataset.i);
  open_run(b.dataset.t, +b.dataset.i, b);
});
document.addEventListener("keydown", ev => {
  if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
  const m = location.hash.match(/^#t(\d+)-r(\d+)$/);
  if (!m || ev.target.closest("input, select, textarea")) return;
  const btn = document.querySelector("#tr" + m[1] + " .nav button:" + (ev.key === "ArrowLeft" ? "first-child" : "nth-child(2)"));
  if (btn) btn.click();
});
{
  const m = location.hash.match(/^#t(\d+)-r(\d+)$/);
  if (m) { const b = document.querySelector('.cell[data-t="' + m[1] + '"][data-i="' + m[2] + '"]'); if (b) open_run(m[1], +m[2], b).then(() => b.scrollIntoView({ block: "center" })); }
}

const root = document.documentElement, key = "theme";
try { const s = localStorage.getItem(key); if (s) root.dataset.theme = s; } catch (_) {}
document.getElementById("theme").onclick = () => {
  const next = (root.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  try { localStorage.setItem(key, next); } catch (_) {}
};
