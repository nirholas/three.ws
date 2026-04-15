# Band 6 — On-chain Agent Deployment

## The end state

A user's agent exists on-chain. The record contains:
- owner wallet
- agent id (also an NFT or ERC-8004 entry)
- GLB URI (IPFS or Arweave for permanence)
- metadata URI (name, description, skills manifest)

From any host (Claude, LobeHub, the user's personal site, a random iframe on X), you paste an address or ENS name and **the same avatar appears**. No server on our side required to resolve — the host reads the chain, fetches the pinned GLB, renders.

## Current state

- ERC-8004 registration scaffolding exists — `src/erc8004/agent-registry.js`, `src/erc8004/register-ui.js`. The UI does the on-chain write; the contract side may not be deployed.
- `.github/prompts/deploy-erc8004-contracts.md` covers contract deploy. Treat it as a dependency of this band — if not deployed, deploy first.
- Agent records in Postgres have optional `wallet_address` and `chain_id` columns. They are not yet synced to on-chain state.
- No IPFS / Arweave pinning — GLBs live in R2 today.

## Prompts in this band

| # | File | Depends on |
|---|---|---|
| 01 | [erc8004-write-flow.md](./01-erc8004-write-flow.md) | contracts deployed |
| 02 | [ipfs-arweave-pinning.md](./02-ipfs-arweave-pinning.md) | — |
| 03 | [agent-by-address-resolver.md](./03-agent-by-address-resolver.md) | 01, 02 |
| 04 | [ens-naming.md](./04-ens-naming.md) | 03 |
| 05 | [action-provenance-signing.md](./05-action-provenance-signing.md) | band 1 wallet auth |

## Done = merged when

- Owner clicks **Deploy on-chain** on their agent page; we estimate gas, they approve, transaction confirms, the agent page shows "on-chain ✓" with an explorer link.
- GLB is pinned on IPFS (via a pinning service) and the pin endures across cache evictions.
- Any host (including `curl`) can resolve an agent from a wallet address / ENS name via `GET /api/agents/by-address/:addr` — returns the same record whether the host queries us or queries the chain directly.
- Action history entries are signed by the wallet and the signatures verify independently (anyone with an explorer and the contract address can audit the agent's behavior).

## Off-limits for this band

- Don't deploy to mainnet without user approval. Default to Base Sepolia / Sepolia for all prompt work.
- Don't re-implement ENS resolution — use `ethers.resolveName`.
- Don't introduce a second blob store. IPFS for on-chain canonical; R2 stays as the fast-path cache.
