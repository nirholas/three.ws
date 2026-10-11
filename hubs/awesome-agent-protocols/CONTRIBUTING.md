# Contributing

Thank you for helping map the agent interoperability ecosystem. Good additions are real, public, and useful to someone building agents that need to talk to tools or to other agents.

## What belongs here

- Protocol and standard specifications for agent-to-tool, agent-to-agent and agent-to-user communication.
- Agent discovery, identity, agent card and registry projects.
- MCP gateways, proxies and aggregators, and A2A-aware gateways.
- Multi-agent orchestration frameworks and platforms.
- SDKs, inspectors, conformance suites, samples and bridges for the above.
- Directories and curated lists in the same space.

A project should be publicly reachable and have enough documentation for a newcomer to understand what it does.

## How to add an entry

1. Fork the repository and edit `data/entries.json`.
2. Add one object with every field below. Put it in the right category and keep entries sorted alphabetically by name within each category.
3. Run `npm run check`. It validates your entry and regenerates the README tables.
4. Commit `data/entries.json` and `README.md`, then open a pull request using the template.

```json
{
  "id": "my-project",
  "name": "My Project",
  "url": "https://example.com",
  "repo": "https://github.com/owner/my-project",
  "category": "sdks",
  "chain": "none",
  "description": "One factual sentence about what the project does.",
  "status": "active",
  "added": "2026-10-10"
}
```

## Field rules

- `id`: unique, kebab-case.
- `url`: the canonical home page or specification. `repo`: the source repository, or `null`.
- `category`: an `id` from `data/categories.json`.
- `chain`: `none` unless the project runs onchain, then `solana`, `evm` or `multi`.
- `description`: one factual sentence, 160 characters or fewer. Describe what the project is and does. Avoid marketing superlatives.
- `status`: `active`, `early` or `archived`.
- `added`: the date you add it, `YYYY-MM-DD`.
- Do not use em-dash or en-dash characters. Use commas, periods or colons.

## Adding a category

If nothing fits, propose a new category in the pull request description, then add it to `data/categories.json` with an `id`, `title` and `blurb`.

## Review

Maintainers check that the link resolves, the description is accurate and the project fits the scope. This repository uses issue and pull request templates only. There are no automated workflows, so please run `npm run check` locally before opening your pull request.
