# Task 05 — Re-roll selfie

## Why

"I don't like how this one turned out." Users need a one-click way to retake their selfie and regenerate the GLB — without losing their persona, skills, memory, or on-chain identity.

## Depends on

- Layer 2 (selfie → agent) shipped
- Task 01 (persona) shipped (so we have `meta` intact)

## Read first

- [prompts/selfie-agent/01-selfie-capture-ui.md](../selfie-agent/01-selfie-capture-ui.md)
- [prompts/selfie-agent/02-avaturn-pipeline.md](../selfie-agent/02-avaturn-pipeline.md)
- [prompts/selfie-agent/03-persist-selfie-agent.md](../selfie-agent/03-persist-selfie-agent.md)
- [api/avatars/index.js](../../api/avatars/index.js)
- [api/agents/[id].js](../../api/agents/[id].js)

## Build this

### 1. `agent_identities.avatar_id` swap

Currently one-to-one. Add `avatar_history` (JSONB array on `agent_identities.meta`):

```json
[
  { "avatarId": "avt_old", "createdAt": "…", "replacedAt": "…" },
  { "avatarId": "avt_new", "createdAt": "…" }
]
```

On reroll, the current `avatar_id` row is pushed to history (with `replacedAt`) and the new one takes its place.

### 2. `/agent/:id/edit` tab "Re-roll"

- Large "Retake photo" button.
- Click → opens the capture UI (re-use the component from selfie-agent 01).
- After capture, runs the same Avaturn pipeline.
- Before committing, shows a side-by-side preview: current vs. new.
- Buttons: "Keep new" (commit), "Try again" (re-capture), "Cancel" (keep current).

### 3. Server endpoint

`POST /api/agents/:id/avatar` (owner-auth):
- Body: `{ avatarId }` (must be owned by the user).
- Verifies caller owns both the agent and the avatar.
- Swaps `agent_identities.avatar_id`, appends to history.
- Does NOT touch persona, skills, memory, wallet_address, chain_id.
- Returns the updated row.

### 4. On-chain consideration

If `agent.chain_id` is set, the on-chain `agentURI` still points to the old IPFS CID. Swap flow:
- Warn: "This agent is on-chain. The public record still shows your previous avatar until you re-register."
- Offer "Update on-chain" button — pins the new GLB (task onchain/02), pins a new metadata JSON, calls `IdentityRegistry.update(agentId, newURI)`.
- If the user skips, new avatar is local-only.

### 5. Undo

History lets users restore a prior avatar. Show the last 3 in a dropdown. Clicking "Restore" sets `avatar_id` back — same flow, no Avaturn call.

## Don't do this

- Do not delete old avatar R2 objects. Keep them; they might be on-chain.
- Do not auto-update on-chain. Always user-initiated.
- Do not blow away memory / persona. Reroll is a visual operation.

## Acceptance

- [ ] Reroll flow produces a new GLB, user confirms, agent page shows new avatar.
- [ ] Persona and memory unchanged.
- [ ] History visible + restorable.
- [ ] On-chain agents show the warning + update button.
- [ ] `npm run build` passes.

## Reporting

- Screenshot of the side-by-side preview
- Before/after `meta.avatar_history`
- Confirmation that memory + persona survive
