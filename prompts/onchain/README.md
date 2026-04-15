# Onchain (priority 6) — task prompts

Self-contained prompt files for wiring the 3D Agent platform to its on-chain identity. Each file is designed to be dropped into a fresh Claude Code session without extra context.

## The big thing that is already done

**Canonical ERC-8004 contracts are already wired.** See [../../src/erc8004/abi.js](../../src/erc8004/abi.js). The reference deployments (CREATE2 — same address on every EVM chain) live there keyed by `chainId`:

- Testnets: identity `0x8004A818BFB912233c491871b3d84c89A494BD9e`, reputation `0x8004B663056A597Dffe9eCcC1965A193B7388713`, validation `0x8004Cb1BF31DAf7788923b405b754f57acEB4272`
- Mainnets: identity `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`, reputation `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`. Validation `''` — not yet deployed on mainnet, treat as read-only-via-testnet only.

**Do not propose redeploying contracts.** That decision is settled. Every prompt in this series assumes those addresses are correct and the ABIs in `abi.js` are authoritative.

## What still needs to happen

The remaining work is **integration + UX**. The registration code path exists ([agent-registry.js](../../src/erc8004/agent-registry.js)) and the registration UI exists ([register-ui.js](../../src/erc8004/register-ui.js)), but:

- Agents discovered on-chain don't hydrate cleanly into an `AgentIdentity` without extra plumbing.
- There's no "wallet → my agents" surface powering the dashboard.
- The registration flow lacks gas estimation, pending UX, and a post-register handoff.
- The avatar-edit flow doesn't propagate updates to `setAgentURI`.
- Reputation has helpers but no UI.
- Cross-chain resolution defaults to Base instead of reading the `agentRegistry: "eip155:<chainId>:<addr>"` field.

## Execution order

| # | File | Depends on |
|---|---|---|
| 1 | [01-hydrate-agent-from-chain.md](./01-hydrate-agent-from-chain.md) | — |
| 2 | [02-wallet-to-agents.md](./02-wallet-to-agents.md) | 01 (shares hydrate path) |
| 3 | [03-register-flow-polish.md](./03-register-flow-polish.md) | — |
| 4 | [04-update-agent-uri.md](./04-update-agent-uri.md) | 03 helpful but not required |
| 5 | [05-reputation-display-and-submit.md](./05-reputation-display-and-submit.md) | 01 (uses hydrate on `/agent/:id`) |
| 6 | [06-cross-chain-lookup.md](./06-cross-chain-lookup.md) | 01 |

## Rules for every task

- **No redeploys. Do not touch [abi.js](../../src/erc8004/abi.js) contract addresses.** You may extend helper exports.
- No new runtime dependencies. `ethers` is the only chain lib; `@privy-io/*` only where already imported.
- `node --check` every modified JS file before reporting done.
- `npx vite build` and report result. Ignore the pre-existing `@avaturn/sdk` resolution warning.
- The canonical identity contract **reverts on `totalSupply()`** — any enumeration must use event scanning, not `totalSupply`.
- The mainnet validation contract address is `''`. Any code that imports validation helpers must guard `if (!deployment.validationRegistry) { … }` and fail gracefully on mainnet.
- Read-only flows (hydrate, list, lookup) must work **without a signer** — use `JsonRpcProvider` with the default RPC from [manifest.js](../../src/manifest.js) `DEFAULT_RPCS` (extend it if needed for new chains).
- Keep the split: `src/erc8004/` for chain plumbing, other files consume it.

## Reporting

Each task ends with a short report: files created, files edited (which functions/sections), commands run and their output, manual verification URLs or console snippets, any surprises or unrelated bugs noticed.
