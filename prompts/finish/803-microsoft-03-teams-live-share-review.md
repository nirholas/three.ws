# microsoft 03: a shared 3D review stage inside Teams meetings (Live Share)

Status 2026-11-11: built and verified locally (two-browser Live Share e2e passes, package --check passes); waits on the owner for a real two-person meeting sideload, push and deploy. See docs/teams-live-share.md.

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3103.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

The Teams app today is a personal tab and a bot. The moment where 3D matters most in a company is the design review: a team in a meeting looking at the same product mockup, avatar or prop. Microsoft's Live Share SDK (open source, MIT) syncs state between meeting participants on Teams' own relay at no cost to the publisher. A three.ws meeting stage where everyone sees the same model, the presenter's camera follows for all, and anyone can drop a comment pin on the mesh is a feature no 3D tool ships inside Teams today, and it is the kind of demo Microsoft's own developer channels feature.

## Step 0: re-derive the current state

    ls integrations/microsoft/copilot-teams; sed -n 1,200p integrations/microsoft/copilot-teams/manifest.template.json
    sed -n 1,80p pages/microsoft-teams-tab.html; ls src | grep -i teams
    sed -n 1,80p scripts/build-microsoft-app-package.mjs
    npm run package:microsoft-app -- --check
    grep -rn -i "live-share\|fluid" package.json src | head

Read the current Live Share docs on learn.microsoft.com (meeting side panel, share to stage, `LiveState`, `LivePresence`, `LiveFollowMode`, the resource-specific consent permissions, and local testing with `TestLiveShareHost` against a local Fluid service). Verify the license of `@microsoft/live-share` and its Fluid dependencies from their LICENSE files.

## Tasks

1. **Stage page** at `/microsoft/teams-stage` (vercel.json route with the same frame-ancestors CSP the teams-tab route uses, Vite input): the three.ws viewer full-bleed, a model picker (the signed-in user's models, a team library if one exists, or a paste-a-URL field), and Live Share state:
   - **Follow mode:** the presenter's orbit camera drives everyone's view; a participant can break away and "jump back to presenter".
   - **Presence:** avatars or initials of who is viewing, and each participant's pointer as a colored laser on the mesh.
   - **Comment pins:** raycast-placed pins with short text, synced, exportable as a markdown list at the end of the meeting.
   - **Animation and variant sync:** the presenter's selected animation clip and playback time stay in sync.
2. **Side panel page** (`/microsoft/teams-stage?view=panel` or a sibling route): pick the model and press "Share to stage" using the Teams JS SDK's meeting share APIs.
3. **Manifest.** Add the configurable meeting tab with `meetingSidePanel` and `meetingStage` contexts and the Live Share resource-specific permissions to `manifest.template.json` (small anchored edit, re-read first: sibling order 804 may also touch it). Teach `scripts/build-microsoft-app-package.mjs --check` to validate the new entries.
4. **Local multi-client test.** A Playwright test that opens two browser contexts against the stage in local mode (`TestLiveShareHost` plus a local Fluid service started by the test, a real service, not a stub) and asserts camera follow, presence, pin creation and animation sync propagate.
5. **Docs.** `docs/teams-live-share.md` (what it does, how to sideload into a real meeting, privacy: no meeting content is stored by three.ws unless the pins are exported), link from docs/microsoft.md, STRUCTURE.md row, changelog entry.

## Definition of done

- [ ] The two-context Playwright test passes and shows state propagating both ways.
- [ ] `npm run package:microsoft-app -- --check` passes with the meeting contexts and permissions present.
- [ ] The stage page works outside Teams too (graceful single-user mode with an explanation), no console errors, every control has hover, active and focus states.
- [ ] Docs, STRUCTURE.md, changelog landed; `npm test` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No Teams tenant to sideload into | Ship and verify in local mode, write the sideload click path in docs/teams-live-share.md, put "sideload and run a two-person meeting" in the owner message. |
| Teams JS SDK meeting APIs need a real meeting context | Feature-detect the context; outside a meeting show the single-user mode, never a broken page. |
| Bundle size from Fluid packages | Lazy-load the Live Share chunk only on the stage route; record the chunk size in the report. |
| Microsoft docs changed since 2026-11-11 | Build to what the page says today and cite its URL. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git rm` this file in the closing commit. An owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
