# Contributing

Thank you for adding to the list. Good entries make the directory useful for everyone, and a small pull request is all it takes.

## What belongs here

Projects and documentation for **Robinhood Crypto** and **Robinhood Chain** that a developer or an AI agent can use today:

- Clients and SDKs for the Robinhood Crypto Trading API
- MCP servers and agent integrations
- Trading bots, CLIs and strategy tools
- Robinhood Chain SDKs, examples, parsers and infrastructure (RPC, explorers, indexers, oracles)
- Market data, analytics, alerts and security tools
- Official documentation and API references

The project must be public, working, and clearly about Robinhood Crypto or Robinhood Chain. Multi-chain tools are welcome when Robinhood Chain or the Crypto API is a documented, first-class target.

## How to add an entry

1. Fork the repository.
2. Add one object to `data/entries.json`, in the correct category and in alphabetical order by `name` within it (categories follow the order in `data/categories.json`).
3. Run `npm run check`. It validates your entry and regenerates the README tables.
4. Commit `data/entries.json` and `README.md` together and open a pull request.

### Entry format

```json
{
  "id": "my-project",
  "name": "My Project",
  "url": "https://github.com/me/my-project",
  "repo": "https://github.com/me/my-project",
  "category": "api-clients",
  "chain": "none",
  "description": "Typed Python client for the Robinhood Crypto Trading API with built-in request signing.",
  "status": "active",
  "added": "2026-10-10"
}
```

| Field | Rules |
| --- | --- |
| `id` | Unique, kebab-case. |
| `name` | The project's own name. |
| `url` | Canonical https link: homepage, docs or repository. |
| `repo` | Source repository URL, or `null` for documentation and hosted services. |
| `category` | An `id` from `data/categories.json`. |
| `chain` | `robinhood-chain`, `solana`, `multi`, or `none` for off-chain API tools. |
| `description` | One factual sentence, 160 characters or fewer, describing what it does. |
| `status` | `active` (commits in the last six months), `early` (young or experimental), or `archived`. |
| `added` | The date you add it, `YYYY-MM-DD`. |

### Writing a good description

- Say what the project does, in plain words: "MCP server for the Robinhood Crypto API with account, market data and order tools."
- Be specific and factual. Skip superlatives, price talk and promotion.
- Do not use the em-dash or en-dash characters. Use a comma, colon or period.

## Checks

`npm run validate` verifies required fields, unique ids and URLs, https links, existing categories, description length, no em-dash or en-dash characters, and the sort order. Fix every message it prints, then run `npm run build`.

## Security note

Never include API keys, private keys or seed phrases in an entry, issue or pull request. Projects that sign requests or transactions should document how keys are handled.
