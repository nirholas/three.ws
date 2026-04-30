# Task 01 — Database Schema: Agent Monetization Tables

## Goal
Add the database tables needed to store per-skill pricing, payment revenue records, and owner payout wallet config. All migrations must be additive (no destructive changes).

## Success Criteria
- `npm run db:migrate` runs without error
- All new tables exist with correct columns and constraints
- Foreign keys reference existing `agent_identities` and `users` tables correctly

## Tables to Create

### `agent_skill_prices`
Stores the price an agent owner sets for each monetized skill.

```sql
CREATE TABLE agent_skill_prices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      UUID NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
  skill         TEXT NOT NULL,                   -- skill name, e.g. "answer-question"
  currency_mint TEXT NOT NULL,                   -- SPL mint or EVM token address
  chain         TEXT NOT NULL DEFAULT 'solana',  -- "solana" | "base" | "evm"
  amount        BIGINT NOT NULL,                 -- smallest unit (lamports or wei)
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_id, skill)
);
```

### `agent_revenue_events`
Immutable record written each time a payment intent is consumed. This is the source of truth for earnings.

```sql
CREATE TABLE agent_revenue_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id       UUID NOT NULL REFERENCES agent_identities(id),
  intent_id      UUID NOT NULL REFERENCES agent_payment_intents(id),
  skill          TEXT NOT NULL,
  gross_amount   BIGINT NOT NULL,   -- full amount paid by caller (smallest unit)
  fee_amount     BIGINT NOT NULL,   -- platform fee deducted
  net_amount     BIGINT NOT NULL,   -- gross_amount - fee_amount
  currency_mint  TEXT NOT NULL,
  chain          TEXT NOT NULL,
  payer_address  TEXT,              -- caller wallet (nullable if anonymous)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `agent_payout_wallets`
The wallet address where an agent owner wants to receive revenue.

```sql
CREATE TABLE agent_payout_wallets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id       UUID REFERENCES agent_identities(id) ON DELETE SET NULL,  -- NULL = default for all agents
  address        TEXT NOT NULL,
  chain          TEXT NOT NULL DEFAULT 'solana',
  is_default     BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, agent_id, chain)
);
```

### `agent_withdrawals`
Tracks payout requests from agent owners.

```sql
CREATE TABLE agent_withdrawals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  agent_id        UUID REFERENCES agent_identities(id),
  amount          BIGINT NOT NULL,
  currency_mint   TEXT NOT NULL,
  chain           TEXT NOT NULL,
  to_address      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | processing | completed | failed
  tx_signature    TEXT,            -- on-chain tx hash when completed
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Migration File
Create `/api/_lib/migrations/013_agent_monetization.sql` with all four `CREATE TABLE` statements above plus index creation:

```sql
CREATE INDEX ON agent_skill_prices (agent_id);
CREATE INDEX ON agent_revenue_events (agent_id, created_at DESC);
CREATE INDEX ON agent_revenue_events (intent_id);
CREATE INDEX ON agent_payout_wallets (user_id);
CREATE INDEX ON agent_withdrawals (user_id, status);
```

## Files to Touch
- `/api/_lib/migrations/013_agent_monetization.sql` — new file
- `/api/_lib/db.js` — verify migration runner picks up new file (check glob pattern)

## Verify
```bash
npm run db:migrate
psql $DATABASE_URL -c "\dt agent_skill_prices agent_revenue_events agent_payout_wallets agent_withdrawals"
```
