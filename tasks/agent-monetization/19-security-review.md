# Task 19 — Security Review: Agent Monetization Feature

## Goal
Before shipping, conduct a targeted security review of all new code added in Tasks 01–18. Focus on the highest-risk areas: payment flows, authorization boundaries, and financial data integrity.

## Method
Run `/security-review` on the branch containing all monetization changes, then manually verify each item in the checklist below.

## Checklist

### Authorization
- [ ] Every pricing write endpoint (`PUT`, `DELETE`) verifies `agent.user_id === session.user_id`
- [ ] Revenue data endpoints (`/billing/revenue`, `/billing/withdrawals`) are scoped to the authenticated user only — no other user's data leaks
- [ ] Admin endpoints (`/admin/revenue`, `PATCH /admin/withdrawals/:id`) require `is_admin = true` on the user row
- [ ] Public endpoints (`GET /api/agents/:id/pricing`, `GET /api/billing/fee-info`) return no sensitive data (wallet private keys, user emails, session tokens)

### Payment Integrity
- [ ] Intent status transitions are atomic (inside a DB transaction)
- [ ] `status = 'consumed'` is only set once per intent (idempotency)
- [ ] `agent_revenue_events.intent_id` has a unique constraint or the insert is inside the same transaction as the status update
- [ ] `gross_amount = fee_amount + net_amount` is enforced in the insert, not just the application layer
- [ ] Payment proof signature is verified on the backend before marking intent as `paid` (check existing x402 verification is still called)

### Financial Data
- [ ] `agent_revenue_events` is append-only (no UPDATE or DELETE allowed from application code)
- [ ] Withdrawal amount cannot exceed available balance (checked with `SELECT FOR UPDATE` to prevent race conditions)
- [ ] `PLATFORM_TREASURY_KEYPAIR` is never logged, returned in responses, or stored in the DB

### Input Validation
- [ ] Skill name in pricing API is validated against `^[a-z0-9-]{1,64}$` (prevent injection via skill name)
- [ ] Amount fields are integers — no floating-point arithmetic in financial calculations
- [ ] Payout wallet addresses are validated for correct format per chain before storage

### Rate Limiting
- [ ] Payment intent creation: rate-limited per payer address
- [ ] Withdrawal creation: rate-limited per user (max 3/hour)
- [ ] Pricing read: rate-limited per IP

### CSRF
- [ ] All state-mutating endpoints (POST, PUT, DELETE, PATCH) that accept session cookie auth require CSRF token verification (check existing `verifyCsrfToken()` is applied)

### Data Leakage
- [ ] Error messages in payment endpoints do not reveal internal state (intent IDs, stack traces) to callers
- [ ] Withdrawal `to_address` is not returned to non-owners (the admin endpoint is OK, but the user-facing GET should only return their own)

## Files to Review
All files created/modified in Tasks 01–18:
- `/api/_lib/migrations/013_agent_monetization.sql`
- `/api/_lib/fee.js`
- `/api/_lib/payout.js`
- `/api/_lib/solana-transfer.js`
- `/api/agents/[id]/pricing/*.js`
- `/api/billing/revenue.js`
- `/api/billing/withdrawals/*.js`
- `/api/billing/payout-wallets/*.js`
- `/api/billing/fee-info.js`
- `/api/cron/process-withdrawals.js`
- `/api/notifications/*.js`
- The modified x402 manifest endpoint

## Output
Create a brief report listing:
1. Any HIGH severity findings with the file + line number
2. Any MEDIUM findings
3. Confirmation that all checklist items passed

Fix all HIGH and MEDIUM findings before merging.
