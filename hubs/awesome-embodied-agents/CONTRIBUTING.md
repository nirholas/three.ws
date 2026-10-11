# Contributing

Thanks for helping map the embodied-agent and 3D-avatar ecosystem. Every project that makes it easier to give an AI a body, a face or a voice belongs here.

## Add a project

1. Fork the repository.
2. Add one object to `data/entries.json`, placed alphabetically by `name` inside its category:

   ```json
   {
     "id": "my-project",
     "name": "My Project",
     "url": "https://example.com",
     "repo": "https://github.com/you/my-project",
     "category": "avatar-agents",
     "chain": "none",
     "description": "One factual sentence about what it does, 160 characters at most.",
     "status": "active",
     "added": "2026-10-10"
   }
   ```

3. Run `npm run validate` (or `node scripts/validate.mjs`). Fix anything it reports.
4. Run `npm run build` (or `node scripts/build-readme.mjs`) and commit the regenerated `README.md`. Never edit the tables between the `ENTRIES` markers by hand.
5. Open a pull request using the template.

You can also [open an issue](.github/ISSUE_TEMPLATE/add-project.md) and a maintainer will add it.

## Field rules

- `id`: kebab-case, unique.
- `url`: the project home page. `repo`: the source repository, or `null` for closed-source products.
- `category`: an `id` from `data/categories.json`. Pick the closest fit.
- `chain`: `none` unless the project is onchain, then the chain name (for example `solana`).
- `description`: one factual sentence, plain language, 160 characters or fewer. Say what it does, not how great it is. No em-dashes or en-dashes.
- `status`: `active` (maintained), `early` (new or experimental), `archived` (read-only or unmaintained but still useful).
- `added`: the date you add it, `YYYY-MM-DD`.

## What belongs

- Real, working projects you can open today: libraries, tools, models, standards, platforms and datasets that help build agents with an embodied presence.
- Open-source projects and commercial products are both welcome. Keep the tone neutral.
- Each project is listed once. Self-listing is fine.

## Review checklist

Maintainers check that the URL resolves, the description matches what the project says about itself, the category fits and the file passes validation.
