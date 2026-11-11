# microsoft 21: an internal Microsoft partnership dashboard (SaaS subscriptions, metering, Teams, connector, alerts)

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3121.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

The Microsoft surfaces (Marketplace SaaS offer, Teams and Copilot app, Power Platform connector, Store and Edge packages) each write their own records, and nobody can see at a glance whether they work. When a Marketplace subscriber's webhook fails or metering is rejected, Microsoft notices before we do, and that costs the listing. One internal page that shows the health and the business of every Microsoft surface, with alerts on the failure modes that matter, turns the partnership from a set of launches into something operated.

## Step 0: re-derive the current state

    sed -n 1,80p api/_lib/microsoft-marketplace.js
    ls api/microsoft-marketplace api/teams; grep -rln -i "microsoft_marketplace\|teams_" api/_lib/migrations | head
    ls pages/admin* src/admin* 2>/dev/null | head; grep -n -i "admin" data/pages.json | head
    grep -rn -i "requireAdmin\|isAdmin" api/_lib/*.js | head -5
    grep -n -i "alert\|notify\|telegram\|discord\|slack" api/_lib/*.js | head -10

Find every table and log the Microsoft surfaces write (subscriptions, operations, metering usage events and Microsoft's verdicts, Teams bot activities, connector traffic by user agent or key), how existing admin pages authenticate, and the alert channel the repo already uses for the owner.

## Tasks

1. **Data API.** `api/admin/microsoft.js` (admin-only, the existing guard) returning: SaaS subscriptions by status and plan with MRR from real plan prices, webhook operations in the last 7 days with failures, metering events by verdict (accepted, duplicate, expired, rejected) with the last error, Teams bot conversations and active tenants, message extension and card action counts, Power Platform connector calls by operation and error rate, and Store and Edge install signals if any are recorded.
2. **Dashboard** at `/admin/microsoft`: KPI row, time series per surface, failure tables with the exact record and the runbook link for each failure type, and a "what needs attention" list at the top. Charts follow the repo's existing chart approach; accessible colours.
3. **Partner Center analytics.** If the Partner Center analytics API is reachable with the existing Entra app credentials, ingest orders, usage and customers daily via a cron (vercel.json `crons`, synced to Cloud Scheduler) into a table; otherwise build the ingestion with tests and list the exact permission needed in the owner message.
4. **Alerts.** A cron that checks: any webhook operation unacknowledged past Microsoft's deadline, any metering rejection, connector error rate above a threshold, Teams bot 5xx. Sends one deduplicated message per incident through the owner channel the repo already uses.
5. **Docs.** `docs/ops/microsoft-dashboard.md` (each metric, its source table, each alert and what to do), STRUCTURE.md row, `data/pages.json` if admin pages are listed there; no public changelog entry (internal), unless the repo logs admin features.

## Definition of done

- [ ] Test-first tests for every aggregate (fixtures built from the real table schemas, not invented shapes) and for alert deduplication.
- [ ] The dashboard renders real production data on port 3121 with an admin session; screenshot described in the report.
- [ ] One alert fired end to end in a controlled way (for example a threshold set to zero in a test run) through the real channel, then reset.
- [ ] Docs and STRUCTURE.md landed; `npm test` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Admin login for the browser check | The self-unblock playbook has the QA login row; use it. |
| A surface records nothing yet | Show the designed empty state that says what will appear and when; never fake rows. |
| Partner Center API access missing | Build and test the ingestion; the permission goes in the owner message. |
| Cron sync is a deploy step | Add to vercel.json; the `create-gcp-scheduler` sync goes in the owner message. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git rm` this file in the closing commit. An owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
