# Contributing

Thank you for adding to the list. Contributions are pull requests that edit [`data/entries.json`](data/entries.json). Never edit the generated tables in `README.md` by hand.

## What belongs here

Real, working projects in generative 3D: models and weights, hosted APIs, splatting and NeRF tools, auto-rigging, texture generation, mesh cleanup and retopology, datasets, and glTF tooling used in AI pipelines. The project must be publicly reachable and documented. Early-stage projects are welcome with `"status": "early"`.

## Add an entry

Append an object to `data/entries.json`, placed alphabetically by `name` inside its category:

```json
{
  "id": "my-project",
  "name": "My Project",
  "url": "https://example.com",
  "repo": "https://github.com/owner/my-project",
  "category": "image-to-3d-models",
  "chain": "none",
  "description": "One factual sentence about what it does, 160 characters at most.",
  "status": "active",
  "license": "MIT",
  "added": "2026-10-10"
}
```

Rules:

- `id` is unique kebab-case. `category` is an id from `data/categories.json`. `chain` is always `"none"`.
- `repo` is the source URL, or `null` for closed products. `license` is the SPDX id or license name, or `null` if none is declared.
- Descriptions are factual and neutral: what it does, not marketing. Use plain hyphens; the em-dash and en-dash characters are rejected.
- `added` is the date of your pull request.

## Check your change

```
npm run validate
npm run build
```

Commit the updated `README.md` together with your JSON change. Pull requests that fail validation are asked to fix it before review.

## Removing or updating

Archived or dead projects get `"status": "archived"` rather than deletion, so links in the wild keep context. Corrections to descriptions and licenses are always welcome.
