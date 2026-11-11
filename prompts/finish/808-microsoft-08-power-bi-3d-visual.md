# microsoft 08: a Power BI custom visual that renders 3D models bound to report data

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3108.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Power BI reports are where enterprises look at their products, inventory and facilities, and they have no good way to show a 3D model of the thing behind the numbers. A certified custom visual on AppSource puts three.ws inside every Power BI tenant: a column of GLB URLs (or three.ws model ids) becomes an interactive 3D view, coloured or scaled by a measure, cross-filtering with the rest of the report. The distribution plan marked this "plausible but niche"; it is also a surface no other 3D agent platform occupies, and it costs one focused session.

## Step 0: re-derive the current state

    ls integrations/microsoft
    grep -rn -i "pbiviz\|powerbi" package.json integrations docs | head
    sed -n 1,40p docs/embedding.md

Read the current Power BI custom visuals docs on learn.microsoft.com: `powerbi-visuals-tools` (pbiviz CLI), `capabilities.json` data roles and the `WebAccess` privilege, the selection and tooltip APIs, rendering events, the guidelines for certified visuals (no external calls except declared ones, no eval) and `powerbi-visuals-utils-testutils` for unit tests. Verify each package's LICENSE.

## Tasks

1. **Project.** `integrations/microsoft/power-bi-visual/` created with the pbiviz tooling at its current version: TypeScript, three.js bundled locally (no CDN), meshopt and Draco decoders bundled so production three.ws GLBs load.
2. **Data roles.** Category (label), Model (GLB URL or three.ws model id, resolved to the public GLB URL through the documented three.ws API), optional measures for colour and scale, optional tooltip fields. Declare `WebAccess` only for `https://three.ws` and the asset CDN host it actually uses.
3. **Behaviour.** One row renders a single model; many rows render a grid or a turntable gallery. Clicking a model selects that row through the selection manager (cross-filters the report); report selections highlight models. Formatting pane: background, lighting preset, auto-rotate, colour mode. Rendering events (`renderingStarted`, `renderingFinished`, `renderingFailed`) are reported correctly. Landing page when no data is bound explains what to drag where.
4. **Quality bar.** Meets the certified-visual requirements you read in step 0 (list them in the README with how each is met). Handles high-DPI, resize, and a model that fails to load (per-tile error, not a broken visual).
5. **Packaging and submission.** `pbiviz package` produces the `.pbiviz`. A sample `.pbix` cannot be authored without Power BI Desktop, so write the exact build steps for the owner instead. AppSource submission notes in `marketing/growth/submissions/programs/microsoft-power-bi-visual.md`.
6. **Docs.** README in the visual folder, a section in docs/microsoft.md "Built for Microsoft surfaces", STRUCTURE.md row, changelog entry.

## Definition of done

- [ ] `pbiviz package` succeeds and the `.pbiviz` path is in the report.
- [ ] Unit tests with `powerbi-visuals-utils-testutils` cover data-role mapping, selection, the landing page and the per-tile error path, and pass.
- [ ] The visual's compiled bundle loads real production GLBs by URL and by model id in the testutils host; screenshot in the report.
- [ ] The README lists every certification requirement and how it is met; docs, STRUCTURE.md, changelog landed; `npm test` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No Power BI account to load the visual | Verify with pbiviz and testutils, write the developer-mode steps, put "load the .pbiviz in Power BI Service developer mode" in the owner message. |
| pbiviz needs a newer Node than the repo | Run it through `npx` with the required Node via the version manager already on the machine, inside the visual folder only. |
| Model ids need an API that does not exist | Use the existing public model or creation lookup; if none returns the GLB URL publicly, accept URLs only and say so in the README. |
| Microsoft docs changed since 2026-11-11 | Build to what the page says today and cite its URL. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git rm` this file in the closing commit. An owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
