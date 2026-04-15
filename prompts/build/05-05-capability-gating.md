# 05-05 — Capability gating for embedded agents

## Why it matters

Not every host should be allowed to make the avatar speak, never mind call paid skills. An avatar embedded in a random blog shouldn't get microphone access or burn the owner's LLM quota. Capability gating is the permission model that makes host embeds (Layer 5) safe to turn on by default.

## Context

- Embed policy table stub: [api/agents/[id]/embed-policy.js](../../api/agents/[id]/embed-policy.js) + [public/dashboard/embed-policy.html](../../public/dashboard/embed-policy.html).
- Embed bootstrap: [public/agent/embed.html](../../public/agent/embed.html), [src/element.js](../../src/element.js).
- postMessage contract: 05-04.
- Owner agent page: [public/dashboard/](../../public/dashboard/).

## What to build

### Capability set

Canonical capability strings, defined in [specs/EMBED_SPEC.md](../../specs/EMBED_SPEC.md):

- `speak` — TTS output
- `animate` — play animations
- `listen` — microphone capture (default OFF)
- `chat` — trigger LLM calls that bill the owner
- `skills:*` — invoke skills (comma-glob, e.g. `skills:weather,skills:time`)
- `click_events` — emit `click` events to host

### Schema

```sql
create table if not exists agent_embed_policies (
    agent_id            uuid primary key references agents(id) on delete cascade,
    origin_allowlist    text[] not null default '{}',
    capabilities        text[] not null default '{speak,animate,click_events}',
    require_referrer    boolean not null default true,
    updated_at          timestamptz not null default now()
);
```

Default policy for new agents: `speak, animate, click_events` allowed; `listen, chat, skills:*` denied.

### Endpoint — `api/agents/[id]/embed-policy.js`

- `GET` — owner-only. Returns the policy.
- `PUT` — owner-only. Body `{ origin_allowlist, capabilities, require_referrer }`. Validates each capability against the canonical set.
- On every change, bump `updated_at` and emit a `policy_changed` row to `agent_actions` (audit trail).

### Runtime enforcement

In [src/element.js](../../src/element.js) / embed bootstrap:

- Fetch the policy on load (`/api/agents/:id/embed-policy` — public `GET` scoped to the capability list only, not the origin allowlist — origin check is enforced server-side).
- Validate the referrer against the allowlist server-side before serving `embed.html`. If blocked, serve a 403 page with a short explainer.
- On every inbound `postMessage`, check that the requested action's capability is in the agent's capability set. Reject with `error { code: 'capability_denied', capability: 'chat' }` otherwise.

### Dashboard UI — policy editor

On [public/dashboard/embed-policy.html](../../public/dashboard/embed-policy.html) (already scaffolded):

- Checkbox per capability with a one-line description.
- Tag-style input for origin allowlist (one origin per chip; validates scheme+host).
- "Preview" button opens the embed in a new tab using your origin for a quick smoke check.
- Save calls the PUT endpoint; show a non-blocking confirmation toast.

## Out of scope

- Per-host (not per-agent) capability sets.
- Paid-capability metering (lands with Layer 5 billing — not now).
- Cryptographic attestations that a host enforced a policy.

## Acceptance

1. A new agent's embed loads in a same-origin iframe and responds to `speak` and `play_animation`.
2. The same agent, embedded on a disallowed origin, serves 403.
3. Remove `speak` from the capability list → embed still loads, `speak` messages receive `capability_denied`.
4. Attempt to PUT `capabilities: ['chaos']` → 400 `unknown_capability`.
5. Audit row is written in `agent_actions` with `type = 'policy_changed'`.
6. `node --check` passes on modified files.
