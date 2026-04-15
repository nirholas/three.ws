# Task 03 — host auth handoff (LobeHub user → agent viewer)

## Context

Repo: `/workspaces/3D`. When a LobeHub user loads a chat with our plugin, the embedded iframe needs to know **who** is viewing so the avatar can behave as "their" agent (use their wallet-linked identity, read their own memory namespace, etc.). LobeHub provides user-identity context in its host; we need to consume it across the iframe boundary safely.

Parallel context:

- The `postMessage` handshake — see [02-iframe-handshake.md](./02-iframe-handshake.md) — already carries `host:hello` with a capabilities list.
- Wallet auth today uses SIWE inside our own pages; see [src/erc8004/](../../src/erc8004/) and the top-level `wallet-auth` prompt series.
- [AgentIdentity](../../src/agent-identity.js) is the record layer — `walletAddress`, memory namespace, signed-action diary.

Important: LobeHub user ≠ wallet. A LobeHub user may or may not have a wallet linked. The embed must work for **anonymous** viewers (no identity known) and **authenticated** viewers (LobeHub user id only) and **wallet-linked** viewers (SIWE-completed) — with a smooth upgrade path between them.

## Goal

Define and implement the three-tier viewer identity handoff inside the embed, and a minimal opt-in SIWE-on-open flow so a LobeHub viewer can link their wallet without leaving the chat.

## Deliverable

1. **Extend the handshake** in `src/embed-host-bridge.js` (created in [02](./02-iframe-handshake.md)) with two new envelope types:
   - Inbound: `host:identity` — `{ hostUserId, hostUserName?, hostUserAvatar?, hostSignedToken? }`
   - Outbound: `embed:identity-request` — `{ want: ['wallet' | 'host-user'], reason }` (embed asks host to either (a) reveal its user id, or (b) trigger wallet link)
2. **Viewer identity state machine** — new file `src/embed-viewer-identity.js`:
   - Tiers: `anon` → `host-user` → `wallet-linked`
   - Transitions stored in `sessionStorage` under key `3d-agent:viewer-identity:<agentId>`
   - Methods: `current()`, `setHostUser(info)`, `linkWallet({ address, chainId, signature, message })`, `clear()`
   - Expose a read-only object: `{ tier, hostUserId?, walletAddress?, chainId? }`
3. **Optional SIWE-on-open** — an opt-in flow:
   - Embed renders a small, dismissible prompt in the corner: "Link wallet to let [agent name] act as you" with a "Connect" button.
   - Clicking "Connect" posts `embed:identity-request { want: ['wallet'] }` to host so LobeHub can open its wallet UI — **or** if host capability `inline-wallet` is false, opens a same-origin SIWE pop-up using our existing wallet infra.
   - Completed SIWE stores tier=`wallet-linked`, notifies host with `embed:identity-change`.
   - The prompt must be **dismissible** and **remembered** per agent id for the session.
4. **Avatar behavior gating** — when tier is `anon`:
   - Avatar still renders with full Empathy Layer (do **not** flatten).
   - Memory operates in "ephemeral" mode (in-process only, no persistence to the agent's wallet-scoped namespace).
   - Skills that require `ctx.wallet` or `ctx.sign` return `{ ok: false, error: 'wallet-required' }` instead of throwing.
5. **Propagation to the runtime** — when tier changes, re-hydrate [AgentIdentity](../../src/agent-identity.js) with the new scope. Existing avatar instance is **not** re-mounted (avoid full reboot); only the identity record is swapped.

## Audit checklist

- **Anon path works with no flags.** Paste the embed URL into a bare-HTML iframe, no host messages — confirm avatar renders, speaks, gestures, blends emotion. This is the floor.
- **LobeHub token trust.** If LobeHub passes a `hostSignedToken`, verify signature against a configured LobeHub public key **server-side** via a new endpoint `POST /api/embed/verify-host-token` (stub, returns 200 unless a env var `LOBEHUB_HOST_JWKS_URL` is set). Do not blindly trust the token client-side.
- **SIWE pop-up vs in-iframe.** Reading `window.parent` to open a pop-up from inside an iframe is fragile. Prefer posting `embed:identity-request` and letting the host handle it. Fall back to `window.open` only if host capability `inline-wallet` === `false`.
- **Session scope.** Do not persist `wallet-linked` beyond `sessionStorage` here; the canonical wallet link belongs to [AgentIdentity](../../src/agent-identity.js). Session storage is a cache for the current tab.
- **Dismiss state.** The SIWE prompt must not re-appear after dismiss within the same session.
- **Empathy Layer untouched.** No emotion logic lives in this file. If you find yourself editing [src/agent-avatar.js](../../src/agent-avatar.js), stop — you're off-scope.
- **Origin check.** `host:identity` must still pass the origin whitelist from [02](./02-iframe-handshake.md). Do not loosen.

## Constraints

- No new runtime deps. SIWE is already available via existing wallet infra — reuse.
- The new API endpoint `api/embed/verify-host-token.js` must be a Vercel serverless handler, small (~30 lines), and gracefully no-op when `LOBEHUB_HOST_JWKS_URL` is unset.
- **LobeHub spec uncertainty.** We do **not** know at this time the exact shape of LobeHub's user-context envelope. Flag each assumption with `// TODO(lobehub-spec): confirm against https://lobehub.com/docs/usage/plugins/development` and keep the code resilient to field renames.
- Prompt UI: plain HTML in the embed page, not a framework component. Absolute-positioned, small, accessible (tabbable, ESC to dismiss).

## Verification

1. `node --check src/embed-viewer-identity.js api/embed/verify-host-token.js` passes.
2. `npx vite build` succeeds.
3. Manual matrix:
   - **Anon**: iframe the embed, send no messages. Avatar works.
   - **Host-user only**: iframe sends `host:identity { hostUserId: 'u1' }`. Prompt appears. Dismiss persists.
   - **Host-user + wallet**: dismiss then re-init with a `linkWallet()` call in console. Tier flips to `wallet-linked`. `embed:identity-change` fires.
   - **Tier downgrade**: call `clear()`. Avatar keeps running; memory flips to ephemeral. Skills fail softly.
4. Unit-test the state machine in isolation via a quick node REPL (`import('./src/embed-viewer-identity.js')`). Document what you ran.

## Scope boundaries — do NOT do these

- Do **not** implement the plugin manifest (task [01](./01-plugin-manifest.md)).
- Do **not** build the base handshake (task [02](./02-iframe-handshake.md)) — this task only **extends** it with identity envelopes.
- Do **not** wire chat tool-call relay (task [04](./04-action-passthrough.md)).
- Do **not** package or submit (task [05](./05-plugin-submission.md)).
- Do **not** modify [src/agent-avatar.js](../../src/agent-avatar.js) — the Empathy Layer is out of scope.
- Do **not** modify the top-level SIWE/wallet-auth flow. Call it, don't reshape it.

## Files off-limits

- `public/.well-known/lobehub-plugin.json` — owned by [01](./01-plugin-manifest.md)
- `src/embed-host-bridge.js` — owned by [02](./02-iframe-handshake.md) for its core shape. You add two envelope types; keep diffs tight and in a clearly delimited `// ── identity ──` block.
- `src/erc8004/*` — reuse, do not refactor
- `src/agent-identity.js` — call, do not rewrite

## Reporting

- New files created with line counts
- Exact additions to `src/embed-host-bridge.js` (which block, how many lines)
- All `TODO(lobehub-spec)` flags, enumerated verbatim with file:line
- Matrix results (anon / host-user / wallet-linked / downgrade) — pass/fail for each
- `node --check` + `vite build` results
- Any unrelated bugs noticed — note, don't fix
