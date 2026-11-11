# microsoft 05: make three.ws feel native on Windows and in Edge (open .glb from Explorer, protocol links, Edge sidebar)

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3105.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

The Microsoft Store package wraps the PWA, but the app does not yet use what makes a PWA feel native on Windows. With `file_handlers` a Windows user double-clicks a `.glb` in Explorer and it opens in three.ws. With `protocol_handlers` a `web+threews:` link in Teams, Outlook or a doc opens the installed app on the right agent. With `edge_side_panel` the user pins their three.ws agent in the Edge sidebar next to any page they browse. Window Controls Overlay gives the desktop app a real title bar. These are cheap, they are exactly what Microsoft's PWA team showcases, and they make the Store listing worth installing.

## Step 0: re-derive the current state

    grep -n -i -E "manifest|shortcuts|share_target|widgets|display_override|file_handlers|protocol_handlers|edge_side_panel|launch_handler" vite.config.js | head -40
    curl -s https://three.ws/manifest.webmanifest | head -c 4000
    sed -n 1,80p scripts/package-microsoft-store-pwa.mjs
    npm run package:microsoft-store -- --check
    grep -rn "launchQueue" src | head

Read the current MDN and learn.microsoft.com pages for `file_handlers`, `protocol_handlers`, `launch_handler`, `edge_side_panel`, and Window Controls Overlay, plus PWABuilder's Windows packaging notes on which of these the MSIX honours.

## Tasks

1. **Open 3D files from the OS.** `file_handlers` for `.glb`, `.gltf`, `.vrm` (and `.fbx`, `.obj` if the viewer loads them; check). A `launchQueue` consumer on the viewer route that reads the file handle locally and opens it in the existing viewer without uploading anything; an "Save to my library" button that uploads only on request.
2. **Protocol links.** `protocol_handlers` for `web+threews`, routed by a small parser: `web+threews://agent/<id>`, `web+threews://model/<id>`, `web+threews://forge?prompt=...`. Unknown or malformed links land on a page that says what was wrong. The parser is unit-tested, test-first, including hostile input (script URLs, path traversal, overlong prompts).
3. **Edge sidebar.** `edge_side_panel` with a preferred width, and a narrow-layout route (for example `/sidebar`) built for 320 to 400px: chat with the user's default agent, quick text-to-3D, recent models. Sign-in works in the side panel.
4. **Desktop polish.** `display_override` with `window-controls-overlay` and a title-bar region that respects `env(titlebar-area-*)`; `launch_handler` with `client_mode` set so a second launch focuses the existing window.
5. **Packaging.** Teach `scripts/package-microsoft-store-pwa.mjs --check` to validate the new members (extensions present, protocol scheme syntax, side-panel route reachable). Edit `vite.config.js` with small anchored edits only (re-read first; it is a shared hot file).
6. **Docs.** A "Windows and Edge" section in `docs/desktop.md` (or the doc that covers the PWA), the Store listing copy in `marketing/growth/submissions/programs/microsoft-edge-and-store.md` updated with the new features, changelog entry.

## Definition of done

- [ ] The built manifest contains the new members and `npm run package:microsoft-store -- --check` passes.
- [ ] A Playwright test on Chromium injects a real `.glb` from the repo's test assets through the launch queue path (or the same handler via a file input) and the viewer renders it with no network upload.
- [ ] The protocol parser tests pass, including hostile inputs.
- [ ] `/sidebar` screenshots at 360px in both themes; no console errors; focus states on every control.
- [ ] Docs, listing copy, changelog landed; `npm test` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No Windows machine to test file association | Verify the manifest and handler in Chromium on Linux, write the Windows check (install from Store or Edge, double-click a GLB) into the owner message. |
| PWABuilder ignores a member in MSIX | Record it in the doc, keep the member for Edge and Chrome installs. |
| `vite.config.js` edit conflicts with a sibling | Re-read and redo the anchored edit; never overwrite the file. |
| Microsoft docs changed since 2026-11-11 | Build to what the page says today and cite its URL. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git rm` this file in the closing commit. An owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
