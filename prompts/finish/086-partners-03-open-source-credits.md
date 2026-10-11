# partners 03: Open-source credits page and in-surface credits

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

The partner sweep found that three.ws credits almost none of the open source it stands on where a visitor can see it. /objects is built from Poly Haven's CC0 catalog and never says so. meshoptimizer's credit lives in the header of a vendored file. The Forge does not name the open models that made a result. Every open-source partnership in the [outreach plan](../../docs/partners/outreach-plan.md) climbs the ladder Use, Credit, Contribute, and we are stuck on the first rung. `/credits` is the billing page, so this needs its own route.

## Step 0: re-derive the current state

    cat NOTICE | head -60 && ls third_party
    node -e "const p=require('./package.json');console.log(Object.keys(p.dependencies||{}).length,Object.keys(p.devDependencies||{}).length)"
    grep -n '"path": "/open-source\|"path": "/credits' data/pages.json
    grep -rn "polyhaven\|Poly Haven" src pages --include=*.js --include=*.html | head
    ls workers | head -80

List every GPU worker's model and its license from the worker READMEs, and every asset source (Poly Haven, Quaternius, Mesh2Motion, and anything else under `scripts/fetch-*`).

## Tasks

1. **A credits dataset generated from the source of truth.** A script under `scripts/` builds `data/open-source-credits.json` from `package.json` and the lockfile (name, license, repository, funding link), `NOTICE`, `third_party/`, worker model licenses, and asset sources, plus a short hand-written "what it powers here" line per major project kept in a small curated file. Wire it into the existing pages build without reordering the `build:gcp` chain (if you change a load-bearing script, update CLAUDE.md in the same commit).
2. **The page.** A new route (for example `/open-source`) grouped by area: rendering, formats and compression, generation models, motion, voice, assets, infrastructure. Each entry shows the license, a link, what it powers in three.ws, and a "sponsor" link where the project publishes one. All states designed; responsive; accessible. Add it to `data/pages.json` and the footer.
3. **In-surface credits.** Poly Haven on /objects and on each object page; the engine and model name on Forge results and in exported file metadata; the clip source in the animation gallery; meshoptimizer and glTF-Transform in the export dialog's "how this file was made" detail.
4. **A guard.** A test that fails when a new direct dependency lands without a dataset entry, so the page cannot rot.
5. **Docs.** `STRUCTURE.md` row, a short doc on how to add a credit, changelog entry.

## Definition of done

- [ ] The page renders in a real browser at 320, 768 and 1440 pixels, with no console errors, and lists every direct dependency.
- [ ] Poly Haven is credited on /objects; a Forge result names its engine.
- [ ] The guard test fails on an uncredited dependency and passes on main.
- [ ] `npm test` passes; `npm run audit:docs` reports nothing new.
- [ ] `data/pages.json`, `STRUCTURE.md` and changelog entries landed.

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
3. If every line passes, delete this file in that commit (`git rm prompts/finish/086-partners-03-open-source-credits.md`) and append a dated entry to [_context/partners-PROGRESS.md](_context/partners-PROGRESS.md) with the commit SHAs. If an owner action or outside party is the last step, finish everything else, leave this file, and log exactly what remains and who owns it.
4. Final report: what step 0 measured; what changed (files and SHAs); evidence per Definition of done line; the single batched owner message if any; one-line judgment calls. No trailing questions.
