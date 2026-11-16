# microsoft 24: a reproducible media kit for every Microsoft listing (screenshots at each store's sizes, captioned demo video)

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3124.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Five Microsoft listings (Marketplace SaaS offer, Teams Store, Microsoft Store, Edge Add-ons, Visual Studio Marketplace) each require screenshots at specific sizes, and some accept or require a video. Hand-made screenshots go stale the week after they are taken and get rejected when a size is wrong. A script that captures every required asset from the real product, at every required size, means each submission (and each resubmission) has current, correct media in one command.

## Step 0: re-derive the current state

    ls marketing/growth/submissions/programs | grep -i microsoft
    ls marketing/microsoft 2>/dev/null; ls integrations/microsoft
    grep -rn -i "screenshot" integrations/microsoft packages/vscode-3d/package.json marketing/growth/submissions/programs/*microsoft* 2>/dev/null | head -20
    ls scripts | grep -i -E "capture|screenshot|playwright" | head
    which ffmpeg; npx playwright --version

Read each store's current media requirements on Microsoft's docs: Marketplace offer listing (screenshot size 1280x720, up to five; video requirements and thumbnail), Teams Store app submission (screenshot sizes and count), Microsoft Store (desktop screenshot sizes, store logos, trailer rules), Edge Add-ons (screenshots and promotional tiles), Visual Studio Marketplace (README images, icon). Record each requirement with its URL in the manifest.

## Tasks

1. **Capture script** `scripts/capture-microsoft-listing-media.mjs`: Playwright drives the real production site (or a dev server on 3124 pointed at production APIs) through scripted, deterministic scenes: forge a model on the free lane, the viewer with a real result, an agent page, the Teams tab and Adaptive Card render, the connector in use if renderable. Each scene captured at every size each store requires, with retina-quality scaling and no dev UI. Fails if an output dimension does not match its requirement.
2. **Demo video.** The same script records a 60 to 90 second walkthrough (Playwright video or a frame sequence encoded with ffmpeg), with an SRT caption file and burned-in captions variant, and a thumbnail at the required size. The narration text is written to a file for the owner to voice if wanted; no synthetic voice unless the repo already has a TTS lane on GCP.
3. **Output.** Images in `marketing/microsoft/media/<store>/` (committed, optimized with the repo's existing image pipeline); the video uploaded to the existing GCS public bucket with its URL, size and checksum in `marketing/microsoft/media/manifest.json` (video binaries are not committed).
4. **Wire into submissions.** Each Microsoft submission file under `marketing/growth/submissions/programs/` references its exact assets from the manifest.
5. **Docs.** `marketing/microsoft/media/README.md` (how to rerun, each store's requirement with its source URL, when to refresh), `npm run media:microsoft` script entry.

## Definition of done

- [ ] The script runs end to end and produces every required asset; the dimension check passes (output in the report).
- [ ] The video is in GCS and plays from its public URL; the manifest has its checksum.
- [ ] Every Microsoft submission file references its assets; images are optimized (sizes in the report).
- [ ] `npm test` passes; README landed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| ffmpeg missing | Install a static build user-local, or use Playwright's built-in video recording. |
| A scene needs login | Use the QA login row in the self-unblock playbook. |
| Free lane queued during capture | Wait for the real result; never stage a fake one. |
| A store's requirement page is unreachable | Use the size recorded in the existing submission file and mark it unverified in the manifest. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git rm` this file in the closing commit. An owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
