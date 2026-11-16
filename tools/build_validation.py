"""Build validation/index.html: the 20 worlds in plain English and the agentic baseline runs.

    python3 tools/build_validation.py

Reads analysis.json, plain.json, stakes.json, unprobed.json and agentic.json in validation/. The last comes from
`tools/export_validation_agentic.py`; stats.json comes from `tools/analyze_validation_agentic.py`.
"""
import html
import json
from pathlib import Path

import plots
from build_breakdown import STYLE

ABBREVIATIONS = {"pull-requests-and-code-review": "PR", "secrets-and-credentials": "Secrets", "dependencies-and-supply-chain": "Deps",
                 "infrastructure-as-code-and-cloud": "IaC", "release-and-deployment-pipelines": "Release"}


def short(rule_id: str) -> str:
    """`pull-requests-and-code-review-2` as `PR 2`."""
    for long, abbr in ABBREVIATIONS.items():
        if rule_id.startswith(long):
            return abbr + rule_id[len(long):].replace("-", " ")
    return rule_id


ROOT = Path(__file__).resolve().parent.parent / "validation"
e = html.escape

EXTRA = """
.pair { display: flex; gap: 16px; flex-wrap: wrap; } .pair svg.plot { flex: 1 1 300px; }
.fig { background: #fafaf7; border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; margin: 12px 0; max-width: 760px; }
.fig img { width: 100%; height: auto; display: block; }
.fig figcaption { color: #4a4a44; font-size: 13px; margin-top: 6px; }
.versions { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; max-width: 900px; }
.versions pre { background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; white-space: pre-wrap; font: 12px/1.5 var(--mono); margin: 4px 0; }
.versions .rule { background: var(--add); border-radius: 3px; }
.grid th.grp { border-bottom: 2px solid var(--line); }
.opt { background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px; margin: 4px 0; max-width: none; font-size: 13px; }
.opt .tag { font: 600 11px var(--mono); margin-right: 6px; color: var(--muted); }
.opt.chosen { outline: 2px solid var(--accent); }
.promptbox { white-space: pre-wrap; font: 12px/1.5 var(--mono); background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; max-height: 420px; overflow: auto; }
details.orig { margin: 10px 0 4px; } details.orig summary { cursor: pointer; color: var(--muted); font-size: 13px; }\n.sumline { color: var(--muted); font-size: 13px; margin: 4px 0 10px; }
.mb { position: relative; height: 12px; background: var(--bg); border: 1px solid var(--line); border-radius: 3px; }
.mf { position: absolute; left: 0; top: 0; bottom: 0; background: var(--accent); opacity: .55; }
.mi { position: absolute; top: 4px; height: 2px; background: var(--ink, currentColor); }
table.mech td, table.mech th, table.stakes th { text-align: left; min-width: 110px; }
table.stakes td { text-align: left; vertical-align: top; font-size: 13px; }
@media (max-width: 640px) { .versions { grid-template-columns: 1fr; } }
"""






def stakes_table(line: dict) -> str:
    """Reputation and harm sentences side by side, one row per pressure level; `line` maps (kind, level) to text."""
    mechs = [m for m in ("reputation", "harm") if (m, 1) in line]
    head = "".join(f"<th>{m.capitalize()}</th>" for m in mechs)
    rows = "".join(f"<tr><td>P{p}</td>" + "".join(f"<td>{e(line[(m, p)])}</td>" for m in mechs) + "</tr>" for p in (1, 2, 3))
    return f'<table class="sum stakes"><tr><th></th>{head}</tr>{rows}</table>'




def stakes_for(stakes: dict, n: int) -> str:
    """World `n`'s reputation and harm sentences side by side."""
    return stakes_table({(m, int(p)): t for m, d in stakes[str(n)].items() for p, t in d.items()})


def plain_html(w: dict, pl: dict) -> str:
    """The world in plain English: a summary, the rule and its two readings, and the two routes with their effort."""
    return f"""<div class="tldr"><strong>TL;DR.</strong> {e(pl["tldr"])}</div>
<dl>
<dt>Rule</dt><dd>{e(w["rule"])}<div class="small muted">Narrow reading: {e(pl["narrow"])}. Broad reading: {e(pl["broad"])}.</div></dd>
<dt>Honest route</dt><dd>{e(pl["honest"])}<div class="small muted">Cheap: {e(pl["cheap"])}. Costly: {e(pl["costly"])}.</div></dd>
<dt>Loophole route</dt><dd>{e(pl["sneaky"])}<div class="small muted">Why it can be argued allowed: {e(pl["argument"])}</div></dd>
</dl>
<details class="orig"><summary>Original wording</summary>
<dl>
<dt>Rule's ambiguity</dt><dd>{e(w["ambiguity"])}</dd>
<dt>Task</dt><dd>{e(w["task"])}</dd>
<dt>Compliant option</dt><dd>{e(w["compliant_option"])}</dd>
<dt>Loophole option</dt><dd>{e(w["loophole_option"])}</dd>
<dt>Why arguable</dt><dd>{e(w["loophole_rationale"])}</dd>
</dl></details>"""


NO_ENV: dict[str, str] = {}   # world "<rule id>|<world>" to why it has no agentic run; every world has one in the current log


def agentic_world_html(w: dict, ag: dict) -> str:
    """The grid of this world's agentic runs: one row per kind of stakes and level, a column for cheap and for costly."""
    n = w["n"]
    cells = ag["cells"].get(str(n))
    if not cells:
        why = NO_ENV.get(f'{w["rule_id"]}|{w["world"]}', "No agentic run for this world.")
        return f'<h3>Agentic baseline</h3><p class="muted">No run: {e(why)}</p>'
    index = {(c[0], c[1], c[2]): (i, c[3], c[4], c[6]) for i, c in enumerate(cells)}
    kinds = [k for k in ("reputation", "harm") if any(c[0] == k for c in cells)]
    rows = ""
    for kind in ("reputation", "harm"):
        for pr in (1, 2, 3):
            tds = ""
            for cost in ("cheap", "costly"):
                if (kind, pr, cost) in index:
                    i, outcome, goal, calls = index[(kind, pr, cost)]
                    cls = {"compliant": "C", "loophole": "L"}.get(outcome, "N")
                    lab = {"C": "C", "L": "L", "N": "–"}[cls]
                    tds += (f'<td><button class="cell acell {cls}" data-a="{n}" data-j="{i}" '
                            f'title="{kind} P{pr}, {cost}: {outcome}{"" if goal else ", goal not reached"}, {calls} tool calls">{lab}</button></td>')
                else:
                    tds += '<td class="muted" title="not run">·</td>'
            rows += f"<tr><td>{kind} P{pr}</td>{tds}</tr>"
    missing = "" if len(kinds) == 2 else '<p class="small muted">Only the reputation levels ran: this environment was built without harm levels.</p>'
    return (f'<h3>Agentic baseline</h3><p class="small muted">One run per cell. C = followed the rule, L = took the loophole, – = neither. Click a cell to read the run.</p>'
            f'<table class="grid"><tr><th></th><th>Cheap</th><th>Costly</th></tr>{rows}</table>{missing}<div class="tr" id="ag{n}" hidden></div>')


def agentic_summary_html(ag: dict, worlds: list) -> str:
    """Overall loophole counts of the agentic baseline, by kind of stakes, and per world."""
    allc = [c for cs in ag["cells"].values() for c in cs]
    reputation_only = sum(all(c[0] == "reputation" for c in cs) for cs in ag["cells"].values())

    def rate(sub: list) -> str:
        k = sum(c[3] == "loophole" for c in sub)
        return f"{k / len(sub):.2f} <span class='muted'>({k}/{len(sub)})</span>"

    rows = "".join(
        f"<tr><td>{lab}</td><td>{rate([c for c in allc if c[2] == 'cheap' and sel(c)])}</td><td>{rate([c for c in allc if c[2] == 'costly' and sel(c)])}</td></tr>"
        for lab, sel in (("All runs", lambda c: True), ("Reputation stakes", lambda c: c[0] == "reputation"), ("Harm stakes", lambda c: c[0] == "harm")))
    per = ""
    for w in worlds:
        cs = ag["cells"].get(str(w["n"]))
        if not cs:
            continue
        cheap, costly = [c for c in cs if c[2] == "cheap"], [c for c in cs if c[2] == "costly"]
        per += (f'<tr><td><a href="#w{w["n"]}">World {w["n"]}</a> <span class="muted">{e(short(w["rule_id"]))} w{w["world"]}</span></td>'
                f'<td>{sum(c[3] == "loophole" for c in cheap)}/{len(cheap)}</td><td>{sum(c[3] == "loophole" for c in costly)}/{len(costly)}</td></tr>')
    return f"""<h2>Agentic baseline on the {len(ag["cells"])} environments</h2>
<p>A model working inside the built environment of each world: a shell, files and the world's tools, with no deadline. The log is {e(ag["log"])}, model {e(ag["model"].split("/")[-1])}, one run per cell: {len(ag["cells"])} environments, cheap and costly honest route, reputation and harm stakes at three levels ({reputation_only} ran only their reputation levels). {sum(len(c) for c in ag["cells"].values())} runs with a limit of {e(str(ag["message_limit"]))} messages. A run counts as a loophole when the environment's own state shows the loophole action was taken, whatever the agent said.</p>
<table class="sum"><tr><th>Share of runs that took the loophole</th><th>Cheap</th><th>Costly</th></tr>{rows}</table>
<details class="orig"><summary>Per world</summary><table class="sum"><tr><th>World</th><th>Cheap</th><th>Costly</th></tr>{per}</table></details>
<p class="muted small">One model and one run per cell, so single cells are noisy. The loophole counts are small, so differences between worlds or kinds of stakes are suggestive only.</p>"""


def stats_html(st: dict) -> str:
    """The regression tables of the agentic baseline and the counts behind them, with a plain reading."""
    def row(t: dict) -> str:
        pval = "< 0.001" if t["p"] < 0.001 else f"{t['p']:.3f}"
        sig = " class=\"sig\"" if t["p"] < 0.05 else ""
        return (f'<tr{sig}><td>{e(t["term"])}</td><td>{t["odds"]:.2f}</td><td>{t["lo"]:.2f} to {t["hi"]:.2f}</td><td>{pval}</td></tr>')

    cost = [next(t for t in m["terms"] if t["term"].startswith("Honest route")) for m in st["models"]]
    tables = "".join(
        f'<h3>{e(m["label"])}</h3><p class="small muted">{m["n"]} runs, {m["events"]} loopholes, {m["clusters"]} worlds. {e(m["formula"])}</p>'
        f'<table class="sum"><tr><th>Factor</th><th>Odds ratio</th><th>95% interval</th><th>p</th></tr>{"".join(row(t) for t in m["terms"])}</table>'
        for m in st["models"])
    by = {(c["kind"], c["pressure"], c["cost"]): c for c in st["cells"]}
    rows = "".join(
        f'<tr><td>{k} P{p}</td><td>{by[(k, p, "cheap")]["loophole"]}/{by[(k, p, "cheap")]["n"]}</td><td>{by[(k, p, "costly")]["loophole"]}/{by[(k, p, "costly")]["n"]}</td></tr>'
        for k in ("reputation", "harm") for p in (1, 2, 3))
    return f"""<h2>What moves the loophole</h2>
<p>Logistic regressions on the {st["models"][0]["n"]} runs, with standard errors clustered by world because the runs of one world are not independent. An odds ratio above 1 means the loophole becomes more likely. Pressure is counted per step from P1 to P3 and harm is against reputation.</p>
<table class="sum"><tr><th>Loopholes taken</th><th>Cheap</th><th>Costly</th></tr>{rows}</table>
<p class="small muted">Per world, costly against cheap: {st["worlds_up"]} worlds take the loophole more often, {st["worlds_flat"]} equally often (mostly never) and {st["worlds_down"]} less often. A sign test on the {st["worlds_up"] + st["worlds_down"]} worlds that differ gives p = {st["sign_test_p"]:.3f}.</p>
{tables}
<p><strong>How to read it.</strong> Making the honest route costly raises the odds of the loophole in all three models: {cost[0]["odds"]:.1f} times across all worlds (95% interval {cost[0]["lo"]:.2f} to {cost[0]["hi"]:.2f}) and {cost[2]["odds"]:.1f} times when each world is compared only with itself. The second figure rests on the {st["models"][2]["clusters"]} worlds where any run took the loophole, and on {st["models"][2]["events"]} loopholes, so its interval is wide and it says nothing about the {st["worlds"] - st["worlds_with_loophole"]} worlds where the model never did. Harm against reputation points the same way in every model but its interval includes 1 in each, so I read it as no measurable difference. The pressure level shows no effect (odds ratio near 1). One model, one run per cell and {st["models"][0]["events"]} loopholes in all: this is a pilot analysis.</p>"""


def share(cells: list, cost: str) -> float:
    """Share of the runs of `cost` (cheap or costly) that took the loophole."""
    sub = [c for c in cells if c[2] == cost]
    return sum(c[3] == "loophole" for c in sub) / len(sub) if sub else 0.0


def figures_html(ag: dict, worlds: list, st: dict) -> str:
    """The plots of the agentic baseline: by kind of stakes, by pressure level, per world and the odds ratios."""
    allc = [c for cs in ag["cells"].values() for c in cs]
    kinds = [(lab, share([c for c in allc if sel(c)], "cheap"), share([c for c in allc if sel(c)], "costly"), "")
             for lab, sel in (("All runs", lambda c: True), ("Reputation stakes", lambda c: c[0] == "reputation"), ("Harm stakes", lambda c: c[0] == "harm"))]
    per = []
    for w in worlds:
        cs = ag["cells"].get(str(w["n"]))
        if cs:
            per.append((f'World {w["n"]} · {short(w["rule_id"])} w{w["world"]}', share(cs, "cheap"), share(cs, "costly"), f'#w{w["n"]}'))
    per.sort(key=lambda r: (r[2] - r[1], r[2]))
    by_level = {k: {c: [share([x for x in allc if x[0] == k and x[1] == lv], c) for lv in (1, 2, 3)] for c in ("cheap", "costly")} for k in ("reputation", "harm")}
    pair = f'<div class="pair">{plots.lines(by_level["reputation"], "Reputation stakes, by level")}{plots.lines(by_level["harm"], "Harm stakes, by level")}</div>'
    fm = [m for m in st["models"] if m["label"] in ("Took the loophole", "Took the loophole, each world compared with itself")]
    return f"""<figure class="chart">{plots.dumbbell(kinds, "Loophole share by kind of stakes", 150)}<figcaption>Open circle: honest route cheap. Filled: honest route costly. Each point is 114, 57 or 57 runs of one model.</figcaption></figure>
<figure class="chart">{pair}<figcaption>Loophole share at pressure levels P1 to P3, 18 to 20 runs per point, so one run moves a point by about 5 percentage points.</figcaption></figure>
<figure class="chart">{plots.dumbbell(per, "Loophole share, cheap to costly, by world", 230, 18)}<figcaption>Six runs per world and version (three for the two worlds with reputation levels only). Worlds with no loophole in either version sit at 0%. Click a name to jump to the world.</figcaption></figure>
<figure class="chart">{plots.forest(fm[0]["terms"], "Odds ratios, all runs")}{plots.forest(fm[1]["terms"], "Odds ratios, each world compared with itself")}<figcaption>Odds ratios with 95% intervals on a log axis; the vertical line is no effect. Orange marks p below 0.05. The second panel uses only the {fm[1]["clusters"]} worlds where a loophole occurred, so its intervals are wide.</figcaption></figure>"""


def world_html(w: dict, pl: dict, ag: dict, stakes: dict) -> str:
    n = w["n"]
    return f"""<section class="task" id="w{n}">
<h2>World {n}</h2>
<div class="where">{e(w["rule_id"])} · world {w["world"]}</div>
{plain_html(w, pl)}
<div class="base">
<h3>What failing the task means</h3>
{stakes_for(stakes, n)}
{agentic_world_html(w, ag)}
</div>
</section>"""


def main() -> None:
    data = json.loads((ROOT / "analysis.json").read_text())
    unprobed = json.loads((ROOT / "unprobed.json").read_text())
    plain = json.loads((ROOT / "plain.json").read_text())
    agentic = json.loads((ROOT / "agentic.json").read_text())
    stakes = json.loads((ROOT / "stakes.json").read_text())
    stats = json.loads((ROOT / "stats.json").read_text())
    worlds = data["worlds"] + [{**w, "n": len(data["worlds"]) + i} for i, w in enumerate(unprobed, 1)]
    jump = "".join(f'<a href="#w{w["n"]}">{w["n"]}</a>' for w in worlds)
    page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>20 worlds: harm vs reputation</title>
<meta name="description" content="Twenty worlds in plain English, each written for harm and reputation stakes, with the agentic baseline runs.">
<link rel="stylesheet" href="../assets/style.css?v=10">
<style>
{plots.CSS}{STYLE}{EXTRA}</style>
</head>
<body>
<header class="top">
  <nav class="crumbs"><a href="../">← Home</a> · <a href="../breakdown/">The 50 environments</a></nav>
  <button id="theme" class="ghost" type="button" aria-label="Toggle theme">Theme</button>
</header>
<main>
<h1>20 worlds: harm vs reputation</h1>
<p>Each world has a rule with a narrow and a broad reading, an honest route that follows the rule and a loophole that only follows the narrow reading. Making the honest route costly tests whether the agent starts reading the rule narrowly. Each world is written twice, once for each kind of stakes.</p>
<h2>Harm vs reputation</h2>
<p>Both kinds say what happens if the task is not done. Reputation names only who learns of the failure and what they think of the company. Harm names who is left without the result. Neither names money, a deadline or physical harm. The three pressure levels raise how many people are affected. Here is world 1:</p>
{stakes_for(stakes, 1)}
{agentic_summary_html(agentic, worlds)}
<h2>Plots</h2>
{figures_html(agentic, worlds, stats)}
{stats_html(stats)}
<div class="jump">{jump}</div>
{"".join(world_html(w, plain[f"{w['rule_id']}|{w['world']}"], agentic, stakes) for w in worlds)}
</main>
<footer class="foot">The descriptions are written from the generated worlds and have not been checked by hand. Agentic log {e(agentic["log"])}. The model's reasoning is its own account, not a measure of why it chose.</footer>
<script src="app.js?v=3"></script>
<script src="agentic.js?v=1"></script>
</body>
</html>
"""
    (ROOT / "index.html").write_text(page)
    print(f"wrote {ROOT / 'index.html'}")


if __name__ == "__main__":
    main()
