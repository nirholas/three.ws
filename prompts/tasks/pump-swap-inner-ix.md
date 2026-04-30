# Task: Implement the skipped pump-swap inner instruction in the cron job

## Context

The project is three.ws — a platform for 3D AI agents with Pump.fun token trading capabilities.

The repo is at `/workspaces/3D-Agent`.

**What exists:**

- `api/cron/[name].js` — A Vercel cron endpoint that handles periodic lifecycle jobs. One job is `pump-swap` which executes pending DCA (dollar-cost averaging) swap orders for agent tokens on Pump.fun/Raydium.

- Around the swap inner instruction build in `api/cron/[name].js`, there is a comment:
  ```js
  // Phase 3.1: Skipping for safety — pump-swap inner ix build not yet implemented
  // TODO: build the actual swap instruction here
  ```
  The job currently logs the pending orders but does not execute any swaps.

- `api/pump-fun-mcp.js` (~23KB) — Has token creation, portfolio tracking, and other Pump.fun operations. Likely has utility functions for building Pump.fun transactions that the cron job should reuse.

- `src/solana/` — Solana utilities including vanity key grinding, SNS resolution, etc.

- `solana-agent-sdk/` — Solana agent SDK with actions for token transfers and swaps. Contains the underlying swap logic.

- `api/agents/[id]/solana/` — Agent Solana wallet endpoints.

**The problem:** The `pump-swap` cron job reads pending DCA orders from the database but doesn't execute them. When a user sets up a DCA strategy for their agent token (e.g. "buy $10 of my token every day"), nothing happens because the swap instruction builder was "skipped for safety."

**The goal:** Implement the swap instruction builder in the cron job so that pending Pump.fun swap orders are actually executed.

---

## Before starting

1. **Read `api/cron/[name].js` in full** to understand the current job structure — what orders it reads, what state it tracks, what it skips.
2. **Read `api/pump-fun-mcp.js` in full** to find existing swap utilities.
3. **Read `solana-agent-sdk/`** for the swap action implementation.
4. **Read `api/agents/[id]/solana/`** to understand how agent wallets are accessed.

The comment location in `api/cron/[name].js` is the primary source of truth. This prompt describes the expected approach but may not match the actual code — always read the source first.

---

## Expected swap flow on Pump.fun/Raydium

A Pump.fun token swap (buy or sell) requires:

1. **Fetch pool state** — Get the bonding curve address for the token mint. For graduated tokens (on Raydium), use the Raydium AMM pool.
   ```js
   // Pump.fun bonding curve address derivation
   const [bondingCurve] = PublicKey.findProgramAddressSync(
     [Buffer.from('bonding-curve'), mint.toBuffer()],
     PUMP_PROGRAM_ID
   );
   ```

2. **Get associated token accounts** — For the buyer and the bonding curve.
   ```js
   const buyerATA = getAssociatedTokenAddressSync(mint, buyer.publicKey);
   const bondingCurveATA = getAssociatedTokenAddressSync(mint, bondingCurve, true);
   ```

3. **Build the buy instruction** — Pump.fun buy discriminator is `0x66063d1201daebea` (8-byte discriminator for `buy` in Anchor IDL). Parameters: `{ amount: u64, maxSolCost: u64 }`.
   ```js
   const data = Buffer.alloc(24);
   data.writeBigUInt64LE(BigInt('0x66063d1201daebea'), 0); // discriminator
   data.writeBigUInt64LE(BigInt(tokenAmount), 8);           // amount
   data.writeBigUInt64LE(BigInt(maxSolCost), 16);           // max sol cost (slippage)
   ```

4. **Compute slippage** — Apply the configured slippage percentage to the quoted price. Default: 2%.

5. **Assemble and send transaction** — Use priority fees from `ComputeBudgetProgram.setComputeUnitPrice`.

6. **Record result** — Update the swap order status in the DB (success/failed + tx signature).

---

## Database schema

Check the existing schema in `api/_lib/schema.sql` for a `swap_orders` or `dca_orders` or similar table. The cron job reads from it — look at the SQL queries in the cron handler to understand the table name and columns.

After the swap, update the order:
```sql
UPDATE <orders_table>
SET status = $1,
    tx_signature = $2,
    executed_at = now(),
    error = $3
WHERE id = $4
```

---

## Error handling

Swaps can fail for several reasons:
- Insufficient SOL balance
- Slippage exceeded (bonding curve price moved)
- Network error / timeout
- Token graduated to Raydium but cron still tries bonding curve

Handle each case:
- Insufficient balance: mark order `status = 'failed'`, `error = 'insufficient_balance'`
- Slippage: retry up to 2 times with 1% wider slippage, then fail
- Network timeout: mark `status = 'pending'` again (will retry next cron cycle)
- Graduated: detect by checking if bonding curve is complete, route to Raydium instead

Do NOT silently swallow errors. Log each failure with order ID + error for debugging.

---

## Files to edit

**Edit:**
- `api/cron/[name].js` — Implement the swap instruction builder where the "skipping for safety" comment is. Import utilities from `api/pump-fun-mcp.js` or `solana-agent-sdk/` rather than duplicating swap logic.

**Do not create new files** unless the refactoring genuinely requires extracting a shared utility.

---

## Safety checklist (do these before the task is done)

- [ ] The cron job has a per-order try/catch — one failed swap must not abort all others
- [ ] Maximum SOL spend per cron run is capped (read the existing cap from config/env, or add `MAX_SOL_PER_CRON_RUN = 0.1` if none exists)
- [ ] Idempotency: if the cron runs twice in quick succession (duplicate trigger), orders should not be double-executed. Use a DB lock or an `executing` status flag.
- [ ] The swap sends from the **agent's** Solana wallet, not a shared server wallet. Verify the wallet loading code.
- [ ] No private keys are logged.

---

## Acceptance criteria

1. Create a test DCA order in the DB (manually or via the existing API). Run the cron job. The swap executes and the order is marked `status = 'executed'` with a `tx_signature`.
2. A swap with insufficient balance marks the order `failed` — does not crash the cron job.
3. A slippage error retries twice, then marks failed.
4. Running the cron job twice simultaneously does not double-execute any order.
5. `node --check api/cron/[name].js` passes.
6. No existing cron jobs (other than `pump-swap`) are affected.

## Constraints

- Use `@solana/web3.js` — already a project dependency.
- Do not introduce `@coral-xyz/anchor` as a new dependency unless it's already present. Use manual discriminators/instruction encoding instead.
- The swap logic must use the agent's own Solana wallet (loaded from the DB or env). Never use a hardcoded private key.
- Keep the existing "Phase 3.1" comment in place (update it to "implemented" after completion) so git history shows intent.
