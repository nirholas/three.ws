# 05-09 — Host embed: skill permission prompt

**Branch:** `feat/host-skill-permissions`
**Stack layer:** 5 (Host embed)
**Depends on:** 05-08 (auth bridge), 11-* (mcp-skills bridge)

## Why it matters

If a host can ask the embedded agent to perform a skill (`host:perform-skill`), the user must consent before sensitive skills run. Browser permission patterns (camera, geolocation) are the model: a one-time prompt per origin per skill, remembered.

## Read these first

| File | Why |
|:---|:---|
| [src/agent-skills.js](../../src/agent-skills.js) | Skill registry — each skill has a `dangerLevel` field (add if missing). |
| [src/host-bridge.js](../../src/host-bridge.js) | Bridge that routes `host:perform-skill`. |
| [src/agent-protocol.js](../../src/agent-protocol.js) | `perform-skill` event — gate before dispatch. |

## Build this

1. Add a `dangerLevel: 'safe' | 'medium' | 'high'` field to each built-in skill in [src/agent-skills.js](../../src/agent-skills.js):
   - `safe`: greet, present-model, think — no prompt.
   - `medium`: remember, sign-action — prompt once per origin per session.
   - `high`: any skill that calls external APIs or moves money — prompt every call.
2. Add `src/permission-prompt.js` — small DOM module that renders an in-iframe overlay: "{host} wants to use skill **{skillName}**. Allow once / Allow always / Deny." Returns a Promise.
3. Wire into the bridge: when `host:perform-skill` arrives, look up `dangerLevel`, prompt as needed, store the decision in `sessionStorage` keyed by `${hostOrigin}:${skillId}`.
4. Reject denied calls with `agent:skill-result { ok: false, error: 'permission_denied' }`.
5. Add a "Reset permissions" link in the agent's identity card overlay.

## Out of scope

- Do not persist permissions across browser sessions (sessionStorage is enough; users re-decide on revisit).
- Do not implement granular per-arg permissions (skill-level only).
- Do not add a host-side admin panel.

## Acceptance

- [ ] First `medium`-level skill from a host triggers the overlay.
- [ ] "Allow always" prevents future prompts in the same session.
- [ ] "Deny" returns the documented error shape.
- [ ] Permissions cleared on tab close (sessionStorage semantics).
- [ ] `npm run build` passes.

## Test plan

1. Open a scratch host page; trigger a `safe` skill — no prompt.
2. Trigger a `medium` skill — prompt appears, click "Allow always".
3. Trigger again — no prompt; result returns immediately.
4. Reload the embed (close + reopen the iframe) — prompt reappears.
5. Click "Deny" on a prompt — verify the error shape returned to host.
