"""Export agentic runs and the environments they ran in, for the site's agentic page.

Usage: uv run --with inspect_ai --with pyyaml python tools/export_agentic.py \
    --log <agentic.eval> --envs <environments/ID> [<environments/ID> ...] --id db-ops-glm-costly-p3 --title "..."
Add --all to export every sample of the log as its own run (ids `<id>--<env>--<cost>-<pressure>`); without it only the first.

Writes agentic/data/runs/<id>.json (the trajectory and its outcome), agentic/data/envs/<env id>.json (only what the
evaluated agent has access to) and agentic/data/index.json. Never exported: oracle.py, README.md, tools/world.py,
tools/outcome.py (the agent cannot read them), and the builder's notes.
"""

import argparse
import ast
import json
from pathlib import Path

import yaml
from inspect_ai.log import read_eval_log

OUT = Path(__file__).resolve().parent.parent / "agentic" / "data"
LEVELS = ("p1", "p2", "p3")


def read_files(root: Path) -> dict[str, str]:
    """Every text file under `root`, keyed by its path relative to `root`."""
    return {str(p.relative_to(root)): p.read_text() for p in sorted(root.rglob("*")) if p.is_file() and p.suffix != ".pyc"}


def tool_specs(server: Path) -> list[dict]:
    """Name, parameters and docstring of each `@mcp.tool()` function in the world's MCP server: what the agent is shown."""
    specs = []
    for node in ast.parse(server.read_text()).body:
        if isinstance(node, ast.FunctionDef) and any("tool" in ast.unparse(d) for d in node.decorator_list):
            params = [f"{a.arg}: {ast.unparse(a.annotation)}" if a.annotation else a.arg for a in node.args.args]
            specs.append({"name": node.name, "parameters": params, "description": ast.get_docstring(node) or ""})
    return specs


def export_env(env_dir: Path) -> dict:
    """The environment as the evaluated agent meets it: prompts, files per pressure level, tools, and its two containers."""
    spec = yaml.safe_load((env_dir / "env.yaml").read_text())
    workspace = read_files(env_dir / "workspace")
    levels = {}
    for level in LEVELS:
        overlay = env_dir / "variants" / "pressure" / level / "workspace"
        levels[level] = {**workspace, **(read_files(overlay) if overlay.is_dir() else {})}
    system = (env_dir / spec["prompts"]["system"]).read_text().replace("{rule}", spec["rule"]["text"])
    return {
        "id": spec["id"],
        "rule": spec["rule"]["text"],
        "system_prompt": system,
        "task_prompt": (env_dir / spec["prompts"]["task"]).read_text(),
        "workspace": levels,
        "tools": tool_specs(env_dir / "tools" / "server.py"),
        "containers": {
            "default": "The agent's shell, working directory /workspace, with the files above written into it. Private network "
            "with the tools container only; no internet.",
            "tools": "The world's simulator and its MCP server. The agent can call the tools above; it cannot read this container's "
            "code, state or audit log.",
        },
    }


def content_parts(content) -> tuple[str, str]:
    """(reasoning, text) of a message's content."""
    if isinstance(content, str):
        return "", content
    reasoning = "\n".join(getattr(p, "reasoning", "") for p in content if type(p).__name__ == "ContentReasoning")
    text = "\n".join(getattr(p, "text", "") for p in content if type(p).__name__ == "ContentText")
    return reasoning, text


def export_message(m) -> dict:
    reasoning, text = content_parts(m.content)
    out = {"role": m.role, "text": text}
    if reasoning:
        out["reasoning"] = reasoning
    if m.role == "assistant":
        out["calls"] = [{"tool": c.function, "arguments": c.arguments} for c in m.tool_calls or []]
    if m.role == "tool":
        out["tool"] = m.function
    return out


def route_of(outcome: dict) -> str:
    """Which route an outcome records: the first (compliant), the second (loophole) or neither."""
    return "first" if outcome.get("compliant") else "second" if outcome.get("loophole") else "neither"


def export_run(log, log_path: Path, sample, run_id: str, title: str, experiment: str) -> dict:
    """One sample of an agentic log as a run."""
    meta = sample.metadata["metadata"]
    return {
        "id": run_id,
        "experiment": experiment,
        "title": title,
        "model": log.eval.model,
        "date": log.eval.created[:10],
        "env": meta["env_id"],
        "cost": meta["cost"],
        "pressure": meta["pressure"],
        "rule": meta["rule"],
        "seconds": round(sample.total_time or 0),
        "source": log_path.name,
        "outcome": dict(sample.scores["outcome"].value),
        "messages": [export_message(m) for m in sample.messages],
    }


def runs_of(log_path: Path, run_id: str, title: str, every_sample: bool) -> list[dict]:
    """The log's first sample as run `run_id`, or with `every_sample` each sample as a run named after its cell."""
    log = read_eval_log(str(log_path))
    if not every_sample:
        return [export_run(log, log_path, log.samples[0], run_id, title, run_id)]
    runs = []
    for sample in log.samples:
        meta = sample.metadata["metadata"]
        cell = f"{meta['env_id']}--{meta['cost']}-{meta['pressure']}"
        label = f"{meta['env_id']}, {meta['cost']} cost, {meta['pressure']}"
        runs.append(export_run(log, log_path, sample, f"{run_id}--{cell}", f"{title}: {label}", run_id))
    return runs


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--log", type=Path, required=True)
    parser.add_argument("--envs", type=Path, nargs="+", required=True)
    parser.add_argument("--id", required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--all", action="store_true", help="export every sample of the log, not only the first")
    args = parser.parse_args()
    for sub in ("runs", "envs"):
        (OUT / sub).mkdir(parents=True, exist_ok=True)
    runs = runs_of(args.log, args.id, args.title, args.all)
    for run in runs:
        (OUT / "runs" / f"{run['id']}.json").write_text(json.dumps(run, indent=1))
    exported = [export_env(env_dir) for env_dir in args.envs]
    for env in exported:
        (OUT / "envs" / f"{env['id']}.json").write_text(json.dumps(env, indent=1))
    index_path = OUT / "index.json"
    index = json.loads(index_path.read_text()) if index_path.exists() else {"runs": [], "envs": []}
    ids = {run["id"] for run in runs}
    index["runs"] = [r for r in index["runs"] if r["id"] not in ids] + [
        {k: run[k] for k in ("id", "experiment", "title", "model", "date", "env", "cost", "pressure")}
        | {"route": route_of(run["outcome"]), "goal_reached": bool(run["outcome"].get("goal_reached"))}
        for run in runs
    ]
    index["envs"] = sorted({*index["envs"], *(env["id"] for env in exported)})
    index_path.write_text(json.dumps(index, indent=1))
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
