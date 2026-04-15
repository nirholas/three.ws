# Task: Polish the ERC-8004 register flow — errors, gas, pending UX, post-register handoff

## Context

Repo: `/workspaces/3D`. The registration path works end-to-end but is rough:

- [src/erc8004/register-ui.js](../../src/erc8004/register-ui.js) — the UI.
- [src/erc8004/agent-registry.js](../../src/erc8004/agent-registry.js) — the flow (`registerAgent`) called by the UI.

Current pain:

- Errors surface as raw strings in a log div. Insufficient funds, user-rejected, chain-mismatch, missing IPFS token — all look identical.
- No gas estimate shown before the user clicks "Register".
- The "Registering…" state is a single disabled button; there's no visible step-by-step progress (upload → register tx → pin JSON → setAgentURI tx).
- After success, nothing updates [public/.well-known/agent-registration.json](../../public/.well-known/agent-registration.json)'s `registrations[]` array — so the site's own well-known file is stale.
- No ping to any indexer (if we add one later).

## Goal

Make registration feel trustworthy on a live production wallet. Show cost before commit. Show progress during. Hand the user off cleanly after. Do **not** change the contract calls themselves.

## Deliverable

### A. Error surface

In [register-ui.js](../../src/erc8004/register-ui.js), classify errors by a new helper `classifyTxError(err)` (put it in [src/erc8004/errors.js](../../src/erc8004/errors.js), new file) returning `{ code, title, detail, hint }`. Codes to handle:

| Code | Trigger | User hint |
|---|---|---|
| `user-rejected` | `err.code === 4001` or `err.code === 'ACTION_REJECTED'` | "You cancelled the signature." |
| `insufficient-funds` | `err.code === 'INSUFFICIENT_FUNDS'` or error message matches `/insufficient funds/i` | "This wallet doesn't have enough native token for gas on chain X. Try Base Sepolia testnet." |
| `chain-mismatch` | network chainId not in `REGISTRY_DEPLOYMENTS` | "ERC-8004 isn't deployed on chain N. Switch to a supported chain." Show a "switch chain" button that calls `wallet_switchEthereumChain`. |
| `ipfs-no-token` | `pinToIPFS` throws about missing token | "IPFS pinning requires an API token. Paste your web3.storage or Filebase token." |
| `ipfs-upload-failed` | `pinToIPFS` HTTP error | "IPFS pinning failed ({status}). Try a different token or gateway." |
| `tx-reverted` | receipt status 0 | "The transaction was mined but reverted — likely a contract-level check." Link to the explorer. |
| `unknown` | fallback | Show raw message below a collapsible "details" toggle. |

Render errors as a **card** above the log with title/detail/hint — not a red line in a scrolling log.

### B. Gas estimation preview

Before the user clicks "Register Agent On-Chain", once wallet is connected + file selected + name non-empty:

- Estimate gas for `register(string)` using `contract.estimateGas['register(string)'](placeholderURI)` where `placeholderURI` can be `'ipfs://placeholder-for-estimate'`.
- Fetch `getFeeData()` and compute `gasLimit * (maxFeePerGas || gasPrice)`.
- Render under the register button:
  ```
  Est. gas: ~250,000 · Est. cost: 0.0012 ETH (≈ $4.30)
  ```
  ETH→USD conversion is best-effort via `https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd` — silently drop the USD string on fetch failure.
- Cache the estimate for 30s; recompute if file or chain changes.
- Add a second line covering the `setAgentURI` step: estimate separately, show as "+ update-URI step: ~0.0003 ETH". Total cost = sum.

### C. Step-by-step progress

Replace the single "Registering…" state with a stepper:

1. Upload model to IPFS
2. Register on chain (tx hash link appears when submitted)
3. Pin metadata to IPFS
4. Update agent URI on chain (tx hash link)
5. Done

Each step shows `pending | in-progress | done | failed`. Render inside the existing `.erc8004-card`. The existing `onStatus` callback in `registerAgent` becomes structured — extend it (non-breaking): `onStatus` still accepts string for back-compat, but also accepts `{ step: 1..5, state, txHash?, cid? }`. Update `registerAgent` in [agent-registry.js](../../src/erc8004/agent-registry.js) to emit the structured form; keep the string form as a synthesised fallback.

### D. Post-register handoff

After success:

1. Re-fetch [public/.well-known/agent-registration.json](../../public/.well-known/agent-registration.json), append to `registrations[]` the `{ agentId, agentRegistry }` the new agent lives at (build via `agentRegistryId(chainId, registryAddr)` from [abi.js](../../src/erc8004/abi.js)), and `PUT` to a **new backend endpoint** [api/well-known-register.js](../../api/well-known-register.js) — new serverless route — that rewrites `public/.well-known/agent-registration.json` on disk (idempotent; no dup entries).
   - If the backend endpoint isn't available (local static preview), fail silently with a console warning — don't block the success UX.
2. In the result card, add three buttons:
   - **"View agent"** → `window.location.href = '/agent/' + agentId` (the page consumes [01-hydrate-agent-from-chain.md](./01-hydrate-agent-from-chain.md) for chain-only data).
   - **"Copy share link"** → copies `https://3dagent.vercel.app/agent/{agentId}?chain={chainId}`.
   - **"View tx on explorer"** → uses a new `explorerTxURL(chainId, txHash)` helper in [src/erc8004/explorers.js](../../src/erc8004/explorers.js).
3. Emit a DOM event on `window`: `window.dispatchEvent(new CustomEvent('agent:registered', { detail: { agentId, chainId, registrationCID, txHash } }))`. Dashboard / other surfaces can listen and refresh.

## Audit checklist

- Gas preview never blocks the UI — compute in background, render when ready.
- USD conversion failure does not surface an error.
- Chain-switch button uses `wallet_switchEthereumChain` first; if that throws `4902` (chain not added) it calls `wallet_addEthereumChain` with hard-coded metadata for the supported chains.
- Stepper is accessible: each step has an aria-live region for state changes.
- Backend endpoint is idempotent — calling twice with the same `(chainId, agentId)` does not duplicate a `registrations[]` entry.
- Backend endpoint refuses writes unless the request is authed (reuse whatever auth the rest of `api/` uses — likely a session cookie; see [api/CLAUDE.md](../../api/CLAUDE.md)).
- `classifyTxError` has no exceptions of its own — always returns a shape.
- `registerAgent` stays backward-compatible for any other caller that passes a string-only `onStatus`.

## Constraints

- No new runtime dependencies.
- No UI framework. Stick to plain DOM like the rest of [register-ui.js](../../src/erc8004/register-ui.js).
- Do not change `REGISTRY_DEPLOYMENTS` or the ABIs.
- Do not touch the register-agent contract calls. Wrap them; don't rewrite them.
- Keep [register-ui.js](../../src/erc8004/register-ui.js) under ~500 lines. Split a `stepper.js` submodule if needed.

## Verification

1. `node --check` every modified JS file and the new files.
2. `npx vite build` — passes.
3. Manual with MetaMask on Base Sepolia:
   - Connect wallet → name input → attach small GLB. Within a couple of seconds, gas preview line appears.
   - Click Register. Stepper advances 1 → 2, tx hash link appears.
   - Reject the `register(string)` prompt. Error card shows "You cancelled the signature." Register button re-enables.
   - Accept the first tx, watch stepper through 5. Reject the second (`setAgentURI`) → error card explains and lets you retry the URI step only (don't re-mint).
   - After full success, the `.well-known/agent-registration.json` fetch shows the new entry in `registrations[]`.
4. Insufficient-funds path: switch to Ethereum mainnet on a gas-less wallet, trigger register → clean error card.

## Scope boundaries — do NOT do these

- Do not implement `setAgentURI` for existing agents (that's [04-update-agent-uri.md](./04-update-agent-uri.md)).
- Do not implement reputation UI (that's [05](./05-reputation-display-and-submit.md)).
- Do not redesign the register card — keep the current layout and CSS class names.
- Do not add Privy if it's not already configured. The fallback injected-provider path must keep working.
- Do not add an indexer integration. Just emit the DOM event and call the well-known writer.

## Reporting

- Files created / edited.
- The backend endpoint path + auth model used.
- Stepper UX: any steps you split or merged.
- Error-card copy variations you tweaked.
- `npx vite build` status and any chain IDs tested.
