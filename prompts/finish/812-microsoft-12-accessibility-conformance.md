# microsoft 12: accessibility pass on the enterprise surfaces and a published Accessibility Conformance Report

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3112.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Enterprise and public-sector procurement through Microsoft Marketplace routinely asks for an Accessibility Conformance Report (the VPAT format) against WCAG 2.2 AA, and Microsoft itself treats accessibility as a product value. A real audit, real fixes, a regression check and an honest ACR turn a common procurement blocker into a line in the listing. It also improves the product for every user.

## Step 0: re-derive the current state

    grep -n -i "axe\|a11y\|accessib" package.json | head
    ls tests | grep -i -E "a11y|access" ; ls pages | grep -i access
    curl -s https://three.ws/api/version

Pick the audited set: the 12 most-visited public pages (from the repo's analytics or sitemap priority; say which source), plus `/login`, `/microsoft/activate`, `/microsoft/teams-tab`, the Forge main flow, the agent page and the `<agent-3d>` embed. Read WCAG 2.2 AA success criteria and the current ITI VPAT 2.x WCAG edition template structure.

## Tasks

1. **Automated audit.** A Playwright script (`scripts/audit-a11y.mjs`, exposed as `npm run audit:a11y`) that runs axe-core (the same engine Microsoft's Accessibility Insights for Web uses for automated checks; verify the license) on every audited page in both themes at desktop and 400px, and writes a JSON and Markdown report.
2. **Fix everything it finds** in the audited set: names and roles, contrast, focus order and visible focus, form labels and error association, landmark structure, motion (respect `prefers-reduced-motion` in the 3D viewer: no auto-rotate), and canvas alternatives (the 3D viewer exposes a text description and keyboard orbit controls). Bug-class fixes get a test where a test is meaningful; pure CSS fixes say so in one line.
3. **Manual checks** the tools miss: keyboard-only walkthrough of each audited flow, screen reader pass with an open-source reader available on the machine (NVDA is Windows-only; use Orca on Linux, record which), zoom to 200 and 400 percent, and Windows High Contrast emulation via `forced-colors` in Chromium.
4. **ACR.** `docs/accessibility/acr.md` in the VPAT WCAG edition structure: every WCAG 2.2 A and AA criterion with Supports, Partially Supports, Does Not Support or Not Applicable, and remarks naming what remains. Honest, dated, with the product version.
5. **Statement page.** `/accessibility` with the commitment, the conformance status summary, known limitations, and a contact route that exists. Footer link; pages.json, STRUCTURE.md, changelog.

## Definition of done

- [ ] `npm run audit:a11y` exits 0 on the audited set with zero serious or critical axe violations (report attached).
- [ ] The keyboard and screen reader walkthrough notes for each audited flow are in `docs/accessibility/`.
- [ ] `acr.md` covers every WCAG 2.2 A and AA criterion.
- [ ] `/accessibility` renders in both themes with no console errors; `npm test` passes; docs and changelog landed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| A violation lives in a third-party embed | Document it in the ACR with the vendor name and a workaround; fix our wrapper. |
| A fix needs a design decision | Choose the WCAG-conformant option that matches the design system and note it in one line. |
| Pages too slow under swiftshader | Use the light-page harness approach in memory `play-browser-verify-without-world` where it applies, or audit with WebGL disabled and audit the viewer separately. |
| A fix collides with a sibling order editing the same page | Re-read the file, redo the edit; commit small and often. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git rm` this file in the closing commit. An owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
