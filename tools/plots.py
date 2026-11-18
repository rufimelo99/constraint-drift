"""Inline SVG plots for the breakdown page. They use the page's colour variables, so they follow the theme."""
import math
from html import escape as e

W = 760


def _frame(h: int, body: str, label: str) -> str:
    return (f'<svg class="plot" viewBox="0 0 {W} {h}" role="img" aria-label="{e(label)}" '
            f'xmlns="http://www.w3.org/2000/svg">{body}</svg>')


def _pct_axis(x0: float, x1: float, top: float, bottom: float) -> str:
    out = ""
    for v in (0, 25, 50, 75, 100):
        x = x0 + (x1 - x0) * v / 100
        out += (f'<line x1="{x:.1f}" x2="{x:.1f}" y1="{top}" y2="{bottom}" class="grid"/>'
                f'<text x="{x:.1f}" y="{bottom + 14}" class="ax" text-anchor="middle">{v}%</text>')
    return out


LEGEND = ('<circle cx="{x}" cy="12" r="5" class="dc"/><text x="{t}" y="16" class="ax">cheap honest route</text>'
          '<circle cx="{x2}" cy="12" r="5" class="dk"/><text x="{t2}" y="16" class="ax">costly honest route</text>')


def dumbbell(rows: list[tuple[str, float, float, str]], title: str, label_w: int = 170, row_h: int = 22) -> str:
    """One row per item: a hollow circle at the cheap share, a filled one at the costly share, a line between them.

    rows are (label, cheap, costly, link or ""); shares are 0 to 1."""
    x0, x1, top = label_w, W - 30, 30
    h = top + row_h * len(rows) + 30
    body = f'<text x="0" y="16" class="ttl">{e(title)}</text>'
    body += LEGEND.format(x=W - 330, t=W - 320, x2=W - 170, t2=W - 160)
    body += _pct_axis(x0, x1, top, h - 26)
    for i, (name, a, b, href) in enumerate(rows):
        y = top + row_h * i + row_h / 2
        xa, xb = x0 + (x1 - x0) * a, x0 + (x1 - x0) * b
        text = f'<text x="{label_w - 8}" y="{y + 4:.1f}" class="lb" text-anchor="end">{e(name)}</text>'
        body += f'<a href="{href}">{text}</a>' if href else text
        body += (f'<line x1="{xa:.1f}" x2="{xb:.1f}" y1="{y:.1f}" y2="{y:.1f}" class="dl"/>'
                 f'<circle cx="{xa:.1f}" cy="{y:.1f}" r="4.5" class="dc"><title>{e(name)}: cheap {a:.0%}</title></circle>'
                 f'<circle cx="{xb:.1f}" cy="{y:.1f}" r="4.5" class="dk"><title>{e(name)}: costly {b:.0%}</title></circle>')
    return _frame(h, body, title)


def forest(terms: list[dict], title: str) -> str:
    """Odds ratios with 95% intervals on a log axis; one line at 1 (no effect)."""
    label_w, x1, top, row_h = 330, W - 30, 30, 26
    lo, hi = math.log(0.1), math.log(10)
    pos = lambda v: label_w + (x1 - label_w) * (math.log(min(max(v, 0.1), 10)) - lo) / (hi - lo)
    h = top + row_h * len(terms) + 34
    body = f'<text x="0" y="16" class="ttl">{e(title)}</text>'
    for v in (0.1, 0.25, 0.5, 1, 2, 4, 10):
        x = pos(v)
        body += (f'<line x1="{x:.1f}" x2="{x:.1f}" y1="{top}" y2="{h - 28}" class="{"one" if v == 1 else "grid"}"/>'
                 f'<text x="{x:.1f}" y="{h - 14}" class="ax" text-anchor="middle">{v:g}×</text>')
    body += (f'<text x="{pos(1) - 12:.1f}" y="{h - 1}" class="ax" text-anchor="end">← fewer loopholes</text>'
             f'<text x="{pos(1) + 12:.1f}" y="{h - 1}" class="ax">more loopholes →</text>')
    for i, t in enumerate(terms):
        y = top + row_h * i + row_h / 2
        cls = "fs" if t["p"] < 0.05 else "fn"
        body += (f'<text x="{label_w - 8}" y="{y + 4:.1f}" class="lb" text-anchor="end">{e(t["term"])}</text>'
                 f'<line x1="{pos(t["lo"]):.1f}" x2="{pos(t["hi"]):.1f}" y1="{y:.1f}" y2="{y:.1f}" class="{cls}l"/>'
                 f'<circle cx="{pos(t["odds"]):.1f}" cy="{y:.1f}" r="5" class="{cls}"><title>{t["odds"]:.2f}× (95% {t["lo"]:.2f} to {t["hi"]:.2f}), p = {t["p"]:.3g}</title></circle>')
    return _frame(h, body, title)


def lines(series: dict[str, list[float]], title: str) -> str:
    """Loophole share at P1 to P3, one line per cost version."""
    x0, x1, top, bot = 60, 330, 36, 190
    body = f'<text x="0" y="16" class="ttl">{e(title)}</text>'
    for v in (0, 25, 50, 75):
        y = bot - (bot - top) * v / 75
        body += f'<line x1="{x0}" x2="{x1}" y1="{y:.1f}" y2="{y:.1f}" class="grid"/><text x="{x0 - 8}" y="{y + 4:.1f}" class="ax" text-anchor="end">{v}%</text>'
    for k, name in enumerate(("P1", "P2", "P3")):
        x = x0 + (x1 - x0) * (k + 0.5) / 3
        body += f'<text x="{x:.1f}" y="{bot + 16}" class="ax" text-anchor="middle">{name}</text>'
    for name, vals in series.items():
        cls = "dk" if name == "costly" else "dc"
        pts = [(x0 + (x1 - x0) * (k + 0.5) / 3, bot - (bot - top) * v / 0.75) for k, v in enumerate(vals)]
        body += f'<polyline points="{" ".join(f"{x:.1f},{y:.1f}" for x, y in pts)}" class="dl"/>'
        for (x, y), v in zip(pts, vals):
            body += f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4.5" class="{cls}"><title>{name}: {v:.0%}</title></circle>'
        body += f'<text x="{pts[-1][0] + 10:.1f}" y="{pts[-1][1] + 4:.1f}" class="lb">{name}</text>'
    return _frame(bot + 30, body, title).replace(f'viewBox="0 0 {W}', 'style="max-width:400px" viewBox="0 0 400', 1)


def bars(rows: list[tuple[str, float, str, str]], title: str, label_w: int = 170, row_h: int = 22) -> str:
    """Horizontal bars, one per row: (label, value, link or "", text shown after the bar). The longest bar fills the width."""
    x0, x1, top = label_w, W - 150, 30
    peak = max((r[1] for r in rows), default=1) or 1
    out = f'<text x="0" y="14" class="ttl">{e(title)}</text>'
    for i, (label, value, link, text) in enumerate(rows):
        y = top + i * row_h
        name = f'<text x="{x0 - 8}" y="{y + 15}" class="lb" text-anchor="end">{e(label)}</text>'
        out += f'<a href="{e(link)}">{name}</a>' if link else name
        out += (f'<rect x="{x0}" y="{y + 4}" width="{max((x1 - x0) * value / peak, 1):.1f}" height="{row_h - 8}" class="bar"/>'
                f'<text x="{x0 + (x1 - x0) * value / peak + 6:.1f}" y="{y + 15}" class="ax">{e(text)}</text>')
    return _frame(top + len(rows) * row_h + 6, out, title)


CSS = """
svg.plot { width: 100%; height: auto; max-width: 760px; display: block; margin: 8px 0 18px; font-family: var(--sans); }
.plot .ttl { font-size: 13px; font-weight: 600; fill: var(--fg); }
.plot .lb { font-size: 12px; fill: var(--fg); }
.plot a:hover .lb { fill: var(--accent); text-decoration: underline; }
.plot .ax { font-size: 11px; fill: var(--muted); }
.plot .bar { fill: var(--accent); opacity: .75; }
.plot .grid { stroke: var(--line); stroke-width: 1; }
.plot .one { stroke: var(--muted); stroke-width: 1.5; }
.plot .dl { stroke: var(--grey); stroke-width: 2; fill: none; }
.plot .dc { fill: var(--bg); stroke: var(--accent); stroke-width: 2; }
.plot .dk { fill: var(--risk); stroke: var(--risk); stroke-width: 2; }
.plot .fs { fill: var(--risk); } .plot .fsl { stroke: var(--risk); stroke-width: 2; }
.plot .fn { fill: var(--grey); } .plot .fnl { stroke: var(--grey); stroke-width: 2; }
details.tables { margin: 4px 0 16px; } details.tables summary { cursor: pointer; color: var(--muted); }
"""
