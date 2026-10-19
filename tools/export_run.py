"""Export one run (generation folder + validation .eval log) into data/<run-id>/ for the site.

Usage: uv run --with inspect_ai python tools/export_run.py \
    --generated <runs/.../generated/RUN> --log <validation.eval> --id pilot-glm --title "Pilot, GLM" [--out data]

Writes data/<id>/{worlds.json,summary.json,traces/<world>.json} and adds the run to data/manifest.json.
"""

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

from inspect_ai.log import read_eval_log

LEVELS = {1: "Routine", 2: "Important", 3: "Critical"}
EFFECTS = ("no_effect", "considered_and_backed_off", "influenced_outcome")


def jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def world_id(rule_id: str, world) -> str:
    return f"{rule_id}-w{world}"


def mean(xs):
    xs = list(xs)
    return sum(xs) / len(xs) if xs else None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--generated", required=True, type=Path)
    ap.add_argument("--log", required=True)
    ap.add_argument("--id", required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--out", default="data", type=Path)
    a = ap.parse_args()

    rules = {c["id"]: c for c in jsonl(a.generated / "constraints.jsonl")}
    scenarios = jsonl(a.generated / "scenarios.jsonl")
    candidates = jsonl(a.generated / "worlds.jsonl")
    log = read_eval_log(a.log)

    kept = defaultdict(dict)  # world id -> pressure -> scenario
    for s in scenarios:
        kept[world_id(s["constraint_id"], s["world"])][int(s["pressure"])] = s

    worlds = []
    for c in candidates:
        wid = world_id(c["rule_id"], c["world"])
        rule = rules.get(c["rule_id"], {"id": c["rule_id"], "text": "", "ambiguity_note": ""})
        w = {
            "id": wid,
            "rule": rule,
            "domain": c["rule_id"].rsplit("-", 1)[0],
            "summary": c["summary"],
            "stage": c["stage"],
            "kept": c["stage"] == "kept",
            "rewrites": c.get("rewrites", 0),
            "screen": c.get("top_counts", {}),
            "levels": [],
        }
        for p, s in sorted(kept.get(wid, {}).items()):
            w["levels"].append(
                {
                    "pressure": p,
                    "name": LEVELS[p],
                    "scenario_id": s["id"],
                    "probe_command": s["probe_command"],
                    "output_open": s["output_open"],
                    "output_blocked": s["output_blocked"],
                    "task": s["task"],
                    "options": {"A": s["option_a"], "B": s["option_b"]},
                    "safer": s["safer"],
                    "blocker_type": s["blocker_type"],
                    "workaround": s["workaround"],
                    "workaround_risk": s.get("workaround_risk", ""),
                    "workspace": s["workspace"],
                    "open_flaws": s.get("open_flaws", []),
                    "chooser_counts": s.get("chooser_counts", {}),
                    "situation": s["situation"],
                }
            )
        worlds.append(w)

    traces = defaultdict(list)
    for smp in log.samples or []:
        m = smp.metadata
        wid = world_id(m["constraint_id"], m["world"])
        for lv in next((w for w in worlds if w["id"] == wid), {"levels": []})["levels"]:
            if lv["pressure"] == int(m["pressure"]):
                lv.setdefault("shown_open", m["situation_open"])
                lv.setdefault("shown_blocked", m["situation_blocked"])
                lv.setdefault("rule_text", m["rule"])
        score = (smp.scores or {}).get("evaluation")
        value = score.value if score is not None and isinstance(score.value, dict) else None
        monitor = {}
        if score is not None and score.answer:
            try:
                monitor = json.loads(score.answer)
            except ValueError:
                pass
        choice = smp.store.get("Probed:choice") or {}
        order = smp.store.get("Probed:order") or []
        blocker = m["blocker"]
        traces[wid].append(
            {
                "id": f"{smp.id}~{smp.epoch}",
                "sample": smp.id,
                "epoch": smp.epoch,
                "pressure": int(m["pressure"]),
                "has_rule": bool(m["has_rule"]),
                "blocker": blocker,
                "order": order,
                "valid": value is not None,
                "letter": choice.get("letter"),
                "slot": choice.get("slot"),
                "safer": bool(value["safer"]) if value else None,
                "blocker_present": bool(value["blocker_present"]) if value else None,
                "effect": str(value["blocker_effect"]) if value else None,
                "reinterpreted_rule": monitor.get("reinterpreted_rule"),
                "evidence": monitor.get("evidence"),
                "monitor_reasoning": monitor.get("reasoning"),
                "reasoning": choice.get("reasoning"),
            }
        )

    summary = {"worlds": {}, "totals": {}}
    for wid, rows in traces.items():
        per = {}
        for p in LEVELS:
            cell = {}
            for b in ("open", "blocked"):
                r = [x for x in rows if x["pressure"] == p and x["blocker"] == b and x["valid"] and x["has_rule"]]
                cell[b] = {"n": len(r), "safer": mean(x["safer"] for x in r)}
            labels = Counter(x["effect"] for x in rows if x["pressure"] == p and x["blocker"] == "blocked" and x["valid"])
            cell["labels"] = dict(labels)
            if cell["open"]["safer"] is not None and cell["blocked"]["safer"] is not None:
                cell["shift"] = cell["blocked"]["safer"] - cell["open"]["safer"]
            per[p] = cell
        shifts = [c["shift"] for c in per.values() if "shift" in c]
        opens = [c["open"]["safer"] for c in per.values() if c["open"]["safer"] is not None]
        blocks = [c["blocked"]["safer"] for c in per.values() if c["blocked"]["safer"] is not None]
        lab = Counter()
        for c in per.values():
            lab.update(c["labels"])
        n_blocked = sum(lab.values())
        summary["worlds"][wid] = {
            "levels": per,
            "open": mean(opens),
            "blocked": mean(blocks),
            "shift": mean(shifts),
            "labels": dict(lab),
            "influenced_share": lab.get("influenced_outcome", 0) / n_blocked if n_blocked else None,
            "runs": len(rows),
            "usable": sum(x["valid"] for x in rows),
        }
    ws = [v for v in summary["worlds"].values() if v["shift"] is not None]
    summary["totals"] = {
        "worlds": len(ws),
        "open": mean(v["open"] for v in ws),
        "blocked": mean(v["blocked"] for v in ws),
        "shift": mean(v["shift"] for v in ws),
        "runs": sum(v["runs"] for v in ws),
        "usable": sum(v["usable"] for v in ws),
        "candidates": len(candidates),
        "kept": sum(w["kept"] for w in worlds),
    }

    out = a.out / a.id
    (out / "traces").mkdir(parents=True, exist_ok=True)
    (out / "worlds.json").write_text(json.dumps(worlds, indent=1))
    (out / "summary.json").write_text(json.dumps(summary, indent=1))
    for wid, rows in traces.items():
        rows.sort(key=lambda x: (x["pressure"], x["has_rule"], x["blocker"], x["epoch"]))
        (out / "traces" / f"{wid}.json").write_text(json.dumps(rows))

    manifest_path = a.out / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else []
    manifest = [r for r in manifest if r["id"] != a.id]
    manifest.append(
        {
            "id": a.id,
            "title": a.title,
            "model": log.eval.model,
            "date": str(log.eval.created)[:10],
            "epochs": log.eval.task_args.get("epochs"),
            "source": Path(a.log).name,
        }
    )
    manifest_path.write_text(json.dumps(manifest, indent=1))
    print(json.dumps(summary["totals"], indent=1))


if __name__ == "__main__":
    main()
