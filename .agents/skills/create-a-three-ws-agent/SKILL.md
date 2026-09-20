---
name: create-a-three-ws-agent
description: Create a real three.ws AI agent (identity, 3D body, custodial Solana wallet, persona) from the command line and get its live public page. Use when you or the user want to create, build, deploy, launch, or set up an AI agent, a 3D agent, an on-chain agent, or "my own agent" on three.ws, attach a 3D body to an existing agent, edit an agent's persona or brain, or list the agents an account already owns. Returns the agent id, its Solana wallet address, and the public URL anyone can visit and chat with.
when_to_use: The user wants an agent that exists on three.ws (a record with a page, a wallet, and a brain), not just a 3D file. For a GLB model only, use generate-3d-model or create-3d-avatar. To put an existing agent on a website, use embed-three-ws-avatar. To sell what the agent can do, use sell-an-agent-skill.
license: MIT
metadata:
  category: platform/agents
  cross-platform-safe: false
  pack: three-ws-skills
---

# Create a three.ws agent

A three.ws agent is four real things at once: an **identity** row with a public page,
a **3D body** (an avatar GLB) rendered in the browser, a **custodial Solana wallet**
minted at creation, and a **brain** (persona plus model config) that answers chat.
This skill creates all four over the public REST API and hands back the live URL.

Nothing here is a draft or a sandbox. The wallet is a real Solana keypair, the page is
publicly reachable the moment it is created, and the agent shows up in the site activity
ticker and on `/agents`.

## Prerequisites

One API key with write scope. The user mints it at
[three.ws/dashboard/api](https://three.ws/dashboard/api) (sign in first at
`https://three.ws/login`).

- Scopes needed here: `avatars:write` (creating and editing an agent both check it),
  plus `avatars:read` if you also want to list avatars.
- The plaintext secret (`sk_live_...`) is shown **once**, in the create response.
- Ask the user to paste it, then export it for the session. Never write it to a file in
  their repo:

```bash
export THREE_WS_KEY='sk_live_...'
```

Bearer callers are exempt from CSRF, so an API key is all you need for every call below.

## The flow

```
forge a GLB (free)  ->  save it as an avatar  ->  create the agent  ->  set the brain
   /api/forge            /api/avatars/from-forge     /api/agents        PUT /api/agents/:id
```

Steps 1 and 2 are optional: an agent with no body is valid and its page renders a
"create a body" state instead of an empty viewer. If the user already has an avatar,
skip to step 3 with its `avatar_id`.

### 1. Forge the body (free, no auth)

Use the `generate-3d-model` or `create-3d-avatar` skill, or call the free lane directly.
For an agent you want to animate, forge a **rigged** avatar (`forge_avatar`), not a prop.
Keep the returned `glbUrl`.

### 2. Save the GLB into the account's avatar library

```bash
curl -s https://three.ws/api/avatars/from-forge \
  -H "authorization: Bearer $THREE_WS_KEY" \
  -H 'content-type: application/json' \
  -d '{
    "glb_url": "<glbUrl from step 1>",
    "name": "Nova",
    "visibility": "public",
    "source_prompt": "a friendly cartoon astronaut in a glossy white suit",
    "rigged": true
  }'
```

`201` returns `{ "avatar": { "id": "<uuid>", ... }, "view_url": "..." }`. The server
fetches the GLB itself (no CORS problem, no browser upload cap), validates the GLB
header, and auto-rigs it if it arrived unrigged. Keep `avatar.id`.

`visibility` is `public`, `unlisted` (default), or `private`. Only a `public` avatar
appears in the gallery and search.

### 3. Create the agent

```bash
curl -s https://three.ws/api/agents \
  -H "authorization: Bearer $THREE_WS_KEY" \
  -H 'content-type: application/json' \
  -d '{
    "name": "Nova",
    "description": "A deep-space guide who explains orbital mechanics in plain language.",
    "avatar_id": "<avatar.id from step 2>",
    "skills": ["greet", "present-model", "remember", "think"]
  }'
```

| Field | Notes |
| --- | --- |
| `name` | Required, up to 100 chars. Must not impersonate an existing public agent (see below). |
| `description` | Up to 500 chars. This is what the marketplace and search show. |
| `avatar_id` | A UUID of an avatar the same account owns. Omit for a bodyless agent. |
| `skills` | Built-in skill names. Default: `greet`, `present-model`, `validate-model`, `remember`, `think`. |
| `meta` | Optional JSON bag. Studio config goes under `meta.studio` (step 4). |

`201` returns `{ "agent": { ... } }` with:

- `id`: the agent UUID, and the public page is `https://three.ws/agents/<id>`.
- `wallet_address` plus `meta.solana_address`: the agent's own wallets, minted during
  this request. Signing keys stay encrypted server side and are never returned.
- `walletReady`: `true` once the Solana address and its encrypted key both exist.

**A 409 `identity_conflict` is not a bug.** Creation runs an identity-integrity check
that refuses a name or description that impersonates an existing public agent. Read
`integrity.reasons[0]`, tell the user which agent it looked like, and pick a distinct
name rather than retrying the same one.

### 4. Give it a brain and a persona

`PUT /api/agents/<id>` updates the agent. The field that changes how it talks is
`persona_prompt` (up to 8000 chars): it is the column the chat runtime reads, so a PUT
here is what makes the agent answer in character everywhere it appears.

```bash
curl -s -X PUT "https://three.ws/api/agents/<id>" \
  -H "authorization: Bearer $THREE_WS_KEY" \
  -H 'content-type: application/json' \
  -d '{
    "persona_prompt": "You are Nova, a deep-space guide. Answer in two short paragraphs, never more. Prefer concrete numbers over adjectives.",
    "description": "A deep-space guide who explains orbital mechanics in plain language."
  }'
```

`name`, `description`, `avatar_id`, `skills`, `home_url` and `meta` are updatable on the
same route, and each one is left untouched when omitted, so a PUT is always a partial
update.

**About `meta.studio`.** Agent Studio (the browser editor at
[three.ws/agent-studio](https://three.ws/agent-studio)) persists its whole state into
`meta.studio`, and the API accepts only these top-level keys there: `studio_version`,
`brain`, `memory`, `body`, `money`, `trading`, `skills`. Anything else is rejected with a
400 so a typo cannot pollute the shared bag. `meta` merges rather than replaces, so a
later PUT touching one key keeps the rest.

The Brain tab writes a node graph (`meta.studio.brain = { version, graph, compiled }`)
and mirrors the compiled system prompt into `persona_prompt` for you. Do not hand-author
that graph from a script: set `persona_prompt` over the API, and send the user to the
studio when they want the visual brain editor, memory policy, or pricing tabs.

### 5. Hand back the links

Always give the user all three:

| Link | What it is |
| --- | --- |
| `https://three.ws/agents/<id>` | The public page: 3D stage, chat, pose, skills, embed tabs. |
| `https://three.ws/agents/<id>/profile` | The long-form profile (lineage, activity, launches). |
| `https://three.ws/my-agents` | Their own list, for editing in the browser. |

## Reading agents back

```bash
# Every agent the key's account owns
curl -s https://three.ws/api/agents -H "authorization: Bearer $THREE_WS_KEY"

# One agent (public fields need no auth at all)
curl -s https://three.ws/api/agents/<id>
```

The public GET is a good sanity check after creating: it returns the decorated record
with `skill_prices`, `chat_count`, and the avatar keys the viewer resolves. Secrets
(`meta.encrypted_*`) are stripped on every read.

## Failure modes worth handling

| Response | Meaning | Do this |
| --- | --- | --- |
| `401 unauthorized` | No key, or a revoked one. | Have the user mint a fresh key at `/dashboard/api`. |
| `403 insufficient_scope` | Key lacks `avatars:write`. | Mint a key with that scope; scopes are fixed at creation. |
| `404 not_found` on `avatar_id` | The avatar is not owned by this account, or was deleted. | List the account's avatars and pick a real id. |
| `409 identity_conflict` | Name or description looks like an existing agent. | Choose a distinct identity, do not retry verbatim. |
| `429 rate_limited` | Agent creation has its own per-IP bucket. | Respect `retry_after`; do not loop. |

## What to do next

- **Put it on a site**: `embed-three-ws-avatar` turns the agent id into an `<agent-3d>`
  embed that renders and chats anywhere.
- **Give it paid capabilities**: `sell-an-agent-skill` publishes and prices a skill so
  the agent earns per call in $THREE.
- **Let it buy work**: `hire-an-agent` spends the agent's own wallet on other agents'
  skills over x402.
- **Fund the wallet**: the `fund` and `send-usdc` skills operate the wallet the agent
  was born with.
