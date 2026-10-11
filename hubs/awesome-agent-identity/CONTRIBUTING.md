# Contributing

Add your project with a pull request that edits `data/entries.json`. Do not edit the tables in `README.md` by hand; they are generated.

## Entry format

```json
{
  "id": "my-project",
  "name": "My Project",
  "url": "https://example.com",
  "repo": "https://github.com/org/my-project",
  "category": "solana",
  "chain": "solana",
  "description": "One factual sentence saying what it does, 160 characters or fewer.",
  "status": "active",
  "added": "2026-10-10"
}
```

- `id`: unique kebab-case slug.
- `repo`: a URL, or `null` when there is none.
- `category`: an `id` from `data/categories.json`.
- `chain`: `solana`, `base`, `ethereum`, `multi`, `none`, or another lowercase chain slug.
- `status`: `active`, `early` or `archived`.
- `added`: today's date as `YYYY-MM-DD`.
- Keep entries sorted alphabetically by `name` within their category.
- Describe what the project does in plain, factual terms. No em-dash or en-dash characters.
- Specs and standards (ERCs, ENSIPs, W3C and IETF documents) are welcome when they are real and public.

## Commands

```sh
npm run validate   # checks the data and prints readable errors
npm run build      # regenerates the tables in README.md
```

Run both before opening your pull request and commit the updated `README.md`. Requires Node 18 or newer; there are no dependencies to install.

## Scope

The directory covers on-chain agent identity, registries, naming, attestations, reputation, and DIDs and verifiable credentials for agents. Solana projects are listed first.
