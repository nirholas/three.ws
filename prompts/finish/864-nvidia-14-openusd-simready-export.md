# nvidia 14: every Forge model exports as validated OpenUSD with physics, semantics and skeletons, ready for NVIDIA Omniverse and Isaac Sim

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `nvidia-` order, so it can run in parallel with all of them. Dev port: 3264.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/nvidia-00-CONTEXT.md](_context/nvidia-00-CONTEXT.md) (facts, the technology-claim rule, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, `three-ws-api` deploy, Inception portal edits, NVIDIA submissions, forum or social posts) into ONE message at the end. Never contact NVIDIA or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

OpenUSD is the format NVIDIA's whole 3D and simulation ecosystem (Omniverse, Isaac Sim, SimReady) runs on, and the visibility map records Omniverse interop as "roadmap, not shipping", which blocks the Omniverse surfaces. three.ws already exports USDZ for AR ([src/usdz-pipeline.js](../../src/usdz-pipeline.js)) and imports SimReady assets, but not simulation-grade USD out. Validated USD with collision, mass and semantic labels lets any generated model drop into a robotics or digital-twin scene, which is new and very on-message for NVIDIA.

## Step 0: re-derive the current state

    grep -n "usdz\|'fbx'\|'3mf'" src/forge-export.js | head -20
    sed -n 1,60p src/usdz-pipeline.js
    sed -n 1,40p docs/simready-assets.md; sed -n 1,40p scripts/simready-to-glb.py

Read the current SimReady asset specification, OpenUSD schemas (UsdGeom, UsdShade with UsdPreviewSurface, UsdPhysics, UsdSkel, Semantics), and NVIDIA's open-source asset validator.

## Tasks

1. **USD exporter** (a server-side worker or job with `usd-core`, or a client path if faithful): meshes, normals, UVs, UsdPreviewSurface materials with textures, `metersPerUnit`, `upAxis`, default prim, kind and asset info; `.usd`, `.usda` and `.usdz` outputs.
2. **Physics**: convex decomposition with an open-source tool (CoACD or V-HACD) into UsdPhysics collision, rigid body, mass from volume and a material density chosen from the prompt category, with the method recorded in the asset metadata.
3. **Semantics**: class labels from the prompt and category; **skeletons**: UsdSkel with bindings and animations for rigged avatars.
4. **Validation**: run `usdchecker` and NVIDIA's asset validator on every export in tests and in the pipeline; fix every error; warnings recorded.
5. **Product**: "OpenUSD (simulation-ready)" in the Forge export menu, an API route, and an MCP tool, with progress and error states. Open an export in a USD viewer (usdview or a web USD viewer) for screenshots.
6. **Docs** `docs/openusd-export.md`, update the visibility map's Omniverse row from roadmap to shipped only once deployed (anchored edit), changelog entry.

## Definition of done

- [ ] Ten real Forge models (props and a rigged avatar) export and pass both validators (output in the report).
- [ ] Physics loads: a test scene drops an exported prop and it collides and settles (usd-core physics check or Isaac Sim if available on a GCE GPU VM).
- [ ] UI, API and MCP paths verified; `npm test` and `npm run audit:docs` pass.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Isaac Sim needs an RTX GPU | Run it headless on a GCE RTX-class VM; if unavailable, validate physics with usd-core and PhysX-backed checks and say so. |
| Material fidelity differs from glTF | Document the mapping and measure render difference on a few assets. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/nvidia-PROGRESS.md](_context/nvidia-PROGRESS.md), including the measured number this order produced.
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message; one-line judgment calls. No trailing questions.
