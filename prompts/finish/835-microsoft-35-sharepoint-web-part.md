# microsoft 35: a SharePoint Framework web part and Viva Connections card that put three.ws agents and 3D models on company intranets

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3135.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

SharePoint is where most Microsoft 365 companies run their intranet, and Viva Connections is the intranet dashboard inside Teams. "Embed a 3D agent on your intranet" is the first professional service offer in the plan, but there is no SharePoint component to deliver it. A SharePoint Framework (SPFx) solution lets a site owner drop a three.ws agent or 3D model onto any modern page from the toolbox, and it can be listed in the Microsoft 365 store (AppSource) as its own offer.

## Step 0: re-derive the current state

    ls integrations/microsoft
    ls src | grep -i -E "agent-3d|element|embed" | head; grep -rn "customElements.define('agent-3d'" src | head -3
    curl -sI https://three.ws/agent-3d.js | head -5; grep -rn "agent-3d" docs/embed*.md 2>/dev/null | head -5
    grep -rn "frame-ancestors\|X-Frame-Options" server/index.mjs api/_lib/http.js vercel.json | head

Read the current SPFx docs: supported SPFx version and its required Node version, the web part and Adaptive Card Extension (ACE) templates, the property pane, CDN and `includeClientSideAssets`, domain isolation, tenant-wide deployment, and the AppSource requirements for SPFx solutions. Check how `<agent-3d>` loads (script URL, CSP needs) so SharePoint's CSP Trusted Script Sources setting can allow it.

## Tasks

1. **SPFx solution** in `integrations/microsoft/sharepoint-spfx/` on the current SPFx version: a "three.ws Agent" web part rendering a live `<agent-3d>` for a chosen agent, and a "three.ws 3D Model" web part rendering a Forge model or any GLB URL with the three.ws viewer. Property pane: search and pick an agent or model through the public three.ws APIs (real calls, debounced, with loading, empty and error states), size, background, camera, autoplay, accessible title. Respects SharePoint theme variants and reduced motion.
2. **Viva Connections ACE** that shows an agent card (name, avatar poster, status) and opens a quick view or the agent page.
3. **Assets** bundled in the `.sppkg` (`includeClientSideAssets: true`); the three.ws runtime script loaded from `https://three.ws` with the exact CSP Trusted Script Sources entry documented for admins.
4. **Build and test.** `npm run package:sharepoint` (in the package, wired to the root with a prefixed script) produces the `.sppkg`; unit tests for the property pane data layer; package validation for the manifest ids and versions. Exercise the web part bundle in the SPFx local workbench or a headless harness that mounts the compiled web part class with real API calls.
5. **AppSource readiness.** `marketing/growth/submissions/programs/microsoft-sharepoint-spfx.md`: listing copy, screenshots plan, test notes, the admin deployment steps (App Catalog upload, tenant-wide deployment, CSP entry), and the store's SPFx requirements checklist with each item's evidence.
6. **Docs.** `integrations/microsoft/sharepoint-spfx/README.md`, a `docs/microsoft-sharepoint.md` admin and site-owner guide linked from `docs/microsoft.md`, a `STRUCTURE.md` row, changelog entry, `npm run build:pages`.

## Definition of done

- [ ] `npm run package:sharepoint` produces a valid `.sppkg` (output and size in the report).
- [ ] Both web parts and the ACE render with real three.ws data in the local harness with no console errors (screenshot paths).
- [ ] Unit tests pass; root `npm test` passes; SPFx's own toolchain stays inside its package and does not change the root lockfile beyond a scoped workspace entry.
- [ ] README, admin guide, submission doc, STRUCTURE row and changelog landed; `npm run audit:docs` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| SPFx needs a different Node version than the repo | Run the SPFx package with its required Node through the version manager on the machine; document it in the package README. |
| No SharePoint tenant | Local workbench or harness render is the bar; App Catalog upload goes in the owner message. |
| `<agent-3d>` cannot load under SharePoint CSP | Document the Trusted Script Sources entry; if a CSP-safe self-contained build is needed, bundle the runtime into the package instead. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
