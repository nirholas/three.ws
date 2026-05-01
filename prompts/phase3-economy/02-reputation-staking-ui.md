---
mode: agent
description: 'Phase 3 — Reputation staking UI: stake ETH on an agent via ReputationRegistry.sol, view live stake totals'
---

# Phase 3 · Reputation Staking UI

**Branch:** `feat/reputation-staking-ui`
**Standalone.** No other prompt must ship first.

## Why it matters

`ReputationRegistry.sol` is deployed and has `submitReputation` + `getReputation`. This prompt adds a *stake* layer: users back their rating with ETH, making reputation economically meaningful. The contract already exists — what's needed is the UI and the API layer to read aggregated on-chain data.

## Read these first

| File | Why |
|:---|:---|
| `src/erc8004/reputation.js` | `submitReputation`, `getReputation` helpers. |
| `src/erc8004/reputation-panel.js` | Existing star-rating UI — extend this, don't replace it. |
| `src/reputation-ui.js` | `ReputationDashboard` — full review list. |
| `src/erc8004/abi.js` | `REPUTATION_REGISTRY_ABI` and `REGISTRY_DEPLOYMENTS`. |
| `contracts/src/ReputationRegistry.sol` | The live contract. |
| `contracts/DEPLOYMENTS.md` | Deployed addresses. |

## What to build

### 1. Add `stakeReputation` to the contract ABI + helper

Check `contracts/src/ReputationRegistry.sol` for a `stakeReputation(uint256 agentId, uint8 score, string calldata comment)` function that accepts `msg.value`. If it exists, add it to `REPUTATION_REGISTRY_ABI` in `src/erc8004/abi.js`.

If the function is NOT in the contract, add it:
- File: `contracts/src/ReputationRegistry.sol`
- Function:
  ```solidity
  function stakeReputation(uint256 agentId, uint8 score, string calldata comment)
    external payable
  {
    require(score >= 1 && score <= 5, "score out of range");
    require(msg.value >= 0.001 ether, "min stake 0.001 ETH");
    _submitReputation(agentId, score, comment, msg.value);
    emit ReputationStaked(agentId, msg.sender, score, msg.value);
  }

  function getTotalStake(uint256 agentId) external view returns (uint256) {
    return _totalStake[agentId];
  }
  ```
  Add `mapping(uint256 => uint256) private _totalStake;` and `event ReputationStaked(uint256 indexed agentId, address indexed staker, uint8 score, uint256 value);`.
  
  Also add a helper to `src/erc8004/reputation.js`:
  ```js
  export async function stakeReputation({ agentId, score, comment, stakeWei, signer, chainId })
  export async function getTotalStake({ agentId, runner, chainId }) // returns BigInt wei
  ```

### 2. Stake form in the reputation panel

In `src/erc8004/reputation-panel.js`, extend the existing star rating form to include:
- A "Stake ETH (optional)" toggle checkbox
- When toggled: a numeric input for stake amount in ETH (default `0.01`, min `0.001`, max `10`)
- A live USD estimate (fetch ETH price from `https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd` — cache for 5 min in a module-level variable)
- Replace the `submitReputation` call with `stakeReputation` when stake is enabled; use `submitReputation` otherwise

### 3. Total stake display on agent detail page

In `src/reputation-ui.js` (the `ReputationDashboard`), add a "Total Staked" metric below the average score:
- Fetch `getTotalStake(agentId)` from the on-chain contract
- Display in ETH with 4 decimal places and USD equivalent
- Show the chain name (from `CHAIN_NAMES` map already in the file)

### 4. Staker leaderboard section

Below the existing review list in `ReputationDashboard`, add a "Top Stakers" section:
- Filter `ReputationStaked` events from the contract using `contract.queryFilter(contract.filters.ReputationStaked(agentId), 0, 'latest')` (last 1000 blocks is fine — add a block limit to avoid timeout)
- Show top 5 stakers: truncated address (first 6 + last 4 chars), stake amount in ETH, score given
- Only show if `getTotalStake > 0`

### 5. API endpoint for cached stake data

File: `api/agents/[id]/reputation.js`
`GET /api/agents/:id/reputation?chain_id=8453`
- Read from on-chain using `JsonRpcProvider` (viem or ethers — reuse what's already imported in the file) 
- Cache result in Upstash Redis for 5 minutes: key `rep:{agentId}:{chainId}`
- Return `{ average, count, total_stake_wei, chain_id }`

Add route to `vercel.json`.

## Out of scope

- Unstaking or withdrawing (Phase 3.1 at earliest — this requires a contract upgrade).
- Multi-chain staking in a single transaction.
- ERC-20 token stakes (ETH only).

## Contract deployment

If `stakeReputation` was added above, run:
```bash
cd contracts && forge build
```
The agent should stop here and note that a new deployment is needed before the UI can be tested on-chain. Do not auto-deploy — just confirm the build passes and note it in the reporting section.

## Acceptance

- [ ] Reputation panel shows stake toggle; checking it reveals ETH input with USD estimate.
- [ ] `stakeReputation` helper calls the contract with correct `value`.
- [ ] Total staked amount appears on agent detail page (0 ETH if no stakes yet).
- [ ] Top Stakers list renders if events exist (empty state if none).
- [ ] `GET /api/agents/:id/reputation` returns cached on-chain data within 5 min TTL.
- [ ] `forge build` passes.
- [ ] `npx vite build` passes.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
