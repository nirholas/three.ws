# partners 13: Tripo reply, first call, and the house key (owner-gated)

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

Sending the reply is posting to an external party, and putting a platform-paid `TRIPO_API_KEY` on the production service onboards a paid API. Both are the owner's call under CLAUDE.md. The agent's part is to make each of those a single step.

## Why this matters

Tripo reached out on 2026-10-09. The [brief](../../docs/partners/tripo.md) has the reply draft, the call questions and three deal shapes; order 084 builds the house lane behind the env var. This order carries the deal from reply to a live lane.

## Step 0: re-derive the current state

    sed -n '/## Reply draft/,/## Related/p' docs/partners/tripo.md
    node scripts/read-service-env.mjs '^TRIPO' --names
    ls prompts/finish | grep 084 || echo "084 done"

Re-read the Tripo-family job counts from `forge_creations` for the last 30 days and update the brief's table if they moved.

## Tasks

1. **Refresh the brief** with today's numbers and anything Tripo has announced since 2026-10-09 (new models, pricing, the v3 endpoints).
2. **Owner: send the reply** from the brief, copying `business@tripo3d.ai` if the first contact came from elsewhere. Log it in the tracker row.
3. **Owner: hold the call** with the six questions; the agent turns the owner's notes into the agreed deal shape in the brief.
4. **Owner: approve the key.** Once terms are agreed, the owner sets it with `gcloud run services update three-ws-api --region us-central1 --update-env-vars TRIPO_API_KEY=...` (or as a Secret Manager reference, matching how the service holds every other credential). Never `--set-env-vars`.
5. **After the key lands**: confirm Tripo jobs route as a house lane, run the reporting script from order 084 daily for the pilot, and draft the joint launch post in `marketing/growth/submissions/tripo-launch-post.md` for the owner to send.

## Definition of done

- [ ] Reply sent and logged in `marketing/growth/opportunities.csv`.
- [ ] Deal shape recorded in the brief.
- [ ] Key on the service, a production Tripo house-lane job completed, and the first pilot report produced.
- [ ] Launch post drafted.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Missing credential or env var | Follow the credential row of the CLAUDE.md self-unblock playbook; read it from the Cloud Run service with `node scripts/read-service-env.mjs`. If it exists nowhere, ship the feature wired behind the env var, prove it with a real call that the vendor answers (a documented auth error from their live API counts), and list the one missing variable in the owner message. |
| A partner's docs or intake changed since 2026-10-09 | Build to what the page says today, and fix the row in [docs/partners/prospects.md](../../docs/partners/prospects.md) in the same commit. |
| Upstream repo moved or changed license | Re-read the LICENSE file; if it is no longer permissive, switch to reference-only and build our own. |
| A step needs a third-party account only the owner can create | Build and verify everything up to that step, write the exact sign-up and submission steps into the order's submission file, and put them in the owner message. |
| Tripo has not answered in 12 days | Follow the cadence in [the outreach plan](../../docs/partners/outreach-plan.md#cadence-and-follow-up), then mark the row `no_reply`. Order 084's work stays useful to BYOK users either way. |

## Close out (required)

1. Verify every Definition of done line with the actual command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths and a subject that describes the diff (`type(scope): what changed and why a reader cares`).
3. If every line passes, delete this file in that commit (`git rm prompts/finish/936-partners-13-tripo-reply-and-house-key.md`) and append a dated entry to [_context/partners-PROGRESS.md](_context/partners-PROGRESS.md) with the commit SHAs. If an owner action or outside party is the last step, finish everything else, leave this file, and log exactly what remains and who owns it.
4. Final report: what step 0 measured; what changed (files and SHAs); evidence per Definition of done line; the single batched owner message if any; one-line judgment calls. No trailing questions.
