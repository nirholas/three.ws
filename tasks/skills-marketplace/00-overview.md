# Skills Marketplace — Implementation Overview

A community skills marketplace embedded in the chat UI, allowing users to browse, install,
publish, and rate skill packs that extend the LLM's tool capabilities.

## Task execution order

Run each task in a **new chat** in the order listed. Each task is self-contained with full
context, but later tasks depend on earlier ones being merged.

| # | File | What it builds | Depends on |
|---|------|----------------|------------|
| 01 | `01-db-schema.md` | Postgres tables: `marketplace_skills`, `skill_installs`, `skill_ratings` + basic seed data | nothing |
| 02 | `02-skills-api.md` | REST API: `/api/skills/` (list, create, install, rate) | 01 |
| 03 | `03-marketplace-modal.md` | `SkillsMarketplaceModal.svelte` — full browse + publish UI | 01, 02 |
| 04 | `04-chat-integration.md` | Wire modal into `App.svelte` toolbar | 03 |
| 05 | `05-seed-and-categories.md` | 15 seed skills + `/api/skills/categories` endpoint + modal update | 02, 03 |
| 06 | `06-skill-detail-and-ratings.md` | Expanded detail panel + star rating widget | 03, 04, 05 |
| 07 | `07-installed-skills-toolbar.md` | Active skill chip strip above chat input | 04 |

## Feature summary

### For users
- **Browse** community skills by category (Finance, Developer, Utility, etc.) with search + sort
- **Install** a skill with one click — it immediately appears as an active LLM tool
- **See** installed skills as chips above the input bar, removable with ×
- **Rate** skills 1–5 stars
- **Publish** your own skill: name, description, category, and a JSON tool definition

### Architecture
- Skills are stored in `marketplace_skills` (Postgres). The `schema_json` column holds a JSON
  array in the exact shape of the existing `curatedToolPacks` in `tools.js`.
- When installed, a skill is written to the `toolSchema` Svelte store (persisted in localStorage).
  The existing LLM tool pipeline reads from this store — no changes to `convo.js` or `providers.js`
  are needed.
- The community marketplace API lives at `/api/skills/`. System skills have `author_id = null`.

### Files created/modified
New files:
- `/api/_lib/migrations/2026-04-30-skills-marketplace.sql`
- `/api/_lib/migrations/2026-04-30-skills-seed.sql`
- `/api/skills/index.js`
- `/api/skills/[id].js`
- `/api/skills/[id]/install.js`
- `/api/skills/[id]/rate.js`
- `/api/skills/categories.js`
- `/chat/src/SkillsMarketplaceModal.svelte`

Modified files:
- `/api/_lib/schema.sql` (append new tables)
- `/chat/src/App.svelte` (import + button + modal instance + chip strip + removeSkill)
