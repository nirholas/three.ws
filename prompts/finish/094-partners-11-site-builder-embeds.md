# partners 11: WordPress, Framer and Webflow embeds for <agent-3d>

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

The `<agent-3d>` web component already embeds anywhere with one script tag, SRI-pinned to an immutable release. Site builders are where non-developers put things on the web, and each has a directory: the WordPress plugin directory, the Framer marketplace, and the Webflow Apps marketplace. A native block or component in each turns "paste this script" into "search for three.ws".

## Step 0: re-derive the current state

    cat data/agent-3d-releases.json | head -30
    grep -n "integrity=" docs/*.md | head
    ls integrations

Read the current submission rules for the WordPress plugin directory (readme.txt format, plugin check, security review), Framer code components and marketplace, and Webflow Designer Extensions and the Webflow Apps marketplace.

## Tasks

1. **WordPress**: `integrations/wordpress/`, a block plugin (block.json, editor preview, server render) that loads the SRI-pinned `<agent-3d>` release and takes an agent id or model URL, with shortcode fallback for the classic editor. Passes the official Plugin Check locally (run it in a local WordPress through docker). A `readme.txt` in the directory's format.
2. **Framer**: `integrations/framer/`, a code component with property controls (agent, model, autoplay, background), tested in a real Framer project if an account exists, and its marketplace listing text.
3. **Webflow**: `integrations/webflow/`, a Designer Extension or the documented embed path that inserts the element, plus listing text.
4. **One release pin.** All three read the version and SRI hash from `data/agent-3d-releases.json` through a small build step, so a new release updates every embed at once.
5. **Docs.** README per directory, an embed doc section per platform, `STRUCTURE.md` rows, changelog entry, submission text in `marketing/growth/submissions/site-builders.md` for owner order 938.

## Definition of done

- [ ] The WordPress block renders an agent in a local WordPress page, and Plugin Check passes (output in the report).
- [ ] The Framer and Webflow components render an agent, verified in the real tool or, if no account exists, in the local harness each platform documents.
- [ ] All three use the pinned release and hash from the ledger.
- [ ] `npm test` passes; `npm run audit:docs` reports nothing new.
- [ ] READMEs, docs, `STRUCTURE.md`, changelog and submission text landed.

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
3. If every line passes, delete this file in that commit (`git rm prompts/finish/094-partners-11-site-builder-embeds.md`) and append a dated entry to [_context/partners-PROGRESS.md](_context/partners-PROGRESS.md) with the commit SHAs. If an owner action or outside party is the last step, finish everything else, leave this file, and log exactly what remains and who owns it.
4. Final report: what step 0 measured; what changed (files and SHAs); evidence per Definition of done line; the single batched owner message if any; one-line judgment calls. No trailing questions.
