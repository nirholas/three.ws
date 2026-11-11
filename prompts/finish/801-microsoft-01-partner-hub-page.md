# microsoft 01: the /microsoft partner hub, with live demos of Microsoft tech running in three.ws

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3101.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

NVIDIA has a hub at `/nvidia`. Microsoft, a partner with a live Marketplace listing and five Microsoft surfaces built in the repo, has only `/microsoft/activate` and `/microsoft/teams-tab`, both functional pages nobody would share. A partner amplifies what it can screenshot. This page is the one URL that proves the partnership is real engineering: Microsoft Research and Microsoft open source running live in the product, and every place a Microsoft customer can use three.ws.

## Step 0: re-derive the current state

    ls pages | grep -i microsoft; ls pages/nvidia
    sed -n 1,120p pages/nvidia/index.html
    grep -n '"/nvidia' -A3 vercel.json | head -20
    grep -n -i microsoft pages/partners.html | head
    curl -s https://three.ws/api/microsoft-marketplace/status
    curl -sI https://three.ws/microsoft | head -3
    sed -n 1,120p docs/microsoft.md

If `/microsoft` already serves a hub, extend it to cover every task below instead of starting over.

## Tasks

1. **Route and page.** `pages/microsoft/index.html` served at `/microsoft` and `/microsoft/` (vercel.json route beside the existing `/microsoft/activate` routes, Vite input in `vite.config.js`), in the house design system, both themes, 400px wide without horizontal scroll.
2. **Hero.** The two approved claims verbatim, the Marketplace publisher link, and the CoinMarketCap coverage links from docs/microsoft.md. No tier, endorsement or certification language.
3. **"Microsoft tech, running live" section, each a real working demo:**
   - **TRELLIS.2 (Microsoft Research).** A strip of real recent image-to-3D creations from the `trellis2` lane, fetched from the existing public forge feed or gallery API (find it; add a `lane` filter server-side if missing, test-first), each opening in the viewer. A "Try it" button deep-links into Forge with that lane selected.
   - **ONNX Runtime Web.** A live on-device speech-to-text demo that reuses `src/runtime/whisper-stt.js`: press, speak, see the transcript, with a visible "audio never leaves this device" note that is true (verify in the network tab).
   - **Adaptive Cards.** Render a real featured agent's Glance card with the open-source `adaptivecards` renderer (MIT; verify the license file) from the same payload `api/_lib/glance-adaptive.js` produces, next to a button that copies the card JSON.
4. **"Use three.ws inside Microsoft" section.** One card per surface (Marketplace SaaS, Teams and Microsoft 365 Copilot app, Power Platform connector, Microsoft Store app, Edge Add-ons, VS Code extensions, MCP in Copilot Studio and Foundry). Status comes from a new `data/microsoft-surfaces.json` (status `live`, `pending review` or `built, awaiting publish`, plus the evidence link), and the Marketplace card additionally reads `/api/microsoft-marketplace/status` live. Each card says honestly what a visitor can do today.
5. **Built-on credits.** The open-source table from docs/microsoft.md (TRELLIS.2, ONNX Runtime Web, Adaptive Cards, TypeScript, Playwright) with license and repo links, and the trademark line.
6. **Social card.** An OG image for `/microsoft` generated through the existing OG pipeline (find how `/nvidia` or blog posts get theirs) and correct meta tags.
7. **Wire it in.** Link from the Microsoft card on `/partners`, from the Microsoft row on `/partners/benefits`, and in the "Where it shows up" table of docs/microsoft.md. `data/pages.json` entry, `STRUCTURE.md` row, `data/changelog.json` entry, `npm run build:pages`.

## Definition of done

- [ ] `curl -s http://localhost:3101/microsoft` returns the page; Playwright screenshots at 1280px and 400px in both themes show no overflow.
- [ ] The TRELLIS.2 strip shows real creations from a real API response (network tab), the STT demo transcribes real speech with no audio request leaving the browser, the Adaptive Card renders from a real agent's payload.
- [ ] Every interactive element has hover, active and focus states; loading uses skeletons; empty and error states tell the visitor what to do.
- [ ] No console errors or warnings from this page.
- [ ] `/partners` links to it; docs, pages.json, STRUCTURE.md and changelog landed; `npm run audit:docs` reports nothing new; `npm test` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Missing credential or env var | `node scripts/read-service-env.mjs` reads it from Cloud Run (self-unblock playbook). If it exists nowhere, wire the feature behind the variable, prove the code against the live endpoint, and name the variable in the owner message. |
| No public feed exposes lane | Add a lane filter to the existing feed handler with a test; do not hardcode creation ids. |
| No recent `trellis2` creations in production | Generate a few real ones through the production forge (GCP spend is pre-approved) and feature those. |
| Microsoft docs changed since 2026-11-11 | Build to what the page says today and cite its URL. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git rm` this file in the closing commit. An owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message (production deploy of the page); one-line judgment calls. No trailing questions.
