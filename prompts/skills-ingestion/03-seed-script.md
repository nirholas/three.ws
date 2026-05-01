# Step 3 — Seed script: ingest `data/skills/seed.json` into `marketplace_skills`

Working directory: `/workspaces/3D-Agent`. Read `/workspaces/3D-Agent/api/CLAUDE.md` first.

## Prerequisites

Steps 1 and 2 must be applied. Verify:

```bash
psql "$DATABASE_URL" -c "\d marketplace_skills" | grep content
```

## Source data

`data/skills/seed.json` contains an object `{ generatedAt, skills: [...] }`. Each skill looks like:

```json
{
  "category": "protocol",
  "content": "# Ethereum Gas Optimization\n## When to use ...\n",
  "description": "Optimize Ethereum gas usage by ...",
  "identifier": "ethereum-gas-optimization",
  "manifest": {
    "name": "ethereum-gas-optimization",
    "description": "...",
    "license": "MIT",
    "metadata": {
      "category": "protocol",
      "difficulty": "intermediate",
      "author": "sperax-team",
      "tags": ["protocol", "ethereum", "gas", "optimization", "l2", "transactions"]
    }
  },
  "name": "ethereum-gas-optimization",
  "source": "builtin"
}
```

There are 100+ entries. Categories observed: `analysis`, `community`, `defi`, `development`, `general`, `news`, `portfolio`, `protocol`, `security`, `trading`.

## Task

Create a Node script at `scripts/seed-skills.js` (ESM, matches existing scripts in `scripts/`).

Behavior:

1. Reads `data/skills/seed.json` from the repo root.
2. For each skill, upserts into `marketplace_skills` keyed by `slug` (= the skill's `identifier`):
   - `name` ← `manifest.name` (or `identifier` if missing)
   - `slug` ← `identifier`
   - `description` ← `description` (truncate to 500 chars per existing column constraint)
   - `category` ← `category` (lowercase, trimmed)
   - `tags` ← `manifest.metadata.tags ?? []`
   - `content` ← `content` (markdown body)
   - `schema_json` ← `NULL`
   - `is_public` ← `true`
   - `author_id` ← `NULL` (these are platform-seeded, no author)
3. `ON CONFLICT (slug) DO UPDATE` set name/description/category/tags/content/updated_at. Do NOT reset `install_count`.
4. Logs progress: `[N/total] inserted|updated <slug>`.
5. Exits non-zero if any row fails. Does not swallow errors.

Use the project's existing DB helper: `import { sql } from '../api/_lib/db.js'` (Neon serverless tagged template). Do not instantiate a new pool. Do not mock the DB.

For env vars, the existing scripts read from `.env` or process env — match whatever pattern they use (look at one or two scripts in `scripts/` first). Do not add a new env loader.

Add a `seed:skills` script to `package.json` `scripts`: `"seed:skills": "node scripts/seed-skills.js"`.

## Hard rules

- No mocks, no fakes. Inserts go to the real Neon DB.
- Idempotent: running twice produces the same DB state, no duplicate rows.
- Don't transform or rewrite the markdown content. Insert it verbatim.
- Don't truncate content (column is `text`, no length limit; the 200000 char cap in the API is only for user-submitted skills).

## Verification

```bash
pnpm run seed:skills    # or npm run, whichever this repo uses
```

Then:

```bash
psql "$DATABASE_URL" -c "SELECT count(*) FROM marketplace_skills WHERE content IS NOT NULL;"
psql "$DATABASE_URL" -c "SELECT slug, category, length(content) FROM marketplace_skills WHERE content IS NOT NULL ORDER BY slug LIMIT 10;"
```

The count must equal the number of skills in `data/skills/seed.json` (verify with `jq '.skills | length' data/skills/seed.json`).

Run the seed a second time. Count must not increase. `updated_at` should advance for all rows.

Spot-check via API:

```bash
curl -s 'http://localhost:3000/api/skills?category=defi&limit=5' | jq '.skills[] | {slug, has_content, content_preview}'
```

Each row must show `has_content: true` and a non-empty `content_preview`.

## Done means

- 100+ rows inserted, all with non-null `content` and null `schema_json`.
- Re-running the seed is a no-op for inserts (only updates timestamps).
- API list endpoint surfaces them.
