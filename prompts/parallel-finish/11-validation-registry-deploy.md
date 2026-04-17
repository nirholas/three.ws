# Task: Mainnet deployment script + runbook for `ValidationRegistry`

## Context

Repo root: `/workspaces/3D-Agent`. Read [contracts/CLAUDE.md](../../contracts/CLAUDE.md) first.

`ValidationRegistry.sol` is implemented and tested but **not deployed on any mainnet**. `IdentityRegistry` and `ReputationRegistry` are live on 15 chains (see `REGISTRY_DEPLOYMENTS` in [src/erc8004/abi.js](../../src/erc8004/abi.js)). Those were deployed via CREATE2 so all chains share the same address. We want the same for `ValidationRegistry`.

This task produces the **script + runbook**, not the broadcast itself. Per [/CLAUDE.md](../../CLAUDE.md): **never `forge script --broadcast` without approval.** The user will run the broadcast step themselves after reviewing your work.

## Files you own (exclusive — all new)

- `contracts/script/DeployValidationMainnet.s.sol` — single-purpose deploy script. Uses the same CREATE2 salt pattern as `Deploy.s.sol`. Deploys `ValidationRegistry` with the correct constructor args (check the contract — it takes `identityRegistry` address).
- `docs/VALIDATION_DEPLOY.md` — step-by-step runbook: env vars needed, dry-run command, broadcast command, verification command on each chain's block explorer, post-deploy smoke test, patch to `src/erc8004/abi.js` `REGISTRY_DEPLOYMENTS`.

**Do not edit** `src/erc8004/abi.js` (the runbook instructs the human on how to update it — you don't run the broadcast, so you don't know the address).

**Do not edit** `Deploy.s.sol` or any other Solidity file. If `ValidationRegistry.sol` has an issue, document it in the runbook — do not fix it.

## Script requirements

- Identical CREATE2 salt to the existing deploy script — ensures deterministic address parity with the testnet deployment (if one exists — check `REGISTRY_DEPLOYMENTS` for testnet ValidationRegistry addresses and **must match**).
- Reads `IDENTITY_REGISTRY` env var if the constructor needs it, else hardcode the canonical CREATE2 address from `contracts/CLAUDE.md`.
- Logs the computed address _before_ deploying (so a human can sanity-check).
- `forge script ... --rpc-url $RPC --sender $DEPLOYER` as the dry-run. Broadcast is `--broadcast --verify --etherscan-api-key $KEY`.

## Runbook requirements

Target chains (from `contracts/CLAUDE.md` — verify the list):

- Ethereum mainnet
- Base
- Optimism
- Arbitrum One
- Polygon
- BNB Chain
- Avalanche
- Gnosis
- Linea
- Scroll
- zkSync Era
- Mantle
- Celo
- Ink
- Unichain

For each, list:

- RPC URL env var name.
- Etherscan-equivalent verification URL + API key env var.
- Estimated gas cost (order of magnitude — "≈0.01 ETH on L2s").
- Expected deterministic address (compute locally with `cast create2` and include in the runbook).

Include a **rollback section**: since CREATE2 addresses are single-shot, "rollback" means documenting the bad deploy and re-deploying with a new salt. Explain why we want to avoid this.

Include a **patch block** showing exactly what to add to `src/erc8004/abi.js`'s `REGISTRY_DEPLOYMENTS` for each chain.

## Out of scope

- **Do not broadcast.**
- Do not modify the contract source.
- Do not deploy to testnet (if a testnet deploy is missing, note it in the runbook; someone else will do that task).
- Do not implement validator allow-listing at the registry level — that's a post-deploy governance concern.

## Verification

```bash
cd contracts
forge build
forge test
forge script script/DeployValidationMainnet.s.sol --rpc-url https://ethereum-rpc.publicnode.com --sender 0x0000000000000000000000000000000000000001
```

The `forge script` dry-run should compute an address and exit without broadcasting.

## Report back

Files created, `forge test` output, the computed CREATE2 address (from the dry-run), the runbook's total gas-cost estimate across all 15 chains.
