# microsoft 22: receive Microsoft Marketplace leads, store them, notify the owner and draft replies

Status 2026-11-14: live in production, paused on one owner step: in Partner Center, point each offer's Customer leads at the HTTPS endpoint URL and select Validate. Code is on threews/main and deployed, MS_MARKETPLACE_LEADS_TOKEN is set on three-ws-api (revision 00536), the cron is synced and passing. See the 822 entries in the progress log.

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3122.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Every Microsoft Marketplace listing produces leads: people who click "Get it now", start a trial or contact us. Partner Center sends them to a lead destination configured on the offer. Without one, Partner Center keeps them in its own UI, where nobody looks, and a lead that waits a week goes cold. Our own HTTPS endpoint as the lead destination means every lead lands in our database within seconds, reaches the owner immediately, and comes with a drafted reply.

## Step 0: re-derive the current state

    sed -n 1,60p api/_lib/microsoft-marketplace.js
    ls marketing/growth/submissions/programs | grep -i microsoft
    grep -rn -i "lead" api/microsoft-marketplace api/_lib/microsoft* 2>/dev/null | head
    grep -n -i "rateLimit\|rate-limit" api/_lib/*.js | head -5
    grep -n -i "notify\|telegram\|discord" api/_lib/*.js | head -5

Read the current learn.microsoft.com docs for Marketplace lead management with an HTTPS endpoint: the payload Partner Center posts (lead source, offer, customer info fields, `LeadSource` values such as `AzureMarketplace` and `AppSource` with action codes), how to validate the configuration (Partner Center sends a test lead), and the documented retry behaviour.

## Tasks

1. **Endpoint** `api/microsoft-marketplace/leads.js` behind a long random token in the URL path or query (the documented way to secure an HTTPS lead destination, since Partner Center does not sign leads), stored as an env var; JSON schema validation of the documented payload; per-IP rate limit; idempotency on the lead's natural key; responds within Partner Center's timeout. Route in vercel.json.
2. **Storage.** Migration for `microsoft_marketplace_leads` (fresh timestamp; `npm run db:status` first): raw payload, parsed fields, source and action, offer id, received time, status (new, contacted, qualified, closed), owner notes. Personal data minimized to what the payload provides, with a retention rule documented in docs.
3. **Owner notification** through the existing owner channel: one message per lead with name, company, source, action and a link to the admin view. Never include more personal data than needed.
4. **Drafted reply.** For each lead, generate a reply draft with the platform's existing LLM path, grounded in the offer the lead came from and the approved partnership wording, stored with the lead. It is never sent automatically; the admin view has copy and "mark contacted".
5. **Admin view** at `/admin/microsoft/leads` (existing admin guard): list with filters, detail with raw payload, draft, status and notes. Docs: `docs/ops/microsoft-marketplace-leads.md` with the exact Partner Center configuration steps (lead destination type HTTPS endpoint, URL including the token), retention, and what to do with each lead type. STRUCTURE.md row.

## Definition of done

- [ ] Test-first tests: payload validation for each documented lead source, token rejection, idempotency, rate limit.
- [ ] A real HTTP POST of a documented-format test lead to the endpoint on port 3122 is stored, notifies through the real channel, and gets a real drafted reply (evidence in the report).
- [ ] Admin view verified in a browser; no console errors.
- [ ] Docs, STRUCTURE.md landed; `npm test` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| The token env var is not on Cloud Run | Generate it, put the `gcloud run services update three-ws-api --update-env-vars` command (pre-approved config-only) in the report and run it if the route is already deployed; otherwise it goes in the owner message with the deploy. |
| Partner Center configuration | The owner step, with the exact URL format, in the owner message. |
| Payload docs ambiguous on a field | Store the raw payload always; parse only documented fields. |
| LLM call fails | Store the lead and notify anyway; mark the draft as failed with a retry button. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git rm` this file in the closing commit. An owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
