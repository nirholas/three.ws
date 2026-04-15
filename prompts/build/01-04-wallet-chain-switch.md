# 01-04 — Chain guard and network switch prompt

**Pillar 1 — Wallet auth.**

## Why it matters

The on-chain pillar (6) deploys ERC-8004 registries to a specific chain (Base Sepolia for now, mainnet later). Today the wallet client has no concept of "expected chain" — users on Ethereum mainnet can sign in and then hit "Register on-chain" and the tx errors out because the registry isn't deployed there. Fix the guard before we ship onchain registration UX.

## What to build

A reusable `NetworkGuard` helper that:

1. Reads the expected chain from config (`VITE_TARGET_CHAIN_ID`).
2. Compares against the wallet's current chain.
3. If mismatched, shows a modal: "Switch to Base Sepolia" with a one-click switch button.
4. Calls `wallet_switchEthereumChain` and if the chain isn't added, falls back to `wallet_addEthereumChain`.
5. Blocks the calling action (register, sign, etc.) until the chain matches.

Plus: a passive network pill in the wallet chip showing current chain name + color.

## Read these first

| File | Why |
|:---|:---|
| [src/erc8004/abi.js](../../src/erc8004/abi.js) | `REGISTRY_DEPLOYMENTS` — source of truth for supported chains. |
| [src/erc8004/agent-registry.js](../../src/erc8004/agent-registry.js) | Existing `connectWallet`. See what chain check (if any) is there. |
| [public/wallet-login.js](../../public/wallet-login.js) | Current sign-in — reads `chainId` but does nothing with it. |
| [api/auth/siwe/verify.js](../../api/auth/siwe/verify.js) | Persists `chain_id` on `user_wallets`. No guard server-side — that's fine, guard is UX-only. |
| `src/components/wallet-chip.js` (from 01-02) | Where the network pill mounts. |

## Build this

### 1. Chain config

Create `src/lib/chains.js`:

```js
export const CHAINS = {
  1:      { name: 'Ethereum',     short: 'ETH',  color: '#627eea', rpc: null, explorer: 'https://etherscan.io' },
  8453:   { name: 'Base',         short: 'BASE', color: '#0052ff', rpc: 'https://mainnet.base.org',     explorer: 'https://basescan.org' },
  84532:  { name: 'Base Sepolia', short: 'B-SEP',color: '#88aaff', rpc: 'https://sepolia.base.org',    explorer: 'https://sepolia.basescan.org' },
  // Add more as needed.
};

export function chainInfo(id) { return CHAINS[Number(id)] || { name: `Chain ${id}`, short: 'UNK', color: '#777' }; }

export const TARGET_CHAIN_ID = Number(import.meta.env.VITE_TARGET_CHAIN_ID) || 84532;
```

Also document `VITE_TARGET_CHAIN_ID` in `.env.example`.

### 2. `NetworkGuard`

Create `src/lib/network-guard.js`:

```js
export async function ensureChain(targetId) { /* returns true if on target chain after prompt, false if user cancelled */ }
export async function switchOrAdd(provider, chainId) { /* wallet_switchEthereumChain → wallet_addEthereumChain */ }
```

Use dynamic `BrowserProvider` from esm.sh to keep the file CDN-loadable like `wallet-login.js`.

### 3. Wire into ERC-8004 actions

In [src/erc8004/agent-registry.js](../../src/erc8004/agent-registry.js), before every state-changing tx, call `await ensureChain(TARGET_CHAIN_ID)`. If it returns false, throw a typed error `{ code: 'chain_mismatch' }`.

Callers that show a UI should catch `chain_mismatch` and display a friendly message.

### 4. Network pill

Extend `src/components/wallet-chip.js` (from 01-02) to show the current chain as a pill inside the chip. Passive — just a label + colored dot. Listen to `window.ethereum` `chainChanged` event to re-render.

## Out of scope

- Do not add an RPC selector.
- Do not store the chain on the server beyond what `user_wallets.chain_id` already holds.
- Do not block wallet sign-in based on chain (sign-in is chain-agnostic — only on-chain actions need the guard).

## Deliverables

**New:**
- `src/lib/chains.js`
- `src/lib/network-guard.js`

**Modified:**
- [src/erc8004/agent-registry.js](../../src/erc8004/agent-registry.js) — add `ensureChain` calls before each write path.
- `src/components/wallet-chip.js` — network pill + `chainChanged` listener.
- `.env.example` — document `VITE_TARGET_CHAIN_ID`.

## Acceptance

- [ ] With wallet on mainnet (chain 1) and `VITE_TARGET_CHAIN_ID=84532`, hitting register opens a switch prompt.
- [ ] Clicking "Switch" invokes MetaMask's switch dialog; accepting it updates the network pill to "Base Sepolia" in real time.
- [ ] If Base Sepolia is not yet added in the wallet, the add-network prompt fires with the correct RPC and explorer.
- [ ] Cancelling the switch → the calling action throws `chain_mismatch`, UI shows a friendly error, nothing on-chain happens.
- [ ] `npm run build` passes.

## Test plan

1. Set `VITE_TARGET_CHAIN_ID=84532` locally.
2. MetaMask on Ethereum mainnet. Visit dashboard → pill says "Ethereum" in blue.
3. Click any action that calls `ensureChain` (mock with a dev-only button if the register UI from pillar 6 isn't shipped yet). Confirm switch prompt → accept → pill updates.
4. Switch back to mainnet manually in MetaMask. Pill updates to "Ethereum" without reload.
5. Remove Base Sepolia from MetaMask (Settings → Networks). Retry → add-network prompt fires.
