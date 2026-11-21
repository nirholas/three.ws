# insta360 10: `/capture` 360 mode: raw-file preview, trim, resumable upload, progress and the finished splat

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `insta360-` order, so it can run in parallel with all of them. Dev port: 3340.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/insta360-00-CONTEXT.md](_context/insta360-00-CONTEXT.md) (you own the `/capture` 360 mode and the browser multipart uploader; you call C4 endpoints over HTTP). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, deploy) into ONE message at the end.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

This is the page an Insta360 owner actually uses: drop the raw `.insv` from the card (or a stitched export, or any 360 camera's equirect video), see it play as 360 right in the browser before a single byte is uploaded, trim to the walkaround, and walk away while it uploads and trains. The research doc found GyroView (MIT, npm) stitches `.insv` live in the browser with WebGL2 and hardware HEVC decode: that gives an instant preview with zero server cost.

## Step 0: re-derive the current state

    sed -n 1,200p pages/capture.html
    sed -n 1,200p src/scene-capture.js
    ls api/capture-upload api/pano-capture.js 2>&1
    npm view gyroview version license repository.url 2>&1 | head
    grep -n "\"/capture\"" vercel.json; grep -n "capture" vite.config.js

Record the current capture flow and states, whether 338 and 339 endpoints exist on disk, and GyroView's current version, license and API (read its README and source; check whether it decodes `.insv` two-track and split pairs, and what it needs from the browser).

## Tasks

1. **Mode switch** on `/capture`: "Standard video" (today's flow, unchanged) and "360 video" tabs, keyboard accessible. Auto-select 360 when the dropped file is `.insv`, `.insp`, `.lrv` or a 2:1 video (read dimensions from a `<video>` element's metadata for mp4 and mov).
2. **Instant preview**: for 2:1 equirect video, a lightweight Three.js inverted-sphere player with drag, scroll zoom and gyro on phones. For `.insv`, GyroView (pinned, lazy-loaded only on this mode) for the live stitched preview; for split pairs, ask for the matching `_10_` file and pair by name. When GyroView or hardware HEVC is unavailable (feature-detect `VideoDecoder.isConfigSupported` for HEVC), show "Preview isn't available in this browser. Your file will still work; we stitch it on our servers." and continue: the server stitches (C1 `pano_stitch`). Never block the upload on preview.
3. **Trim**: a timeline with in and out handles, thumbnails sampled from the preview, keyboard nudge, and guidance ("Best results: 30 s to 3 min walking slowly, camera on a stick above your head"). Trim is sent as `trim` (C4), not cut in the browser.
4. **Quality**: Preview, Standard, High (contract C1 presets) with honest time estimates derived from the trimmed duration (use the measured numbers in the progress log if present; otherwise label them as estimates and keep them conservative).
5. **Resumable uploader** `src/multipart-upload.js`: create, sign in batches, upload parts with 4 parallel PUTs and a per-part retry with exponential backoff, read `ETag` from each response, complete, abort on cancel. Persist `{ upload_id, key, file name, size, lastModified, finished parts }` in IndexedDB (wrapped in try/catch) so reopening the page with the same file offers "Resume upload" and sends only missing parts (call `sign` for those only). Real progress from `XMLHttpRequest.upload.onprogress` per part, aggregated; speed and time remaining. Wake lock while uploading where supported; warn on `beforeunload` while uploading.
6. **Job**: after `complete`, POST `/api/pano-capture` with the `source_url`, `source_kind` (`insv`, `insp`, `equirect_video`, `equirect_images` for multiple 2:1 photos), `trim` and `quality`. Then a staged progress view (Upload, Stitch for raw, Frames, Camera solve, Training, Export) driven by real `stage` and `progress` from polling `GET ?job=` every 5 s with backoff when hidden (Page Visibility). Tell the user they can close the tab and find it in "Your captures".
7. **Result**: inline splat viewer from `viewer_url` (embed the existing splat viewer component), the preview MP4 with a share button (Web Share API with the file or link; copy-link fallback), downloads for PLY and SPZ, "Open in /splat", and "Use as a world" if a route exists to make a scene a place on three.ws (find it: `grep -rln "world\|place" pages | head`; if none, skip the button).
8. **Your captures**: a list on `/capture` from `GET /api/pano-capture?mine=1` with poster, status, time, open, retry (on failure) and delete (with an in-page confirmation, not `confirm()`).
9. **States**: designed empty, loading (skeletons), error states for every C4 error code (`unconfigured` without operator hints, `too_few_registered` with capture tips, file too large, signed out with sign-in link, network loss with auto-resume). Hover, active, focus, keyboard. 400 px layout.
10. **Tests** `tests/multipart-upload.test.js` and `tests/capture-360.test.js`: part planning, retry and resume logic against a local HTTP server speaking C4 (allowed by the context file), source-kind detection, trim serialisation. Browser proof below.
11. Docs: capture docs section for 360, changelog entry.

## Definition of done

- [ ] In a real browser on port 3340: a real `.insv` previews (in a browser with HEVC decode) or shows the designed fallback; a real 2:1 mp4 previews in the sphere player; trim works.
- [ ] A real 1 GB or larger file uploads through the real C4 endpoints if 338 exists on disk (otherwise through a C4-speaking local server against the real R2 bucket using the repo's R2 helper), with a reload mid-upload and a successful resume. Evidence in the report.
- [ ] Job creation and progress UI work against the real `/api/pano-capture` if 339 exists on disk, else against a C4-speaking local server; the result view renders a real SPZ or PLY.
- [ ] No console errors or warnings from this code. Tests, `npm test` and `npm run audit:docs` pass.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| GyroView cannot read a model's files | Fallback message path; list the models it handles in the docs. |
| Headless Chromium lacks HEVC | Expected; verify the fallback there, and verify the GyroView path in a headed Chrome with hardware decode if available, or state it was not verifiable on this machine. |
| 338 or 339 not built yet | Contract-speaking local servers for the missing side; 347 runs the real chain. |

## Close out (required)

1. Verify every Definition of done line with the command output or browser evidence in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/insta360-PROGRESS.md](_context/insta360-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
