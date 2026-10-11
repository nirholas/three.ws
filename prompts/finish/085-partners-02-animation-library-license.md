# partners 02: Move the public animation library off Mixamo clips

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

[`api/animations/library.js`](../../api/animations/library.js) publicly serves a bulk clip library baked from Mixamo (`scripts/mixamo-all.mjs`) as raw JSON, and [`scripts/mirror-animation-library.mjs`](../../scripts/mirror-animation-library.mjs) exists so third parties can mirror it. Mixamo's terms, as Adobe states them on its community forum, allow royalty-free use of the animations inside projects but not redistribution of the animation files themselves. The partner sweep of 2026-10-09 flagged this as the one licensing risk that would embarrass us in front of any animation or avatar partner. Two CC0 libraries (Quaternius's Universal Animation Library and Mesh2Motion) and our own text-to-motion worker can replace it.

## Step 0: re-derive the current state

    sed -n 1,80p api/animations/library.js
    sed -n 1,60p scripts/mixamo-all.mjs
    sed -n 1,40p scripts/mirror-animation-library.mjs
    grep -rln "animations/library" src api pages public --include=*.js --include=*.html | head -40
    gh api repos/Mesh2Motion/mesh2motion-app --jq '[.full_name,.pushed_at[:10],.license.spdx_id]|@tsv'

Count clips per manifest (Mixamo bake versus generative seeder) from the live endpoint (`?facets=1`) and record it. Read Mixamo's current FAQ and Adobe's terms, and quote the exact redistribution sentence in your report. Read the license on quaternius.com and in the Mesh2Motion repo for the animation assets specifically.

## Tasks

1. **CC0 replacement set.** Import the Quaternius Universal Animation Library and the Mesh2Motion CC0 clips, convert them to the library's clip format through the existing retarget pipeline, and fill gaps from the text-to-motion worker ([`workers/model-text2motion`](../../workers/model-text2motion/)). Map each Mixamo clip name the product deep-links to a replacement, so no consumer (the /animations gallery, the embed viewer, the pose studio) breaks.
2. **Provenance on every entry.** Each manifest entry carries `source` and `license`. The gallery shows the credit per clip.
3. **Public endpoints serve only what we may redistribute.** The library endpoint and the mirror script serve CC0 and self-generated clips. Mixamo-derived clips leave every public raw endpoint. Do not delete the stored Mixamo objects (unrecoverable data gate): unpublish them from the public manifest. If the license reading in step 0 supports keeping them for in-product playback applied to a user's avatar, keep that path and say why in the report; if it does not, the replacement set covers it.
4. **Ask in writing for anything we want to keep.** Draft the permission request to Adobe in `marketing/growth/submissions/adobe-mixamo-permission.md`; sending it is owner order 938.
5. **Docs.** A licensing section in the animation docs, the credit wired into the credits page (order 086, or its dataset if 086 has not run), and a changelog entry ("the animation library is now openly licensed").

## Definition of done

- [ ] No public endpoint or mirror path returns a Mixamo-derived clip (show the request and the manifest check).
- [ ] Every product surface that used a Mixamo clip by name still plays a clip (browser check of /animations, the embed viewer and one pose deep link).
- [ ] Every manifest entry has `source` and `license`.
- [ ] `npm test` passes for the touched areas; `npm run audit:docs` reports nothing new.
- [ ] Permission draft, docs and changelog entry landed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Missing credential or env var | Follow the credential row of the CLAUDE.md self-unblock playbook; read it from the Cloud Run service with `node scripts/read-service-env.mjs`. If it exists nowhere, ship the feature wired behind the env var, prove it with a real call that the vendor answers (a documented auth error from their live API counts), and list the one missing variable in the owner message. |
| A partner's docs or intake changed since 2026-10-09 | Build to what the page says today, and fix the row in [docs/partners/prospects.md](../../docs/partners/prospects.md) in the same commit. |
| Upstream repo moved or changed license | Re-read the LICENSE file; if it is no longer permissive, switch to reference-only and build our own. |
| A step needs a third-party account only the owner can create | Build and verify everything up to that step, write the exact sign-up and submission steps into the order's submission file, and put them in the owner message. |
| A clip has no CC0 equivalent | Generate it with the text-to-motion worker, and if that is not good enough, list it as kept for in-product playback only, with the reason. |

## Close out (required)

1. Verify every Definition of done line with the actual command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths and a subject that describes the diff (`type(scope): what changed and why a reader cares`).
3. If every line passes, delete this file in that commit (`git rm prompts/finish/085-partners-02-animation-library-license.md`) and append a dated entry to [_context/partners-PROGRESS.md](_context/partners-PROGRESS.md) with the commit SHAs. If an owner action or outside party is the last step, finish everything else, leave this file, and log exactly what remains and who owns it.
4. Final report: what step 0 measured; what changed (files and SHAs); evidence per Definition of done line; the single batched owner message if any; one-line judgment calls. No trailing questions.
