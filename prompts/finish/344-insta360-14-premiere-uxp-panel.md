# insta360 14: a Premiere Pro UXP panel that sends 360 clips to three.ws and brings the 3D back to the timeline

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `insta360-` order, so it can run in parallel with all of them. No dev server.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/insta360-00-CONTEXT.md](_context/insta360-00-CONTEXT.md) (you own the new `integrations/premiere-uxp/`; you call C4 endpoints over HTTP). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Submitting to the Adobe Exchange or Creative Cloud marketplace is an owner step owned by order 347 (prepare the package and listing). Never contact Adobe or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Insta360 Studio exports straight into Premiere Pro workflows, and Premiere is where 360 editors live. The research doc found UXP generally available in Premiere Pro 25.6 with CEP being retired, so a new panel must be UXP. The return path is concrete: the splat lane's `preview.mp4` flythrough (rendered server-side by `splat_train`) imports as a clip, and the PLY, SPZ and GLB land in the project bin for After Effects (24.1+ imports GLB) or other tools.

## Step 0: re-derive the current state

    ls integrations/ | head -40
    sed -n 1,80p integrations/README.md
    grep -rln "uxp\|UXP" integrations docs | head

Read Adobe's current Premiere Pro UXP documentation (developer.adobe.com/premiere-pro/uxp/): manifest v5 fields, the `premierepro` module API for the project, bins, importing files and reading the selected clip's media path, network permissions (`requiredPermissions.network.domains`), local file access (`localFileSystem`), and the UXP Developer Tool workflow. Record the API version you target and the minimum Premiere version.

## Tasks

1. **Package** `integrations/premiere-uxp/`: `manifest.json` (manifest v5, host `premierepro` at the minimum version you recorded, network domains limited to `three.ws` and the R2 and GCS hosts your uploads and downloads hit, `localFileSystem: "request"` or the narrowest that works), `index.html`, `src/` (plain JS modules, no framework unless UXP needs a bundler for it; if you add a build, add a `package.json` local to this directory, never the root's), Spectrum UXP widgets for native look, light and dark theme support.
2. **Auth**: an API key field stored with UXP secure storage (`require("uxp").storage.secureStorage`) and a "Get an API key" link to the real three.ws page that issues keys (find it: `grep -rln "api key\|api-keys" pages | head`).
3. **Send**: "Send selected clip" reads the selected project item's media file path (or lets the user pick a file), detects 360 (`.insv`, `.insp` or a 2:1 video by reading metadata through the Premiere API where possible), offers quality and uses the clip's in and out points as `trim`. Upload with C4 multipart (4 parallel parts, retry, resume state in plugin data folder), then POST `/api/pano-capture`. Progress from polling with a real progress bar and stage labels; cancel.
4. **Return**: when finished, download `preview.mp4`, `poster.jpg`, `scene.ply` and `scene.spz` into a folder next to the project file (`<project>_three.ws/<job_id>/`), import them into a bin named `three.ws captures`, and offer "Insert preview on timeline at playhead". Show the `viewer_url` as a link. Also support a single 360 photo to the `pano-scene` lane, returning the GLB into the bin.
5. **Your captures** list from `GET ?mine=1` with import buttons.
6. **States**: designed empty, loading, error (each C4 error code with its visitor message; no operator hints), offline. Keyboard focus visible. Copy with nominative Insta360 wording.
7. **Tests**: plain Node tests (`node --test` in this directory) for the client logic (part planning, resume, polling, error mapping) against a local HTTP server speaking C4; pure functions separated from UXP host calls so they run outside Premiere.
8. **Package and verify**: build a `.ccx` with the UXP Developer Tool CLI (`@adobe/uxp-devtools-cli`, check its current name and license on npm) into a gitignored path; validate the manifest with the tool. If Premiere Pro is not installed on this machine (it will not be: Linux), state that load-testing inside Premiere is not verifiable here and make it the first owner check in 347's message, with exact steps (UXP Developer Tool, Add Plugin, Load, test file).
9. **Docs**: `integrations/premiere-uxp/README.md` (install, use, permissions explained, troubleshooting), a row in [integrations/README.md](../../integrations/README.md) (anchored edit), listing text for the Adobe marketplace with screenshots placeholders replaced by a list of the screenshots the owner must capture in Premiere, changelog entry, `STRUCTURE.md` row (hot file, anchored edit, last).

## Definition of done

- [ ] `integrations/premiere-uxp/` with manifest v5, UI, client, tests passing (`node --test`), README.
- [ ] `.ccx` built and manifest validated; SHA-256 recorded.
- [ ] Client logic proven against the real C4 endpoints on a local dev server if 338 and 339 exist on disk, else against a C4-speaking local server, with the honest note.
- [ ] Listing text and the owner's in-Premiere check steps ready. `npm test` and `npm run audit:docs` pass.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Premiere not installable on Linux | Expected. Build, validate, test logic; the in-host check is the owner's first step in 347's message. |
| UXP API for reading a clip's media path differs from the docs | Use the file picker path as the primary flow and the selection as a convenience when available. |
| Devtools CLI unavailable or changed | Package the `.ccx` per Adobe's documented zip layout and validate the manifest against its JSON schema. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. In-host verification and submission are the owner's: leave this file in `finish/` with a dated status line naming both. Append to [_context/insta360-PROGRESS.md](_context/insta360-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
