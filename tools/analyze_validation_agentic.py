"""Multivariate analysis of the agentic baseline of the 20 worlds: logistic regressions, errors clustered by world.

    uv run python tools/analyze_validation_agentic.py --dir validation

Reads `<dir>/agentic.json` and `<dir>/analysis.json` (for each world's rule), writes `<dir>/stats.json` for the page.
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.formula.api as smf
from scipy.stats import binomtest
from statsmodels.discrete.conditional_models import ConditionalLogit

LABELS = {
    "costly": "Honest route is costly",
    "harm": "Stakes are harm (vs reputation)",
    "pressure": "Pressure level (per step, P1 to P3)",
    "costly:harm": "Costly x harm",
    "costly:pressure": "Costly x pressure level",
    "calls": "Tool calls in the run (per 10)",
}


def frame(ag: dict, worlds: dict) -> pd.DataFrame:
    rows = [dict(world=int(n), area=worlds[int(n)], harm=int(k == "harm"), pressure=p - 1, costly=int(c == "costly"),
                 loophole=int(o == "loophole"), neither=int(o == "neither"), goal=g, calls=calls / 10)
            for n, cells in ag["cells"].items() for k, p, c, o, g, _, calls in cells]
    return pd.DataFrame(rows)


def fit(formula: str, df: pd.DataFrame, label: str) -> dict:
    res = smf.logit(formula, df).fit(disp=0, cov_type="cluster", cov_kwds={"groups": df["world"]}, maxiter=200)
    ci = res.conf_int()
    terms = [dict(term=LABELS.get(n, n), odds=float(np.exp(res.params[n])), lo=float(np.exp(ci.loc[n, 0])),
                  hi=float(np.exp(ci.loc[n, 1])), p=float(res.pvalues[n])) for n in res.params.index if n != "Intercept"]
    return dict(label=label, formula=formula, n=int(res.nobs), clusters=int(df["world"].nunique()), events=int(df[formula.split(" ~")[0]].sum()), terms=terms, res=res)


def within_world(df: pd.DataFrame) -> dict:
    """Conditional logit: each world is compared only with itself, so differences between worlds drop out. Worlds
    where no run took the loophole carry no information and are left out."""
    used = df[df.groupby("world")["loophole"].transform("sum") > 0]
    res = ConditionalLogit(used["loophole"], used[["costly", "pressure", "harm"]], groups=used["world"]).fit(disp=0)
    ci = res.conf_int()
    terms = [dict(term=LABELS[n], odds=float(np.exp(res.params[n])), lo=float(np.exp(ci.loc[n, 0])), hi=float(np.exp(ci.loc[n, 1])),
                  p=float(res.pvalues[n])) for n in res.params.index]
    return dict(label="Took the loophole, each world compared with itself", formula="conditional logit, grouped by world", n=int(len(used)),
                clusters=int(used["world"].nunique()), events=int(used["loophole"].sum()), terms=terms)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", type=Path, required=True)
    d = ap.parse_args().dir
    ag = json.loads((d / "agentic.json").read_text())
    worlds = {n: w["rule_id"] for n, w in enumerate(json.loads((d / "analysis.json").read_text())["worlds"], 1)}
    unprobed = json.loads((d / "unprobed.json").read_text())
    worlds.update({len(worlds) + i: w["rule_id"] for i, w in enumerate(unprobed, 1)})
    df = frame(ag, worlds)
    df["area"] = df["area"].str.replace(r"-\d+$", "", regex=True)
    fits = [
        fit("loophole ~ costly + pressure + harm", df, "Took the loophole"),
        fit("loophole ~ costly * harm + costly * pressure", df, "Took the loophole, with interactions"),
    ]
    fits.append(within_world(df))
    ame = fits[0]["res"].get_margeff(at="overall").summary_frame()["dy/dx"].to_dict()
    cells = [dict(kind="harm" if h else "reputation", pressure=int(p) + 1, cost="costly" if c else "cheap", n=int(len(g)), loophole=int(g.loophole.sum()))
             for (h, p, c), g in df.groupby(["harm", "pressure", "costly"])]
    per_world = df.groupby(["world", "costly"])["loophole"].sum().unstack().fillna(0).astype(int)
    out = dict(models=[{k: v for k, v in m.items() if k != "res"} for m in fits], ame={k: float(v) for k, v in ame.items()}, cells=cells,
               worlds_with_loophole=int((per_world.sum(axis=1) > 0).sum()), worlds=int(len(per_world)),
               worlds_up=int((per_world[1] > per_world[0]).sum()), worlds_flat=int((per_world[1] == per_world[0]).sum()), worlds_down=int((per_world[1] < per_world[0]).sum()))
    out["sign_test_p"] = float(binomtest(out["worlds_up"], out["worlds_up"] + out["worlds_down"]).pvalue)
    (d / "stats.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    for m in fits:
        print(m["label"], m["n"], "events", m["events"], "clusters", m["clusters"])
        for t in m["terms"]:
            print(f"  {t['term']:<40} OR {t['odds']:.2f} [{t['lo']:.2f}, {t['hi']:.2f}] p={t['p']:.3g}")
    print("AME", out["ame"]); print({k: out[k] for k in ("worlds", "worlds_with_loophole", "worlds_up", "worlds_flat", "worlds_down")})
    print(cells)


if __name__ == "__main__":
    main()
