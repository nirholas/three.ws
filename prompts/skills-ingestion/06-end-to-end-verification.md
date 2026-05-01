# Step 6 — End-to-end verification

Working directory: `/workspaces/3D-Agent`. Read `/workspaces/3D-Agent/CLAUDE.md` first.

## Prerequisites

Steps 1-5 done. Do not skip verification just because earlier steps were verified individually — this step catches integration issues.

## Tasks

Run these in order. Each must pass before moving to the next. If any fails, fix the root cause in the relevant earlier step (do not patch around it here).

### 1. DB state

```bash
psql "$DATABASE_URL" -c "
  SELECT
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE content IS NOT NULL) AS content_skills,
    COUNT(*) FILTER (WHERE schema_json IS NOT NULL) AS tool_skills,
    COUNT(*) FILTER (WHERE schema_json IS NULL AND content IS NULL) AS broken
  FROM marketplace_skills;
"
```

- `broken` MUST be 0.
- `content_skills` MUST equal `jq '.skills | length' data/skills/seed.json`.

### 2. API smoke

```bash
# List
curl -s 'http://localhost:3000/api/skills?limit=200' | jq '.skills | length, (map(.has_content) | unique)'

# Categories
curl -s 'http://localhost:3000/api/skills/categories' | jq

# Detail of a content skill
SLUG_ID=$(curl -s 'http://localhost:3000/api/skills?limit=1' | jq -r '.skills[0].id')
curl -s "http://localhost:3000/api/skills/$SLUG_ID" | jq '.skill | {id, name, has_content: (.content != null), tool_count: (.schema_json | length // 0)}'
```

Expect: list has both content and tool-pack skills; categories endpoint covers the new categories from seed (`defi`, `trading`, `security`, `protocol`, etc.); detail returns full content for content skills.

### 3. UI install — content skill

1. Open `/chat` (boot dev server).
2. Sign in (knowledge skills install requires a session).
3. Open the skills marketplace modal.
4. Filter by category `DeFi`. Install `cross-chain-bridge-guide`.
5. DevTools → Application → Local Storage → confirm `knowledgeSkills` contains the skill with full `content`.

### 4. UI install — tool-pack skill (regression)

1. Find a tool-pack skill (any pre-existing skill with non-null `schema_json` — e.g., one from the original curated packs in `chat/src/tools.js` or any non-content row).
2. Install. Confirm it lands in `localStorage.toolSchemaGroups`, not `knowledgeSkills`.
3. Send a chat message that should trigger the tool. Tool runs as before.

### 5. Outbound system prompt

1. With the content skill from step 3 installed, send: "How do cross-chain bridges differ in trust assumptions?"
2. DevTools → Network tab → inspect the LLM request payload.
3. Confirm the `system` (Anthropic) or first system-role message (OpenAI) contains the markdown from `cross-chain-bridge-guide` under the `# Installed knowledge skills` delimiter.
4. Confirm the assistant's reply references concrete details only present in that skill (e.g., specific bridges named in the markdown).

### 6. Uninstall

1. Open modal, uninstall the content skill.
2. Send the same message. Confirm system prompt no longer contains the block. Reply degrades to generic.

### 7. Persistence

1. Install 2 content skills + 1 tool-pack skill.
2. Hard reload. All three remain installed (rehydrate from localStorage).
3. Send a message. Outbound system prompt contains both content skills' markdown.

### 8. Constraint guardrail

```bash
psql "$DATABASE_URL" -c "INSERT INTO marketplace_skills (name, slug, description) VALUES ('x','x-broken','x');"
```

MUST fail with check-constraint violation.

### 9. Re-seed idempotency

```bash
COUNT_BEFORE=$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM marketplace_skills WHERE content IS NOT NULL")
pnpm run seed:skills
COUNT_AFTER=$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM marketplace_skills WHERE content IS NOT NULL")
[ "$COUNT_BEFORE" = "$COUNT_AFTER" ] && echo OK || echo FAIL
```

Must print `OK`.

## Hard rules

- No mocks. Real DB, real API, real LLM call.
- Do not declare done if any of the 9 checks fail.
- If a check fails: identify the step that introduced the bug and fix it in that step's files. Do not paper over.

## Done means

All 9 checks pass. Skills marketplace fully ingests sperax skills into `/chat`, content reaches the model, install/uninstall/persistence all work, no regression to tool-pack skills.
