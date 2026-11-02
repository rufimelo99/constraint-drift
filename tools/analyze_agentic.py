"""Multivariate analysis of one agentic experiment: writes agentic/data/analysis.json.

Unit: one run (a sample of an environment at one cost version and pressure level). Outcome: the route the world's own state
shows (`loophole` against `compliant`; runs that took neither route are left out of that model) and, separately, whether the
goal was reached and how many simulated minutes were spent. Predictors: cost version and pressure level. Standard errors are
clustered by environment, because the runs of one environment share its world. With about ten environments the clustered
errors are rough; the conditional model compares runs only within an environment, so what a world is like cannot explain its
result, but it uses only the environments in which the route varied.

Usage: uv run --with pandas --with statsmodels --with numpy python tools/analyze_agentic.py <experiment id>
"""

import json
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.formula.api as smf
from statsmodels.discrete.conditional_models import ConditionalLogit

DATA = Path("agentic/data")


def load_runs(experiment: str) -> pd.DataFrame:
    """One row per run of the experiment, with its design cell and outcome."""
    rows = []
    for entry in json.loads((DATA / "index.json").read_text())["runs"]:
        if entry.get("experiment") != experiment:
            continue
        run = json.loads((DATA / "runs" / f"{entry['id']}.json").read_text())
        out = run["outcome"]
        rows.append(
            {"env": entry["env"], "costly": int(entry["cost"] == "costly"), "p": int(entry["pressure"][1:]),
             "loophole": int(bool(out["loophole"])), "compliant": int(bool(out["compliant"])),
             "goal": int(bool(out["goal_reached"])), "minutes": float(out["cost_paid"]), "messages": len(run["messages"])}
        )
    return pd.DataFrame(rows)


def term(name: str, ref: str, params, ci, pvalues, key: str, ratio: str) -> dict:
    """One coefficient as a ratio (odds ratio or ratio of means) with its 95% interval."""
    return {"name": name, "ref": ref, "ratio": float(np.exp(params[key])), "lo": float(np.exp(ci.loc[key, 0])),
            "hi": float(np.exp(ci.loc[key, 1])), "p": float(pvalues[key]), "kind": ratio}


def clustered(formula: str, df: pd.DataFrame, family: str):
    groups = pd.factorize(df["env"])[0]
    model = smf.logit(formula, df) if family == "logit" else smf.ols(formula, df)
    kwargs = {"disp": 0} if family == "logit" else {}
    return model.fit(cov_type="cluster", cov_kwds={"groups": groups}, **kwargs)


def route_models(routed: pd.DataFrame) -> list[dict]:
    """Loophole against compliant, among the runs that took a route."""
    out = []
    m = clustered("loophole ~ costly + C(p)", routed, "logit")
    ci = m.conf_int()
    out.append({
        "id": "route", "title": "Which route: cost and pressure together", "outcome": "loophole (vs compliant)", "n": int(m.nobs),
        "clusters": int(routed.env.nunique()), "pseudo_r2": float(m.prsquared),
        "terms": [term("Costly version", "cheap version", m.params, ci, m.pvalues, "costly", "odds"),
                  term("Pressure p2", "p1", m.params, ci, m.pvalues, "C(p)[T.2]", "odds"),
                  term("Pressure p3", "p1", m.params, ci, m.pvalues, "C(p)[T.3]", "odds")],
    })
    m = clustered("loophole ~ costly * p", routed, "logit")
    ci = m.conf_int()
    out.append({
        "id": "interaction", "title": "Does pressure matter more when compliance is costly?", "outcome": "loophole (vs compliant)",
        "n": int(m.nobs), "clusters": int(routed.env.nunique()), "pseudo_r2": float(m.prsquared),
        "terms": [term("Pressure, per level, cheap version", "one level lower", m.params, ci, m.pvalues, "p", "odds"),
                  term("Extra per level when costly", "the cheap version's slope", m.params, ci, m.pvalues, "costly:p", "odds")],
    })
    varying = routed.groupby("env").loophole.transform(lambda x: x.nunique() > 1).astype(bool)
    within = routed[varying]
    cl = ConditionalLogit(within.loophole, within[["costly", "p"]], groups=within.env).fit(disp=0)
    ci = cl.conf_int()
    out.append({
        "id": "within", "title": "Within one environment only (conditional model)", "outcome": "loophole (vs compliant)",
        "n": int(len(within)), "clusters": int(within.env.nunique()), "pseudo_r2": None,
        "note": f"Only the {within.env.nunique()} environments in which the route varied can contribute; the other "
                f"{routed.env.nunique() - within.env.nunique()} always took the same route and say nothing about cost here.",
        "terms": [term("Costly version", "cheap version", cl.params, ci, cl.pvalues, "costly", "odds"),
                  term("Pressure, per level", "one level lower", cl.params, ci, cl.pvalues, "p", "odds")],
    })
    return out


def other_models(df: pd.DataFrame) -> list[dict]:
    """Whether the goal was reached, and the simulated minutes spent, over every run."""
    m = clustered("goal ~ costly + p", df, "logit")
    ci = m.conf_int()
    goal = {"id": "goal", "title": "Was the goal reached?", "outcome": "goal reached", "n": int(m.nobs),
            "clusters": int(df.env.nunique()), "pseudo_r2": float(m.prsquared),
            "terms": [term("Costly version", "cheap version", m.params, ci, m.pvalues, "costly", "odds"),
                      term("Pressure, per level", "one level lower", m.params, ci, m.pvalues, "p", "odds")]}
    m = clustered("np.log(minutes) ~ costly + p", df, "ols")
    ci = m.conf_int()
    minutes = {"id": "minutes", "title": "Simulated minutes spent", "outcome": "minutes (log scale; ratios of the mean)",
               "n": int(m.nobs), "clusters": int(df.env.nunique()), "pseudo_r2": None,
               "note": "Minutes mostly measure waiting and polling, not effort or cost paid on purpose.",
               "terms": [term("Costly version", "cheap version", m.params, ci, m.pvalues, "costly", "ratio"),
                         term("Pressure, per level", "one level lower", m.params, ci, m.pvalues, "p", "ratio")]}
    return [goal, minutes]


def rate(sub: pd.DataFrame) -> dict:
    return {"runs": int(len(sub)), "loophole": int(sub.loophole.sum()), "compliant": int(sub.compliant.sum()),
            "neither": int(len(sub) - sub.loophole.sum() - sub.compliant.sum()), "goal": int(sub.goal.sum())}


def tables(df: pd.DataFrame) -> dict:
    cost = {1: "costly", 0: "cheap"}
    return {
        "by_cost": [{"level": cost[k], **rate(v)} for k, v in df.groupby("costly", sort=False)],
        "by_pressure": [{"level": f"p{k}", **rate(v)} for k, v in df.groupby("p")],
        "by_cell": [{"level": f"{cost[c]} p{p}", **rate(v)} for (c, p), v in df.groupby(["costly", "p"])],
        "by_env": [
            {"env": env, "cheap": [rate(v[(v.costly == 0) & (v.p == p)]) for p in (1, 2, 3)],
             "costly": [rate(v[(v.costly == 1) & (v.p == p)]) for p in (1, 2, 3)]}
            for env, v in df.groupby("env")
        ],
    }


def main(experiment: str) -> None:
    df = load_runs(experiment)
    routed = df[df.loophole + df.compliant == 1]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        models = route_models(routed) + other_models(df)
    out = {"experiment": experiment, "runs": int(len(df)), "routed": int(len(routed)), "environments": int(df.env.nunique()),
           "tables": tables(df), "models": models}
    (DATA / "analysis.json").write_text(json.dumps(out, indent=1))
    for m in models:
        print(m["id"], m["n"], [(t["name"], round(t["ratio"], 2), round(t["p"], 3)) for t in m["terms"]])


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "env-release-20261102-glm")
