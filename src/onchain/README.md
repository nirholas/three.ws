# src/onchain

Unified, family-agnostic on-chain deploy stack. Parallel to (and intended to
eventually supersede) `src/erc8004/deploy-button.js` + `src/erc8004/solana-deploy.js`.

## Why this exists

The legacy stack branches on chain family (`if isSolana ...`) at every layer:
deploy button, register-prep payload, agent_identities `meta` shape. Every new
chain family doubles the branching surface. This module collapses all of that
behind two abstractions:

- **`ChainRef`** — a CAIP-2-shaped value: `{ family, chainId | cluster }`. Every
  helper takes a `ChainRef`. Family-specific knowledge does not leak into the
  UI.
- **`WalletAdapter`** — `{ connect, switchTo, signAndSend }`. EVM and Solana
  adapters implement the same interface; the deploy orchestrator never sees
  `window.ethereum` or `window.phantom` directly.

## Layout

```
src/onchain/
├── chain-ref.js          ChainRef + CAIP-2 + chain registry (pure)
├── adapters/
│   ├── base.js           WalletAdapter abstract class + isUserRejection()
│   ├── evm.js            ethers + window.ethereum
│   ├── solana.js         @solana/web3.js + Phantom/Backpack/Solflare + inline SIWS
│   └── index.js          getAdapter(family) factory with cache
├── deploy.js             Unified prep → sign → confirm orchestrator
└── deploy-button.js      Mountable UI component (drop-in for legacy)
```

## API surface (frontend)

```js
import { OnchainDeployButton } from 'src/onchain/deploy-button.js';

const btn = new OnchainDeployButton({
  agent,                          // { id, name, description?, avatarId?, onchain? }
  container: document.querySelector('#deploy'),
  preferredChain: 'eip155:8453',  // CAIP-2; default Base mainnet
});
btn.mount();
```

Or, headless:

```js
import { deployAgent } from 'src/onchain/deploy.js';
import { evm, solana } from 'src/onchain/chain-ref.js';

const result = await deployAgent({
  agent,
  ref: solana('devnet'),
  onProgress: (step) => console.log(step), // 'connect'|'prep'|'sign'|'confirm'|'save'
});
// → { ref, txHash, onchainId, contractOrMint, agent }
```

## API surface (server)

Two endpoints — replace the four legacy ones:

| Endpoint                          | Purpose                                                 |
| --------------------------------- | ------------------------------------------------------- |
| `POST /api/agents/onchain/prep`   | Pin manifest, build family-specific tx prep, return prepId |
| `POST /api/agents/onchain/confirm`| Verify tx on-chain, link wallet, write `meta.onchain`   |

Request shape (prep):

```json
{
  "agent_id": "uuid",
  "chain": "eip155:8453",
  "wallet_address": "0x...",
  "name": "...",
  "description": "...",
  "avatar_id": "uuid|null",
  "skills": ["..."]
}
```

Response (prep): `{ prepId, chain, metadataUri, cid, contractAddress | { assetPubkey, txBase64, cluster } }`

Request shape (confirm):

```json
{
  "prep_id": "...",
  "tx_hash": "0x... | <base58 sig>",
  "onchain_id": "<EVM agentId> | null",
  "wallet_address": "..."
}
```

Confirm writes a single canonical block to `agent_identities.meta.onchain`:

```json
{
  "onchain": {
    "chain":            "eip155:8453",
    "family":           "evm",
    "tx_hash":          "0x...",
    "onchain_id":       "42",
    "contract_or_mint": "0x8004...",
    "wallet":           "0x...",
    "metadata_uri":     "ipfs://...",
    "confirmed_at":     "2026-..."
  }
}
```

Frontend reads `agent.onchain` only — no family-specific fields.

## Migration

`api/_lib/migrations/2026-04-29-onchain-unified.sql` backfills legacy rows
(both EVM and Solana shapes) into `meta.onchain`. Idempotent. Apply via:

```bash
psql $DATABASE_URL -f api/_lib/migrations/2026-04-29-onchain-unified.sql
```

The legacy endpoints (`register-prep`, `register-confirm`,
`solana-register-prep`, `solana-register-confirm`) are left intact. Deprecate
once all callers move to `/api/agents/onchain/*`.

## Adding a new chain family

1. Add a `ChainRef` constructor + CAIP-2 namespace handling in `chain-ref.js`.
2. Add an entry helper to `buildRegistry()` so it appears in the dropdown.
3. Implement `WalletAdapter` for the family in `adapters/<name>.js`.
4. Wire the adapter into `getAdapter()` in `adapters/index.js`.
5. Add a `prep<Family>()` branch in `api/agents/onchain/prep.js` and a
   `verify<Family>()` branch in `api/agents/onchain/confirm.js`.

No UI changes required.

## Tests

`tests/src/onchain.test.js` — pure-logic coverage of `chain-ref` + adapter
factory dispatch. Wallet I/O is integration-tested via Playwright (not yet
written for this module — TODO).

## Token launches (Pump.fun, …)

Layered on top of the deploy stack. Same pattern: a `TokenAdapter` interface
under `src/onchain/tokens/` with one impl today (`PumpfunTokenAdapter`) and
two endpoints (`/api/agents/tokens/launch-prep` + `launch-confirm`) writing a
canonical `meta.token` block on the agent record:

```json
{
  "token": {
    "provider":     "pumpfun",
    "mint":         "<base58>",
    "symbol":       "AGT",
    "name":         "Agent",
    "metadata_uri": "ipfs://...",
    "cluster":      "mainnet" | "devnet",
    "creator":      "<base58>",
    "tx_signature": "<base58>",
    "launched_at":  "2026-...",
    "pumpfun_url":  "https://pump.fun/<mint>"
  }
}
```

Mounting:

```js
import { LaunchTokenButton } from 'src/onchain/launch-token-button.js';
new LaunchTokenButton({ agent, container }).mount();
```

The button auto-hides itself unless the agent is deployed on Solana. After a
launch, it rehydrates as a chip linking to the Pump.fun page (mainnet) or
Solana Explorer (devnet).

Schema migration: `api/_lib/migrations/2026-04-29-token-launches.sql`.

Pump.fun specifics:
- The mint Keypair is generated server-side and partial-signs the launch tx.
  Its secret key never touches the client and is dropped after partial-signing.
- Optional `initial_buy_sol` (0–50) buys the first slot on the bonding curve
  in the same transaction as the create.
- Compute budget is bumped to 350k units — coin creation routinely overflows
  the 200k default and reverts otherwise.
- Mainnet only after deploy. Devnet works for QA via Pump.fun's devnet-tagged
  SDK builds (`@pump-fun/pump-sdk@*-devnet.*`).

Adding another launchpad:
1. Implement `TokenAdapter` in `src/onchain/tokens/<provider>.js`.
2. Add to `getTokenAdapter()` in `src/onchain/tokens/index.js`.
3. Branch on `provider` in `api/agents/tokens/launch-prep.js`.
4. UI auto-extends if you make the dropdown provider-aware (single provider
   today, no dropdown).
