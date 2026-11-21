# insta360 01: a user's own 360 photo becomes the avatar's world (lighting and backdrop)

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `insta360-` order, so it can run in parallel with all of them. Dev port: 3331.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/insta360-00-CONTEXT.md](_context/insta360-00-CONTEXT.md) (contract, independence rules, parallel-run rules, fixture rules, trademark wording). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, deploy) into ONE message at the end. Never contact Insta360 or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

The cheapest, fastest win for anyone with a 360 camera: export one equirectangular photo (Insta360 Studio and the app export 2:1 JPEG up to 72 MP; every other 360 camera does the same) and drop it into three.ws so the avatar stands in that place, lit by it. Today [src/viewer/environment.js](../../src/viewer/environment.js) only loads curated EXR files through `getCubeMapTexture(viewer, environment)`. No model, no worker, no account: pure frontend, works on every device.

## Step 0: re-derive the current state

    sed -n 1,200p src/viewer/environment.js
    grep -rn "getCubeMapTexture\|environment" src/viewer/*.js | grep -v "^src/viewer/environment.js" | head -40
    grep -rn "backdrop\|environment\|skybox" src/splat-viewer.js src/splat-stage.js | head -30
    grep -rn "EXRLoader\|RGBELoader\|HDRLoader\|PMREMGenerator" src --include=*.js | head
    node -e "console.log(require('three/package.json').version)"

Record: which environment presets exist, where the environment picker UI lives, how the PMREM pipeline is built, whether `/splat` has any backdrop control, and the Three.js version (loader names changed across releases: `RGBELoader` vs `HDRLoader`).

## Tasks

1. **Loader** in `src/viewer/environment.js` (extend, do not fork): accept a user `File` or a public https URL of type JPEG, PNG, WebP, AVIF, EXR or Radiance HDR. Equirect only: validate a 2:1 aspect (tolerate 1 px rounding); a non-2:1 image gets a clear message ("This isn't a 360 photo. Export an equirectangular 2:1 image from your camera app.") instead of a stretched sky. LDR images go through `SRGBColorSpace`, `EquirectangularReflectionMapping`, then `PMREMGenerator.fromEquirectangular`. HDR and EXR keep linear data.
2. **Big photos without crashing phones**: a 72 MP JPEG is 11904x5952. Read `renderer.capabilities.maxTextureSize`, decode with `createImageBitmap` (with `resizeWidth`/`resizeHeight` to the largest 2:1 size the GPU allows, capped at 8192x4096 on desktop and 4096x2048 on mobile), and do it off the main thread where the browser supports `OffscreenCanvas`. Measure decode time and peak memory on a real 72 MP file and record both.
3. **Lighting and backdrop as separate switches**: "Use as lighting" (environment intensity slider, rotation slider 0 to 360 degrees so the sun lines up with the avatar) and "Show as background" (background blur slider using `scene.backgroundBlurriness`, background intensity). Ground the avatar: a shadow-catcher plane (`ShadowMaterial`) so the avatar does not float in the sphere, with a height-offset control.
4. **Exposure for LDR sources**: an LDR photo used as an environment map looks flat. Add an optional "brighten highlights" control that applies an inverse-tonemap curve to the decoded LDR texture before PMREM (a small shader pass, values above a threshold expanded), default on, measured before and after on a real Insta360 sunny outdoor photo with a reference sphere.
5. **Where users reach it**: the existing environment picker in the viewer UI gets an "Your 360 photo" entry with file input and drag-and-drop on the canvas. Add the same backdrop control to `/splat` ([src/splat-viewer.js](../../src/splat-viewer.js) or [src/splat-stage.js](../../src/splat-stage.js), whichever owns the scene) so a splat or avatar can sit inside a 360 photo. Persist the last choice per page in `localStorage` (wrapped in try/catch) as a URL only when the source was a URL; a local file is never uploaded by this order.
6. **Embed and URL params**: `?env=<https url>` and the `<agent-3d>` attribute that already selects environments (find it in step 0) accept an https equirect URL, SSRF-irrelevant because the browser fetches it, CORS-dependent: on a CORS failure show "That image's host doesn't allow other sites to use it. Download it and drop the file here instead."
7. **States**: loading skeleton on the canvas overlay with real decode progress (bytes read via the `File` stream), empty state in the picker explaining what a 360 photo is and how to export one from the Insta360 app and Insta360 Studio (nominative wording from the context file), error states above. Hover, active and focus styles on every new control; keyboard reachable; sliders have labels and `aria-valuetext`.
8. **Tests** in `tests/pano-environment.test.js`: aspect validation, size clamping math, URL param parsing, colour-space selection per format. Docs: a section in the viewer docs (find the right file with `grep -rln "environment" docs | head`), the `<agent-3d>` attribute reference, and a changelog entry.

## Definition of done

- [ ] In a real browser on port 3331: a real 2:1 photo from an Insta360 camera (fetch a redistributable sample per the context file's fixture rules) lights the avatar and shows as background; rotation lines the sun up; blur works; shadow catcher grounds the avatar. Screenshots saved under `docs/screenshots/insta360/` only if that directory is gitignored or you delete them before committing.
- [ ] A 72 MP file loads on a simulated mobile viewport (Chrome device emulation with a 4096 texture cap honoured) without a context loss; measured decode ms and memory recorded in the report.
- [ ] A non-2:1 image and a CORS-blocked URL each show their designed message.
- [ ] `/splat` has the same backdrop control and it works with a real `.spz` or `.ply` scene.
- [ ] No console errors or warnings from this code. `npx vitest run tests/pano-environment.test.js` and `npm test` pass. `npm run audit:docs` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No Insta360 sample photo found quickly | Wikimedia Commons category "Equirectangular projection" has CC-licensed 360 photos from many cameras, including Insta360 models (check EXIF `Model`). Use those; record source and license in the report. |
| WebGL in headless Chromium stalls | Use the memory note `play-browser-verify-without-world` approach: a light harness page that mounts only the viewer. Playwright libs missing: memory `playwright-system-libs-lost-on-restart`. |
| `OffscreenCanvas` unavailable in a browser | Fall back to main-thread `createImageBitmap` with resize options; still never upload a texture larger than `maxTextureSize`. |

## Close out (required)

1. Verify every Definition of done line with the command output or browser evidence in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/insta360-PROGRESS.md](_context/insta360-PROGRESS.md) with the measured decode time.
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured numbers; the one batched owner message; one-line judgment calls. No trailing questions.
