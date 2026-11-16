# Cost traces

A static site for the constraint-drift study. The root page links to the current work: `breakdown/` (the 50 environments, one by one, with the baseline runs and their analysis) and `validation/` (the 20 harm and reputation worlds in plain English, with the agentic baseline runs). Everything earlier is under `old_logs/`: `cost-traces/`, `agentic/` and `pilots/`.

The old cost-traces page is a static browser for the scenarios and model trajectories of the cost-shift study: when the compliant route still works but is slow or expensive, does a model read an ambiguous safety rule more loosely? The earlier pilots blocked the compliant route instead; they are on the `old_logs/pilots/` page.

- **Index:** every candidate world (kept or dropped), with filters, grouping, sorting and search (optionally over the reasoning).
- **World page:** the rule, the three urgency levels, the two versions the model saw with the differing lines highlighted, and every trajectory with its monitor label.
- **Highlights:** examples where the model took the shortcut after arguing the rule forbids less than it appears to.
- **Trace page:** one trajectory with what the model saw and what it did. Every view has a URL.

Labels come from a second model reading the reasoning and have not been checked by hand.

## Run locally

```
python3 -m http.server 8000   # then open http://localhost:8000 (home), /breakdown/, /validation/, /old_logs/
```

`fetch` does not work from `file://`, so serve the folder.

## Add a run

```
uv run --with inspect_ai python tools/export_run.py \
  --generated <runs/.../generated/RUN> --log <validation.eval> \
  --id <short-id> --title "<title shown on the site>"
git add old_logs/cost-traces/data && git commit -m "Add <short-id>" && git push
```

The cost-traces page is `old_logs/cost-traces/` (data in `old_logs/cost-traces/data/`) and the earlier pilots are `old_logs/pilots/` (`--out old_logs/pilots/data` to export one). Runs whose scenarios carry `cheap_ending` / `costly_ending` (a cost on the compliant route, not a block) are shown as "Cheap route" / "Costly route".

The exporter writes `old_logs/cost-traces/data/<id>/{worlds,summary}.json` and one `traces/<world>.json` per world, and adds the run to its `manifest.json`. The site needs no other change; with more than one run a run picker appears.
