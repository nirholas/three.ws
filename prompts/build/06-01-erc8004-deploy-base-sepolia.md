# 06-01 — Deploy ERC-8004 registries to Base Sepolia

**Pillar 6 — Onchain portability.** Stack layer 6 — the novel unlock.

## Why it matters

Pillar 6 promises: the same agent renders inside any host app *directly from its onchain record*. That requires three registries deployed on a public chain: `IdentityRegistry`, `ReputationRegistry`, `ValidationRegistry`. The contracts exist in [contracts/src/](../../contracts/src/) but may not be deployed anywhere non-local, or the deployed addresses may not be wired into [src/erc8004/abi.js](../../src/erc8004/abi.js)'s `REGISTRY_DEPLOYMENTS`. Ship this first; everything downstream (06-02+) assumes it.

## What to build

A clean deployment to Base Sepolia + wired addresses + a public block explorer link for each contract.

## Read these first

| File | Why |
|:---|:---|
| [contracts/src/IdentityRegistry.sol](../../contracts/src/IdentityRegistry.sol) | The three registries. |
| [contracts/src/ReputationRegistry.sol](../../contracts/src/ReputationRegistry.sol) | |
| [contracts/src/ValidationRegistry.sol](../../contracts/src/ValidationRegistry.sol) | |
| [contracts/script/Deploy.s.sol](../../contracts/script/Deploy.s.sol) | Existing Foundry script. Read it and confirm it deploys the three in one run. |
| [contracts/foundry.toml](../../contracts/foundry.toml) | Network profile. |
| [src/erc8004/abi.js](../../src/erc8004/abi.js) | `REGISTRY_DEPLOYMENTS` keyed by chainId. Add Base Sepolia entries after deploy. |
| [contracts/CLAUDE.md](../../contracts/CLAUDE.md) | Local project rules. |

## Build this

### 1. Dry-run locally

```bash
cd contracts
forge test
forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast
```

Confirm all three contracts deploy and pass any existing tests. If tests fail, stop and fix before going to a public chain.

### 2. Deploy to Base Sepolia

Requirements:
- `DEPLOYER_PRIVATE_KEY` in env (never committed).
- ~0.05 ETH test balance on Base Sepolia (faucet: `https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet`).

```bash
forge script script/Deploy.s.sol \
  --rpc-url https://sepolia.base.org \
  --broadcast \
  --verify \
  --etherscan-api-key $BASESCAN_API_KEY
```

Record the deployed addresses. Verify on `https://sepolia.basescan.org`.

### 3. Wire addresses

Edit [src/erc8004/abi.js](../../src/erc8004/abi.js):

```js
export const REGISTRY_DEPLOYMENTS = {
  ...existing,
  84532: {
    IdentityRegistry:   '0x<deployed>',
    ReputationRegistry: '0x<deployed>',
    ValidationRegistry: '0x<deployed>',
    chainName: 'Base Sepolia',
    explorer:  'https://sepolia.basescan.org',
    blockDeployed: <block number>,
  },
};
```

### 4. Document

Add deployed addresses to [contracts/README.md](../../contracts/README.md) under a "Deployments" section with the verification URLs. Include the git commit hash of the deployed source.

### 5. Verify a smoke call

Use `cast` or a tiny script to call a read function on IdentityRegistry and confirm it returns the expected value (e.g. registry version). This proves the ABI in `src/erc8004/abi.js` matches the deployed bytecode.

## Out of scope

- **Do not deploy to mainnet.** Testnet only; mainnet is 06-06.
- Do not change contract source — if a bug is found, stop and report (schema change → ask per CLAUDE.md rule #1... well, contracts are outside the schema list, but ask before altering solidity).
- Do not change the ABI files — regenerate only if you intentionally redeploy a new source version.
- Do not hard-code the deployer private key anywhere. It stays in env.

## Deliverables

**Modified:**
- [src/erc8004/abi.js](../../src/erc8004/abi.js) — add Base Sepolia entry.
- [contracts/README.md](../../contracts/README.md) — deployment table.

**Runtime artifacts (check in under contracts/broadcast/):**
- Foundry broadcast logs. Git should track these per Foundry convention.

## Acceptance

- [ ] Three registries deployed + verified on Base Sepolia.
- [ ] Addresses listed in `src/erc8004/abi.js` under chainId 84532.
- [ ] `contracts/README.md` has a deployments table with explorer links.
- [ ] A scripted `cast call` against IdentityRegistry returns a sane value.
- [ ] Front-end `ensureChain` (from 01-04) points at 84532 and the chain pill shows "Base Sepolia".
- [ ] `npm run build` passes.

## Test plan

1. Local: `forge test` all green.
2. Deploy to Base Sepolia → confirm all three verified on Basescan (source shown, read tab works).
3. `cast call <IdentityRegistry> <readFn>` returns expected value.
4. Boot the app with `VITE_TARGET_CHAIN_ID=84532`; wallet pill shows correct network.
5. No private keys anywhere in git diff.
