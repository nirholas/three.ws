# nvidia 15: a three.ws extension for NVIDIA Omniverse Kit apps: generate and import 3D models inside the stage

Status 2026-11-16: extension, panel, import, library, tests, owner pack (PUBLISHING.md, docs/omniverse-extension.md, media, preview image), STRUCTURE row and changelog committed. Measured on an NVIDIA L4: 62 tests OK with 0 Kit log errors, live image to 3D imported in 78.5 s; `scripts/gce_gpu_run.sh` verified end to end (62 OK); headless 63 OK; `npm run audit:docs` has no finding in this order's files. Not archived: full `npm test` (36 failures in 18 files) and `npm run audit:docs` (8 findings) fail only in other orders' files. Waiting on the owner: git push, deploy:gcp:full (three-ws-api, enables the live text to 3D test), Exchange submission, GitHub topic.

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `nvidia-` order, so it can run in parallel with all of them. Dev port: 3265.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/nvidia-00-CONTEXT.md](_context/nvidia-00-CONTEXT.md) (facts, the technology-claim rule, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, `three-ws-api` deploy, Inception portal edits, NVIDIA submissions, forum or social posts) into ONE message at the end. Never contact NVIDIA or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Omniverse is NVIDIA's 3D platform, and its extensions are how third parties show up inside it (USD Composer and every Kit-based app). An extension that turns a prompt or an image into a model placed in the open stage is the most natural Omniverse integration three.ws can offer, and it is the artifact the Omniverse Exchange path needs. It talks to the public three.ws API, so it stands alone.

## Step 0: re-derive the current state

    ls integrations integrations/nvidia 2>/dev/null
    grep -n "forge\|/api/v1" docs/3d-api.md | head -30
    grep -rn "omniverse" docs/nvidia-visibility-map.md | head

Read NVIDIA's current Kit extension docs (kit-app-template, `extension.toml`, omni.ui, async patterns, the asset converter, omni.kit.test) and the current Omniverse Exchange and extension registry publishing requirements.

## Tasks

1. **Extension** `integrations/nvidia/omniverse-kit-extension/` (`threews.forge`): a panel with prompt or image input, quality lane, generate, real progress, cancel, and import of the result into the stage at the cursor or origin (GLB through the Kit asset converter, or USD when the API serves it), plus a browser of the user's own models.
2. **Auth**: a three.ws API key stored in Kit settings, never logged; clear errors for missing, invalid or out-of-credit keys.
3. **Quality**: async without blocking the UI, retries on network errors, correct units and up-axis on import.
4. **Tests** with omni.kit.test, run headless in a Kit environment on a GCE GPU VM, including a real generation and import.
5. **Packaging**: README with screenshots and a short screen capture, LICENSE, icons and preview images per the registry spec, and the `omniverse-kit-extension` GitHub topic noted for the owner if it moves to its own repo.
6. **Owner pack**: Exchange publishing steps and field values in `integrations/nvidia/omniverse-kit-extension/PUBLISHING.md`; docs page `docs/omniverse-extension.md`; changelog entry.

## Definition of done

- [ ] Headless Kit tests pass with a real generation imported into a stage (output and screenshot).
- [ ] The extension loads in a Kit app with no errors in the Kit log.
- [ ] Docs and publishing pack landed; `npm run audit:docs` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No RTX GPU locally | Use a GCE VM with an RTX-class or L4 GPU (pre-approved GCP) and Kit headless. |
| Exchange intake is early access | Package to spec and put the request in the owner message. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/nvidia-PROGRESS.md](_context/nvidia-PROGRESS.md), including the measured number this order produced.
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message; one-line judgment calls. No trailing questions.
