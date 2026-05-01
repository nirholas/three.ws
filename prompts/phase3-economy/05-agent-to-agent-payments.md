---
mode: agent
description: 'Phase 3 — Agent-to-agent autonomous payments: delegated signer wallet funds a skill call, records on-chain'
---

# Phase 3 · Agent-to-Agent Payments

**Branch:** `feat/agent-to-agent-payments`
**Standalone.** No other prompt must ship first.

## Why it matters

Agents should be able to hire other agents and skills autonomously — paying with their own delegated wallet without a human approving every transaction. This is the economic primitive that makes a multi-agent mesh possible.

## Read these first

| File | Why |
|:---|:---|
| `src/runtime/delegation-redeem.js` | Existing EIP-7710 delegation redeem flow — this is the template. |
| `api/agents/[id].js` | Agent detail — `wallet_address`, `delegated_signer`, `chain_id`. |
| `api/_lib/skill-runtime.js` | Server-side skill dispatcher — add payment hooks here. |
| `api/agents/payments/` | Search this directory — may already have partial implementation. |
| `api/wk-x402.js` | x402 protocol handler. |
| `api/_lib/schema.sql` | Table definitions. |
| `contracts/src/IdentityRegistry.sol` | Check if `authorizeAgentSpend(address agent, uint256 budget)` or equivalent exists. |

## What to build

### 1. Agent wallet funding check

File: `api/_lib/agent-wallet.js`

```js
export async function getAgentBalance(agentId) {
  // Load agent's wallet_address and chain_id from DB.
  // Query on-chain balance via JsonRpcProvider (ethers) using the chain's RPC URL.
  // Return { address, chain_id, balance_wei, balance_eth }.
}

export async function canAfford(agentId, priceUsd) {
  // Convert priceUsd to ETH using a cached ETH/USD price (coingecko, 5-min cache).
  // Compare against getAgentBalance().balance_wei.
  // Return bool.
}
```

### 2. Delegated spend authorization contract method

Check `contracts/src/IdentityRegistry.sol` for an `authorizeSpend` or `setSpendAllowance` method. If it doesn't exist, add:

```solidity
// Max spend per caller per period (set by agent owner)
mapping(uint256 => mapping(address => uint256)) public spendAllowance;

function setSpendAllowance(uint256 agentId, address spender, uint256 maxWei)
  external
  onlyAgentOwner(agentId)
{
  spendAllowance[agentId][spender] = maxWei;
  emit SpendAllowanceSet(agentId, spender, maxWei);
}

function spend(uint256 agentId, address payable recipient, uint256 amountWei, string calldata memo)
  external
  nonReentrant
{
  require(spendAllowance[agentId][msg.sender] >= amountWei, "allowance exceeded");
  require(address(this).balance >= amountWei, "contract balance insufficient");
  spendAllowance[agentId][msg.sender] -= amountWei;
  recipient.transfer(amountWei);
  emit AgentPayment(agentId, msg.sender, recipient, amountWei, memo);
}
```

Add to `IDENTITY_REGISTRY_ABI` in `src/erc8004/abi.js`.

Also add a helper to `api/_lib/agent-wallet.js`:
```js
export async function delegatedSpend({ agentId, recipient, amountWei, memo, signer }) {
  // Calls IdentityRegistry.spend() via the delegated signer key.
  // Returns tx hash.
}
```

### 3. Payment recording table

Add to `api/_lib/schema.sql`:
```sql
CREATE TABLE IF NOT EXISTS agent_payments (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  payer_agent_id uuid       NOT NULL REFERENCES agent_identities(id),
  payee_agent_id uuid       REFERENCES agent_identities(id),  -- null if paying a skill author
  skill_id      uuid        REFERENCES skills(id),
  amount_wei    numeric(40) NOT NULL,
  chain_id      integer     NOT NULL,
  tx_hash       text,
  memo          text,
  status        text        NOT NULL DEFAULT 'pending',  -- pending | confirmed | failed
  created_at    timestamptz NOT NULL DEFAULT now()
);
```

### 4. Wire into skill runtime

In `api/_lib/skill-runtime.js`, after a successful tool call for a skill with `price_per_call_usd > 0`:
1. Check `canAfford(agentId, priceUsd)`.
2. If yes: call `delegatedSpend` (fire-and-forget — do not block the skill response). Insert an `agent_payments` row.
3. If no: insert a `failed` `agent_payments` row, log warning. The skill result still returns to the caller — don't block on payment.

### 5. Payment history API

`GET /api/agents/:id/payments?direction=sent|received&limit=20&cursor=`

File: `api/agents/[id]/payments.js`

Auth required; must own the agent.

Returns paginated `agent_payments` rows with resolved `skill_name` and `payee_name`.

Add route to `vercel.json`.

### 6. Payment history UI on agent detail page

In `public/dashboard/index.html`, add a "Payments" tab (or add to existing "Actions" tab) showing `GET /api/agents/:id/payments?direction=sent` for the logged-in user's agent. Show:
- Date, skill name or "to: agent name", amount in ETH, status (pending/confirmed/failed), explorer link for `tx_hash`.

Empty state: "No payments yet. Payments are sent automatically when the agent uses paid skills."

## Out of scope

- Setting spend allowances via UI (this is an advanced setting — hardcode a default of 0.01 ETH per skill call).
- Receiving payments from external sources.
- Multi-sig or multi-chain atomic swaps.

## Contract deployment note

If the contract was modified, `forge build` must pass. Note in the report that a re-deployment is needed for on-chain features to go live. Do NOT auto-deploy.

## Acceptance

- [ ] `getAgentBalance(agentId)` returns live on-chain balance (not mocked).
- [ ] `delegatedSpend` constructs and broadcasts a real transaction.
- [ ] `agent_payments` table is created via schema.sql.
- [ ] Skill runtime inserts a payment row after a successful paid skill call.
- [ ] `GET /api/agents/:id/payments` returns correct data.
- [ ] Dashboard Payments tab renders.
- [ ] `forge build` passes.
- [ ] `node --check` passes.
- [ ] `npx vite build` passes.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
