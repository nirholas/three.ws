# partners 16: Apply to the partner and startup programs (owner-gated)

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Blocked on owner actions; do everything the order assigns to the agent first.

## Operating clause (binding)

- Read CLAUDE.md first, then [_context/partners-00-CONTEXT.md](_context/partners-00-CONTEXT.md). CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: irreversible spend, git push or deploy, external posting, committing content that names a crypto project other than $THREE, destroying unrecoverable data. Batch every such ask into ONE message at the end.
- Never contact a third party: no email, issue, pull request, form, listing or post. Write the exact text into the repo and put the step in the owner message (context file rules).
- Never onboard a paid API or spend. Wire paid vendors behind their env var and prove the code against the real API with whatever free or sandbox access exists.
- Verify each upstream license from its LICENSE file before adopting anything.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. The em-dash and en-dash characters are banned.
- Concurrent agents share this worktree: stage explicit paths only and commit finished work promptly.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.

## Why this is gated

Each application creates an account or agreement in the owner's name, and some commit the platform to terms. Only the owner can do that.

## Why this matters

The [prospects list](../../docs/partners/prospects.md) found a set of programs that grant credits, listings or partner status to a platform like three.ws, several of which need a live integration first (built in orders 087 to 092). This order is the application checklist, with the answers drafted.

## Step 0: re-derive the current state

    ls marketing/growth/submissions/

Re-read each program's page on the day: eligibility, deadline, what it grants, and the form fields. Microsoft's legacy route closes on 2026-10-31, so it goes first if it is still open.

## Tasks

1. **Draft every application** in `marketing/growth/submissions/programs/<program>.md` with each form field answered from verified facts and the proof brief:
   - Microsoft (Copilot Studio and Microsoft 365 Copilot MCP certification, through Partner Center)
   - LiveKit Startups, ElevenLabs startup grant, Deepgram startup program, Cloudflare for Startups
   - Composio toolkit partnership, Meshy partner form
   - VRoid Hub app approval (order 092), Shopify Partner and App Store review (order 091), Discord app verification and Activity Discovery (order 088)
   - GitHub Technology Partner, JetBrains AI partner route
   - Avaturn, Uthana and Rokoko partner or integration forms
2. **Owner: submit** each, deadline first.
3. **Log each** in the tracker and, when approved, wire what it grants (credits into the provider, listings into the partner docs).

## Definition of done

- [ ] One drafted application per program, each with the date its page was last read.
- [ ] Each submitted application logged with its outcome.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Missing credential or env var | Follow the credential row of the CLAUDE.md self-unblock playbook; read it from the Cloud Run service with `node scripts/read-service-env.mjs`. If it exists nowhere, ship the feature wired behind the env var, prove it with a real call that the vendor answers (a documented auth error from their live API counts), and list the one missing variable in the owner message. |
| A partner's docs or intake changed since 2026-10-09 | Build to what the page says today, and fix the row in [docs/partners/prospects.md](../../docs/partners/prospects.md) in the same commit. |
| Upstream repo moved or changed license | Re-read the LICENSE file; if it is no longer permissive, switch to reference-only and build our own. |
| A step needs a third-party account only the owner can create | Build and verify everything up to that step, write the exact sign-up and submission steps into the order's submission file, and put them in the owner message. |
| A program page is gone or closed | Mark it in the prospects list's screened-out table with the date, and move on. |

## Close out (required)

1. Verify every Definition of done line with the actual command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths and a subject that describes the diff (`type(scope): what changed and why a reader cares`).
3. If every line passes, delete this file in that commit (`git rm prompts/finish/939-partners-16-program-applications.md`) and append a dated entry to [_context/partners-PROGRESS.md](_context/partners-PROGRESS.md) with the commit SHAs. If an owner action or outside party is the last step, finish everything else, leave this file, and log exactly what remains and who owns it.
4. Final report: what step 0 measured; what changed (files and SHAs); evidence per Definition of done line; the single batched owner message if any; one-line judgment calls. No trailing questions.
