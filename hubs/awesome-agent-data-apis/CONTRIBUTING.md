# Contributing

Thanks for helping the list grow. Good additions are real, live projects that agents can use today.

## What belongs

- Paid API marketplaces, bazaars, indexes and facilitators for pay-per-call access.
- Onchain data APIs and MCP servers, market-data and oracle feeds, prediction-market APIs.
- Web data APIs built for agents, MCP registries, and usage-metering or API monetization tooling.
- Providers and tooling only. Individual tokens and coins are out of scope.

Solana-native projects are especially welcome.

## How to add an entry

1. Add one object to `data/entries.json` inside the right category, in alphabetical order by name (case-insensitive).
2. Fields: `id` (kebab-case, unique), `name`, `url`, `repo` (URL or `null`), `category` (an id from `data/categories.json`), `chain` (`solana`, `evm`, `multi`, `none`), `description` (one factual sentence, 160 characters max), `status` (`active`, `early`, `archived`), `pricing` (`free`, `freemium`, `paid`, `pay-per-call`, `unknown`), `added` (today, `YYYY-MM-DD`).
3. Run `npm run check`. It validates the data and rewrites the README tables.
4. Commit `data/entries.json` and `README.md` together and open a pull request.

## Style

- Describe what the project does in plain, factual terms. No marketing claims, no superlatives.
- Use `unknown` for pricing when the project does not publish it.
- Do not use em-dash or en-dash characters. The validator rejects them.
- Link to the project's own site, not a referral link.

No dependencies are needed: the scripts use only Node.js 18 or newer.
