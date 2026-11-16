"""Export an agentic baseline log of the 20 worlds for the validation page.

    uv run python tools/export_validation_agentic.py --log <agentic.eval> --out validation

Writes `<out>/agentic/<world n>.json` (every run of that world: steps, reasoning, report) and `<out>/agentic.json`
(the outcome of every cell, for the grids). World numbers are those of the validation page: the probed worlds of
`analysis.json`, then the worlds of `unprobed.json`.
"""
import argparse
import json
import re
from pathlib import Path

from export_baseline import RULE_WORDS, steps_of
from inspect_ai.log import read_eval_log


def world_numbers(out: Path) -> dict[str, int]:
    """Environment id (`<rule id>-w<world>`) to the validation page's world number."""
    probed = json.loads((out / "analysis.json").read_text())["worlds"]
    unprobed = json.loads((out / "unprobed.json").read_text())
    ordered = [(w["rule_id"], w["world"]) for w in probed] + [(w["rule_id"], w["world"]) for w in unprobed]
    return {f"{rule}-w{world}": n for n, (rule, world) in enumerate(ordered, 1)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--log", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    number = world_numbers(args.out)
    log = read_eval_log(str(args.log))
    per_world: dict[int, list[dict]] = {}
    for s in log.samples:
        env, cond = s.id.split(":")
        kv = dict(x.split("=") for x in cond.split(","))
        kind, level = kv["pressure"].split("-")
        v = s.scores["outcome"].value
        steps, report = steps_of(s.messages)
        per_world.setdefault(number[env], []).append({
            "kind": kind, "pressure": int(level[1]), "cost": kv["cost"],
            "outcome": "loophole" if v["loophole"] else "compliant" if v["compliant"] else "neither",
            "goal": bool(v["goal_reached"]), "cancelled": bool(s.limit) or bool(s.error),
            "calls": sum(len(x["calls"]) for x in steps), "steps": steps, "report": report,
            "rule_words": sum(x["rule"] for x in steps) + len(RULE_WORDS.findall(report)),
        })
    (args.out / "agentic").mkdir(parents=True, exist_ok=True)
    cells = {}
    for n, runs in per_world.items():
        runs.sort(key=lambda r: (r["kind"] != "reputation", r["pressure"], r["cost"] != "cheap"))
        (args.out / "agentic" / f"{n}.json").write_text(json.dumps({"runs": runs}, ensure_ascii=False, separators=(",", ":")))
        cells[n] = [[r["kind"], r["pressure"], r["cost"], r["outcome"], int(r["goal"]), int(r["cancelled"]), r["calls"]] for r in runs]
    info = {"model": log.eval.model, "log": args.log.name, "created": log.eval.created, "epochs": 1,
            "message_limit": (log.eval.task_args or {}).get("message_limit"), "cells": cells}
    (args.out / "agentic.json").write_text(json.dumps(info, ensure_ascii=False, separators=(",", ":")))
    print(f"wrote {len(per_world)} worlds, {sum(len(r) for r in per_world.values())} runs")


if __name__ == "__main__":
    main()
