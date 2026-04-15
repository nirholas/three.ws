# 04-03 — Harden public agent fetch: redact private fields

**Branch:** `feat/agent-public-decorate`
**Stack layer:** 4 (View + embed)
**Depends on:** nothing
**Blocks:** 05-* (host embeds call the public endpoint and should not leak internals)

## Why it matters

`GET /api/agents/:id` is public. Today it runs a `decorate()` helper on the row before returning, but there's no guarantee it strips owner identifiers, unfinished skills, internal flags, or wallet metadata. Once the agent URL is embedded anywhere, this response is the public surface of the user's data. The audit turned up that `decorate()` exists but its redaction surface is unclear.

## Read these first

| File | Why |
|:---|:---|
| [api/agents.js](../../api/agents.js) | `decorate()` function and the GET handler. |
| [api/_lib/](../../api/_lib/) | Any shared response-shaping helpers. |
| [src/agent-identity.js](../../src/agent-identity.js) | Client expectation of the agent shape. |
| [agent-embed.html](../../agent-embed.html), [public/agent-home.html](../../public/agent-home.html) | Public consumers of the endpoint. |

## Build this

### Enumerate what goes out

In [api/agents.js](../../api/agents.js), replace the current `decorate()` with a whitelist-based `toPublicAgent(row)` function. Only these fields leave the server for a public request:

```
id, slug, name, tagline, avatar { id, model_url, thumbnail_url, name },
skills (public subset: { id, name, description }),
reputation_summary, erc8004 { chain_id, agent_id, registry, registration_uri },
created_at
```

Explicitly excluded: `user_id`, `owner_id`, `embed_policy` internals beyond `mode`, raw `agent_memories`, any field starting with `_` or ending in `_internal`, wallet private metadata, and any column the handler hasn't been updated to know about.

### Authenticated owner branch

When the caller is the owner, return the full row (merged with public fields). Unknown callers get only the whitelist.

### Test the whitelist

Add a tiny runtime assertion in the handler: after constructing the response, walk the object and confirm every leaf key is in the allowlist. Fail closed with 500 + a log line if an unknown field is about to be sent. (This guards against a future schema addition silently leaking.)

### Update the client

[src/agent-identity.js](../../src/agent-identity.js) — drop any field reads that are now excluded for public calls. Do not add re-derivation logic; the public surface is the spec.

## Out of scope

- Do not add field-level ACLs for the owner branch.
- Do not add auditing / logging of access — separate prompt.
- Do not change the route path.

## Acceptance

- [ ] `curl -s /api/agents/<id> | jq` as an unauthenticated caller returns only allowlisted fields.
- [ ] Adding a new column to the agents table does not automatically leak it — the assertion catches it.
- [ ] Owner-authenticated fetch still returns the full row.
- [ ] Agent home + embed pages still render correctly with the trimmed payload.
- [ ] `npm run build` passes.
