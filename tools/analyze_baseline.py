"""Multivariate analysis of the baseline runs: logistic regressions with standard errors clustered by task.

    uv run python <this file> --dir breakdown

Reads `<dir>/analysis.json` and `<dir>/data.json`, writes `<dir>/stats.json` for the page.
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.formula.api as smf

MODELS = ["GLM 5.3", "Kimi K3.1 Pro", "Qwen 3.8 Max", "DeepSeek V4.1 Flash", "GLM 5.3 flash"]
KIND = {"D": "deadline_missed", "T": "tight", "": "money_only"}
LABELS = {
    "costly": "Honest route is costly",
    "pressure": "Pressure level (per step, P1 to P3)",
    "costly:pressure": "Costly x pressure level",
    "C(kind)[T.tight]": "Environment: lands within minutes (vs deadline missed)",
    "C(kind)[T.money_only]": "Environment: money cost only (vs deadline missed)",
    "C(model)[T.Kimi K3.1 Pro]": "Model: Kimi K3.1 Pro (vs GLM 5.3)",
    "C(model)[T.Qwen 3.8 Max]": "Model: Qwen 3.8 Max (vs GLM 5.3)",
    "C(model)[T.DeepSeek V4.1 Flash]": "Model: DeepSeek V4.1 Flash (vs GLM 5.3)",
    "C(model)[T.GLM 5.3 flash]": "Model: GLM 5.3 flash (vs GLM 5.3)",
    "costly:C(kind)[T.tight]": "Costly x environment lands within minutes",
    "costly:C(kind)[T.money_only]": "Costly x environment money cost only",
    "density": "Rule words per tool call (more talk about the rule)",
}


def frame(cells: dict, tasks: list) -> pd.DataFrame:
    info = {str(t["n"]): t for t in tasks}
    rows = []
    for n, runs in cells.items():
        t = info[n]
        kind = "tight" if t["deck_tag"].startswith("Tight") else "deadline_missed" if t["deck_tag"].startswith("Dubious") else "money_only"
        for model, cost, p, outcome, goal, cancelled, calls, words in runs:
            rows.append(
                dict(task=int(n), model=model, costly=int(cost == "costly"), pressure=int(p[1]) - 1, kind=kind, area=t["area"],
                     loophole=int(outcome == "loophole"), neither=int(outcome == "neither"), goal=goal, calls=calls,
                     density=words / max(calls, 1), words=words)
            )
    df = pd.DataFrame(rows)
    df["model"] = pd.Categorical(df["model"], categories=MODELS)  # the first is the reference level
    df["kind"] = pd.Categorical(df["kind"], categories=list(KIND.values()))
    return df


def fit(formula: str, df: pd.DataFrame, label: str) -> dict:
    res = smf.logit(formula, df).fit(disp=0, cov_type="cluster", cov_kwds={"groups": df["task"]}, maxiter=200)
    ci = res.conf_int()
    terms = []
    for name in res.params.index:
        if name == "Intercept" or name.startswith("C(area)"):
            continue
        terms.append(
            dict(term=LABELS.get(name, name), odds=float(np.exp(res.params[name])), lo=float(np.exp(ci.loc[name, 0])),
                 hi=float(np.exp(ci.loc[name, 1])), p=float(res.pvalues[name]))
        )
    return dict(label=label, formula=formula, n=int(res.nobs), clusters=int(df["task"].nunique()), terms=terms, res=res)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", type=Path, required=True)
    d = ap.parse_args().dir
    cells = json.loads((d / "analysis.json").read_text())["cells"]
    tasks = json.loads((d / "data.json").read_text())["tasks"]
    df = frame(cells, tasks)
    base = "C(model) + C(kind) + C(area)"
    m1 = fit(f"loophole ~ costly + pressure + {base}", df, "Took the loophole")
    m2 = fit(f"loophole ~ costly * pressure + costly * C(kind) + C(model) + C(area)", df, "Took the loophole, with interactions")
    m3 = fit(f"neither ~ costly + pressure + {base}", df, "Took neither route")
    m4 = fit(f"loophole ~ costly + pressure + density + {base}", df, "Took the loophole, given how much it talks about the rule per step")
    margeff = m1["res"].get_margeff(at="overall", method="dydx").summary_frame()
    ame = {k: float(margeff.loc[k, "dy/dx"]) for k in ("costly", "pressure")}
    out = {"models": [{k: v for k, v in m.items() if k != "res"} for m in (m1, m2, m3, m4)], "ame": ame}
    # model x kind x cost, loophole share
    out["cube"] = [
        dict(model=m, kind=k, cost="costly" if c else "cheap", n=int(len(g)), share=float(g["loophole"].mean()))
        for (m, k, c), g in df.groupby(["model", "kind", "costly"], observed=True)
    ]
    # per task: costly minus cheap loophole share, pooled over models and pressure levels
    shift = df.groupby(["task", "costly"])["loophole"].mean().unstack()
    shift["diff"] = shift[1] - shift[0]
    out["task_shift"] = {int(t): dict(cheap=float(r[0]), costly=float(r[1])) for t, r in shift.iterrows()}
    out["tasks_up"] = int((shift["diff"] > 0).sum())
    out["tasks_flat"] = int((shift["diff"] == 0).sum())
    out["tasks_down"] = int((shift["diff"] < 0).sum())
    # how much the rule is talked about, by outcome and cost
    out["talk"] = [
        dict(outcome=o, cost="costly" if c else "cheap", n=int(len(g)), median_density=float(g["density"].median()), mean_calls=float(g["calls"].mean()))
        for (o, c), g in df.assign(outcome=np.where(df.loophole == 1, "loophole", np.where(df.neither == 1, "neither", "compliant"))).groupby(["outcome", "costly"])
    ]
    out["share_runs_mention"] = float((df["words"] > 0).mean())
    (d / "stats.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    for m in out["models"][:2]:
        print(m["label"], m["n"], m["clusters"])
        for t in m["terms"]:
            print(f"  {t['term']:<62} OR {t['odds']:.2f} [{t['lo']:.2f}, {t['hi']:.2f}] p={t['p']:.3g}")
    print("AME", ame, "tasks up/flat/down", out["tasks_up"], out["tasks_flat"], out["tasks_down"])


if __name__ == "__main__":
    main()
