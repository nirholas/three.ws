# microsoft 28: Microsoft-billed customers can see and manage their subscription, usage and seats inside three.ws

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3128.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

After activation on `/microsoft/activate`, a customer who bought through Microsoft Marketplace has nowhere in three.ws to see what they bought. Enterprise buyers expect a billing page that shows the plan, the billing source, renewal date, status, metered usage against the included quantity, and, for per-user plans, who holds each seat. Without it, every question becomes a support ticket and a suspended subscription looks like a broken product.

## Step 0: re-derive the current state

    grep -n "export async function\|export function" api/_lib/microsoft-marketplace.js
    grep -rn "microsoft_saas" api src --include=*.js | grep -v "_lib/microsoft-marketplace.js" | head
    ls pages | grep -i -E "billing|settings|account|plan"; ls api | grep -i -E "billing|usage|subscription|teams"
    node -e "const p=require('./data/plans.json');console.log(Object.keys(p.plans||p))"
    sed -n 1,80p api/_lib/plans.js

Find where the signed-in user's plan and billing are shown today (`/billing`, settings pages, the dashboard), how `users.plan` is computed (`recomputeUserPlan`), how team membership works (`api/teams/`), and what the Microsoft rows store (plan, quantity, status, term dates, `isTest`).

## Tasks

1. **API** `GET /api/microsoft-marketplace/subscriptions` (session auth): every Microsoft subscription linked to the account or to a team the user administers: offer, plan with its three.ws display name, Microsoft status mapped to plain language, term start and end, auto-renew, quantity, purchaser and beneficiary (masked where appropriate), and metered usage for the current billing period per dimension (accepted, pending, rejected counts from `microsoft_saas_usage_events`) against the plan's included quantity from `data/plans.json` or the plan map. Refresh from the Fulfillment API when the cached row is older than a bounded age, with a timeout and graceful fallback to the stored row.
2. **UI.** A "Billed through Microsoft" section on the existing billing or account surface (do not create a parallel billing page): plan card, status chip, renewal date, usage meters, a "Manage in Microsoft" link to the correct Microsoft admin surface for SaaS subscriptions (verify the current URL on Microsoft docs), and a clear explanation of suspension or cancellation and what still works. Skeleton loading, empty state (no Microsoft subscription: one line on buying through Microsoft with a link to the `/microsoft` hub or the offer), error state with retry. Hover, active and focus states; works at 400px; light and dark.
3. **Seats** for any plan where Microsoft sends a quantity: an admin of the linked team sees seats used versus purchased, can assign and unassign members to seats, and the entitlement check grants the paid plan only to seat holders. Over-allocation after a ChangeQuantity down is handled deterministically (most recently assigned lose seats first, each affected person notified in-app). Flat-rate plans show no seat UI.
4. **Tests** test-first for the usage aggregation, the seat entitlement rule and the over-allocation rule (`tests/microsoft-billing.test.js`), plus API tests.
5. **Docs and changelog.** A "Managing a Microsoft-billed subscription" section in [docs/microsoft-marketplace-saas.md](../../docs/microsoft-marketplace-saas.md), a changelog entry, `npm run build:pages`.

## Definition of done

- [ ] The section renders with real data for a Microsoft subscription row created through the real resolve path against an isolated DB or preview tenant (screenshot paths in the report), and the empty state renders for an account without one.
- [ ] Seat assignment changes the computed plan for the affected users (test output).
- [ ] No console errors on the page at 1280px and 400px.
- [ ] `npm test` passes; docs and changelog landed; `npm run audit:docs` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No live Microsoft subscription exists yet | Drive the real resolve and activate code against Microsoft's SaaS API emulator or an isolated DB (`scripts/lib/isolated-db.mjs`) to create the row; never insert hand-made rows into production. |
| QA login | The QA login row in the self-unblock playbook. |
| Included quantities per plan are not defined | Read them from Partner Center plan config in `data/microsoft-marketplace.json`; add an `included` field per dimension per plan there with the values in `data/plans.json` and document it. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
