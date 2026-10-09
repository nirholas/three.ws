# partners 15: Open the pull requests, submit the listings, publish the packages, send the emails (owner-gated)

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

Each item is a pull request, issue, form, listing, npm publish or email to a third party, all of which are external posting under CLAUDE.md. The runnable orders prepared every one of them as text in the repository; the owner sends them.

## Why this matters

Orders 085 to 095 each end with prepared submissions in `marketing/growth/submissions/`. This order is the owner's checklist for sending them, in the order that does the most good first, and the agent's job of keeping each one current on the day it goes out.

## Step 0: re-derive the current state

    ls marketing/growth/submissions/ marketing/growth/submissions/agent-registries/ 2>/dev/null
    ls prompts/finish | grep -E "^0(8[4-9]|9[0-5])-partners" || echo "all runnable partners orders closed"

For each submission file, re-check the intake route and any number it quotes on the day it is sent.

## Tasks

Send in this order, one tracker row per item, logging the outcome in `status` and `next_action`:

1. **Agent registries** (order 093): npm publish of `packages/ai-sdk` and `packages/langchain`; the LangChain integration issue; Hermes, Kilo, OpenHands, OpenCode, Dify and cursor.directory entries; the Composio toolkit form; the GitHub MCP registry entry.
2. **LiveKit and Pipecat** (order 087): the avatar plugin pull request to livekit/agents and the community-integration pull request to Pipecat's docs.
3. **Home Assistant** (order 095): create the standalone repository from the export script, then the `home-assistant/brands` and `hacs/default` pull requests.
4. **Slicers** (order 089): the PrusaSlicer trusted-hosts pull request and the Bambu Studio issue.
5. **Site builders** (order 094): WordPress plugin directory, Framer marketplace, Webflow Apps.
6. **Animation licensing** (order 085): the Adobe permission email, if order 085 kept anything that needs it.
7. **Mocap landing** (order 090): announce it, and decide whether to name the closed services in outreach.

## Definition of done

- [ ] Every submission file has a tracker row with its sent date and outcome.
- [ ] Merged or listed items are linked from the [prospects list](../../docs/partners/prospects.md) and, where the partner page's rules allow, [the partner page](../../docs/partners.md).

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Missing credential or env var | Follow the credential row of the CLAUDE.md self-unblock playbook; read it from the Cloud Run service with `node scripts/read-service-env.mjs`. If it exists nowhere, ship the feature wired behind the env var, prove it with a real call that the vendor answers (a documented auth error from their live API counts), and list the one missing variable in the owner message. |
| A partner's docs or intake changed since 2026-10-09 | Build to what the page says today, and fix the row in [docs/partners/prospects.md](../../docs/partners/prospects.md) in the same commit. |
| Upstream repo moved or changed license | Re-read the LICENSE file; if it is no longer permissive, switch to reference-only and build our own. |
| A step needs a third-party account only the owner can create | Build and verify everything up to that step, write the exact sign-up and submission steps into the order's submission file, and put them in the owner message. |

## Close out (required)

1. Verify every Definition of done line with the actual command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths and a subject that describes the diff (`type(scope): what changed and why a reader cares`).
3. If every line passes, delete this file in that commit (`git rm prompts/finish/938-partners-15-listings-prs-and-sends.md`) and append a dated entry to [_context/partners-PROGRESS.md](_context/partners-PROGRESS.md) with the commit SHAs. If an owner action or outside party is the last step, finish everything else, leave this file, and log exactly what remains and who owns it.
4. Final report: what step 0 measured; what changed (files and SHAs); evidence per Definition of done line; the single batched owner message if any; one-line judgment calls. No trailing questions.
