# Contributing

Thanks for helping build the directory. Every entry lives in `data/entries.json`; the README tables are generated.

## Entry format

```json
{
  "id": "my-project",
  "name": "My Project",
  "url": "https://example.com",
  "repo": "https://github.com/org/my-project",
  "category": "agent-frameworks",
  "chain": "solana",
  "description": "One factual sentence, at most 160 characters.",
  "status": "active",
  "added": "2026-10-10"
}
```

- `id`: unique kebab-case slug.
- `url`: canonical homepage or docs page. `repo`: repository URL, or `null`.
- `category`: an `id` from `data/categories.json`.
- `chain`: `solana`, `multi` (Solana plus other chains) or `none`.
- `status`: `active`, `early` or `archived`.
- `added`: the date you submit, `YYYY-MM-DD`.

## Rules

1. Tooling only: SDKs, frameworks, servers, skills, wallets, payments, data and infrastructure. No individual tokens or coins.
2. Describe what the project does, factually. No marketing language, no price talk.
3. Keep entries alphabetical by `name` within each category.
4. No em-dash or en-dash characters anywhere.
5. Only list projects you have checked: the link works and the description is accurate.

## Commands

```sh
npm run validate   # check the data
npm run build      # regenerate README tables
```

Open a pull request with your `data/entries.json` change and the regenerated `README.md`. Prefer not to edit JSON? Open an "Add a project" issue instead.
