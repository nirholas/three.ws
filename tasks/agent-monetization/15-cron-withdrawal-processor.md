# Task 15 — Cron: Withdrawal Processor

## Goal
A cron job that picks up `pending` withdrawal requests and executes the on-chain transfer, then marks them `completed` or `failed`. This is the backend job that actually moves funds.

## Success Criteria
- Cron runs at a configurable interval (default: every 15 minutes)
- Picks up rows with `status = 'pending'` in `agent_withdrawals`
- For Solana USDC: transfers SPL token from the platform escrow/treasury wallet to `to_address`
- Marks `processing` before sending, `completed` with tx hash after confirmation, `failed` on error
- A single failed transfer doesn't block other pending withdrawals
- Re-entrancy is safe: each row is locked with `SELECT ... FOR UPDATE SKIP LOCKED`

## Implementation

### File: `/api/cron/process-withdrawals.js`

```js
export default async function handler(req, res) {
  // Verify Vercel cron secret
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }

  // Lock and fetch pending withdrawals (process up to 10 at a time)
  const rows = await db.query(`
    SELECT * FROM agent_withdrawals
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT 10
    FOR UPDATE SKIP LOCKED
  `);

  for (const row of rows) {
    try {
      // Mark processing
      await db.query(
        `UPDATE agent_withdrawals SET status='processing', updated_at=now() WHERE id=$1`,
        [row.id]
      );

      // Execute transfer (Solana USDC example)
      const txSig = await transferSolanaUSDC({
        fromWallet: process.env.PLATFORM_TREASURY_KEYPAIR, // base58 keypair
        toAddress: row.to_address,
        amount: row.amount,       // lamports
        mint: row.currency_mint,
      });

      // Mark completed
      await db.query(
        `UPDATE agent_withdrawals SET status='completed', tx_signature=$1, updated_at=now() WHERE id=$2`,
        [txSig, row.id]
      );
    } catch (err) {
      console.error(`Withdrawal ${row.id} failed:`, err.message);
      await db.query(
        `UPDATE agent_withdrawals SET status='failed', updated_at=now() WHERE id=$1`,
        [row.id]
      );
    }
  }

  res.json({ processed: rows.length });
}
```

### Solana Transfer Helper
Create `/api/_lib/solana-transfer.js`:
```js
export async function transferSolanaUSDC({ fromWallet, toAddress, amount, mint }) {
  // Use @solana/web3.js + @solana/spl-token
  // createTransferInstruction → send transaction → return signature
}
```

Reference existing Solana code in `/api/agents/` or `/src/wallet/` for patterns.

## Vercel Cron Config
Add to `vercel.json`:
```json
{
  "crons": [
    { "path": "/api/cron/process-withdrawals", "schedule": "*/15 * * * *" }
  ]
}
```

## Required Env Vars
- `PLATFORM_TREASURY_KEYPAIR` — base58 private key of the platform's treasury wallet (holds float for payouts)
- `CRON_SECRET` — shared secret for cron authorization (already used by other crons)

## Files to Create/Touch
- `/api/cron/process-withdrawals.js` — new cron handler
- `/api/_lib/solana-transfer.js` — new Solana transfer helper
- `vercel.json` — add cron entry

## Security Notes
- `PLATFORM_TREASURY_KEYPAIR` must never be logged or returned in responses
- All DB mutations should be inside a transaction where possible
- `SKIP LOCKED` prevents two cron instances from double-processing the same row

## Verify
```bash
# Simulate cron call
curl -X GET /api/cron/process-withdrawals \
  -H "Authorization: Bearer $CRON_SECRET"

# Check withdrawal status changed
psql $DATABASE_URL -c "SELECT id, status, tx_signature FROM agent_withdrawals ORDER BY created_at DESC LIMIT 5;"
```
