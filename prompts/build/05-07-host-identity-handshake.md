# 05-07 — Host identity handshake: host learns agent name / skills / wallet

**Pillar 5 — Host embed.**

## Why it matters

When the agent mounts inside a host chat, the host needs to know who this is: display name, short bio, installed skills, wallet address (if on-chain), avatar thumbnail. Without this, the host UI shows a generic "Plugin" label — which kills the sense of identity that is the whole point.

## What to build

Extend the `ready` outbound message from the agent iframe to carry the full identity card. Host UIs (Lobehub chat header, Claude Artifact description, our own test harness) read this and render appropriately.

## Read these first

| File | Why |
|:---|:---|
| `src/lib/embed-bridge.js` (from 05-04) | `ready` envelope lives here. |
| [api/agents.js](../../api/agents.js) `decorate()` | Fields available for public consumers. |
| `specs/EMBED_POSTMESSAGE.md` (from 05-04) | Where to document the extended `ready`. |

## Build this

### 1. Extended `ready` payload

```js
{
  __agent: '<id>',
  v: 1,
  type: 'ready',
  payload: {
    id: '<id>',
    name: '<name>',
    description: '<one-line bio, <= 280 chars>',
    avatar_thumbnail: '<cdn url, may be null>',
    home_url: '<https url of /agent/:id>',
    skills: ['greet', 'present-model', ...],
    wallet: { address: '<0x..>', chain_id: 84532 } | null,
    chain: { id: 84532, registry: '<0x..>', token_id: '<uint>' } | null,
    meta: { ...public meta fields }
  }
}
```

### 2. Fetch logic

Inside the iframe boot, after `/api/agents/:id` + `/api/avatars/:avatar_id`, build the payload and emit `ready` exactly once. If any field is missing, set to `null` — never crash.

### 3. Host renderers

Update the three host UIs:

- **Our test harness** (`public/preview/embed-tester.html`): render the name + thumbnail + skill chips above the iframe.
- **Lobehub plugin** (`api/agents/[id]/lobe-plugin.json`): the plugin's `meta` fields fall back to `ready` values so a fresh install shows the latest name/thumbnail even if the manifest was cached.
- **Claude Artifact** (copy snippet from `05-02`): the pasted prompt already includes the name; nothing else needed on our side.

### 4. Spec update

`specs/EMBED_POSTMESSAGE.md` (from 05-04): document the extended `ready` schema as `v: 1, type: 'ready'`. Make clear everything after `id`/`name` is optional and hosts should degrade.

### 5. Privacy defaults

Do NOT send:
- `user_id` (owner)
- `email`
- Internal skill URLs (just the short names).
- `memories` (never across this boundary).

Any host-facing URL must be the public `home_url`, not an authenticated dashboard link.

## Out of scope

- Do not add signed identity proofs (that's pillar 6 — on-chain resolution is a separate handshake).
- Do not fetch identity on every frame / message. `ready` is one-shot.
- Do not add avatar thumbnails if the R2 key isn't public.

## Deliverables

**Modified:**
- `src/lib/embed-bridge.js` — extended `ready` payload.
- `public/agent/embed.html` — emit extended `ready`.
- `api/agents/[id]/artifact.js` (05-01) — emit extended `ready`.
- `api/agents/[id]/lobe-ui.js` (05-03) — emit extended `ready`.
- `public/preview/embed-tester.html` — render the identity card.
- `specs/EMBED_POSTMESSAGE.md` (05-04) — spec update.

## Acceptance

- [ ] Test harness shows agent name + thumbnail + skill chips after iframe boots.
- [ ] Lobehub chat header shows agent name (not "Plugin").
- [ ] Missing thumbnail/wallet/chain gracefully renders without errors.
- [ ] No private fields (user_id, email) leak in `ready`.
- [ ] `npm run build` passes.

## Test plan

1. Load test harness for agent X → identity card visible above iframe.
2. View `ready` in devtools message log → confirm shape.
3. Make the agent private → harness shows "Unavailable" not a crash.
4. Agent without a wallet → `wallet: null`, UI still renders.
5. After pillar 6 ships: agent with on-chain registration → `chain: { id, registry, token_id }` populated.
