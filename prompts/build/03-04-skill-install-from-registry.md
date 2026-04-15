# 03-04 — Install a skill onto an existing agent

**Pillar 3 — Edit avatar / agent.**

## Why it matters

Today `agent_identities.skills` is a static array set at creation (`['greet', 'present-model', 'validate-model', 'remember', 'think']`). There's no UI to add, remove, or install a third-party skill onto an existing agent. Without this, the "skill marketplace" called out in [src/CLAUDE.md](../../src/CLAUDE.md) has no front door.

## What to build

A **Skills** tab on the agent edit page (`/agent/:id/edit` or the dashboard agent detail view) that:

1. Lists currently-installed skills with a remove button (disable remove on the 5 built-ins).
2. "Install from URL" field — paste a skill bundle URL (https, ipfs://, ar://, or `agent://chain/id`).
3. Preview of the skill's manifest + tools + permissions before install.
4. Stores the installed skill list on `agent_identities.skills` (string array: built-in names; external URLs otherwise).

## Read these first

| File | Why |
|:---|:---|
| [src/skills/index.js](../../src/skills/index.js) | `SkillRegistry.install(spec, { bundleBase })` — reuse, don't reinvent. |
| [src/manifest.js](../../src/manifest.js) | Manifest normalization. Skills may live inside a manifest or alone. |
| [api/agents.js](../../api/agents.js) — `handleUpdate` | Already accepts `skills` in the PUT body. Update is a no-op if you only add/remove strings from the array. |
| [specs/](../../specs/) | Skill format spec — what's in a skill bundle (`SKILL.md`, `tools.json`, `handlers.js`). |
| [src/runtime/tools.js](../../src/runtime/tools.js) | Built-in tools the agent already has. Third-party skills add to this set at runtime. |

## Build this

### 1. Skills tab UI

Create `public/agent/edit-skills.html` + `edit-skills.js` (or add as a tab inside an existing `/agent/:id/edit` page).

Layout:
- Header: "Skills for <agent name>"
- Installed list, each row: name · short description · source · [Remove]
- Divider
- "Install from URL" input + [Install] button
- Empty state: "Give your agent new abilities. Paste a skill bundle URL."

### 2. Install preview modal

On paste + Install, fetch the skill bundle via [src/skills/index.js](../../src/skills/index.js) (read-only parse — don't register yet). Show a modal with:

- Name, version, author, description
- Tools it adds (name + description for each)
- Dependencies (other skills it will pull in)
- Permissions: "Needs: read memory, fetch from `example.com`, sign actions"
- Warning banner if `author` doesn't match any wallet the user trusts
- [Cancel] / [Install]

### 3. Server — add skill to agent

Reuse `PUT /api/agents/:id` with a modified `skills` array. No new endpoint.

The `skills` column holds either:
- built-in skill name (`"greet"`, `"remember"`, etc.)
- external skill URL (`"https://..."`, `"ipfs://..."`, `"agent://..."`)

The runtime (browser) resolves external URLs via SkillRegistry at agent boot.

### 4. Remove

Remove button PATCHes `skills` with the string filtered out. Built-in skills are not removable (show a tooltip: "Built-in skill, cannot be removed").

### 5. Trust modes

The agent record has a `meta.skill_trust` field:
- `any` (default) — allows any URL.
- `owned-only` — only skills authored by the agent's wallet address.
- `whitelist` — explicit list of authors in `meta.skill_authors`.

Expose a trust dropdown on the tab. Default new agents to `owned-only` once this ships (existing agents keep `any` — don't mass-migrate).

### 6. Runtime load

At agent boot (`element.js` / `agent-home`), iterate `identity.skills`. For each string, if it's a built-in name, skip. Otherwise call `SkillRegistry.install(url, { bundleBase: url, trust: identity.meta.skill_trust })`. If install fails, log but don't crash the whole agent — skip that skill.

## Out of scope

- Do not build a skill publishing flow.
- Do not build a browsable skill registry (that's a separate future prompt).
- Do not implement sandboxing beyond what `handlers.js` already provides (it runs as a module — revisit if we allow arbitrary JS later).
- Do not add skill-level billing or paid skills.

## Deliverables

**New:**
- `public/agent/edit-skills.html`
- `public/agent/edit-skills.js`

**Modified:**
- [src/element.js](../../src/element.js) — iterate `identity.skills`, call `SkillRegistry.install` for URLs.
- [src/agent-home.js](../../src/agent-home.js) — render installed skills list in the home UI (read-only).

## Acceptance

- [ ] User visits their agent's edit page → Skills tab lists 5 built-ins.
- [ ] Paste `examples/coach-leo/` (served locally) skill URL → preview modal shows name, tools, permissions.
- [ ] Install → agent row's `skills` array contains the URL.
- [ ] Reload `/agent/:id` → new skill is active (its tools are callable via the runtime).
- [ ] Remove a third-party skill → it's gone; built-ins can't be removed.
- [ ] Trust mode `owned-only` blocks a skill whose author isn't the agent's wallet.
- [ ] `npm run build` passes.

## Test plan

1. Spin up a local skill bundle at `http://localhost:3000/examples/coach-leo/` or similar.
2. Edit your agent → Skills tab → paste the URL → preview → install.
3. Talk to the agent via the runtime chat → call one of the new tools.
4. Remove the skill → the tool is no longer listed.
5. Set trust to `owned-only`, try to install an unsigned skill → install blocked with a clear error.
