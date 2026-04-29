# 38 — Add repo-integrations to top-level prompts index

**Branch:** `docs/prompts-index-repo-integrations`
**One PR. Standalone. No other prompt is required to be shipped first.**

## Why it matters

The prompts dispatch index ([prompts/INDEX.md](../INDEX.md), [prompts/README.md](../README.md)) lists active bands. The new `repo-integrations/` band needs an entry so future agents pick it up rather than reinventing tasks.

## Read these first

| File | Why |
| :--- | :--- |
| [prompts/INDEX.md](../INDEX.md) | Top-level dispatch index. |
| [prompts/README.md](../README.md) | Active vs archival list. |
| [prompts/repo-integrations/README.md](./README.md) | The new band's own README. |

## Build this

1. Add a single line to [prompts/INDEX.md](../INDEX.md) under "Dispatch order" linking to `repo-integrations/`. Describe in one line: "side lane — feature ports from the user's other GitHub repos. Independent of the priority stack."
2. Add a row to the "Active" table in [prompts/README.md](../README.md) for `repo-integrations/` with status "Active — repo feature ports".
3. Do not change priorities or band order. The new band is a parallel side lane.

## Out of scope

- Renaming or reorganizing existing bands.
- Editing repo-integrations files.

## Acceptance

- [ ] Both index files reference `repo-integrations/`.
- [ ] `prompts/repo-integrations/` is reachable in two clicks from `INDEX.md`.
- [ ] No other content in the index files changed.

## Test plan

1. Render both files in a Markdown previewer; confirm links resolve.
2. Diff the two files; confirm only additions, no edits to existing rows.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
