"""Inline SVG plots of the validation probes, drawn from the cells of analysis.json. They use the page's colour variables.

A cell is [kind of stakes, pressure level, rule shown (0 or 1), cost, epoch, compliant (0 or 1)].
"""
from html import escape as e

W = 760
SHORT = {"dependencies-and-supply-chain-2": "Deps 2", "infrastructure-as-code-and-cloud-3": "IaC 3", "pull-requests-and-code-review-1": "PR 1",
         "pull-requests-and-code-review-3": "PR 3", "release-and-deployment-pipelines-3": "Release 3", "secrets-and-credentials-3": "Secrets 3"}

CSS = """
.plot .bno { fill: var(--grey); } .plot .brule { fill: var(--accent); }
.plot .ci { stroke: var(--risk); stroke-width: 2; fill: none; }
.plot .cil { stroke: var(--risk); stroke-width: 2; opacity: .5; }
.plot .val { font-size: 13px; font-weight: 600; fill: var(--fg); }
.plot .dia { fill: var(--grey); }
.plot .rep { fill: var(--accent); stroke: var(--accent); stroke-width: 2; } .plot .repl { stroke: var(--accent); stroke-width: 2; fill: none; }
.plot .har { fill: var(--risk); stroke: var(--risk); stroke-width: 2; } .plot .harl { stroke: var(--risk); stroke-width: 2; fill: none; }
.plot .axl { stroke: var(--muted); stroke-width: 1.5; }
figure.chart { margin: 14px 0; max-width: 760px; } figure.chart figcaption { color: var(--muted); font-size: 13px; }
"""


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float, float]:
    """The share k/n with its 95% Wilson interval."""
    if not n:
        return 0.0, 0.0, 0.0
    p, d = k / n, 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * (p * (1 - p) / n + z * z / (4 * n * n)) ** 0.5 / d
    return p, max(0.0, c - h), min(1.0, c + h)


def share(cells: list, **where) -> tuple[float, float, float, int, int]:
    """Share, interval, successes and count of the compliant choices among the cells matching `where`."""
    keys = {"mech": 0, "pressure": 1, "rule": 2, "cost": 3}
    sub = [c for c in cells if all(c[keys[k]] == v for k, v in where.items())]
    k = sum(c[5] for c in sub)
    return (*wilson(k, len(sub)), k, len(sub))


def _frame(h: int, body: str, label: str) -> str:
    return f'<svg class="plot" viewBox="0 0 {W} {h}" role="img" aria-label="{e(label)}" xmlns="http://www.w3.org/2000/svg">{body}</svg>'


def _y_axis(x0: float, x1: float, top: float, bot: float) -> str:
    out = ""
    for v in (0, 0.25, 0.5, 0.75, 1):
        y = bot - (bot - top) * v
        out += f'<line x1="{x0}" x2="{x1}" y1="{y:.1f}" y2="{y:.1f}" class="grid"/><text x="{x0 - 8}" y="{y + 4:.1f}" class="ax" text-anchor="end">{v:.2f}</text>'
    return out


def _whisker(x: float, lo: float, hi: float, top: float, bot: float, cls: str = "ci") -> str:
    y1, y2 = bot - (bot - top) * hi, bot - (bot - top) * lo
    return (f'<line x1="{x:.1f}" x2="{x:.1f}" y1="{y1:.1f}" y2="{y2:.1f}" class="{cls}"/>'
            f'<line x1="{x - 6:.1f}" x2="{x + 6:.1f}" y1="{y1:.1f}" y2="{y1:.1f}" class="{cls}"/>'
            f'<line x1="{x - 6:.1f}" x2="{x + 6:.1f}" y1="{y2:.1f}" y2="{y2:.1f}" class="{cls}"/>')


def by_version(cells: list) -> str:
    """Compliant share with and without the rule, when complying is cheap and when it is costly."""
    x0, x1, top, bot = 60, W - 20, 30, 270
    body = _y_axis(x0, x1, top, bot)
    centres = {"cheap": 230, "costly": 560}
    for cost, cx in centres.items():
        for j, (rule, cls, name) in enumerate(((0, "bno", "no rule"), (1, "brule", "rule"))):
            p, lo, hi, k, n = share(cells, rule=rule, cost=cost)
            x = cx + (j - 0.5) * 120
            y = bot - (bot - top) * p
            body += (f'<rect x="{x - 45:.1f}" y="{y:.1f}" width="90" height="{bot - y:.1f}" class="{cls}"><title>{cost}, {name}: {p:.2f} ({k}/{n})</title></rect>'
                     f'{_whisker(x, lo, hi, top, bot)}<text x="{x:.1f}" y="{bot - (bot - top) * hi - 8:.1f}" class="val" text-anchor="middle">{p:.2f}</text>'
                     f'<text x="{x:.1f}" y="{bot + 18}" class="ax" text-anchor="middle">{name}</text>')
        body += f'<text x="{cx}" y="{bot + 40}" class="lb" text-anchor="middle">complying is {cost}</text>'
    body += f'<line x1="{x0}" x2="{x1}" y1="{bot}" y2="{bot}" class="axl"/>'
    return _frame(bot + 52, body, "Compliant share by rule and cost")


def by_pressure(cells: list) -> str:
    """Rule shown and complying costly: compliant share at each pressure level, for each kind of stakes."""
    x0, x1, top, bot = 60, W - 20, 40, 270
    body = _y_axis(x0, x1, top, bot)
    cx = lambda p, dx: x0 + (x1 - x0) * (p - 0.5) / 3 + dx
    for p in (1, 2, 3):
        body += f'<text x="{cx(p, 0):.1f}" y="{bot + 20}" class="lb" text-anchor="middle">pressure {p}</text>'
    for mech, dx, cls, name in (("reputation", -14, "rep", "reputation"), ("harm", 14, "har", "harm")):
        pts = []
        for p in (1, 2, 3):
            share_, lo, hi, k, n = share(cells, mech=mech, pressure=p, rule=1, cost="costly")
            pts.append((cx(p, dx), bot - (bot - top) * share_, share_, lo, hi, k, n))
        body += f'<polyline points="{" ".join(f"{x:.1f},{y:.1f}" for x, y, *_ in pts)}" class="{cls}l"/>'
        for x, y, s, lo, hi, k, n in pts:
            body += (_whisker(x, lo, hi, top, bot, f"{cls}l") + f'<circle cx="{x:.1f}" cy="{y:.1f}" r="5.5" class="{cls}"><title>{name}: {s:.2f} ({k}/{n})</title></circle>'
                     f'<text x="{x + (-10 if dx < 0 else 10):.1f}" y="{y + (-14 if dx < 0 else 24):.1f}" class="val" text-anchor="{"end" if dx < 0 else "start"}">{s:.2f}</text>')
    body += (f'<circle cx="{x0 + 10}" cy="16" r="5" class="rep"/><text x="{x0 + 22}" y="20" class="lb">reputation</text>'
             f'<circle cx="{x0 + 120}" cy="16" r="5" class="har"/><text x="{x0 + 132}" y="20" class="lb">harm</text>')
    body += f'<line x1="{x0}" x2="{x1}" y1="{bot}" y2="{bot}" class="axl"/>'
    return _frame(bot + 36, body, "Compliant share by pressure and kind of stakes")


def by_world(worlds: list) -> str:
    """One row per world: rule cheap (open circle) to rule costly (filled), its interval, and no rule costly (diamond)."""
    rows = []
    for w in worlds:
        c = w["cells"]
        cheap, costly, no = share(c, rule=1, cost="cheap"), share(c, rule=1, cost="costly"), share(c, rule=0, cost="costly")
        rows.append((costly[0], w, cheap, costly, no))
    rows.sort(key=lambda r: (r[0], r[1]["n"]))
    label_w, x1, top, rh = 190, W - 30, 34, 26
    X = lambda v: label_w + (x1 - label_w) * v
    h = top + rh * len(rows) + 52
    body = ""
    for v in (0, 0.25, 0.5, 0.75, 1):
        body += f'<line x1="{X(v):.1f}" x2="{X(v):.1f}" y1="{top - 8}" y2="{top + rh * len(rows)}" class="grid"/><text x="{X(v):.1f}" y="{top + rh * len(rows) + 16}" class="ax" text-anchor="middle">{v:.2f}</text>'
    for i, (_, w, cheap, costly, no) in enumerate(rows):
        y = top + rh * i + rh / 2
        name = f'World {w["n"]} · {SHORT.get(w["rule_id"], w["rule_id"])} w{w["world"]}'
        body += (f'<a href="#w{w["n"]}"><text x="{label_w - 10}" y="{y + 4:.1f}" class="lb" text-anchor="end">{e(name)}</text></a>'
                 f'<line x1="{X(costly[1]):.1f}" x2="{X(costly[2]):.1f}" y1="{y:.1f}" y2="{y:.1f}" class="cil"/>'
                 f'<line x1="{X(cheap[0]):.1f}" x2="{X(costly[0]):.1f}" y1="{y:.1f}" y2="{y:.1f}" class="dl"/>'
                 f'<circle cx="{X(cheap[0]):.1f}" cy="{y:.1f}" r="5" class="dc"><title>{name}: rule, cheap {cheap[0]:.2f} ({cheap[3]}/{cheap[4]})</title></circle>'
                 f'<circle cx="{X(costly[0]):.1f}" cy="{y:.1f}" r="5" class="dk"><title>{name}: rule, costly {costly[0]:.2f} ({costly[3]}/{costly[4]})</title></circle>'
                 f'<path d="M{X(no[0]):.1f} {y - 6:.1f} l6 6 l-6 6 l-6 -6 z" class="dia"><title>{name}: no rule, costly {no[0]:.2f} ({no[3]}/{no[4]})</title></path>')
    ly = top + rh * len(rows) + 40
    body += (f'<circle cx="{label_w}" cy="{ly - 4}" r="5" class="dc"/><text x="{label_w + 10}" y="{ly}" class="lb">rule, cheap</text>'
             f'<circle cx="{label_w + 120}" cy="{ly - 4}" r="5" class="dk"/><text x="{label_w + 130}" y="{ly}" class="lb">rule, costly</text>'
             f'<path d="M{label_w + 250} {ly - 10} l6 6 l-6 6 l-6 -6 z" class="dia"/><text x="{label_w + 262}" y="{ly}" class="lb">no rule, costly</text>'
             f'<text x="{x1}" y="{ly}" class="ax" text-anchor="end">compliant share</text>')
    return _frame(h, body, "Compliant share per world")
