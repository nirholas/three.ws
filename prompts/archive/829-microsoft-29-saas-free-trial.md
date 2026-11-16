# microsoft 29: support Microsoft Marketplace free trials on the SaaS offer, from activation to conversion

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3129.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Partner Center lets a SaaS plan offer a free trial, and trial offers convert far better on Marketplace than paid-only ones. A trial subscription arrives with `isFreeTrial: true` and converts to paid automatically at the end of the trial unless the buyer cancels. Today the three.ws code ignores the flag, so a trial user gets no indication they are on a trial, no reminder before conversion, and the owner cannot see trial conversion in reporting.

## Step 0: re-derive the current state

    grep -n -i "freetrial\|is_free_trial\|trial" api/_lib/microsoft-marketplace.js api/microsoft-marketplace/*.js src/microsoft-activate.js
    ls api/_lib/migrations | grep -i microsoft
    grep -n -i "trial" data/plans.json | head
    npx vitest run tests/microsoft-marketplace.test.js

Read Microsoft's current SaaS docs on free trials: the subscription fields that mark a trial, its term dates, how and when conversion happens, which webhook action (if any) fires at conversion, and what happens when a trial is canceled. Record each fact with its doc URL in the doc you update.

## Tasks

1. **Persist trial state.** A migration (fresh UTC timestamp, `npm run db:status` first) adding the trial flag and trial end date to `microsoft_saas_subscriptions`, populated from Microsoft's copy on every resolve, webhook and refresh. Conversion detected from Microsoft's data (flag flips or the documented signal) records a conversion timestamp and an audit entry.
2. **Activation page.** `/microsoft/activate` shows "Free trial, ends <date>, then <plan price> through Microsoft" for trial subscriptions, using the price shown in Partner Center where the API exposes it, otherwise the plan name without a made-up price.
3. **In-product trial banner** for trial users on the main signed-in surfaces: days left, what converts, and a "Manage in Microsoft" link. Dismissible per session, never blocking. Accessible (role, focus, contrast).
4. **Reminders.** A cron (added to `vercel.json` crons, so it syncs to Cloud Scheduler) sends one in-app notification and one email through the existing notification and email paths at 7 days and 1 day before trial end. Idempotent per subscription and milestone.
5. **Reporting.** Trial starts, conversions and cancellations-during-trial exposed in the existing Microsoft admin view (`api/admin/microsoft.js`, `src/microsoft-admin.js`) as counts with a conversion rate.
6. **Tests first** for state mapping, conversion detection and reminder idempotency.
7. **Docs and changelog.** Free trial section in [docs/microsoft-marketplace-saas.md](../../docs/microsoft-marketplace-saas.md) including the Partner Center setting the owner flips, a changelog entry, `npm run build:pages`.

## Definition of done

- [ ] A trial subscription driven through the real resolve path (emulator or isolated DB) shows trial copy on `/microsoft/activate` and the banner in the app (screenshot paths).
- [ ] Reminder cron sends exactly one notification per milestone on rerun (test output).
- [ ] Migration applied after `npm run db:status` (output in the report).
- [ ] `npm test` passes; docs, changelog, cron entry landed; `npm run audit:docs` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No trial subscription exists | Use Microsoft's SaaS API emulator with a trial purchase, or the isolated DB; never insert rows into production by hand. |
| Microsoft's docs are ambiguous about the conversion signal | Detect conversion from the subscription state on every refresh (flag and term change), which is robust to either signal, and document both. |
| Email path unconfigured locally | Assert the queued email row; the existing email worker sends it in production. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
