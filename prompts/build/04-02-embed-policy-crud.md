# 04-02 — Finish embed-policy CRUD (origin allowlist per agent)

**Branch:** `feat/embed-policy-crud`
**Stack layer:** 4 (View + embed)
**Depends on:** 01-02 (stable session)
**Blocks:** 05-* (host embeds need a policy to enforce against Claude / Lobehub origins)

## Why it matters

[api/agents/[id]/embed-policy.js](../../api/agents/[id]/embed-policy.js) exists as a stub — it returns 200 with no enforcement logic. Without it, any origin can iframe any agent. Once the product ships to Lobehub / Claude, the owner will want to restrict embeds to specific hosts. This is also the last piece of Layer 4 before we can honestly call the agent "shareable by default, lockable on demand."

## Read these first

| File | Why |
|:---|:---|
| [api/agents/[id]/embed-policy.js](../../api/agents/[id]/embed-policy.js) | Current stub. |
| [agent-embed.html](../../agent-embed.html) | The iframe page. Its `Content-Security-Policy` + `X-Frame-Options` must reflect the policy. |
| [api/_lib/](../../api/_lib/) | Auth + Neon helpers. |
| [api/agents.js](../../api/agents.js) | Schema for agents and how ownership is checked. |

## Build this

### Schema

Add a migration adding `embed_policy jsonb` to `agent_identities` (or extend the existing `agents` table — match current naming). Shape:

```json
{
  "mode": "open" | "allowlist" | "private",
  "allowed_origins": ["https://claude.ai", "https://chat.lobehub.com"]
}
```

Default `{ "mode": "open", "allowed_origins": [] }`.

### Endpoints — `/api/agents/:id/embed-policy`

- `GET` — public, returns the policy. Used by the embed iframe itself to decide rendering.
- `PUT` — owner only, replaces the policy. Validate with `zod`: `mode` enum, `allowed_origins` array of valid origin strings (parsable via `new URL()`, no path / query).

### Enforcement

In [agent-embed.html](../../agent-embed.html) (and any server-side render of it):

1. Server reads the policy on each request.
2. If `mode === 'private'`, require auth + ownership; 403 otherwise.
3. If `mode === 'allowlist'`, set:
   - `Content-Security-Policy: frame-ancestors <allowed_origins>`
   - `X-Frame-Options: SAMEORIGIN` as a safety net (modern browsers prefer CSP).
4. If `mode === 'open'`, set `frame-ancestors *`.

### Dashboard UI

On the agent edit view (from 03-01 extended, or a new "Embed" tab), surface:
- Mode selector (Open / Allowlist / Private).
- Allowed origins list with add/remove (validate format on blur).
- Live preview of a test iframe loaded from a picker origin to confirm enforcement.
- Copy-ready iframe snippet.

## Out of scope

- Do not add per-origin analytics — separate prompt.
- Do not add signed embed tokens — separate prompt.
- Do not validate that the given origins *actually* resolve to real hosts. We trust the user to know their deployment.

## Acceptance

- [ ] `PUT` rejects malformed origins (paths, wildcards beyond `*`, non-URL strings).
- [ ] Policy in `allowlist` mode blocks iframing from an origin not on the list (check via a local HTML file).
- [ ] Policy in `private` mode returns 403 for unauthenticated embed requests.
- [ ] Dashboard UI round-trips: set allowlist → save → reload → values persist → iframe from an allowed origin works.
- [ ] Open mode still renders everywhere (baseline preserved).
