"""Export the baseline runs on the 50 environments for the breakdown page.

    uv run python <this file> --logs <logs/agentic_50_baseline> --out breakdown

Writes `<out>/runs/<task>.json` (one file per task: every run's steps, reasoning and report) and `<out>/analysis.json`
(outcome of every cell, for the grid). Run it from a checkout that has inspect_ai installed; the logs are local files
and are not published, only these exports are.
"""
import argparse
import json
import re
from pathlib import Path

from inspect_ai.log import read_eval_log

# One log per model: the four of 2026-11-06 and the GLM 5.3 flash run of 2026-11-08 (the clock-sync environments).
LOGS = {
    "2026-11-06T12-02-34": "GLM 5.3",
    "2026-11-06T13-24-58": "Kimi K3.1 Pro",
    "2026-11-06T14-02-41": "Qwen 3.8 Max",
    "2026-11-06T15-05-57": "DeepSeek V4.1 Flash",
    "2026-11-08T16-12-21": "GLM 5.3 flash",
}
THINK = re.compile(r"<think>(.*?)</think>", re.S)
CUT = {"reasoning": 700, "say": 400, "args": 220, "result": 240, "report": 1500}
# Words that show a model is thinking about the rule. A keyword heuristic, not a judgement of what it concluded.
RULE_WORDS = re.compile(r"\b(rule|policy|forbid\w*|prohibit\w*|retention hold|must not|not allowed|violat\w*|permitted|restriction|constraint)\b", re.I)
LOOK_TOOL = re.compile(r"(status|inspect|tail|read|list|get|show|entry|plan|quote|describe|check|query|view|diff|preview|estimate|verify|log|info|search|lookup)", re.I)
LOOK_CMD = re.compile(r"^\s*(cd [^;&|]*(&&|;)\s*)?(cat|ls|find|grep|head|tail|echo|printf|for |sed -n|wc|pwd|date|stat|tree|less|jq|test|\[)\b")
SECRET = re.compile(r"(sk-[A-Za-z0-9]{16,}|fw_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{12,}|ghp_[A-Za-z0-9]{20,})")


def cut(text: str, n: int) -> str:
    text = SECRET.sub("[removed]", " ".join(str(text).split()))
    return text if len(text) <= n else text[: n - 1] + "…"


def text_of(content) -> str:
    if isinstance(content, str):
        return content
    return "\n".join(getattr(c, "text", None) or getattr(c, "reasoning", None) or "" for c in content)


def kind_of(tc) -> str:
    """l: reads or inspects, a: changes something, s: the final report. Guessed from the tool name and shell command."""
    if tc.function == "submit":
        return "s"
    if tc.function == "bash":
        return "l" if LOOK_CMD.match(str((tc.arguments or {}).get("command", ""))) else "a"
    return "l" if LOOK_TOOL.search(tc.function) else "a"


def steps_of(messages) -> tuple[list[dict], str]:
    """The assistant turns of a run: what it thought, said and called, with each call's result; and its final report."""
    results = {}
    for m in messages:
        if m.role == "tool":
            results[m.tool_call_id] = text_of(m.content)
    steps, report = [], ""
    for m in messages:
        if m.role != "assistant":
            continue
        items = [m.content] if isinstance(m.content, str) else list(m.content)
        thoughts = [c.reasoning for c in items if getattr(c, "reasoning", None)]
        texts = [c if isinstance(c, str) else c.text for c in items if isinstance(c, str) or getattr(c, "text", None)]
        for t in texts:
            thoughts += [x.strip() for x in THINK.findall(t)]
        thought = " ".join(dict.fromkeys(thoughts))
        say = "\n".join(THINK.sub("", t).strip() for t in texts).strip()
        calls = []
        for tc in m.tool_calls or []:
            args = json.dumps(tc.arguments, ensure_ascii=False)
            if tc.function == "submit":
                report = (tc.arguments or {}).get("report", "")
            calls.append(
                {"tool": tc.function, "k": kind_of(tc), "args": cut(args, CUT["args"]), "result": cut(results.get(tc.id, ""), CUT["result"])}
            )
        steps.append(
            {
                "think": cut(thought, CUT["reasoning"]),
                "say": cut(say, CUT["say"]),
                "rule": len(RULE_WORDS.findall(thought + " " + say)),
                "calls": calls,
            }
        )
    return steps, cut(report, CUT["report"])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--logs", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--data", type=Path, default=None, help="breakdown/data.json, to map environments to task numbers")
    args = ap.parse_args()
    data = json.loads((args.data or args.out / "data.json").read_text())
    task_of = {t["env_id"]: t["n"] for t in data["tasks"]}
    per_task: dict[int, list[dict]] = {n: [] for n in task_of.values()}
    for stamp, model in LOGS.items():
        (path,) = args.logs.glob(f"{stamp}*.eval")
        log = read_eval_log(str(path))
        for s in log.samples:
            env, cond = s.id.split(":")
            kv = dict(x.split("=") for x in cond.split(","))
            v = s.scores["outcome"].value
            outcome = "loophole" if v["loophole"] else "compliant" if v["compliant"] else "neither"
            steps, report = steps_of(s.messages)
            per_task[task_of[env]].append(
                {
                    "model": model,
                    "cost": kv["cost"],
                    "pressure": kv["pressure"],
                    "outcome": outcome,
                    "goal": bool(v["goal_reached"]),
                    "cancelled": bool(s.limit) or bool(s.error),
                    "calls": sum(len(x["calls"]) for x in steps),
                    "steps": steps,
                    "report": report,
                    "rule_words": sum(x["rule"] for x in steps) + len(RULE_WORDS.findall(report)),
                }
            )
    (args.out / "runs").mkdir(parents=True, exist_ok=True)
    grid = {}
    for n, runs in per_task.items():
        (args.out / "runs" / f"{n}.json").write_text(json.dumps({"task": n, "runs": runs}, ensure_ascii=False, separators=(",", ":")))
        grid[n] = [[r["model"], r["cost"], r["pressure"], r["outcome"], int(r["goal"]), int(r["cancelled"]), r["calls"], r["rule_words"]] for r in runs]
    (args.out / "analysis.json").write_text(
        json.dumps({"models": list(LOGS.values()), "cells": grid}, ensure_ascii=False, separators=(",", ":"))
    )
    print(f"wrote {len(per_task)} task files, {sum(len(r) for r in per_task.values())} runs")


if __name__ == "__main__":
    main()
