# partners 09: Import an avatar from VRoid Hub

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

VRoid Hub is where a very large share of the world's VRM avatars live, and its API lets an approved app download a model on the user's behalf, subject to the license conditions the creator set on each model. three.ws already loads VRM, canonicalizes VRoid and VRM 1.0 skeletons ([`src/glb-canonicalize.js`](../../src/glb-canonicalize.js)) and has an import page pattern in /import/rpm. A "bring your VRoid Hub avatar" button turns three.ws into somewhere those avatars can talk, walk and act as agents.

## Step 0: re-derive the current state

    ls pages | grep -i import; grep -n '"path": "/import' data/pages.json
    sed -n 1,60p "$(grep -rl "import/rpm" src --include=*.js | head -1)"
    node scripts/read-service-env.mjs '^VROID' --names

Read the VRoid Hub API docs (developer.vroid.com): app registration and approval, OAuth, the download-license flow, the per-model license fields (avatar use, commercial use, redistribution, alteration), and the attribution rules.

## Tasks

1. **OAuth** behind `VROID_HUB_CLIENT_ID` and `VROID_HUB_CLIENT_SECRET`, with the callback route and token storage following the existing OAuth patterns in `api/`.
2. **The picker.** A page at `/import/vroid` listing the user's own models and their hearted models that allow download, each with its license conditions shown in plain words.
3. **Enforce the license.** Only offer actions the model's conditions allow (for example, no public agent if the creator disallows it, no export if redistribution is disallowed), keep the creator credit on every surface the avatar appears on, and store the license fields with the avatar.
4. **The import.** Download through the license flow, run the existing VRM load and canonicalize path, and land the user in the avatar editor with idle and walk playing.
5. **Docs and submission.** A doc page, `data/pages.json` entry, `STRUCTURE.md` row, changelog entry, and `marketing/growth/submissions/vroid-hub-app.md` with the app registration answers for owner order 939.

## Definition of done

- [ ] With credentials present, a real VRoid Hub model imports and plays canonical clips; without them, the page shows its designed "coming soon to your account" state and the route returns no error.
- [ ] A model whose license disallows an action never offers that action (unit test over the license mapping).
- [ ] `npm test` passes; `npm run audit:docs` reports nothing new.
- [ ] Docs, page entry, `STRUCTURE.md`, changelog and the submission file landed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Missing credential or env var | Follow the credential row of the CLAUDE.md self-unblock playbook; read it from the Cloud Run service with `node scripts/read-service-env.mjs`. If it exists nowhere, ship the feature wired behind the env var, prove it with a real call that the vendor answers (a documented auth error from their live API counts), and list the one missing variable in the owner message. |
| A partner's docs or intake changed since 2026-10-09 | Build to what the page says today, and fix the row in [docs/partners/prospects.md](../../docs/partners/prospects.md) in the same commit. |
| Upstream repo moved or changed license | Re-read the LICENSE file; if it is no longer permissive, switch to reference-only and build our own. |
| A step needs a third-party account only the owner can create | Build and verify everything up to that step, write the exact sign-up and submission steps into the order's submission file, and put them in the owner message. |
| VRoid Hub app approval pending | Build and unit-test the whole flow against the documented API shapes, verify the OAuth redirect against the live authorize endpoint, and leave the approval as owner order 939. |

## Close out (required)

1. Verify every Definition of done line with the actual command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths and a subject that describes the diff (`type(scope): what changed and why a reader cares`).
3. If every line passes, delete this file in that commit (`git rm prompts/finish/092-partners-09-vroid-hub-import.md`) and append a dated entry to [_context/partners-PROGRESS.md](_context/partners-PROGRESS.md) with the commit SHAs. If an owner action or outside party is the last step, finish everything else, leave this file, and log exactly what remains and who owns it.
4. Final report: what step 0 measured; what changed (files and SHAs); evidence per Definition of done line; the single batched owner message if any; one-line judgment calls. No trailing questions.
