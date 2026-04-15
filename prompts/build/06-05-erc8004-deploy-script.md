# 06-05 — Onchain: ERC-8004 deploy automation

**Branch:** `feat/erc8004-deploy`
**Stack layer:** 6 (Onchain portability)
**Depends on:** nothing (Foundry already configured)
**Blocks:** 06-06 (indexer needs canonical ABI + addresses)

## Why it matters

Today contract addresses are hand-pasted into [src/erc8004/abi.js](../../src/erc8004/abi.js) after manual `forge script` runs. ValidationRegistry is missing on mainnets. Adding a chain or rotating an address is error-prone. A scripted deploy + ABI sync removes the foot-guns and unblocks further deploys.

## Read these first

| File | Why |
|:---|:---|
| [contracts/](../../contracts/) | Foundry project layout. |
| [contracts/script/](../../contracts/script/) | Existing deploy scripts — match style. |
| [src/erc8004/abi.js](../../src/erc8004/abi.js) | Hardcoded ABIs + `REGISTRY_DEPLOYMENTS` address map — output target. |
| [contracts/CLAUDE.md](../../contracts/CLAUDE.md) | Existing deploy notes. |

## Build this

1. Add `contracts/script/DeployAll.s.sol` — deploys IdentityRegistry, ReputationRegistry, ValidationRegistry deterministically (CREATE2 with the existing salt). Fail loudly if any address differs from the expected deterministic address.
2. Add `scripts/deploy-erc8004.mjs` — Node wrapper that:
   - Reads target chain ID from CLI arg.
   - Reads `DEPLOYER_PK` and `RPC_URL_<CHAIN>` from env.
   - Runs `forge script DeployAll --broadcast`.
   - Parses the broadcast JSON for the three deployed addresses.
   - Updates `REGISTRY_DEPLOYMENTS` in [src/erc8004/abi.js](../../src/erc8004/abi.js) using a string-replace (don't rewrite the whole file).
   - Verifies on Etherscan via `forge verify-contract` if `ETHERSCAN_API_KEY_<CHAIN>` is set.
3. Add `scripts/sync-erc8004-abi.mjs` — reads `contracts/out/*.sol/*.json`, extracts the ABI, regenerates the human-readable ethers v6 array in [src/erc8004/abi.js](../../src/erc8004/abi.js). Idempotent.
4. Add npm scripts: `deploy:erc8004 -- <chainId>`, `sync:erc8004-abi`.
5. Document `RPC_URL_*`, `DEPLOYER_PK`, `ETHERSCAN_API_KEY_*` in `.env.example`.

## Out of scope

- Do not deploy to any chain in this PR — script must be run manually with explicit chain id.
- Do not change the contracts themselves.
- Do not introduce Hardhat or any second toolchain.

## Acceptance

- [ ] `npm run deploy:erc8004 -- 11155111` (Sepolia) succeeds in a fork test.
- [ ] `REGISTRY_DEPLOYMENTS` updated with deterministic addresses; ABI regenerated.
- [ ] Re-running on the same chain is idempotent (no diff if addresses unchanged).
- [ ] `npm run sync:erc8004-abi` is a no-op if contract bytecode hasn't changed.

## Test plan

1. Boot anvil locally. Set `RPC_URL_31337=http://localhost:8545`, `DEPLOYER_PK=<anvil-acct-0>`.
2. `npm run deploy:erc8004 -- 31337`. Verify all three addresses logged.
3. Inspect [src/erc8004/abi.js](../../src/erc8004/abi.js) — addresses present.
4. Run again — confirm no-op (idempotent).
5. Touch a contract source, recompile, run `npm run sync:erc8004-abi` — confirm ABI updates.

## When you finish

- **Do not** run on real mainnet/testnet without explicit ask. The script is staged and ready; deploy is a separate decision.
