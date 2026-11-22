# insta360 13: the three.ws Blender extension sends 360 footage to the splat lane and imports the result

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `insta360-` order, so it can run in parallel with all of them. No dev server.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/insta360-00-CONTEXT.md](_context/insta360-00-CONTEXT.md) (you own [integrations/blender/](../../integrations/blender); you call C4 endpoints over HTTP). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Submitting the new version to extensions.blender.org is an owner step owned by order 347 (prepare the package and the listing text). Never contact Blender or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Blender is where 360 shooters who do VFX and archviz already work. A panel that sends a 360 clip to three.ws and drops the finished splat (or the depth shell GLB) into the scene, correctly scaled and oriented, turns three.ws into part of their pipeline. Splat rendering in Blender is solved by the KIRI Engine 3DGS Render add-on (Apache-2.0, per the research doc); we import PLY that it reads and point users at it, we do not vendor it.

## Step 0: re-derive the current state

    cat integrations/blender/README.md integrations/blender/SUBMITTING.md
    cat integrations/blender/three_ws/blender_manifest.toml
    sed -n 1,200p integrations/blender/three_ws/__init__.py
    sed -n 1,200p integrations/blender/three_ws/three_ws_client.py
    ls integrations/_pyclient; which blender; blender --version 2>&1 | head -2

Record the extension's auth model (API key in preferences or OAuth), how it honours `bpy.app.online_access`, existing operators and panels, and its version. Read the KIRI 3DGS Render add-on's README and LICENSE on GitHub; record its version and which PLY layout it reads.

## Tasks

1. **Client**: add the C4 calls to `three_ws_client.py` (create, sign, part upload, complete, `pano-capture` POST, GET by job, GET mine, `pano-scene` POST and GET), standard library only (`urllib`, `concurrent.futures`) because Blender extensions cannot rely on pip installs unless wheels are bundled. Multipart upload with 4 parallel parts, retries, and resume state stored in the add-on preferences directory. Every network call is skipped with a clear message when `bpy.app.online_access` is off.
2. **Panel** "360 Capture" in the 3D viewport sidebar (N panel): pick a file (`.insv`, `.insp`, 2:1 mp4 or mov, 2:1 jpg), quality, trim (in and out seconds), Send. Uploads and polling run on a background thread with `bpy.app.timers` driving UI updates (never block Blender's main thread; never touch `bpy.data` from the worker thread). Progress bar from the real `stage` and `progress`, cancel button (`DELETE`). A list of "Your captures" from `GET ?mine=1` with import buttons.
3. **Import**: download `scene.ply` (splat) to the blend file's directory (or a temp dir if unsaved, with a warning to save), and if the KIRI 3DGS Render add-on is enabled, import through its operator (check its operator idnames on the day); otherwise import as a point cloud mesh with colours via a minimal PLY reader of your own and show "Install the KIRI 3DGS Render add-on to see the splat rendered." with a link. GLB results (`pano-scene`) import with Blender's glTF importer. Orientation: +Y up in three.ws to +Z up in Blender handled explicitly; scale in metres. Also import `preview.mp4` as a video strip in the sequencer on request.
4. **Manifest**: bump the version, add permissions the manifest schema requires for network and files with honest reasons, keep Blender 4.2+ compatibility; `blender --command extension validate` passes.
5. **Tests**: unit tests for the client (run with plain `python -m pytest` outside Blender, against a local HTTP server speaking C4) and a headless Blender test script (`blender -b --python-expr` or `--python`) that installs the built extension, runs the import on a real PLY and a real GLB, and asserts object counts and bounding boxes. If Blender is not on this machine, download the official Blender 4.2 LTS Linux build into the scratchpad and run it headless.
6. **Live**: with a real three.ws API key (self-unblock playbook credentials row), run the panel's client path against production for the parts that exist there today (sign-in, listing), and against the C4 endpoints on a local dev server (port 3343) if 338 and 339 exist on disk. Record what ran where.
7. **Docs and listing**: README section, `SUBMITTING.md` updated with the new version's changes, a ready-to-paste listing changelog for extensions.blender.org (nominative Insta360 wording), changelog entry. Build the extension zip with `blender --command extension build` into a gitignored path and record its SHA-256.

## Definition of done

- [ ] Panel, client and import work in headless Blender against real files; `extension validate` passes; tests pass.
- [ ] Network calls respect `bpy.app.online_access`; UI never blocks the main thread (verified by a timer-driven test).
- [ ] Built zip SHA-256 and listing text ready for the owner.
- [ ] `npm test` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| KIRI add-on operator names changed | Read its current source; fall back to the point-cloud import if it cannot be called safely. |
| C4 endpoints not on disk yet | Contract-speaking local server for tests; 347 runs it against production. |
| No Blender on the machine | Official LTS tarball into the scratchpad, headless. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. The listing submission is the owner's: leave this file in `finish/` with a dated status line ("extension <version> built, SHA <sha>; submission waits on 347"). Append to [_context/insta360-PROGRESS.md](_context/insta360-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.

Status 2026-11-22: extension 1.1.0 rebuilt after the 347 client timeout fix, SHA d62a5f9dfe99dea857ee8100bb5dd4186498f7e1a679718c6ea06f8a30cc70cb (44,440 bytes); submission is an owner step in the 347 owner message.
