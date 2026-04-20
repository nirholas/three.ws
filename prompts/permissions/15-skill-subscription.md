# Task 15 — Reference skill: Subscription (`public/skills/subscription/`)

## Why

The marquee use case from the MetaMask Advanced Permissions announcement: recurring on-chain payments that work without the user re-signing every period. A subscribed viewer grants a monthly cap; the skill triggers a `transfer` on each period boundary via the relayer path until revoked or expired.

## Read first

- [specs/SKILL_SPEC.md](../../specs/SKILL_SPEC.md) — skill frontmatter + lifecycle hooks
- [public/skills/tip-jar/](../../public/skills/tip-jar/) — sibling skill (task 14); share the helper pattern for ERC-20 calldata
- [00-README.md](./00-README.md) — scope shape (`period: 'weekly'` / `'daily'`)
- [src/runtime/delegation-redeem.js](../../src/runtime/delegation-redeem.js) — `redeemFromSkill` with `mode: 'relayer'` — subscriptions need the server path because they fire when the user isn't present
- [api/cron/](../../api/cron/) — the existing cron endpoint pattern, since we'll register a cron trigger for the subscription
- [vercel.json](../../vercel.json) — cron schedule declaration

## Build this

Create `public/skills/subscription/` with:

1. **`SKILL.md`** with frontmatter:
    - `name: subscription`
    - `version: 0.1.0`
    - `trust: owned-only`
    - `permissions_required: true`
    - `default_scope_preset`:
        ```jsonc
        {
        	"token": "<USDC>",
        	"maxAmount": "5000000", // 5 USDC
        	"period": "weekly",
        	"targets": ["<subscription executor contract>"],
        	"expiry_days": 90,
        }
        ```
2. **`skill.js`** — ESM exporting:
    - `async setup({ agent, host })` — attaches a "Subscribe · 5 USDC / week" action to the agent UI.
    - `async execute({ agent, host, args })` — for the viewer's initial subscription action:
        1. Opens the grant modal (task 10) pre-filled with `default_scope_preset`.
        2. On successful grant, calls `POST /api/subscriptions` (new endpoint, below) with `{ agentId, delegationId, periodSeconds: 7*24*3600, amountPerPeriod }`.
        3. Confirms in the chat: "You're subscribed until <date>. Revoke anytime in the Manage panel."
    - `async onPeriod({ agent, subscription })` — invoked by the server-side cron (via a dynamic import); does NOT run in the browser. Calls `redeemFromSkill(..., mode: 'relayer')` with a single ERC-20 `transfer` call for the period amount. Returns `{ ok, txHash }` to the cron.
3. **New endpoint `api/subscriptions.js`**:
    - POST: records `{ agentId, delegationId, periodSeconds, amountPerPeriod, nextChargeAt }` in a new `agent_subscriptions` table (add a tiny schema file `specs/schema/agent_subscriptions.sql` following task 05's style). Keep this schema self-contained; do not modify task 05's file.
    - GET: list for the authenticated user.
    - DELETE: soft-cancel a subscription (sets `status='canceled'`). Does NOT revoke the delegation — revocation is a separate user action in the manage panel.
4. **New cron `api/cron/run-subscriptions.js`**:
    - Scheduled hourly via `vercel.json` `crons` entry.
    - Selects `agent_subscriptions` rows with `status='active' AND next_charge_at <= NOW()`.
    - For each, loads the delegation row, confirms `status='active'` and not expired.
    - Calls the skill's `onPeriod` handler (via dynamic `import` from the skill's `skill.js` — the cron is server-side, the import is server-side).
    - On success, updates `last_charge_at` + advances `next_charge_at`.
    - On failure (revoked/expired/scope_exceeded): marks the subscription `status='paused'` with a `last_error` column; does not retry automatically.
    - Emits `usage_events` rows.
5. **Manifest reference** — same note as task 14.

## Don't do this

- Do not invoke the skill's `onPeriod` from the browser. Browser path only initiates the subscription; recurrence is strictly server-side.
- Do not retry failed charges silently. `paused` + user notification (email out of scope; surface in the manage panel) is correct.
- Do not run the cron every minute. Hourly is plenty; weekly subscriptions don't need minute precision.
- Do not charge more than `amountPerPeriod` per period, even if the delegation would allow it.
- Do not persist the delegator's private key or bearer tokens in `agent_subscriptions` — reference `delegationId` only.

## Acceptance

- [ ] Viewer subscribes → grant modal → signature → DB row created → weekly cron picks it up.
- [ ] Successful period charge lands on Base Sepolia via the relayer endpoint.
- [ ] Revoked delegation flips the subscription to `paused`.
- [ ] Expired delegation flips to `paused`.
- [ ] Cron idempotent — re-running within the same period doesn't double-charge (enforced by `next_charge_at`).
- [ ] `node --check` on all new JS + `npm run build` pass.

## Reporting

- Explorer link to a real period-charge tx.
- Cron log transcript (success + one intentional failure case).
- Screenshot of the subscription's manage panel card showing `active → paused` after an intentional revoke.
