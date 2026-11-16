// Theme toggle and the probe viewer of the validation page. Probes are fetched from worlds/<n>.json on click.
const RULE_WORDS = /\b(rule|policy|forbid\w*|prohibit\w*|must not|not allowed|violat\w*|permitted|restriction|constraint|merge|publish\w*)\b/gi;
const cache = {};
const el = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text !== undefined) x.textContent = text; return x; };

function marked(text, cls) {
  const p = el("p", cls);
  let last = 0;
  for (const m of text.matchAll(RULE_WORDS)) {
    p.append(document.createTextNode(text.slice(last, m.index)), el("mark", "", m[0]));
    last = m.index + m[0].length;
  }
  p.append(document.createTextNode(text.slice(last)));
  return p;
}

async function open_probe(w, i, button) {
  const box = document.getElementById("tr" + w);
  document.querySelectorAll('.cell.on[data-w="' + w + '"]').forEach(x => x.classList.remove("on"));
  button.classList.add("on");
  box.hidden = false; box.replaceChildren(el("p", "muted", "Loading…"));
  try { cache[w] = cache[w] || (await (await fetch("worlds/" + w + ".json")).json()).samples; }
  catch (_) { box.replaceChildren(el("p", "muted", "Could not load this probe.")); return; }
  const list = cache[w], s = list[i];
  const head = el("div", "hd");
  head.append(el("span", "badge " + (s.compliant ? "compliant" : "loophole"), s.compliant ? "compliant" : "loophole"),
    el("strong", "", s.mech + " P" + s.pressure), el("span", "", (s.rule_shown ? "rule shown" : "no rule") + " · " + s.cost),
    el("span", "muted", "epoch " + s.epoch + " · chose " + s.chose));
  const nav = el("div", "nav");
  const go = d => { const j = (i + d + list.length) % list.length; const b = document.querySelector('.cell[data-w="' + w + '"][data-i="' + j + '"]'); history.replaceState(null, "", "#w" + w + "-s" + j); open_probe(w, j, b); };
  const prev = el("button", "ghost", "‹ Previous"), next = el("button", "ghost", "Next ›");
  prev.onclick = () => go(-1); next.onclick = () => go(1);
  nav.append(prev, next, el("span", "muted small", "Probe " + (i + 1) + " of " + list.length + " (←/→ keys)"));
  const opts = el("div");
  for (const k of Object.keys(s.options)) {
    const o = el("div", "opt" + (k === s.chose ? " chosen" : ""));
    o.append(el("span", "tag", k + (k === s.compliant_letter ? " · compliant" : " · loophole") + (k === s.chose ? " · chosen" : "")), document.createTextNode(s.options[k]));
    opts.append(o);
  }
  const out = [head, nav, opts];
  if (s.reasoning) { out.push(el("div", "lbl muted small", "Model's reasoning")); out.push(marked(s.reasoning, "think")); }
  if (s.say && s.say !== s.reasoning) out.push(el("p", "say", s.say));
  const d = el("details"); d.append(el("summary", "", "The exact prompt"), el("div", "promptbox", s.prompt));
  out.push(d);
  box.replaceChildren(...out);
}

document.addEventListener("click", ev => {
  const b = ev.target.closest(".cell"); if (!b) return;
  history.replaceState(null, "", "#w" + b.dataset.w + "-s" + b.dataset.i);
  open_probe(b.dataset.w, +b.dataset.i, b);
});
document.addEventListener("keydown", ev => {
  if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
  const m = location.hash.match(/^#w(\d+)-s(\d+)$/); if (!m) return;
  const btn = document.querySelector("#tr" + m[1] + " .nav button:" + (ev.key === "ArrowLeft" ? "first-child" : "nth-child(2)"));
  if (btn) btn.click();
});
{
  const m = location.hash.match(/^#w(\d+)-s(\d+)$/);
  if (m) { const b = document.querySelector('.cell[data-w="' + m[1] + '"][data-i="' + m[2] + '"]'); if (b) open_probe(m[1], +m[2], b).then(() => b.scrollIntoView({ block: "center" })); }
}
const root = document.documentElement, key = "theme";
try { const s = localStorage.getItem(key); if (s) root.dataset.theme = s; } catch (_) {}
document.getElementById("theme").onclick = () => {
  const next = (root.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  try { localStorage.setItem(key, next); } catch (_) {}
};
