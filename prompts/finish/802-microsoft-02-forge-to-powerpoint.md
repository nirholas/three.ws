# microsoft 02: Forge to PowerPoint, an interactive 3D slide in one click, plus a PowerPoint add-in

Status 2026-11-11: built, committed and verified locally (see the 802 entry in [microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md)). Kept open for owner steps: open an exported deck in PowerPoint and rotate the model, sideload the add-in, push, deploy, then the AppSource submission.

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3102.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

PowerPoint in Microsoft 365 plays interactive glTF/GLB 3D models: the audience can rotate them in a slideshow, they work with Morph transitions, and animated models play. Hundreds of millions of people present in PowerPoint. Today a three.ws user who wants their model in a deck must download a GLB, discover that a compressed or KTX2-textured file fails to insert, and fiddle. A "PowerPoint" export that hands back a ready slide with the model already embedded is the most natural Microsoft workflow three.ws can own, and it demos beautifully.

## Step 0: re-derive the current state

    grep -rn -i "pptx\|powerpoint" src api packages --include=*.js | head
    grep -rn -i "export" src/forge*.js | grep -i -E "glb|usdz|fbx|download" | head -20
    ls packages/glb-tools packages/glb-tools/src 2>/dev/null
    node -e "const p=require('./package.json');console.log(Object.keys({...p.dependencies,...p.devDependencies}).filter(k=>/zip|gltf-transform|pptx/i.test(k)))"

Read the [MS-ODRAWXML] 3D model section on learn.microsoft.com (`am3d:model3d`, namespace `http://schemas.microsoft.com/office/drawing/2017/model3d`) and the `mc:AlternateContent` fallback rules. Read Microsoft's support page on inserting 3D models in Office for the supported formats and the features PowerPoint does not read (record exactly what you find in the doc you write).

## Tasks

1. **Office-safe GLB pass.** A function (in `packages/glb-tools` or `api/_lib/`, wherever export transforms already live) that turns any three.ws GLB into one PowerPoint accepts: decode meshopt and Draco, convert KTX2 or WebP textures to PNG/JPEG, keep skinning and animation, cap texture size per Microsoft's stated limits, and keep a sane file size. Use glTF Transform (MIT) if it is already a dependency, otherwise add it after checking the license. Test it on real production models of each kind (static prop, rigged avatar, animated).
2. **PPTX writer.** Build a minimal, spec-correct OOXML writer that produces a one-slide (or N-slide) `.pptx`: title, the embedded GLB as an `am3d:model3d` graphic frame with a sensible camera, and the required fallback PNG poster (render it with the existing thumbnail or poster path). Content types and relationships must be exact. No proprietary library; JSZip or the zip lib already in the repo.
3. **Endpoint and buttons.** `GET /api/forge/export-pptx?id=<creation>` (or the existing export router's pattern) streams the file with a good filename. Add a "PowerPoint" item to the Forge export menu and the model page's download menu, with a loading state and an actionable error state.
4. **PowerPoint add-in.** `integrations/microsoft/office-addin/`: a task pane add-in (unified JSON manifest, or XML manifest if PowerPoint requires it for this feature) that signs in with the existing three.ws OAuth, lists the user's models, can generate a new one with the free lane, and inserts the slide with `PowerPoint.run(ctx => ctx.presentation.insertSlidesFromBase64(...))`. Validate with `npx office-addin-manifest validate` (MIT). The task pane page is served by three.ws with a CSP that allows Office hosts as frame ancestors.
5. **Docs.** `docs/powerpoint.md` (what it does, limits found in step 0, how to sideload the add-in), link from docs/microsoft.md "Built for Microsoft surfaces", README in the add-in folder, `STRUCTURE.md` row, changelog entry, submission notes for AppSource in `marketing/growth/submissions/programs/microsoft-powerpoint-addin.md` (owner submits).

## Definition of done

- [ ] Unit tests prove the pptx zip has every required part, content type and relationship, and that the Office-safe pass strips meshopt, Draco and KTX2 while keeping animation.
- [ ] A pptx exported from a real production creation opens without repair in LibreOffice Impress (showing the fallback poster) and loads in `python-pptx` with the 3D graphic frame present; attach the output path in the report.
- [ ] The Forge and model-page buttons work end to end in a browser on port 3102 with real models; no console errors.
- [ ] `npx office-addin-manifest validate` passes on the add-in manifest.
- [ ] Docs, STRUCTURE.md, changelog and the AppSource submission file landed; `npm test` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No PowerPoint available to test the 3D frame | Validate against the spec and LibreOffice/python-pptx, then put "open the exported file in PowerPoint for the web and rotate the model" in the owner message with the file path. |
| A spec detail is ambiguous | Pick the reading Microsoft's own sample in the spec uses, note it in docs/powerpoint.md. |
| Missing credential or env var | `node scripts/read-service-env.mjs`; if absent everywhere, wire behind the variable and name it in the owner message. |
| Microsoft docs changed since 2026-11-11 | Build to what the page says today and cite its URL. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git rm` this file in the closing commit. An owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message (PowerPoint check, AppSource submission, deploy); one-line judgment calls. No trailing questions.
