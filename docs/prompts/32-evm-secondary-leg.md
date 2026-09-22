# 32. EVM as a secondary leg: Base and Robinhood Chain wallets and launches beside Solana

Read `docs/prompts/README.md` first. Solana is the home chain; this brief adds a leg and never demotes it.

## The problem

Agent wallets, launches and the flywheel are Solana. EVM surfaces exist in pieces (`@three-ws/agent-payments` has an `/evm` subpath, some x402 EVM work), but an agent has no EVM address, cannot hold or spend USDC on Base or Robinhood Chain, and cannot launch a token there. Some attention and revenue live on those chains.

## Build

- **Wallets:** each agent gets an EVM keypair generated and encrypted the same way as Solana (`api/_lib/agent-wallet.js`), one address across Base and Robinhood Chain, shown on the wallet page beneath the Solana address. Balances, transfers (`confirm_transfer`, allowlisted), and the custody ledger extended with a `chain` column. Guards apply per chain.
- **Payments:** x402 on Base through the existing EVM path, so an agent can pay EVM-only services; the bazaar marks the chain per service.
- **Launch:** a fixed-supply token launch on an EVM launch venue chosen by the criteria in prompt 15, recorded in the same launch table with a chain badge on `/launches`.
- **Trading:** swap quote and execute through an EVM aggregator behind the venue interface from prompt 30.
- **Reporting:** every page, tool and doc lists Solana first; EVM appears as a second section. Robinhood Chain is treated as a crypto venue only.
- Docs: `docs/agent-wallets.md` gains "EVM leg"; changelog entry tagged `feature`.

## Acceptance

- The QA agent shows an EVM address, receives USDC on Base, and pays an EVM x402 endpoint (stop at the owner confirmation table, gate 1).
- Nothing in the Solana path changed behavior (the Solana test suite is unchanged and green).
- `npm test` green.
