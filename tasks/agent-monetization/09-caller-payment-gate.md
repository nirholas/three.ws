# Task 09 — Frontend: Caller Payment Gate (Skill Invocation Intercept)

## Goal
When a caller tries to invoke a priced skill, intercept the request client-side, show them the price, and require payment before the skill executes. After successful payment, resume the skill call with a payment proof token.

## Success Criteria
- Free skills invoke without any payment prompt
- Priced skills show a modal with the price before executing
- Caller can approve (pay) or cancel
- After payment, skill executes exactly once
- Payment proof is passed to the skill context so the backend can verify it
- Works in both the embedded widget and the full agent viewer

## Where to Hook In

The skill invocation path flows through `/src/skills/index.js` (the skill registry runner). Find the `invoke(skill, args, ctx)` or equivalent method.

Before executing, check if the skill has a price:
1. `GET /api/agents/:agentId/x402/:skill/manifest`
2. If 404 (not priced) → proceed normally
3. If 200 (has price) → pause, show payment modal, wait for user confirmation
4. On confirmation → initiate x402 payment flow → get payment proof
5. Resume skill with `ctx.paymentProof = proof`

## Payment Modal Component

Create `src/components/payment-gate-modal.jsx`:

```jsx
// Props: skill, amount, currencySymbol, chain, onPay, onCancel
// Shows:
//   Title: "This skill requires payment"
//   Body:  "[skill] costs [amount] [currency]"
//   Buttons: [Pay] [Cancel]
// [Pay] triggers the x402 client payment flow
```

The `[Pay]` button calls the existing x402 client helpers (look in `src/` for x402-related code or `agent-payments-sdk`).

## x402 Client Flow

The client-side x402 flow should:
1. Call `GET /api/agents/:id/x402/:skill/manifest` → get payment details
2. Construct and sign the payment on the user's connected wallet
3. Call `POST /api/agents/:id/x402/:skill/pay` (or the prep/confirm endpoints) with the signed payment
4. Receive back a `payment_proof` or `intent_id`
5. Pass this as a header/arg when invoking the skill

Reference the existing `agent-payments-sdk/` and `/api/agents/payments/` for the flow pattern.

## Files to Touch
- `/src/skills/index.js` — add intercept in invoke path
- Add `src/components/payment-gate-modal.jsx` — new file
- `/src/runtime/index.js` — may need to thread `paymentProof` into tool context

## Do NOT Change
- The skill handler signatures or return format
- The x402 backend verification logic

## Edge Cases
- Wallet not connected → show "Connect wallet" before price modal
- Payment timeout → show error, allow retry
- Skill returns error after payment → log to console, do NOT re-charge (intent is consumed)
- Duplicate calls racing → debounce or disable [Pay] button after first click

## Verify
1. Add a price to a skill via Task 08 UI
2. Click that skill in the viewer → payment modal appears with correct price
3. Approve payment → skill runs, output appears
4. Cancel → skill does not run, no payment
5. Free skill → no modal, runs immediately
