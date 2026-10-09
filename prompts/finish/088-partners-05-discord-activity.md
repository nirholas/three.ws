# partners 05: A three.ws Discord Activity

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate.

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

## Why this matters

Discord Activities are web apps that run inside Discord voice channels, and the App Directory lists a verified Activity within about 24 hours of meeting its Discovery criteria. three.ws already has a Discord chat gateway ([`api/gateway/discord.js`](../../api/gateway/discord.js)) but no Embedded App SDK integration. A group that can forge, pose and talk to 3D agents together inside a voice call is the most shareable thing on the prospects list, and purchases inside Activities are supported (15% on the first USD 1M).

## Step 0: re-derive the current state

    sed -n 1,60p api/gateway/discord.js
    node scripts/read-service-env.mjs '^DISCORD' --names
    npm view @discord/embedded-app-sdk version

Read Discord's Activities docs: the Embedded App SDK, the OAuth token exchange, URL mappings through Discord's proxy (every fetch, socket and CDN asset must go through a mapped prefix), the content security rules, and the App Directory Discovery criteria.

## Tasks

1. **Choose the experience** from what exists and works best for a group: a shared Forge where everyone in the call generates and votes, with a three.ws agent in the room that talks and reacts. Keep it free of coin and wallet features; Discord's review and this campaign both call for that. Record the choice in one line.
2. **The Activity entry point**, using `@discord/embedded-app-sdk`: authorize, exchange the code on a new server endpoint, authenticate, and map the Discord user to a three.ws session.
3. **The proxy.** Route every network call through the mapped prefixes, and make the three.ws assets the Activity needs load inside Discord's content security policy.
4. **Shared state per Activity instance**, so everyone in the voice channel sees the same scene.
5. **Purchases.** If the experience sells anything, use Discord's in-app purchase flow; otherwise leave it out and say so.
6. **Docs and submission.** A doc page, `STRUCTURE.md` row, changelog entry, and `marketing/growth/submissions/discord-activity.md` with the exact developer-portal settings (URL mappings, OAuth redirects, Activity flags) and Discovery listing copy for owner order 939.

## Definition of done

- [ ] The Activity loads and works inside the Discord client in a test server, with two accounts seeing the same state (screenshots).
- [ ] No console errors inside the Discord frame; every request goes through a mapped prefix.
- [ ] `npm test` passes; `npm run audit:docs` reports nothing new.
- [ ] Docs, `STRUCTURE.md`, changelog and the submission file landed.

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
3. If every line passes, delete this file in that commit (`git rm prompts/finish/088-partners-05-discord-activity.md`) and append a dated entry to [_context/partners-PROGRESS.md](_context/partners-PROGRESS.md) with the commit SHAs. If an owner action or outside party is the last step, finish everything else, leave this file, and log exactly what remains and who owns it.
4. Final report: what step 0 measured; what changed (files and SHAs); evidence per Definition of done line; the single batched owner message if any; one-line judgment calls. No trailing questions.
