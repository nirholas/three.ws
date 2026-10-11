# Contributing

Thanks for helping map how agents use the web. Contributions of new projects, corrections, and status updates are all welcome.

## What belongs here

A project fits when it is real, public, and relevant to agents operating on or with the web:

- Standards, proposals, and conventions for agent-readable or agent-actionable web content.
- WebMCP and in-page tool libraries; MCP servers and clients for browsers.
- Browser-use and computer-use frameworks, agents, and sandboxes.
- Browser automation engines and headless browser infrastructure used by agents.
- Web data tools built for agents; benchmarks and research agents for web tasks.

Requirements: a working public URL, a factual description, and enough substance to evaluate (docs, a repo, or a published spec). Early projects are welcome with `status: "early"`.

## Adding an entry

Add an object to `data/entries.json`:

```json
{
  "id": "my-project",
  "name": "My Project",
  "url": "https://example.com/",
  "repo": "https://github.com/example/my-project",
  "category": "browser-use-frameworks",
  "chain": "none",
  "description": "One factual sentence about what it does, at most 160 characters.",
  "status": "active",
  "added": "2026-10-10"
}
```

Field notes:

- `id`: unique kebab-case slug.
- `repo`: source repository URL, or `null` if there is none.
- `category`: an `id` from `data/categories.json`.
- `chain`: always `"none"` for this list.
- `description`: one factual sentence, no marketing language, 160 characters max.
- `status`: `active`, `early`, or `archived`.
- `added`: the date you add the entry, `YYYY-MM-DD`.

Keep entries sorted alphabetically by `name` within each category. Do not use em-dash or en-dash characters; use commas, periods, or hyphens.

Then run:

```sh
npm run check
```

This validates the data and regenerates the tables in `README.md`. Commit both `data/entries.json` and `README.md`.

## Updating or archiving

If a project is renamed, moved, or no longer maintained, open a PR that fixes the URL or sets `status` to `archived`. Archived projects stay listed so people can find them and their lineage.

## Style

Positive, specific, and factual. Describe what a project does, not how it compares to others.
