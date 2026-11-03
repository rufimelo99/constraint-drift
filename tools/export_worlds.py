"""Export the accepted worlds of a data release for the review page (agentic/#/worlds): writes agentic/data/worlds.json.

One entry per world: the rule and its ambiguity note, the task, the two options, and the three pressure levels (transcript,
both endings, workspace files, the chooser's counts and the critic's open flaws). `id` is the name the environment folder gets
(`<rule>-w<n>-<source run lowercased>`), so a veto list can be matched against `run_env_build.sh --only`.

Usage: python3 tools/export_worlds.py <accepted folder of the release> [--built agentic/data/envs]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "agentic" / "data" / "worlds.json"


def lines(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def folder_id(source_id: str) -> str:
    """`20261031T000048Z:rule-1-w3` -> `rule-1-w3-20261031t000048z`, as env_build names the environment folder."""
    run, _, name = source_id.rpartition(":")
    return f"{name}-{run}".lower() if run else name


def share(counts: dict[str, int]) -> float | None:
    """The share of valid choices that took the compliant option (A)."""
    total = sum(counts.values())
    return counts.get("A", 0) / total if total else None


def export(accepted: Path, built: set[str]) -> list[dict]:
    rules = {c["id"]: c for c in lines(accepted / "constraints.jsonl")}
    by_world: dict[str, list[dict]] = {}
    for row in lines(accepted / "scenarios.jsonl"):
        by_world.setdefault(f"{row['constraint_id']}-w{row['world']}", []).append(row)
    worlds = []
    for source_id, rows in by_world.items():
        rows.sort(key=lambda r: r["pressure"])
        top = rows[-1]
        rule = rules[top["constraint_id"]]
        levels = [
            {"pressure": r["pressure"], "situation": r["situation"], "cheap_ending": r["cheap_ending"], "costly_ending": r["costly_ending"],
             "workspace": r["workspace"], "counts": r["chooser_counts"], "cheap_share": share(r["chooser_counts"].get("cheap", {})),
             "costly_share": share(r["chooser_counts"].get("costly", {})), "flaws": [str(f) for f in r["open_flaws"]]}
            for r in rows
        ]
        before, after = levels[-1]["cheap_share"], levels[-1]["costly_share"]
        worlds.append({
            "id": folder_id(source_id), "source_id": source_id, "domain": top["constraint_id"].rpartition(":")[2].rsplit("-", 1)[0],
            "rule": rule["text"], "ambiguity": rule["ambiguity_note"], "explicit": rule.get("explicit_text", ""),
            "summary": top["summary"], "task": top["task"], "compliant_option": top["compliant_option"],
            "loophole_option": top["loophole_option"], "loophole_rationale": top["loophole_rationale"], "loophole_risk": top["loophole_risk"],
            "shift": None if before is None or after is None else before - after, "levels": levels,
            "flaws": sorted({f for level in levels for f in level["flaws"]}), "built": folder_id(source_id) in built,
        })
    return sorted(worlds, key=lambda w: w["id"])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("accepted", type=Path)
    parser.add_argument("--built", type=Path, default=OUT.parent / "envs", help="folder of exported environments, to mark built worlds")
    args = parser.parse_args()
    built = {p.stem for p in args.built.glob("*.json")} if args.built.is_dir() else set()
    worlds = export(args.accepted, built)
    OUT.write_text(json.dumps({"source": args.accepted.parts[-5:-1] and "/".join(args.accepted.parts[-4:]), "worlds": worlds}, indent=1))
    print(f"wrote {len(worlds)} worlds ({sum(w['built'] for w in worlds)} built, {sum(bool(w['flaws']) for w in worlds)} with open flaws) to {OUT}")


if __name__ == "__main__":
    main()
