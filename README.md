# Blocker traces

A static browser for the scenarios and model trajectories of the blocker-shift study: when a status command reports that the compliant route is blocked, does a model read an ambiguous safety rule more loosely?

- **Index:** every candidate world (kept or dropped), with filters, grouping, sorting and search (optionally over the reasoning).
- **World page:** the rule, the three urgency levels, the two versions the model saw with the differing lines highlighted, and every trajectory with its monitor label.
- **Highlights:** examples where the model took the shortcut after arguing the rule forbids less than it appears to.
- **Trace page:** one trajectory with what the model saw and what it did. Every view has a URL.

Labels come from a second model reading the reasoning and have not been checked by hand.

## Run locally

```
python3 -m http.server 8000   # then open http://localhost:8000
```

`fetch` does not work from `file://`, so serve the folder.

## Add a run

```
uv run --with inspect_ai python tools/export_run.py \
  --generated <runs/.../generated/RUN> --log <validation.eval> \
  --id <short-id> --title "<title shown on the site>"
git add data && git commit -m "Add <short-id>" && git push
```

The exporter writes `data/<id>/{worlds,summary}.json` and one `traces/<world>.json` per world, and adds the run to `data/manifest.json`. The site needs no other change; with more than one run a run picker appears.
