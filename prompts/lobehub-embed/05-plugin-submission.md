# Task 05 — package, test, and submit to the LobeHub marketplace

## Context

Repo: `/workspaces/3D`. Tasks [01](./01-plugin-manifest.md) through [04](./04-action-passthrough.md) have produced:

- A public plugin manifest at `/.well-known/lobehub-plugin.json`
- A versioned `postMessage` bridge between our iframe and a LobeHub host
- An identity handoff for LobeHub-auth'd viewers (with optional wallet link)
- Bidirectional tool-call ↔ protocol relay that preserves the Empathy Layer

This final task packages those into a submittable LobeHub plugin: a sample LobeHub config for a local dev instance (or mock), an end-to-end smoke script, and the marketplace submission materials (PR description, screenshots, demo GIF scripts).

The user has a LobeHub **fork** — prefer testing against that fork first. If not available in the sandbox, mock the host side.

## Goal

Produce everything needed to (a) reproduce a green local smoke test of the plugin in a LobeHub instance and (b) open a PR against the LobeHub plugin marketplace with a complete, reviewable submission.

## Deliverable

1. **Local-test harness** under `prompts/lobehub-embed/fixtures/`:
   - `sample-lobehub-config.json` — a LobeHub plugin-install descriptor pointing at `https://3dagent.vercel.app/.well-known/lobehub-plugin.json` (or a local dev URL).
   - `mock-host.html` — a standalone page that mimics the LobeHub host frame: iframes our embed, sends the full handshake sequence (`host:hello` → `host:identity` → `host:action` samples), logs replies. Use for offline testing.
   - `smoke.md` — a step-by-step manual smoke test script (10–15 steps) covering: install, open agent, chat sends tool call, avatar speaks with emotion, wallet link prompt, signed action surfaces back to transcript.
2. **Submission bundle** under `prompts/lobehub-embed/submission/`:
   - `PR_DESCRIPTION.md` — marketplace PR body. Must include:
     - What the plugin does (2–3 sentence pitch focused on embodied + Empathy Layer)
     - Why users want it (scenarios: paste an agent id in chat, see a 3D avatar react emotionally, sign onchain actions via ERC-8004)
     - Compliance statement (no arbitrary code execution in host, no data exfiltration, origin-checked `postMessage`)
     - Link to the hosted manifest
     - Link to a demo video / GIF (placeholder URL the maintainer fills in)
     - Maintainer contact
   - `SCREENSHOTS.md` — a script (not actual images) describing the five screenshots to capture: (1) install dialog, (2) agent rendered in a chat bubble, (3) avatar mid-gesture, (4) emotion blend visible (concerned face), (5) signed-action receipt in transcript. For each, list the URL, window size, and visible elements.
   - `DEMO_SCRIPT.md` — 60-second walkthrough script for recording a demo GIF/MP4. Word-for-word spoken lines optional.
3. **Tracking metadata** — add a single line to `public/.well-known/lobehub-plugin.json` (if not already present): `"marketplaceStatus": "pending"` (string), updated to `"listed"` post-acceptance.
4. **Release notes stub** — append a `## v0.1.0 — LobeHub plugin` section to the repo's existing CHANGELOG if one exists; otherwise note its absence in the report.

## Audit checklist

- **Manifest actually loads in LobeHub.** Install the plugin in a local LobeHub dev instance (from the user's fork). Screenshot the install flow. If the fork is unavailable in the sandbox, document why and fall back to `mock-host.html`.
- **All five handshake envelope types exchange cleanly** per [02](./02-iframe-handshake.md). Log the transcript into `smoke.md`.
- **One full round-trip tool call** per [04](./04-action-passthrough.md): LobeHub chat model → `speak` tool → protocol emit → AgentAvatar mouth/emotion → `embed:action` mirror → chat transcript entry. Step-by-step in `smoke.md`.
- **Anon viewer smoke** — tier=anon in [03](./03-host-auth-handoff.md) produces a working avatar. No prompts blocking boot.
- **Wallet-link smoke** — tier=wallet-linked produces a signed action that surfaces with `signature`, `address`, `chainId`.
- **Security review hooks.** The PR_DESCRIPTION.md must list exactly which browser APIs the embed uses and which origins it talks to (ours only — the API plane is `fetch(/api/...)` on same-origin; no third-party beacons).
- **No hidden telemetry.** Search the embed path for `fetch(` calls; enumerate all destinations in the PR description.
- **Empathy Layer is the headline.** The PR_DESCRIPTION.md leads with the emotion-blend video demo. Do **not** bury it under generic "3D avatar" language.

## Constraints

- No new runtime deps.
- Fixture files are markdown/json/html **only** — no new JS outside what's in `mock-host.html` (which must be self-contained, no imports).
- `mock-host.html` is for local testing; do **not** deploy it to production (exclude from `public/`).
- The submission bundle is advisory artifacts — do not wire any CI automation around it.
- **LobeHub spec uncertainty.** If the LobeHub marketplace submission process requires a different file layout (e.g. a `plugins/<name>/` directory in their repo, a specific JSON schema, a CLA), **flag each unknown** with `TODO(lobehub-submission): confirm against current LobeHub docs at https://lobehub.com/docs/usage/plugins/development`. Do **not** invent a process.

## Verification

1. All fixture files parse:
   - `node -e "JSON.parse(require('fs').readFileSync('prompts/lobehub-embed/fixtures/sample-lobehub-config.json','utf8'))"`
   - Open `mock-host.html` in a browser; confirm it loads and sends the handshake without errors.
2. Run `smoke.md` end-to-end, cross off each step, paste the transcript into the report.
3. `npx vite build` still succeeds — fixture files outside `public/` must not interfere with the build.
4. `node --check` passes on any JS touched (probably none for this task).
5. Preview `PR_DESCRIPTION.md` rendered as markdown; confirm it reads as a submitted PR body, not an internal memo.

## Scope boundaries — do NOT do these

- Do **not** re-touch plugin manifest contents beyond the `marketplaceStatus` field (task [01](./01-plugin-manifest.md) owns it).
- Do **not** change `postMessage` envelope shapes from [02](./02-iframe-handshake.md) / [04](./04-action-passthrough.md). If smoke testing reveals a bug, file it in the report — do not fix it here.
- Do **not** implement server-side plugin-registry APIs. This task is client-artifact-only.
- Do **not** commit actual media files (screenshots/videos) into the repo; the scripts describe what the maintainer will record manually.
- Do **not** open the actual LobeHub marketplace PR — produce the description for the maintainer to submit.

## Files off-limits

- Everything owned by tasks [01](./01-plugin-manifest.md) – [04](./04-action-passthrough.md) except the one-line `marketplaceStatus` addition to the manifest.
- `src/agent-avatar.js`, `src/agent-protocol.js` — do not touch.

## Reporting

- Files created, each with line count + path
- Smoke test transcript (from `smoke.md`) — paste the results checklist
- LobeHub fork availability (yes / no / partial); if no, how `mock-host.html` filled the gap
- All `TODO(lobehub-submission)` and `TODO(lobehub-spec)` flags, enumerated verbatim
- `vite build` result
- Any unrelated bugs noticed across the full series — note, don't fix. Flag which task owns each.
- Explicit list of changes the user needs to fill in before submitting the PR (demo URL, screenshots, signature line)
