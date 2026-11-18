"""Extra analysis of the agentic baseline of the 20 worlds: effort, whether the model talks about the rule, and how
concentrated the loopholes are. Reads the run itself.

    uv run python tools/analyze_run_extra.py --log <agentic.eval> --out validation [--excerpts <file>]

Writes `<out>/extra.json` for the page. `--excerpts` also writes the reasoning of the loophole and neither runs, for reading.
Rule mentions are a keyword match (`export_baseline.RULE_WORDS`), not a judgement of what the model concluded.
"""
import argparse
import json
import random
from pathlib import Path

import numpy as np
from export_baseline import RULE_WORDS, steps_of
from export_validation_agentic import world_numbers
from inspect_ai.log import read_eval_log


def run_features(sample, number: dict[str, int]) -> dict:
    env, cond = sample.id.split(":")
    kv = dict(x.split("=") for x in cond.split(","))
    kind, level = kv["pressure"].split("-")
    v = sample.scores["outcome"].value
    steps, report = steps_of(sample.messages)
    acts = [i for i, s in enumerate(steps) if any(c["k"] == "a" for c in s["calls"])]
    first_act = acts[0] if acts else len(steps)
    mention = [i for i, s in enumerate(steps) if s["rule"] > 0]
    return dict(
        world=number[env], kind=kind, pressure=int(level[1]), cost=kv["cost"],
        outcome="loophole" if v["loophole"] else "compliant" if v["compliant"] else "neither", goal=bool(v["goal_reached"]),
        calls=sum(len(s["calls"]) for s in steps), steps=len(steps), first_act=first_act,
        mention=bool(mention), mention_before_act=any(i <= first_act for i in mention),
        mention_steps=len(mention), report_mentions=bool(RULE_WORDS.search(report)), _steps=steps, _report=report,
    )


def bootstrap_shift(runs: list[dict], draws: int = 5000, seed: int = 1) -> dict:
    """Mean over worlds of (costly share - cheap share), with a 95% interval from resampling worlds."""
    worlds = sorted({r["world"] for r in runs})
    shift = {w: np.mean([r["outcome"] == "loophole" for r in runs if r["world"] == w and r["cost"] == "costly"])
             - np.mean([r["outcome"] == "loophole" for r in runs if r["world"] == w and r["cost"] == "cheap"]) for w in worlds}
    rng = random.Random(seed)
    means = sorted(np.mean([shift[rng.choice(worlds)] for _ in worlds]) for _ in range(draws))
    return dict(mean=float(np.mean(list(shift.values()))), lo=float(means[int(0.025 * draws)]), hi=float(means[int(0.975 * draws)]),
                per_world={str(w): float(s) for w, s in shift.items()})


def summarise(runs: list[dict]) -> dict:
    def share(sub: list[dict], key: str) -> float:
        return float(np.mean([r[key] for r in sub])) if sub else 0.0

    out = {}
    for o in ("compliant", "loophole", "neither"):
        for c in ("cheap", "costly"):
            sub = [r for r in runs if r["outcome"] == o and r["cost"] == c]
            out[f"{o}|{c}"] = dict(n=len(sub), calls_mean=share(sub, "calls"), calls_median=float(np.median([r["calls"] for r in sub])) if sub else 0.0,
                                   mention=share(sub, "mention"), before=share(sub, "mention_before_act"), report=share(sub, "report_mentions"),
                                   first_act=share(sub, "first_act"))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--log", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--excerpts", type=Path, default=None)
    args = ap.parse_args()
    number = world_numbers(args.out)
    log = read_eval_log(str(args.log))
    runs = [run_features(s, number) for s in log.samples]
    lean = [{k: v for k, v in r.items() if not k.startswith("_")} for r in runs]
    per_world = {}
    for r in lean:
        w = per_world.setdefault(str(r["world"]), dict(loophole=0, n=0))
        w["n"] += 1
        w["loophole"] += r["outcome"] == "loophole"
    events = sorted((w["loophole"] for w in per_world.values()), reverse=True)
    out = dict(runs=lean, summary=summarise(lean), shift=bootstrap_shift(lean), loopholes_by_world=per_world,
               concentration=[sum(events[: k + 1]) / sum(events) for k in range(len(events))])
    (args.out / "extra.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    if args.excerpts:
        lines = []
        for r in runs:
            if r["outcome"] == "compliant":
                continue
            lines.append(f'### world {r["world"]} {r["kind"]} P{r["pressure"]} {r["cost"]} -> {r["outcome"]} goal={r["goal"]} calls={r["calls"]} mention_before_act={r["mention_before_act"]}')
            for i, s in enumerate(r["_steps"]):
                if s["rule"]:
                    lines.append(f'  step {i + 1} think: {s["think"][:420]}')
                    lines.append(f'  step {i + 1} say: {s["say"][:200]}')
                    break
            lines.append(f'  report: {r["_report"][:420]}')
        args.excerpts.write_text("\n".join(lines))
    print(json.dumps(out["summary"], indent=1)[:1500]); print(out["shift"]["mean"], out["shift"]["lo"], out["shift"]["hi"]); print([round(x, 2) for x in out["concentration"]])


if __name__ == "__main__":
    main()
