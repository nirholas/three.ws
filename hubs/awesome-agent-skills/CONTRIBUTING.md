# Contributing

Thanks for helping map the agent skills ecosystem. Entries are data, so contributing is a small JSON edit.

## What belongs here

- Skill bundles and collections (SKILL.md style) from teams or individuals.
- Registries, marketplaces and directories for skills and agent plugins.
- Tools that author, validate, convert, install or load skills.
- Scanners and security research for skills and agent plugins.
- Specs and official documentation, and agents with native skill or plugin support.

Projects should be public, working, and describe themselves accurately. Real, checkable projects only.

## Add an entry

1. Fork the repository and edit `data/entries.json`.
2. Add an object with these fields:

```json
{
  "id": "my-skill-pack",
  "name": "My Skill Pack",
  "url": "https://example.com/my-skill-pack",
  "repo": "https://github.com/example/my-skill-pack",
  "category": "domain-skills",
  "chain": "none",
  "description": "One factual sentence, at most 160 characters.",
  "status": "active",
  "added": "2026-10-10"
}
```

3. Field rules:
   - `id`: unique, kebab-case.
   - `category`: an `id` from `data/categories.json`.
   - `repo`: source repository URL, or `null`.
   - `chain`: `none` unless the project is onchain.
   - `status`: `active`, `early` or `archived`.
   - `added`: the date of your pull request, `YYYY-MM-DD`.
4. Keep entries sorted alphabetically by `name` within each category.
5. Write descriptions in plain, factual language. No em-dash or en-dash characters, no marketing superlatives.
6. Run `npm run check`. It validates the data and regenerates `README.md`.
7. Open a pull request using the template.

## Maintenance

Maintainers may update descriptions for accuracy, move entries between categories, or mark a project `archived` when it is no longer maintained. Corrections from project owners are always welcome.
