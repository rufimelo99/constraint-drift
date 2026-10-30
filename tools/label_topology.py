"""Write data/labels.json: a topology label for every kept world of the current runs.

Three labels per world, assigned by reading the rule, the two options and the cost ending (one annotator, not
cross-checked):

ambiguity  what the rule's ambiguity hinges on
  environment  where it applies: 'production', 'shared branch', 'public internet'
  action       what counts as the verb: 'restart', 'overwrite', 'push', 'bulk'
  object       what counts as the thing: 'credential', 'backup', 'artifact', 'dependency'
loophole   how the shortcut option differs from the compliant one
  bypass       same core act, skipping the intermediary or safeguard the compliant route uses
  equivalent   a different operation with the same effect that the rule's verb may not name
  transformed  acts on a derived form of the protected object (hash, truncation, fingerprint, scratch copy)
  adjacent     the same kind of act on a neighbouring object, environment or source the narrow reading excludes
  delegated    has standing automation perform the act
cost       what makes the compliant route slow
  queue        waits behind unrelated work
  window       waits for a scheduled window, slot or freeze to end
  throttle     a rate or capacity cap on the service
fee        the cost ending quotes a money amount

Usage: python3 tools/label_topology.py <runs/.../generated> [--out data/labels.json]
Worlds are numbered in the order they appear in the kept worlds of data/<run>/worlds.json, set A then set B.
"""

import argparse
import json
import re
from pathlib import Path

RUNS = {"gen-20261029-a": "20261029T153226Z", "gen-20261029-b": "20261029T160703Z"}

AMBIGUITY = {
    "database-operations-2": "environment", "secrets-and-credentials-1": "object", "infrastructure-as-code-and-cloud-2": "environment",
    "database-operations-1": "action", "incident-response-and-on-call-2": "environment", "dependencies-and-supply-chain-2": "environment",
    "infrastructure-as-code-and-cloud-1": "object", "release-and-deployment-pipelines-2": "environment",
    "secrets-and-credentials-2": "environment", "incident-response-and-on-call-1": "action",
    "release-and-deployment-pipelines-1": "action", "dependencies-and-supply-chain-1": "object",
}
# Set B words these rules differently, so its ambiguity differs.
AMBIGUITY_B = {
    "release-and-deployment-pipelines-1": "environment", "dependencies-and-supply-chain-2": "object",
    "release-and-deployment-pipelines-2": "action", "infrastructure-as-code-and-cloud-2": "action",
    "database-operations-2": "action",
}

B, E, T, A, D = "bypass", "equivalent", "transformed", "adjacent", "delegated"
# Loophole label per kept world index (set A worlds 0-36, then set B worlds 37-68), as (first, last, label).
_SPANS = [
    (0, 3, B), (4, 7, T), (8, 8, A), (9, 9, B), (10, 11, A), (12, 15, E), (16, 19, A), (20, 21, B), (22, 26, A),
    (27, 32, E), (33, 35, A), (36, 36, E), (37, 40, E), (41, 44, B), (45, 47, E), (48, 50, A), (51, 54, D),
    (55, 57, A), (58, 60, A), (61, 61, A), (62, 65, E), (66, 67, A), (68, 68, E),
]
LOOPHOLE = [label for first, last, label in _SPANS for _ in range(first, last + 1)]
WINDOW = {7, 14, 32, 42, 47, 53, 56, 59, 61, 64}
THROTTLE = {6, 9, 10, 19, 38, 45, 50}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data", type=Path)
    ap.add_argument("--out", default=None, type=Path)
    a = ap.parse_args()
    labels, n = {}, 0
    for run, generated in RUNS.items():
        worlds = [w for w in json.loads((a.data / run / "worlds.json").read_text()) if w["kept"]]
        table = labels.setdefault(generated, {})
        for w in worlds:
            rule = w["rule"]["id"]
            cost = "window" if n in WINDOW else "throttle" if n in THROTTLE else "queue"
            amb = (AMBIGUITY_B if run.endswith("-b") else {}).get(rule, AMBIGUITY[rule])
            table[w["id"]] = {
                "ambiguity": amb,
                "loophole": LOOPHOLE[n],
                "cost": cost,
                "fee": bool(re.search(r"\$\d", w["levels"][0]["output_blocked"] or "")),
            }
            n += 1
    assert n == len(LOOPHOLE), (n, len(LOOPHOLE))
    (a.out or a.data / "labels.json").write_text(json.dumps(labels, indent=1))
    print(n, "worlds labelled")


if __name__ == "__main__":
    main()
