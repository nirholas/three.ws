# Contributing

Thanks for helping build the default directory for agent wallets and key management. Contributions are welcome from project authors and users alike.

## What belongs here

Projects that help an AI agent hold, use, protect or constrain keys and funds: agent wallets, MPC and TEE signing, smart accounts and session keys, policy and spend-limit engines, embedded wallet SDKs, wallet MCP servers and skills, custody and signing infrastructure, and the standards they rely on. Solana projects are especially welcome.

A project is a good fit when it is real and reachable today, has public documentation or source, and has a clear wallet or key-management role for agents.

## How to add a project

1. Fork the repository and edit `data/entries.json`.
2. Add one object, placed alphabetically by `name` inside its category (entries are grouped in the order of `data/categories.json`):

```json
{
  "id": "my-project",
  "name": "My Project",
  "url": "https://example.com",
  "repo": "https://github.com/example/my-project",
  "category": "solana",
  "chain": "solana",
  "description": "One factual sentence about what it does.",
  "status": "active",
  "added": "2026-10-10"
}
```

3. Run `npm run check`. It validates the data and regenerates the tables in `README.md`.
4. Commit both `data/entries.json` and `README.md`, then open a pull request.

## Field rules

- `id`: unique, lowercase kebab-case.
- `url`: the main landing page or docs. `repo`: the source repository, or `null`.
- `category`: an `id` from `data/categories.json`.
- `chain`: `solana`, `evm`, `multi` or `none`.
- `description`: one factual sentence, at most 160 characters. Say what it does, not how great it is. No marketing superlatives, no pipes.
- `status`: `active`, `early` or `archived`.
- `added`: the date you add the entry, `YYYY-MM-DD`.
- Do not use em-dash or en-dash characters anywhere. Use commas, periods or parentheses.

## Quality bar

- Verify that the URL resolves and the description matches what the project actually does.
- One entry per project. Link the product page as `url` and the source as `repo`.
- Mark new, preview, alpha or unaudited projects as `early`.
- Keep the tone factual and positive. Describe what a project does well.

## Maintainers

Run `npm run check` before merging. Changes to categories or the schema should update `data/categories.json`, `data/schema.json` and the category index in `README.md` together.
