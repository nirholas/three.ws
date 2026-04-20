---
name: subscription
version: 0.1.0
trust: owned-only
permissions_required: true
default_scope_preset:
    token: '<USDC>'
    maxAmount: '5000000'
    period: 'weekly'
    targets: ['<subscription executor contract>']
    expiry_days: 90
---

# Subscription

Allow a viewer to subscribe to this agent for recurring USDC payments. The agent charges 5 USDC per week automatically — no re-signing needed — until the viewer revokes or the delegation expires (90 days).

## Flow

1. Viewer clicks **Subscribe · 5 USDC / week**.
2. MetaMask opens pre-filled with the scope (5 USDC / week cap, 90-day expiry).
3. Viewer approves once. No further wallet prompts.
4. The server cron fires every hour; weekly charges are applied automatically via the ERC-7710 relayer.
5. Viewer can revoke at any time from the Manage panel — this pauses the subscription.

## onPeriod

`onPeriod` is **server-side only**. The cron at `/api/cron/run-subscriptions` imports it via dynamic `import()` and calls it once per subscription per period. It builds a single ERC-20 `transfer` call for `amountPerPeriod` and redeems it through the relayer endpoint.

**Never call `onPeriod` from the browser.**

## Error behaviour

- Revoked delegation → subscription status flips to `paused`, visible in the Manage panel.
- Expired delegation → same.
- Failed redemption → `paused` + `last_error` stored; no silent retry.
