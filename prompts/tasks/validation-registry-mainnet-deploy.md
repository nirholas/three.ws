# Task: Deploy ValidationRegistry to all mainnet EVM chains

## Context

The project is three.ws — a platform for 3D AI agents with on-chain identity via ERC-8004.

The repo is at `/workspaces/3D-Agent`.

**What exists:**

- `contracts/src/ValidationRegistry.sol` — Solidity 0.8.24. Allow-listed validators attest off-chain proofs for agents. Functions: `recordValidation(agentId, passed, proofHash, proofURI, kind)` (validator-only), `getValidation()`, `getLatestByKind()`, `getValidationRange()`, `addValidator()`, `removeValidator()`, `transferOwnership()`.

- `contracts/DEPLOYMENTS.md` — Deployment status:
  - IdentityRegistry: **deployed** on all 15 mainnet chains and 7 testnet chains
  - ReputationRegistry: **deployed** on all 15 mainnet chains and 7 testnet chains
  - ValidationRegistry: **deployed on testnet only** (`0x8004Cb1BF31DAf7788923b405b754f57acEB4272`). **NOT on mainnet.**

- `contracts/script/` — Foundry deploy scripts. IdentityRegistry and ReputationRegistry were deployed via CREATE2 (same address on every chain). ValidationRegistry needs the same treatment.

- `src/erc8004/abi.js` — `REGISTRY_DEPLOYMENTS` maps chainId → addresses. ValidationRegistry mainnet entry is absent/null. `VALIDATION_REGISTRY_DEPLOYMENTS` is a separate export (check the file for current state).

- `sdk/src/erc8004/abi.js` — Same ABI and deployment map, mirrored in the SDK package. Both must be updated.

**Mainnet chains (15 total):**

| Chain | ChainId |
|-------|---------|
| Ethereum | 1 |
| Optimism | 10 |
| BNB Smart Chain | 56 |
| Gnosis | 100 |
| Polygon | 137 |
| Fantom | 250 |
| zkSync Era | 324 |
| Moonbeam | 1284 |
| Mantle | 5000 |
| Base | 8453 |
| Arbitrum One | 42161 |
| Celo | 42220 |
| Avalanche C-Chain | 43114 |
| Linea | 59144 |
| Scroll | 534352 |

**The goal:** Deploy ValidationRegistry to all 15 mainnet chains using the same CREATE2 salt as the testnet deployment, so it gets the same address (`0x8004Cb1BF31DAf7788923b405b754f57acEB4272`) on every chain. Then update the deployment records in `contracts/DEPLOYMENTS.md`, `src/erc8004/abi.js`, and `sdk/src/erc8004/abi.js`.

---

## Important constraints

**Read `contracts/CLAUDE.md` before making ANY changes.** Key rules:
- ABI shape, storage layout, deployed address, deploy script changes all require user approval first.
- These contracts are immutable once deployed. No mistakes.
- The ValidationRegistry ABI and bytecode must NOT be changed — deploy the exact same contract as testnet.

**This task is write/planning only — do NOT execute `forge script` or any on-chain transaction without explicit user confirmation.** The deliverable is a verified deploy plan + updated source files (once addresses are known).

---

## Steps

### 1. Verify the CREATE2 salt and factory

Check `contracts/script/` for the deploy script that was used for IdentityRegistry and ReputationRegistry. Find:
- The CREATE2 factory address used (standard `0x4e59b44847b379578588920cA78FbF26c0B4956C` or custom)
- The salt value
- The init code hash

Confirm that applying the same factory + salt to ValidationRegistry bytecode would produce `0x8004Cb1BF31DAf7788923b405b754f57acEB4272`. Verify by computing:
```
address = keccak256(0xff ++ factory ++ salt ++ keccak256(initcode))[12:]
```

### 2. Write/update the Foundry deploy script

If a `DeployValidationRegistry.s.sol` script doesn't exist, create it mirroring the pattern from the IdentityRegistry/ReputationRegistry deploy scripts. It must:
- Use the same CREATE2 factory and salt
- Verify the resulting address matches `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` and revert if not
- Accept a private key from `DEPLOYER_PRIVATE_KEY` env var
- Be runnable per-chain via `--rpc-url`

### 3. Dry-run command list

Produce the exact `forge script` command for each of the 15 chains. Format:
```bash
# Ethereum (chainId 1)
forge script contracts/script/DeployValidationRegistry.s.sol \
  --rpc-url $ETH_RPC_URL \
  --broadcast \
  --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY
```

Do not run these — write them to a file `contracts/script/deploy-validation-registry.sh` for the user to execute.

### 4. Update records (fill in after deployment)

After the user runs the deploy script and confirms the addresses, update:

**`contracts/DEPLOYMENTS.md`** — Add `ValidationRegistry` mainnet row with:
- Address: `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` (same as testnet if CREATE2 worked)
- One tx hash per chain (fill in when known — use `TODO: fill after deployment` placeholder)

**`src/erc8004/abi.js`** — In `REGISTRY_DEPLOYMENTS`, for every mainnet chainId, add the `validationRegistry` field:
```js
1: {
  identityRegistry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
  reputationRegistry: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
  validationRegistry: '0x8004Cb1BF31DAf7788923b405b754f57acEB4272',  // ← add this
},
```

**`sdk/src/erc8004/abi.js`** — Same update, mirrored.

### 5. Post-deployment verification

For each chain, verify the contract is live:
```bash
cast call --rpc-url $RPC 0x8004Cb1BF31DAf7788923b405b754f57acEB4272 "owner()(address)"
```
Expected: the deployer address (or a multisig if transferred).

---

## Deliverables

1. `contracts/script/DeployValidationRegistry.s.sol` (create or update)
2. `contracts/script/deploy-validation-registry.sh` — the 15-chain deploy command list
3. Updated `contracts/DEPLOYMENTS.md` (with TODO placeholders for tx hashes)
4. Updated `src/erc8004/abi.js` with all 15 mainnet chainIds having `validationRegistry`
5. Updated `sdk/src/erc8004/abi.js` to match

---

## Acceptance criteria

1. `forge build` passes with no new warnings.
2. `node --check src/erc8004/abi.js` passes.
3. `contracts/DEPLOYMENTS.md` has a complete ValidationRegistry section for all 15 mainnet chains.
4. `src/erc8004/abi.js` has `validationRegistry` populated for all mainnet chainIds.
5. `sdk/src/erc8004/abi.js` matches `src/erc8004/abi.js`.
6. The deploy script was NOT executed — it is ready for the user to run manually.
