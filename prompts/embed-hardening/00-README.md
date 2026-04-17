# Embed Hardening — Make the embed system production-safe before users flood in

This band makes the existing embed surfaces safe to drop on third-party sites at scale. It's a follow-up to the CDN versioning work that landed in [scripts/publish-lib.mjs](../../scripts/publish-lib.mjs) + [vercel.json](../../vercel.json) `/agent-3d/*` routes — the script ships fine, but the _runtime_ (per-agent policy, surface enforcement, LLM payment routing) has gaps that will bite the moment the snippet gets pasted somewhere real.

---

## The audit that drove these prompts

Investigation of the current state ([api/agents/[id]/embed-policy.js](../../api/agents/[id]/embed-policy.js), [api/\_lib/schema.sql](../../api/_lib/schema.sql), [src/runtime/providers.js](../../src/runtime/providers.js), [src/element.js](../../src/element.js), [agent-embed.html](../../agent-embed.html)) found:

- **Embed-policy endpoint exists** with GET/PUT/DELETE and a JSONB `embed_policy` column on `agent_identities`. Owner UI exists at [public/dashboard/embed-policy.html](../../public/dashboard/embed-policy.html). Origin allowlist is enforced in [agent-embed.html:49-88](../../agent-embed.html#L49-L88).
- **Schema migration was never merged** — the `ADD COLUMN` lives in [specs/schema/embed-policy.sql](../../specs/schema/embed-policy.sql) but not in [api/\_lib/schema.sql](../../api/_lib/schema.sql). Fresh deploys won't have the column.
- **`<agent-3d>` web component is broken on third-party sites** — [src/runtime/providers.js:30](../../src/runtime/providers.js#L30) defaults to `https://api.anthropic.com/v1/messages` with no key. No `we-pay`, no quota, no wallet-gating. A pasted snippet either fails silently or, if a key is somehow present, is uncapped.
- **Only one surface checks embed-policy** — the iframe page. The `<agent-3d>` script doesn't, widgets at `/w/:id` have a separate `visibility` flag, MCP at `/api/mcp/*` has no embedding checks at all.
- **No storage-mode tracking** — `avatars.storage_key` says "it's in R2." Nothing tracks "also pinned to IPFS" or "hash attested on-chain."

## The unifying design — one JSONB, three axes

Extend the existing `embed_policy` column from `{ mode, hosts }` to:

```jsonc
{
  "origins":  { "mode": "allowlist|denylist", "hosts": [...] },     // exists today (renamed nest)
  "surfaces": { "script": true, "iframe": true, "widget": true, "mcp": false },
  "brain": {
    "mode":              "none|key-proxy|we-pay|wallet-gated",
    "proxy_url":         "https://owner.example/llm",
    "monthly_quota":     10000,
    "rate_limit_per_min": 20
  },
  "storage": { "primary": "r2", "pinned_ipfs": false, "onchain_attested": false }
}
```

Backwards-compat: existing `{ mode, hosts }` shape is read as `policy.origins`.

---

## The five prompts

| #   | Prompt                                                 | What it ships                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01  | [01-schema-merge.md](01-schema-merge.md)               | Move the `embed_policy` ALTER into [api/\_lib/schema.sql](../../api/_lib/schema.sql) so fresh deploys have the column. Apply via [scripts/apply-schema.mjs](../../scripts/apply-schema.mjs).                                                                                              |
| 02  | [02-extended-policy.md](02-extended-policy.md)         | Define the extended JSONB shape. Write [api/\_lib/embed-policy.js](../../api/_lib/embed-policy.js) helper. Extend [api/agents/[id]/embed-policy.js](../../api/agents/[id]/embed-policy.js) GET/PUT to accept the new shape (backwards-compat). Extend the dashboard UI with new sections. |
| 03  | [03-surface-enforcement.md](03-surface-enforcement.md) | Wire policy reads into the `<agent-3d>` element, the widget page, the MCP endpoint, and CSP `frame-ancestors`. Fail-closed where denied.                                                                                                                                                  |
| 04  | [04-llm-proxy-quotas.md](04-llm-proxy-quotas.md)       | Build `/api/llm/anthropic` with per-agent monthly quota + per-IP rate limit. Default [src/runtime/providers.js](../../src/runtime/providers.js) to it when no key/proxy is set. Track usage in `usage_events`. **This is the spend-protection work — without it, no flood is safe.**      |
| 05  | [05-storage-flags.md](05-storage-flags.md)             | Add `storage_mode` JSONB to `avatars`. Pin-to-IPFS UI in dashboard. Record content hash (no on-chain tx yet).                                                                                                                                                                             |

---

## Independence guarantees — read before running in parallel

These prompts are designed to run **in any order**, **in parallel**, in **separate Claude Code sessions**. The rules that make that safe:

1. **Schema changes are additive `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`**, appended to the existing migration block at [api/\_lib/schema.sql:260](../../api/_lib/schema.sql#L260)+. Three of the five prompts (01, 02, 05) may add their own `ALTER` lines. They're idempotent — re-running is a no-op.
2. **`api/_lib/embed-policy.js` is owned by prompt 02.** Prompts 03 and 04 import it _if it exists_ and otherwise inline a minimal local copy of `defaultEmbedPolicy()` and `readEmbedPolicy(agentId)` (the inlined versions are spelled out in each prompt). Whichever ships first wins; later-shipping prompts can switch to the imported version in a follow-up.
3. **No two prompts touch the same source file's same lines.** Each prompt declares its **Files you own** (create/edit) and **Files off-limits** (other prompts are editing). If you find yourself wanting to edit an off-limits file, stop and report it instead.
4. **No prompt depends on another's runtime artifact.** Prompt 04 (LLM proxy) reads quotas from `embed_policy.brain.*` if present, falls back to a hard-coded global cap if absent. Prompt 03 (surface enforcement) reads `embed_policy.surfaces.*` if present, falls back to "all surfaces allowed" if absent.
5. **Prettier + `node --check` + `npx vite build`** are the verification floor for every prompt. SQL changes must be applied via `node scripts/apply-schema.mjs` against your local `DATABASE_URL` and re-run to prove idempotency.

## Conflict resolution if two prompts ship at once

- **`api/_lib/schema.sql`** — merge by accepting both `ALTER` lines. Order doesn't matter.
- **`api/agents/[id]/embed-policy.js`** — only prompt 02 should edit this. If another prompt's PR shows changes here, that's a bug in the prompt; reject and re-scope.
- **`public/dashboard/embed-policy.html`** — only prompt 02 should edit this; same as above.
- **`api/_lib/embed-policy.js`** — if both 02 and a later prompt try to create it, accept 02's version (it's the source of truth) and have the later prompt's PR import from it instead.

## Acceptance for the band as a whole

When all five have shipped:

1. Drop `<script src="/agent-3d/1.5.1/agent-3d.js"></script><agent-3d src="agent://base/42">` on a third-party origin → it loads, the LLM call goes through `/api/llm/anthropic`, the per-agent quota is enforced, the embed-policy origin allowlist is checked.
2. The dashboard at `/dashboard/embed-policy.html?id=...` exposes all four sections (origins, surfaces, brain, storage) and persists them.
3. `select embed_policy from agent_identities` returns the extended JSONB. Existing `{ mode, hosts }` rows still parse (backwards-compat).
4. Owner can pin an avatar to IPFS from the storage UI; resulting `storage_mode.pinned_ipfs` flips to `true`.
5. A loop of `<agent-3d>` calls beyond the per-agent monthly quota returns HTTP 429 from the proxy, not a successful Anthropic call.

If any of those don't hold, the band isn't done.

---

## House rules (also in [/CLAUDE.md](../../CLAUDE.md) and [/api/CLAUDE.md](../../api/CLAUDE.md))

- ESM only. Prettier: tabs, 4-wide, single quotes, 100 cols. Run `npx prettier --write` on every file you touch.
- Use [api/\_lib/http.js](../../api/_lib/http.js) (`json`/`error`/`wrap`/`cors`/`method`), [api/\_lib/db.js](../../api/_lib/db.js) (`sql` tagged template), [api/\_lib/auth.js](../../api/_lib/auth.js) (`getSessionUser`/`authenticateBearer`), [api/\_lib/rate-limit.js](../../api/_lib/rate-limit.js) (`limits.*`/`clientIp`), [api/\_lib/usage.js](../../api/_lib/usage.js) (`recordEvent`).
- Never `res.end(JSON.stringify(...))`. Never instantiate a new Pool. Never hand-roll JWT.
- One PR per prompt. End every PR with a Reporting block (files changed, commands run + output, what was skipped, unrelated bugs noticed).
