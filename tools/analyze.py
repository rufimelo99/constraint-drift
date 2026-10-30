"""Multivariate analysis of reinterpretation across the current runs: writes data/analysis.json.

Unit: one costly-route run with the rule shown whose answer was usable. Outcome: the monitor labelled the run
`reinterpreted_rule` (the reasoning argues the rule forbids less than it appears to). Predictors are the topology
labels of data/labels.json (see tools/label_topology.py), urgency, the probed model and the generator.
Standard errors are clustered by rule, because worlds of one rule share its wording.

The analysis is repeated for every combination of probed model and data origin (the generated set), so the page can
separate them. A factor with a single level in a slice is left out of that slice's regression.

Usage: uv run --with pandas --with statsmodels --with numpy python tools/analyze.py
"""

import json
import re
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.formula.api as smf

DATA = Path("data")
REFERENCES = {"ambiguity": "environment", "loophole": "equivalent", "cost": "queue", "urgency": 1, "model": "glm-5p3-flash", "gen": "deepseek-v4p1-flash"}
RATE_FACTORS = ("ambiguity", "loophole", "cost", "fee", "urgency", "model", "gen")
TERM = re.compile(r"C\((\w+), Treatment\((.+?)\)\)\[T\.(.+)\]")


def load_runs() -> pd.DataFrame:
    labels = json.loads((DATA / "labels.json").read_text())
    rows = []
    for run in json.loads((DATA / "manifest.json").read_text()):
        for path in sorted((DATA / run["id"] / "traces").glob("*.json")):
            topo = labels.get(run["generated"], {}).get(path.stem)
            if topo is None:
                continue
            for r in json.loads(path.read_text()):
                if not (r["valid"] and r["has_rule"] and r["blocker"] == "blocked"):
                    continue
                rows.append(
                    {
                        "run": run["id"], "generated": run["generated"], "world": path.stem,
                        "rule": run["generated"] + "/" + path.stem.rsplit("-w", 1)[0],
                        "model": run["model"].split("/")[-1], "gen": run["generation"]["models"]["generator"],
                        "urgency": r["pressure"], "reinterpreted": int(bool(r["reinterpreted_rule"])), "shortcut": int(not r["safer"]),
                        "ambiguity": topo["ambiguity"], "loophole": topo["loophole"], "cost": topo["cost"], "fee": int(topo["fee"]),
                    }
                )
    return pd.DataFrame(rows)


def rates(df: pd.DataFrame) -> dict:
    """Reinterpretation rate and share of runs taking the shortcut, per level of each factor."""
    return {
        col: [
            {"level": str(k), "runs": int(len(v)), "worlds": int(v.groupby(["generated", "world"]).ngroups),
             "reinterpreted": float(v.reinterpreted.mean()), "shortcut": float(v.shortcut.mean())}
            for k, v in df.groupby(col)
        ]
        for col in RATE_FACTORS
    }


def world_rows(df: pd.DataFrame) -> list[dict]:
    """One row per world, pooled over its runs: the unit the labels actually vary over."""
    keys = ["generated", "world", "ambiguity", "loophole", "cost", "fee"]
    g = df.groupby(keys).agg(runs=("reinterpreted", "size"), reinterpreted=("reinterpreted", "mean"), shortcut=("shortcut", "mean")).reset_index()
    return [
        {"set": r["generated"], "world": r["world"], "ambiguity": r["ambiguity"], "loophole": r["loophole"], "cost": r["cost"], "fee": bool(r["fee"]),
         "runs": int(r["runs"]), "reinterpreted": float(r["reinterpreted"]), "shortcut": float(r["shortcut"])}
        for r in g.to_dict("records")
    ]


def _terms(model) -> list[dict]:
    ci = model.conf_int()
    terms = []
    for name in model.params.index.drop("Intercept"):
        m = TERM.match(name)
        factor, ref, level = (m.group(1), m.group(2).strip("'"), m.group(3)) if m else (name, "no fee", "fee")
        terms.append(
            {"factor": factor, "level": level, "ref": ref, "odds_ratio": float(np.exp(model.params[name])),
             "lo": float(np.exp(ci.loc[name, 0])), "hi": float(np.exp(ci.loc[name, 1])), "p": float(model.pvalues[name])}
        )
    return terms


def _logit(df: pd.DataFrame, factors: list[str]):
    """A clustered logistic fit on the given factors, or None when it did not converge or is not finite."""
    parts = [f"C({k}, Treatment({REFERENCES[k]!r}))" if k != "fee" else "fee" for k in factors if df[k].nunique() > 1]
    if not parts:
        return None
    try:
        model = smf.logit("reinterpreted ~ " + " + ".join(parts), data=df).fit(
            disp=0, cov_type="cluster", cov_kwds={"groups": pd.factorize(df["rule"])[0]}, maxiter=200
        )
        with np.errstate(over="ignore"):
            terms = _terms(model)
    except Exception:  # separation or a singular design in a small slice
        return None
    finite = all(np.isfinite([x["odds_ratio"], x["lo"], x["hi"], x["p"]]).all() for x in terms)
    ok = bool(model.mle_retvals.get("converged", True)) and finite and max(x["hi"] for x in terms) < 1e4
    return (model, terms) if ok else None


def fit(df: pd.DataFrame) -> dict:
    """Regression for one slice.

    First the joint model of every factor. When a slice has too few rules for that to be reliable, each label is
    fitted on its own, adjusted only for urgency and the probed model, and the result says so (`mode`).
    """
    clusters = int(df["rule"].nunique())
    base = [f for f in ("urgency", "model", "gen") if df[f].nunique() > 1]
    joint = _logit(df, ["ambiguity", "loophole", "cost", "fee", "urgency", "model", "gen"])
    if joint:
        model, terms = joint
        return {"mode": "joint", "terms": terms, "n": int(model.nobs), "pseudo_r2": float(model.prsquared), "clusters": clusters, "unfitted": []}
    terms, unfitted = [], []
    for label in ("ambiguity", "loophole", "cost", "fee"):
        part = _logit(df, [label, *[b for b in base if b != "gen"]])
        if part is None:
            unfitted.append(label)
            continue
        terms += [x for x in part[1] if x["factor"] == label]
    adjust = _logit(df, [b for b in base if b != "gen"])
    if adjust:
        terms += [x for x in adjust[1] if x["factor"] in ("urgency", "model")]
    n = len(df)
    return {"mode": "one_at_a_time", "terms": terms, "n": n, "pseudo_r2": None, "clusters": clusters, "unfitted": unfitted}


def analyse(df: pd.DataFrame) -> dict:
    return {
        "overall": {"runs": int(len(df)), "reinterpreted": float(df.reinterpreted.mean()), "shortcut": float(df.shortcut.mean()), "worlds": int(df.groupby(["generated", "world"]).ngroups)},
        "rates": rates(df),
        "model": fit(df),
        "worlds": world_rows(df),
    }


def main() -> None:
    df = load_runs()
    manifest = json.loads((DATA / "manifest.json").read_text())
    origins = {r["generated"]: r["generation"]["models"]["generator"] for r in manifest}
    models = sorted(df["model"].unique())
    slices, summary = {}, []
    for origin in [None, *origins]:
        for model in [None, *models]:
            sub = df[(df["generated"] == origin) if origin else slice(None)]
            sub = sub[sub["model"] == model] if model else sub
            if sub.empty:
                continue
            slices[f"{origin or 'all'}|{model or 'all'}"] = analyse(sub)
            if origin and model:
                summary.append({"origin": origin, "model": model, **slices[f"{origin}|{model}"]["overall"]})
    out = {
        "outcome": "reinterpreted_rule (monitor label) among costly-route runs with the rule shown",
        "references": {k: str(v) for k, v in REFERENCES.items()},
        "options": {"models": models, "origins": [{"id": g, "generator": gen} for g, gen in origins.items()]},
        "combinations": summary,
        "slices": slices,
    }
    (DATA / "analysis.json").write_text(json.dumps(out, indent=1))
    for key, s in slices.items():
        fitted = s["model"]
        status = f"{fitted['mode']}, {len(fitted['terms'])} terms, unfitted={fitted['unfitted']}, clusters={fitted['clusters']}"
        print(f"{key:40s} runs={s['overall']['runs']:5d} reinterpreted={s['overall']['reinterpreted']:.2f}  {status}")


if __name__ == "__main__":
    main()
