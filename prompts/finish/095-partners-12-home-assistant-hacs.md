# partners 12: Get the Home Assistant integration into the HACS default store

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

[`home-assistant-integration/`](../../home-assistant-integration/) already holds a working custom integration with a `hacs.json`, a config flow and a manifest. HACS is how most Home Assistant users install custom integrations, and its default store lists a repository after a pull request to `hacs/default`, provided the repository passes HACS validation and hassfest in its own CI and has a brand icon in `home-assistant/brands`. The manifest points its issue tracker at a separate `three-ws-home-assistant` repository, so the integration needs a publishable standalone repository.

## Step 0: re-derive the current state

    cat home-assistant-integration/hacs.json
    cat home-assistant-integration/custom_components/three_ws/manifest.json
    ls home-assistant-integration/custom_components/three_ws
    gh repo view nirholas/three-ws-home-assistant --json name,url 2>&1 | head -3

Read the HACS publishing requirements (integration layout, `hacs.json`, releases, brands) and the `hacs/default` pull request rules on the day you run this.

## Tasks

1. **Validate locally.** Run hassfest and the HACS action's checks against the integration with docker (the same container images their GitHub Actions use), and fix every finding.
2. **Manifest and metadata.** Correct `documentation`, `issue_tracker`, `codeowners` and `version`; make the `hacs.json` minimum Home Assistant version match what the code needs; add translations for the config flow.
3. **Brand icon.** Produce `icon.png` and `icon@2x.png` (and dark variants) at the sizes `home-assistant/brands` requires, and write its pull request text.
4. **A standalone repository export.** `scripts/export-hacs-repo.mjs` produces the exact tree the standalone repository needs (integration, README, LICENSE, `hacs.json`, and the two validation workflows that repository will run in its own CI). This repository does not use GitHub Actions, so those workflow files live only in the exported tree and the owner decides whether the standalone repository runs them.
5. **Submission text** for `hacs/default` and `home-assistant/brands` in `marketing/growth/submissions/home-assistant.md`, for owner order 938.
6. **Docs.** Update `home-assistant-integration/README.md` and the home docs page; changelog entry if anything user-visible changed.

## Definition of done

- [ ] hassfest and HACS validation pass locally against the exported tree (output in the report).
- [ ] The integration installs into a local Home Assistant container through its config flow and receives a real event.
- [ ] Brand icons exist at the required sizes.
- [ ] `npm test` passes; `npm run audit:docs` reports nothing new.
- [ ] The export script, submission text and docs landed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Missing credential or env var | Follow the credential row of the CLAUDE.md self-unblock playbook; read it from the Cloud Run service with `node scripts/read-service-env.mjs`. If it exists nowhere, ship the feature wired behind the env var, prove it with a real call that the vendor answers (a documented auth error from their live API counts), and list the one missing variable in the owner message. |
| A partner's docs or intake changed since 2026-10-09 | Build to what the page says today, and fix the row in [docs/partners/prospects.md](../../docs/partners/prospects.md) in the same commit. |
| Upstream repo moved or changed license | Re-read the LICENSE file; if it is no longer permissive, switch to reference-only and build our own. |
| A step needs a third-party account only the owner can create | Build and verify everything up to that step, write the exact sign-up and submission steps into the order's submission file, and put them in the owner message. |
| HACS needs CI in the standalone repository | The workflow files ship only inside the exported tree; creating that repository and turning them on is the owner's call in order 938. |

## Close out (required)

1. Verify every Definition of done line with the actual command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths and a subject that describes the diff (`type(scope): what changed and why a reader cares`).
3. If every line passes, delete this file in that commit (`git rm prompts/finish/095-partners-12-home-assistant-hacs.md`) and append a dated entry to [_context/partners-PROGRESS.md](_context/partners-PROGRESS.md) with the commit SHAs. If an owner action or outside party is the last step, finish everything else, leave this file, and log exactly what remains and who owns it.
4. Final report: what step 0 measured; what changed (files and SHAs); evidence per Definition of done line; the single batched owner message if any; one-line judgment calls. No trailing questions.
