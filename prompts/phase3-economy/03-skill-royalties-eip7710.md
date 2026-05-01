---
mode: agent
description: 'Phase 3 — Skill royalty payments via EIP-7710 delegated permissions: per-call fee from agent wallet to skill author'
---

# Phase 3 · Skill Royalties via EIP-7710

**Branch:** `feat/skill-royalties-eip7710`
**Standalone.** No other prompt must ship first.

## Why it matters

Skills have authors. Today skill authors earn nothing when their skill is invoked. EIP-7710 delegated permissions let an agent's wallet grant a limited spending right to the skill-royalty contract, enabling per-call micro-payments without requiring the user to sign every transaction.

## Read these first

| File | Why |
|:---|:---|
| `api/_lib/skill-runtime.js` | The server-side skill dispatcher — royalty billing hooks go here. |
| `api/skills/index.js` | Skill registry — skills have `author_id`, `price_per_call_usd`. |
| `api/_lib/schema.sql` | Table definitions — add royalty columns. |
| `src/runtime/delegation-redeem.js` | Existing EIP-7710 delegation redeem flow. |
| `contracts/src/IdentityRegistry.sol` | See if `authorizeSkillSpend` or delegation hooks exist. |
| `api/agents/[id].js` | Agent detail — includes `wallet_address` and `chain_id`. |

## What to build

### 1. Add `price_per_call_usd` to skills table

```sql
ALTER TABLE skills ADD COLUMN IF NOT EXISTS price_per_call_usd numeric(10,6) DEFAULT 0;
```
Add to `api/_lib/schema.sql`. Update `api/skills/index.js`:
- `publishSchema` — add `price_per_call_usd: z.number().min(0).max(10).default(0)`
- Include in the `toSkill()` serializer
- Include in the `GET /api/skills/:id` response

### 2. Royalty billing in skill-runtime

In `api/_lib/skill-runtime.js`, after a skill tool call returns successfully, if `manifest.price_per_call_usd > 0`, call a new async helper `billSkillRoyalty({ skillName, agentId, authorId, priceUsd })`. This is fire-and-forget (don't await in the hot path; log errors).

File: `api/_lib/royalty.js`

```js
export async function billSkillRoyalty({ skillName, agentId, authorId, priceUsd }) {
  // 1. Look up the agent's wallet_address and chain_id from agent_identities.
  // 2. Check if agent has enough balance via x402 / wallet balance (read from DB or call RPC).
  // 3. If balance >= priceUsd worth of ETH/USDC:
  //    a. Record a royalty_ledger row (debit agent, credit author).
  //    b. Emit an x402 payment proof or queue an on-chain transfer.
  // 4. If balance < priceUsd: log warning 'insufficient_balance' but don't block the skill.
}
```

**Royalty ledger table:**
```sql
CREATE TABLE IF NOT EXISTS royalty_ledger (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id       uuid        NOT NULL REFERENCES skills(id),
  agent_id       uuid        NOT NULL REFERENCES agent_identities(id),
  author_user_id uuid        NOT NULL REFERENCES users(id),
  price_usd      numeric(10,6) NOT NULL,
  status         text        NOT NULL DEFAULT 'pending',  -- pending | settled | failed
  settled_at     timestamptz,
  tx_hash        text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS royalty_ledger_author_idx ON royalty_ledger(author_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS royalty_ledger_agent_idx  ON royalty_ledger(agent_id, created_at DESC);
```
Add to `api/_lib/schema.sql`.

### 3. On-chain settlement via EIP-7710 delegation

In `api/_lib/royalty.js`, implement `settleRoyalties(authorUserId)` which:
1. Fetches all `pending` royalty_ledger rows for this author, summed by `(agent_id, chain_id)`.
2. For each agent-chain pair, looks up the agent's delegation in `agent_delegations` (or equivalent table — search the codebase for where delegation grants are stored).
3. If a valid delegation exists, redeems it by calling the `IdentityRegistry` contract's delegation redemption function (reuse `src/runtime/delegation-redeem.js` logic server-side).
4. Marks ledger rows as `settled` and records `tx_hash`.

If no delegation: mark `failed`, log, continue.

### 4. Settlement cron

In `api/cron/[name].js`, add a case for `settle-royalties`:
- Runs daily (add `"0 3 * * *"` to `vercel.json` crons — follow existing cron format).
- Calls `settleRoyalties` for all authors with pending balance > $0.01 threshold.

### 5. Author earnings dashboard

File: `api/users/earnings.js`
`GET /api/users/me/earnings`
- Auth required.
- Returns `{ pending_usd, settled_usd, entries: [{ skill_name, agent_name, price_usd, status, created_at }] }` — last 100 entries.

Add route to `vercel.json`: `{ "src": "/api/users/me/earnings", "dest": "/api/users/earnings.js" }`.

Add a "Earnings" tab to `public/dashboard/index.html` that fetches and displays this data. Vanilla HTML/JS page — read the existing dashboard tabs to understand the tab-switching pattern and match it.

### 6. Skill publish UI update

In the chat or wherever skills are published (search for the `POST /api/skills` form), add a "Price per call (USD)" field. Default 0 (free). Numeric input, max $10.

## Out of scope

- Subscription-based skill pricing.
- Multi-currency payouts.
- Dispute resolution.
- The user-facing delegation grant UI (that's a separate prompt in `prompts/permissions/`).

## Acceptance

- [ ] `price_per_call_usd` persists through skill publish and is returned by the API.
- [ ] Calling a paid skill records a `royalty_ledger` row.
- [ ] `GET /api/users/me/earnings` returns correct totals.
- [ ] Settle-royalties cron entry added to `vercel.json`.
- [ ] Dashboard Earnings tab renders data.
- [ ] `node --check api/_lib/royalty.js api/users/earnings.js` passes.
- [ ] `npx vite build` passes.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
