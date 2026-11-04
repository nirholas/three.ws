---
slug: launch-funnel-default-coin-path
title: Fix the agent launch funnel by auto-drafting a coin plan and instrumenting each step
tier: P1
score: 64
area: launch
sources: docs/experiments-agent-launch-funnel.md, docs/research/launchpad-landscape-2026-09.md#4
---

## Why this matters

The funnel experiment measured 2 of 788 new agents ever launching a coin, only 26.4 percent have a wallet at all, and `agent_token_plans` has zero rows, so the launch feature is effectively unused. The research recommendation is to make the coin path the default instead of an opt-in tool buried in a menu. Without per-step instrumentation the drop-off point cannot even be measured.

## Current state (measured by the reviewer on 2026-11-03)

- Planner UI `src/agent-token-plan.js` (497 lines) and API `api/_lib/agent-token-plan.js` (372 lines), routes in `api/agents/tokens/[action].js` and `api/pump/[action].js`.
- No auto-draft on agent creation, no per-step funnel events found.
- Mainnet launch itself is an owner-gated mint (CLAUDE.md gate 1).

## Step 0: re-derive the current state

```
grep -rn "agent_token_plans" api src --include=*.js | head
grep -rn "token-plan\|tokenPlan" src/create-agent.js src/agent-home.js 2>/dev/null | head
ls api/_lib/migrations | grep -i token_plan
grep -n "track(" src/agent-token-plan.js | head
```

Also read `docs/research/launchpad-landscape-2026-09.md` item 4 and the experiment's own SELECT queries (pinned windows) to re-measure the baseline before changing anything.

## Tasks

1. Re-run the experiment queries read-only against production data and record the new baseline in the experiment doc's results section.
2. Test first (`tests/agent-token-plan-draft.test.js`): creating an agent (with wallet) auto-creates a draft plan row with a sensible name/symbol derived from the agent and persona, idempotently; creating without a wallet provisions the custodial Solana wallet first (reuse the existing wallet-provision path) or records a pending draft.
3. Auto-draft on agent creation and surface the draft on the agent home as the primary next step card (skeleton while loading, empty/error states, hover/focus/active), showing the one-tap "review and launch" path that stops at the confirmation screen.
4. Instrument each step as an allowlisted analytics event (`src/analytics.js` and its allowlist test `tests/analytics-event-allowlist.test.js`): plan_viewed, plan_edited, wallet_funded, launch_confirm_opened, launch_submitted, launch_succeeded.
5. Add a funnel read endpoint or admin query that reports step counts, used by the experiment doc.
6. Devnet only for verification. Update the experiment doc with the change and the follow-up measurement date; add a changelog entry.

## Definition of done

- [ ] `npx vitest run tests/agent-token-plan-draft.test.js` passes; allowlist test passes with the new events.
- [ ] Creating a new agent in a real browser shows the draft card without any console error; the funnel query returns non-zero `plan_viewed` after the visit.
- [ ] The experiment doc contains the updated baseline numbers with the pinned query timestamps.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Wallet missing for most agents | Provision the custodial Solana wallet at creation using the existing path; do not add a new wallet system |
| Analytics allowlist rejects events | Add the names to the allowlist and its test in the same change |

## Gates

The final mainnet launch/mint step is a hard gate: render recipient, amount and chain and stop for explicit yes/no every time. Build and verify the confirmation screen on devnet only; do not launch on mainnet in this order.
