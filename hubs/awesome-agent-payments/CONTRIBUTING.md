# Contributing

Thanks for adding to the list. Each entry is one JSON object in `data/entries.json`. The README tables are generated, so never edit the README entries section by hand.

## What belongs

Projects that help agents pay or get paid: protocols, facilitators, SDKs and middleware, agent wallets and spend controls, paid-API directories, and trust or receipt layers. It must be real, publicly reachable, and describable in one factual sentence. Prefer the official docs or repository as `url`.

## Entry format

```json
{
  "id": "example-project",
  "name": "Example Project",
  "url": "https://example.com/docs",
  "repo": "https://github.com/example/project",
  "category": "sdks",
  "chain": "solana",
  "description": "One factual sentence, at most 160 characters, saying what it does.",
  "status": "active",
  "added": "2026-10-10"
}
```

- `id`: unique kebab-case slug.
- `url`: https link to official docs or site. `repo`: https link or `null`.
- `category`: an `id` from `data/categories.json`.
- `chain`: `solana`, `base`, `multi`, `none`, or another lowercase chain slug.
- `description`: factual, no marketing, max 160 characters, no `|`.
- `status`: `active`, `early`, or `archived`.
- `added`: the date you open the pull request, `YYYY-MM-DD`.
- Do not use em-dash or en-dash characters. Use commas, periods, colons, parentheses, or hyphens.

Insert the object in alphabetical order by `name` inside its category block. Entries are ordered by category (in `categories.json` order), then by name.

## Check and build

```sh
node scripts/validate.mjs     # or: npm run validate
node scripts/build-readme.mjs # or: npm run build
```

Commit `data/entries.json` and the regenerated `README.md` together. No dependencies to install.
