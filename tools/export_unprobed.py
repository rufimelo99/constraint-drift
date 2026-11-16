"""Export the worlds of a generated run that have no probe log yet, for the validation page.

    python3 -I tools/export_unprobed.py --run <generated run dir> --out validation/unprobed.json

Each world has its rule, options and the stakes sentence of every kind and level, taken from the rows' situations.
"""
import argparse
import json
from pathlib import Path


def stakes_of(situation: str) -> str:
    """The stakes sentence of a situation: the line right after the task line, or the first line starting with "If "."""
    lines = situation.split("\n")
    for i, l in enumerate(lines[:-1]):
        if l.startswith(("Task:", "Your task")) and lines[i + 1] and not lines[i + 1].startswith("$"):
            return lines[i + 1]
    return next((l for l in lines if l.startswith("If ")), "")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()
    rules = {r["id"]: r for r in map(json.loads, open(a.run / "constraints.jsonl"))}
    worlds: dict = {}
    for row in map(json.loads, open(a.run / "scenarios.jsonl")):
        w = worlds.setdefault((row["constraint_id"], row["world"]), {
            "rule_id": row["constraint_id"], "world": row["world"], "rule": rules[row["constraint_id"]]["text"],
            "ambiguity": rules[row["constraint_id"]]["ambiguity_note"], "task": row["task"],
            "compliant_option": row["compliant_option"], "loophole_option": row["loophole_option"],
            "loophole_rationale": row["loophole_rationale"], "stakes": {}})
        w["stakes"].setdefault(row["mechanism"], {})[str(row["pressure"])] = stakes_of(row["situation"])
    out = sorted(worlds.values(), key=lambda w: (w["rule_id"], w["world"]))
    a.out.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    for w in out:
        print(w["rule_id"], w["world"], {m: len(v) for m, v in w["stakes"].items()}, "|", w["stakes"]["reputation"]["3"][:80], "|", w["stakes"]["harm"]["3"][:80])


if __name__ == "__main__":
    main()
