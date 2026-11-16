"""Export an ambiguity_validation log (forced-choice probes) for the validation page.

    uv run python -I tools/export_validation.py --log <file.eval> --run <generated run dir> --out validation

Writes `<out>/worlds/<n>.json` (every sample of one world: the exact prompt, the model's reasoning and its choice),
`<out>/analysis.json` (one row per sample plus each world's description) and redacts key-like strings.
"""
import argparse
import json
import re
from collections import defaultdict
from pathlib import Path

from inspect_ai.log import read_eval_log

SECRET = re.compile(r"(sk-[A-Za-z0-9_-]{16,}|fw_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{12,}|ghp_[A-Za-z0-9]{20,})")
MAX_REASONING = 12000


def text_of(content, attachments: dict) -> str:
    """The text of a message or content part, with `attachment://` references resolved."""
    parts = [content] if isinstance(content, str) else list(content)
    out = []
    for p in parts:
        t = p if isinstance(p, str) else getattr(p, "reasoning", None) or getattr(p, "text", "") or ""
        out.append(attachments.get(t.removeprefix("attachment://"), t) if t.startswith("attachment://") else t)
    return "\n".join(x for x in out if x)


def sample_record(s) -> dict:
    """One sample: which version of which setting it was, what the model saw and thought, what it chose."""
    m, value = s.metadata, s.scores["evaluation"].value
    event = next(e for e in s.events if e.event == "model")
    reply = event.output.choices[0].message
    reasoning = " ".join(
        text_of(c.reasoning, s.attachments) for c in reply.content if getattr(c, "reasoning", None)
    ) if isinstance(reply.content, list) else ""
    say = text_of([c for c in reply.content if getattr(c, "text", None)], s.attachments) if isinstance(reply.content, list) else reply.content
    call = reply.tool_calls[0] if reply.tool_calls else None
    return {
        "id": s.id,
        "epoch": s.epoch,
        "rule": m["constraint_id"],
        "world": int(m["world"]),
        "mech": "harm" if "-harm-" in m["scenario_id"] else "reputation",
        "pressure": int(m["pressure"]),
        "rule_shown": str(m["has_rule"]) == "True",
        "cost": m["cost"],
        "compliant": bool(value["safer"]),
        "chose": (call.arguments or {}).get("option") if call else None,
        "compliant_letter": m["safer"],
        "options": m["options"],
        "prompt": SECRET.sub("[removed]", text_of(event.input[-1].content, s.attachments)),
        "reasoning": SECRET.sub("[removed]", reasoning[:MAX_REASONING]),
        "say": SECRET.sub("[removed]", (say or "")[:1500]),
    }


def world_meta(run: Path) -> dict:
    """The rule and the shared description of each world, from the run's constraints and scenarios files."""
    rules = {r["id"]: r for r in map(json.loads, open(run / "constraints.jsonl"))}
    meta = {}
    for row in map(json.loads, open(run / "scenarios.fixed.jsonl")):
        k = f'{row["constraint_id"]}|{row["world"]}'
        if k not in meta:
            meta[k] = {
                "rule": rules[row["constraint_id"]]["text"],
                "ambiguity": rules[row["constraint_id"]]["ambiguity_note"],
                "task": row["task"],
                "compliant_option": row["compliant_option"],
                "loophole_option": row["loophole_option"],
                "loophole_rationale": row["loophole_rationale"],
            }
    return meta


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--log", type=Path, required=True)
    ap.add_argument("--run", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()
    log = read_eval_log(str(a.log))
    by_world = defaultdict(list)
    for s in log.samples:
        r = sample_record(s)
        by_world[(r["rule"], r["world"])].append(r)
    meta = world_meta(a.run)
    (a.out / "worlds").mkdir(parents=True, exist_ok=True)
    worlds = []
    for n, ((rule, world), recs) in enumerate(sorted(by_world.items()), 1):
        recs.sort(key=lambda r: (r["mech"], r["pressure"], not r["rule_shown"], r["cost"], r["epoch"]))
        (a.out / "worlds" / f"{n}.json").write_text(json.dumps({"samples": recs}, ensure_ascii=False))
        worlds.append({"n": n, "rule_id": rule, "world": world, **meta[f"{rule}|{world}"],
                       "cells": [[r["mech"], r["pressure"], int(r["rule_shown"]), r["cost"], r["epoch"], int(r["compliant"])] for r in recs]})
    info = {"model": log.eval.model, "epochs": log.eval.task_args.get("epochs"), "log": a.log.name, "created": log.eval.created, "worlds": worlds}
    (a.out / "analysis.json").write_text(json.dumps(info, ensure_ascii=False))
    print(f"wrote {len(worlds)} worlds, {sum(len(w['cells']) for w in worlds)} samples")


if __name__ == "__main__":
    main()
