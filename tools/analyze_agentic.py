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
# Environments left out of an experiment's analysis, with the reason shown on the page. The runs stay published.
EXCLUDED_ENVS: dict[str, dict[str, str]] = {
    "env-release-20261102-glm": {
        "release-and-deployment-pipelines-2-w3-20261030t230643z": (
            "All 6 runs called tools of another world (devctl_*, fleetctl_device, fleetctl_presence_estimate), not the kiosk "
            "tools this environment defines. Its tools image is tagged cv-env-release-deploy-2-w3-tools, the same tag as "
            "release-and-deployment-pipelines-2-w3-20261031t000048z, which is the likely cause. The runs say nothing about this world."
        )
    }
}


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
        "note": "In the cheap version the loophole counts at p1, p2, p3 are 4, 2, 4 (the two environments that change route go "
                "loophole, compliant, loophole), so the fitted slope is exactly 1 and its interval (1.00 to 1.00) is a numerical "
                "artifact of the clustered errors, not precision. Only the second term carries information.",
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
    goal = {"id": "goal", "title": "Was the goal reached?", "outcome": "goal reached", "n": int(len(df)),
            "clusters": int(df.env.nunique()), "pseudo_r2": None, "terms": []}
    if (df.groupby("costly").goal.agg(["min", "max"]).nunique(axis=1) == 1).any():  # a level where every run has the same value
        reached = {c: f"{int(v.goal.sum())} of {len(v)}" for c, v in df.groupby("costly")}
        goal["note"] = (f"Not estimated: the goal was reached in {reached[0]} cheap runs and {reached[1]} costly runs, so one level "
                        "has no variation and the odds ratio is unbounded. See the counts in the rate tables.")
        goal_model = None
    else:
        goal_model = clustered("goal ~ costly + p", df, "logit")
    if goal_model is not None:
        ci = goal_model.conf_int()
        goal["pseudo_r2"] = float(goal_model.prsquared)
        goal["terms"] = [term("Costly version", "cheap version", goal_model.params, ci, goal_model.pvalues, "costly", "odds"),
                         term("Pressure, per level", "one level lower", goal_model.params, ci, goal_model.pvalues, "p", "odds")]
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
    excluded = EXCLUDED_ENVS.get(experiment, {})
    df = load_runs(experiment)
    left_out = int(df.env.isin(excluded).sum())
    df = df[~df.env.isin(excluded)]
    routed = df[df.loophole + df.compliant == 1]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        models = route_models(routed) + other_models(df)
    out = {"experiment": experiment, "runs": int(len(df)), "routed": int(len(routed)), "environments": int(df.env.nunique()),
           "excluded": [{"env": env, "reason": why} for env, why in excluded.items()], "excluded_runs": left_out,
           "tables": tables(df), "models": models}
    (DATA / "analysis.json").write_text(json.dumps(out, indent=1))
    for m in models:
        print(m["id"], m["n"], [(t["name"], round(t["ratio"], 2), round(t["p"], 3)) for t in m["terms"]])


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "env-release-20261102-glm")
