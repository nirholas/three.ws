# Skills Ingestion — Overview

Goal: bring 100+ markdown knowledge skills (originally from sperax) into the existing `/chat` skills marketplace as **content skills** (markdown injected into the LLM system prompt on install), distinct from the existing **tool-pack skills** (executable function-call tools).

## Current state

- **Skill data already in repo** at `data/skills/seed.json` (and per-category folders `data/skills/{defi,trading,security,...}/<slug>/SKILL.md`). DO NOT re-fetch from any external repo.
- **Existing infrastructure** in `/workspaces/3D-Agent`:
  - DB table `marketplace_skills` (Neon Postgres) with `schema_json jsonb NOT NULL` — see `api/_lib/schema.sql:724-740`.
  - REST API at `api/skills/index.js`, `api/skills/[id].js`, `api/skills/[id]/install.js`, `api/skills/categories.js`.
  - Svelte UI at `chat/src/SkillsMarketplaceModal.svelte`.
  - System prompt assembled from `agent.system_prompt` + persisted message in `chat/src/App.svelte:887-1026` and read in `chat/src/convo.js:34-36`.
- **Architecture decision:** add a `content` column to `marketplace_skills`, make `schema_json` nullable. Content skills inject their markdown into the system prompt on install; tool-pack skills keep working unchanged.

## Run order (each prompt is independent context but must be applied in order)

1. `01-db-migration.md` — schema migration: add `content`, make `schema_json` nullable.
2. `02-api-content-support.md` — API validation, list/detail/install all return `content`.
3. `03-seed-script.md` — Node script that reads `data/skills/seed.json` and upserts into `marketplace_skills`.
4. `04-modal-render-content.md` — modal renders markdown content; install/uninstall handles content skills.
5. `05-system-prompt-injection.md` — installed content skills get their markdown injected into the system prompt.
6. `06-end-to-end-verification.md` — boot dev, install a skill, confirm content reaches the model.

## Hard rules (apply to every step)

- **No mocks, no fakes, no placeholder data.** Every change must work against the real Neon DB and real seed data at `data/skills/seed.json`.
- Match the codebase conventions in `api/CLAUDE.md` (use `sql` tagged template, `wrap()`, `error()`, `json()`, `parse()`, etc.).
- Match the surgical-changes rule in `/workspaces/3D-Agent/CLAUDE.md`: touch only what each step requires.
- Run the verification at the end of each step before declaring done.
