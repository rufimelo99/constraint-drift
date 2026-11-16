// Run viewer for the agentic baseline of the 20 worlds. Runs are fetched from agentic/<world>.json on click.
const A_RULE_WORDS = /\b(rule|policy|forbid\w*|prohibit\w*|must not|not allowed|violat\w*|permitted|restriction|constraint)\b/gi;
const A_KIND = { l: "Reads or inspects", a: "Changes something", s: "Final report" };
const aCache = {};
const ael = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text !== undefined) x.textContent = text; return x; };

function aMarked(text) {
  const p = ael("p", "think");
  let last = 0;
  for (const m of text.matchAll(A_RULE_WORDS)) {
    p.append(document.createTextNode(text.slice(last, m.index)), ael("mark", "", m[0]));
    last = m.index + m[0].length;
  }
  p.append(document.createTextNode(text.slice(last)));
  return p;
}

function aTimeline(run, cards) {
  const bar = ael("div", "tl");
  run.steps.forEach((s, k) => {
    const g = ael("span", "tlg" + (s.rule ? " rule" : ""));
    s.calls.forEach(c => {
      const b = ael("button", "tlc " + c.k);
      b.title = "Step " + (k + 1) + ": " + c.tool + " (" + A_KIND[c.k] + ")";
      b.onclick = () => { cards[k].open = true; cards[k].scrollIntoView({ block: "center", behavior: "smooth" }); };
      g.append(b);
    });
    if (!s.calls.length) g.append(ael("span", "tlc none"));
    bar.append(g);
  });
  return bar;
}

function aStep(s, k, last) {
  const d = ael("details", "stp");
  d.open = k === 0 || last || s.calls.some(c => c.k !== "l");
  const sum = ael("summary");
  sum.append(ael("span", "n", "Step " + (k + 1)), ael("span", "tools", [...new Set(s.calls.map(c => c.tool))].join(", ") || "no tool call"));
  if (s.rule) sum.append(ael("span", "badge", "mentions the rule"));
  d.append(sum);
  if (s.think) d.append(aMarked(s.think));
  if (s.say) d.append(ael("p", "say", s.say));
  s.calls.forEach(c => {
    const l = ael("div", "call " + c.k);
    l.append(ael("span", "ck", c.k === "l" ? "read" : c.k === "a" ? "act" : "submit"), ael("strong", "", c.tool), document.createTextNode(" " + c.args));
    if (c.result) l.append(ael("div", "res", "→ " + c.result));
    d.append(l);
  });
  return d;
}

async function openAgentic(w, j, button) {
  const box = document.getElementById("ag" + w);
  document.querySelectorAll('.acell.on[data-a="' + w + '"]').forEach(x => x.classList.remove("on"));
  button.classList.add("on");
  box.hidden = false; box.replaceChildren(ael("p", "muted", "Loading…"));
  try { aCache[w] = aCache[w] || (await (await fetch("agentic/" + w + ".json")).json()).runs; }
  catch (_) { box.replaceChildren(ael("p", "muted", "Could not load this run.")); return; }
  const runs = aCache[w], r = runs[j];
  const head = ael("div", "hd");
  head.append(ael("span", "badge " + r.outcome, r.outcome), ael("strong", "", r.kind + " P" + r.pressure), ael("span", "", r.cost),
    ael("span", "muted", r.calls + " tool calls · " + (r.goal ? "goal reached" : "goal not reached") + (r.cancelled ? " · cut short" : "")));
  const nav = ael("div", "nav");
  const go = d => { const n = (j + d + runs.length) % runs.length; const b = document.querySelector('.acell[data-a="' + w + '"][data-j="' + n + '"]'); if (b) { history.replaceState(null, "", "#a" + w + "-" + n); openAgentic(w, n, b); } };
  const prev = ael("button", "ghost", "‹ Previous run"), next = ael("button", "ghost", "Next run ›"), all = ael("button", "ghost", "Expand all steps");
  prev.onclick = () => go(-1); next.onclick = () => go(1);
  nav.append(prev, next, all, ael("span", "muted small", "Run " + (j + 1) + " of " + runs.length));
  const cards = r.steps.map((s, k) => aStep(s, k, k === r.steps.length - 1));
  all.onclick = () => { const open = cards.some(c => !c.open); cards.forEach(c => c.open = open); all.textContent = open ? "Collapse all steps" : "Expand all steps"; };
  const legend = ael("div", "key");
  legend.append(ael("span", "tlc l"), " reads or inspects  ", ael("span", "tlc a"), " changes something  ", ael("span", "tlc s"), " final report  ", ael("span", "tlg rule sample"), " step mentions the rule (keyword match)");
  const out = [head, nav, aTimeline(r, cards), legend, ...cards];
  if (r.report) { const f = ael("div", "final"); f.append(ael("div", "lbl", "Final report"), ael("p", "", r.report)); out.push(f); }
  box.replaceChildren(...out);
}

document.addEventListener("click", ev => {
  const b = ev.target.closest(".acell"); if (!b) return;
  history.replaceState(null, "", "#a" + b.dataset.a + "-" + b.dataset.j);
  openAgentic(b.dataset.a, +b.dataset.j, b);
});
{
  const m = location.hash.match(/^#a(\d+)-(\d+)$/);
  if (m) { const b = document.querySelector('.acell[data-a="' + m[1] + '"][data-j="' + m[2] + '"]'); if (b) openAgentic(m[1], +m[2], b).then(() => b.scrollIntoView({ block: "center" })); }
}
