# ROADMAP.md is repaired (invalid UTF-8) and its phase statuses are re-measured and synced with the README roadmap

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/780-plan-docs-roadmap-phase-status-truth-pass.md`.

**Priority:** P3, polish, developer experience, or exploratory (score 24 of 100 inside the tier). **Area:** docs. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

## Operating clause (binding)

- Read `CLAUDE.md` at the repo root before anything else. It overrides this file wherever they disagree.
- Finish 100% in this session. Do not end the turn with a question, an option list, a plan, or "let me know". Make reasonable judgment calls, act on them, and note each in one line in the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: signing or sending a transaction, spending or moving funds, paying an x402 endpoint, minting or launching a coin; `git push`, production deploys, publishing or posting externally; committing content that references a crypto project other than $THREE; destroying data that cannot be regenerated. Do every other part of the work around a gate, and batch every such ask into one message at the end.
- Enterprise grade, no shortcuts. No mocks, no fake data, no placeholders, no sample arrays, no fake loading or progress, no unfinished-work markers, no stub functions, no commented-out code. Real APIs, real endpoints, real data. Errors are handled at the boundaries (network, user input) with a real recovery path.
- Bug fixes are test-first: write the test that reproduces the bug, watch it fail for the reported reason, fix the code, watch it pass, and commit the test with the fix.
- UI work meets the bar a senior design review would pass: hover, focus and active states on every interactive element, designed empty, error and loading (skeleton) states, keyboard accessible, works at phone width, and verified in a real browser.
- Solana is the home chain and leads every design. Robinhood means Robinhood Crypto only. $THREE (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) is the only promoted coin; tests and fixtures use it or a clearly synthetic placeholder, never a real third-party mint.
- Never write the em-dash or en-dash characters anywhere (code, docs, UI copy, commit messages). Use a period, comma, colon, parentheses, or a plain hyphen.
- Before writing any non-trivial feature or UI, load `.claude/skills/engineering-standards/SKILL.md`. Before claiming done, load `.claude/skills/changelog-and-docs/SKILL.md`.

## Running alongside other sessions

Many sessions may be working in this same worktree at once. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Start dev servers on a free port (`npx vite --port <free port> --strictPort`), not the default 3000, so you do not collide with another session.

## Why this matters

`ROADMAP.md` is the root-level public statement of where the platform is going, and it is corrupted: the status glyphs were truncated to lone continuation bytes, so the file is invalid UTF-8 (grep treats it as binary, `iconv -f utf-8` fails) and renders as garbage on some viewers. Its Phase 2 row also says voice clone, persona and memory seeds are "behind /demos, main-flow integration next", but the create flow now wires the voice stage (`src/create-review.js` imports the voice talk scene and voice library modal). The same stale row is copied in `README.md` under `## Roadmap`.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `ROADMAP.md` is 16 lines; `iconv -f utf-8 -t utf-8 ROADMAP.md` exits 1; lines 8 and 9 (phase 0 and phase 1 rows) show the broken bytes where the check mark, arrow and yellow-circle emoji belong (`README.md` lines ~10797-10808 have the same table intact).
- Phase 2 row in both files: "In progress: voice clone, persona, memory seeds shipped behind /demos; main-flow integration next". `src/create-review.js` exposes `case 'voice'` -> `openVoicePreview`.
- The tables in ROADMAP.md and README.md are otherwise duplicates and must stay byte-consistent.
- The phase statuses for 3, 4 and 5 look current (royalty_ledger, `/api/nodes` + `packages/node-operator`, Glance widgets with macOS/iOS next) but were not re-measured end to end.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
iconv -f utf-8 -t utf-8 ROADMAP.md >/dev/null; echo "iconv exit=$?"
grep -an "^| \*\*" ROADMAP.md | cut -c1-140
sed -n 10795,10810p README.md | cut -c1-140
grep -n "voice\|persona\|memory" -i src/create-review.js | head
ls packages/node-operator api/nodes 2>&1 | head; ls pages | grep -i glance
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Test first: add `tests/docs-roadmap-encoding.test.js` that reads `ROADMAP.md` as a Buffer and asserts it is valid UTF-8 (`new TextDecoder('utf-8', { fatal: true })`), and that the phase table rows in `ROADMAP.md` equal the phase table rows in `README.md` `## Roadmap` (normalize whitespace). Run it and confirm it fails on the encoding assertion.
2. Rewrite the corrupted phase rows in `ROADMAP.md` with valid UTF-8. Do not use the em-dash or en-dash (CLAUDE.md tone rule); keep the status glyphs the README uses.
3. Re-measure each phase against the code and decide its true status: Phase 1 (`api/` reconstruction route + `workers/`), Phase 2 (create flow voice stage, persona, memory seeds: check `src/create-review.js`, `src/voice/`, `api/agents/` persona and memory endpoints), Phase 3 (`royalty_ledger`, EAS viewer), Phase 4 (`/api/nodes`, `packages/node-operator`, Livepeer flag), Phase 5 (Glance: macOS and iOS still pending?). Update Phase 2 to what is actually shipped and what remains, with the evidence path.
4. Mirror the corrected table into `README.md` `## Roadmap` and the matching per-phase prose sections (`### Phase 2: Agent Personalization` around README line 10855 and the "Voice & Persona Hub (Phase 2)" section), plus any phase claims in `docs/three-thesis.md` (grep for `Phase 2`), so no document disagrees.
5. Run the new test, `npm run audit:docs`, and `npm run check:rules -- --paths ROADMAP.md README.md`. Add a `data/changelog.json` entry only if a user-visible claim changed, then `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `iconv -f utf-8 -t utf-8 ROADMAP.md >/dev/null` exits 0 and `grep -c "In progress" ROADMAP.md` works without a "binary file" notice.
- [ ] `npx vitest run tests/docs-roadmap-encoding.test.js` passes (failed before the repair).
- [ ] `diff <(grep -a "^| \*\*" ROADMAP.md) <(sed -n '/^## Roadmap/,/^### Phase 0/p' README.md | grep "^| \*\*")` prints nothing.
- [ ] `grep -n "main-flow integration next" ROADMAP.md README.md` prints nothing unless re-measured as still true.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| A phase's real status is ambiguous | Choose the conservative status backed by a code path you can cite in the row's evidence, and note the judgment in the final report. |
| Editor re-corrupts the bytes | Write the file with a UTF-8-safe tool and re-run the iconv check after saving. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/780-plan-docs-roadmap-phase-status-truth-pass.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `780-plan-docs-roadmap-phase-status-truth-pass.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `ROADMAP.md` (whole file)

~~~~markdown
# Roadmap

The destination: anyone can mint a 3D agent of themselves, own it onchain, and embed it anywhere on the internet. Phase-by-phase detail lives in the [full reference](README.md#roadmap). Shipped work is in the [changelog](CHANGELOG.md).

| Phase | Theme                                                                                  | Status                                                                                                         |
| ----- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **0** | Platform foundations (viewer, runtime, ERC-8004 + Metaplex Core identity, embed layer) | -�� Shipped                                                                                                     |
| **1** | Selfie -�� Avatar engine (3-photo capture, hosted inference)                             | 🟡 In progress: capture, reconstruction backend, rigging, R2 storage and draft mint are wired end to end; likeness fidelity is the open track |
| **2** | Agent personalization + voice cloning                                                  | 🟡 In progress: voice clone, persona, memory seeds shipped behind `/demos`; main-flow integration next        |
| **3** | Onchain economy (agent tokens, reputation markets, royalties)                          | 🟡 In progress: bonding-curve sim, EAS-reputation viewer, 0xsplits + EAS SDKs landed; per-call skill royalties accrue on paid skill calls (`royalty_ledger`); contracts + audits next |
| **4** | Open inference network (decentralized GPU layer)                                       | 🟡 Live core: open node-operator client (CPU + CUDA images) + `/api/nodes` job queue with signed, server-recomputed receipts shipped; Livepeer federation behind a flag               |
| **5** | Native widgets (agent on your home screen and desktop)                                  | 🟡 In progress: Glance shipped the card endpoint (JSON, SVG, PNG, Adaptive Card), the Windows 11 widget (installs from the PWA manifest, no store), the `<agent-glance>` element, and the Android home screen widget (app 1.1.0, linked from `/glance` with its own revocable token); macOS and iOS next |

Want to help? Pick a [good first issue](https://github.com/nirholas/three.ws/labels/good%20first%20issue) or start a [discussion](https://github.com/nirholas/three.ws/discussions).
~~~~

### `README.md` (section "Roadmap")

~~~~markdown
## Roadmap

three.ws ships in five phases. Each phase closes a specific gap between the current platform and the end-state vision: **anyone can mint a 3D agent of themselves, own it onchain, and embed it anywhere on the internet.**

| Phase | Theme                                                                                  | Status                                                                                                         |
| ----- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **0** | Platform foundations (viewer, runtime, ERC-8004 + Metaplex Core identity, embed layer) | ✅ Shipped                                                                                                     |
| **1** | Selfie → Avatar engine (3-photo capture, hosted inference)                             | 🟡 In progress: capture, reconstruction backend, rigging, R2 storage and draft mint are wired end to end; likeness fidelity is the open track |
| **2** | Agent personalization + voice cloning                                                  | 🟡 In progress - voice clone, persona, memory seeds shipped behind `/demos`; main-flow integration next        |
| **3** | Onchain economy (agent tokens, reputation markets, royalties)                          | 🟡 In progress: bonding-curve sim, EAS-reputation viewer, 0xsplits + EAS SDKs landed; per-call skill royalties accrue on paid skill calls (`royalty_ledger`); contracts + audits next |
| **4** | Open inference network (decentralized GPU layer)                                       | 🟡 Live core: open node-operator client (CPU + CUDA images) + `/api/nodes` job queue with signed, server-recomputed receipts shipped; Livepeer federation behind a flag               |
| **5** | Native widgets (agent on your home screen and desktop)                                  | 🟡 In progress: Glance shipped the card endpoint (JSON, SVG, PNG, Adaptive Card), the Windows 11 widget (installs from the PWA manifest, no store), the `<agent-glance>` element, and the Android home screen widget (app 1.1.0, linked from `/glance` with its own revocable token); macOS and iOS next |

---

### Phase 0: Foundations _(Shipped)_

The full stack is live at [three.ws](https://three.ws): WebGL viewer, LLM agent runtime, ERC-8004 identity contracts (EVM) and Metaplex Core mints (Solana), OAuth 2.1 server, MCP endpoint, and the `<agent-3d>` web component. Anyone can register an agent today - but the avatar still has to come from a 3D artist or a third-party tool.

**What works:** model upload, agent runtime, onchain registration, embedding, signed action history, reputation scores.
**What doesn't:** there is no automated path from a real human face to a usable 3D avatar.

---

### Phase 1: Selfie → Avatar Engine

**Goal:** any user takes 3 selfies (left, center, right) and receives a rigged, animatable 3D avatar in under 60 seconds.

**Deliverables**

- Mobile-first capture UX with realtime quality gates (lighting, framing, blur). Shipped: [src/selfie-capture.js](src/selfie-capture.js), [src/selfie-gates.js](src/selfie-gates.js)
- Multi-view face reconstruction pipeline (landmark fitting on top of a base body mesh). Shipped: [workers/avatar-reconstruction](workers/avatar-reconstruction/) morphs a rigged template head to the person's 468 MediaPipe landmarks and projects the photo onto its skin
- Hosted inference workers for sub-minute generation. Shipped on Cloud Run: submission, job status, the rig chain, and the abandoned-tab backstop are all live (see [Reconstruction backend](#reconstruction-backend-selfie--rigged-glb) below)
- Output written directly to R2 and minted as a draft agent token: ERC-8004 on EVM, Metaplex Core asset on Solana. Shipped: [api/\_lib/reconstruct-finalize.js](api/_lib/reconstruct-finalize.js)

**Open track:** likeness fidelity, measured by Identity Shape Error rather than by eye. The metric, the reference set and the adversarial set live in [workers/avatar-reconstruction/eval](workers/avatar-reconstruction/eval/); the program plan is [docs/avatar-fidelity-program.md](docs/avatar-fidelity-program.md).

#### Reconstruction backend: selfie → rigged GLB

The path a capture actually takes, end to end. Each hop is a real service; nothing here is stubbed.

| Step | Where | What happens |
| ---- | ----- | ------------ |
| 1. Capture + gate | [src/selfie-pipeline.js](src/selfie-pipeline.js) | Three shots (frontal, left, right). The frontal must contain a face; every other gate is a warning the user can proceed past. Each shot is background-isolated and reframed to a head-and-shoulders square before it is sent. |
| 2. Submit | `POST /api/avatars/reconstruct` | Resolves a provider (platform credentials first, then the caller's own key), submits, and writes an `avatar_regen_jobs` row. A submit that fails over to the next provider never double-charges. |
| 3. Generate | Cloud Run worker | The worker fits the head geometry and skin to the photo and returns a rigged GLB. A capture it cannot use comes back classified as an input error, so the client can say what to fix instead of "try again". |
| 4. Rig chain | [api/\_lib/reconstruct-finalize.js](api/_lib/reconstruct-finalize.js) | A mesh that arrives without a skeleton is sent to the rig worker. If rigging is unavailable or fails, the bare mesh is delivered tagged `unrigged`: the user is never left empty-handed. |
| 5. Store + register | R2, `avatars`, `forge_creations` | The GLB is canonicalized (bone names, up-axis), stored in R2, and registered in the same Forge store the rest of the platform reads, so galleries, embeds and provenance see a capture like any other creation. |
| 6. Draft mint | [api/\_lib/draft-mint.js](api/_lib/draft-mint.js) | Best-effort draft agent identity. A mint hiccup never fails a delivered avatar. |
| 7. Poll | `GET /api/avatars/regenerate-status?jobId=…` | Drives steps 4 to 6 from the browser and reports `queued` / `running` / `rigging` / `done` / `failed`. |
| 8. Backstop | [api/cron/reconstruct-sweep.js](api/cron/reconstruct-sweep.js) | Close the tab and the browser poll stops. The sweep runs the same finalize stages server-side, so an abandoned capture still lands in the user's library. |

**Compute requirements**

- A100/H100-class GPUs for inference, sized to ~10k avatars/day at launch
- Training budget for fine-tuning a stylized face-fitter on a curated dataset
- CDN egress scaling for high-res GLB delivery

**Verification:** 1,000 test users complete capture and mint an onchain agent of themselves end-to-end with ≥4/5 likeness score.

---

### Phase 2: Agent Personalization

**Goal:** the avatar isn't just _you_ - the agent _acts_ like you.

**Deliverables**

- Voice cloning (30+ seconds of speech → ElevenLabs custom voice bound to the agent)
- Persona extraction from a short onboarding interview (tone, vocabulary, interests)
- Memory seeding from connected accounts (X, GitHub, Farcaster) with explicit user consent
- Per-agent fine-tuned system prompt stored in the manifest, signed and pinned to IPFS

**Verification:** users return to converse with their own agent; ≥30% week-2 retention on minted agents.

---

### Phase 3: Onchain Economy

**Goal:** agents are real economic objects on EVM and Solana, not just collectibles.

**Deliverables**

- **Agent tokens** - ERC-8004 mints with bonding-curve pricing or fair launch options
- **Reputation markets** - stake on agents, earn from their action history (extends `ReputationRegistry.sol`)
- **Skill royalties** - skill authors earn per-call fees through EIP-7710 delegated permissions
- **Agent-to-agent payments** - agents transact autonomously via their delegated signer wallets
- **Subscriptions & DCA** - recurring onchain payments to creators (cron infra already in place)

**Funding requirements**

- Smart contract audits (multi-firm) for the reputation, royalty, and delegation contracts
- Liquidity for agent token launches
- Indexer infrastructure across Base, Solana, and additional EVM chains

**Verification:** ≥1,000 agents minted with active onchain reputation; ≥$X in cumulative skill royalties paid out.

---

### Phase 4: Open Inference Network

**Goal:** decouple agent inference from any single provider. Anyone can run a node; agents pay nodes onchain for compute.

**Deliverables**

- Open protocol for agent inference (model weights, GPU runtime, signed responses)
- Node operator client (Docker + GPU drivers) with onchain registration
- Onchain settlement for inference jobs - pay-per-token with cryptographic receipts
- Federation with existing decentralized compute networks where appropriate

**Shipped so far:** anyone can run a node today. The [packages/node-operator/](packages/node-operator/) client registers with the coordinator using a signature under its own Solana ed25519 key (no shared secret to leak), claims jobs from the `/api/nodes` queue, executes them with a real open model on CPU or CUDA, and returns results signed over a canonical receipt binding job, model, and input/output hashes, which the coordinator recomputes before accepting. `npm run e2e` in that package proves the whole loop against the real handlers. Paid inference on `/api/x402/llm-proxy` settles through the metered hook on the x402 paid-endpoint wrapper, and `POST /api/x402/inference-verify` publishes the platform signing key so receipts verify offline. Wire contract: [specs/inference-nodes.md](specs/inference-nodes.md). Operator guide: [docs/inference-node-operator.md](docs/inference-node-operator.md).

**Compute requirements**

- Bootstrap GPU credits for early node operators
- Cryptoeconomic security model (slashing, validator set) - research + audit budget

**Verification:** ≥50% of production agent traffic served by independent node operators; latency parity with centralized inference.

---

### Phase 5: Native Widgets

**Goal:** your agent lives on the home screen, not only in a browser tab. A glanceable widget that shows the agent you own, one live number about it, and a single tap back into the app.

This is a different product from the embeddable web widgets at [three.ws/widgets](https://three.ws/widgets), which put a 3D agent on someone else's web page. Phase 5 is about the operating system surfaces: the Android home screen, the Windows 11 widgets board, and the macOS and iOS widget galleries.

**Why it is next.** The Android shell already exists. three.ws ships as a signed Trusted Web Activity (`ws.three.app`) for the Solana dApp Store, Digital Asset Links verify against the live release key, and deep links, shortcuts and the share sheet already open the app. A widget is the piece that makes the app worth keeping installed between visits. The render side exists too: `POST /api/render/avatar-clip` already produces a posed, camera-framed PNG of any avatar from the headless renderer, which is exactly the image a widget needs, because no widget runtime on any of these platforms can execute WebGL.

**Order of delivery**

| # | Surface | Shell needed | Status |
| - | ------- | ------------ | ------ |
| 1 | Windows 11 widgets board | None | **Shipped.** The installed PWA declares a `widgets` manifest member and an Adaptive Card template ([/api/glance/template](api/glance/template.js)); the service worker ([public/glance-sw.js](public/glance-sw.js)) answers `widgetinstall`, `widgetresume`, `widgetclick` and `periodicsync` |
| 2 | Any web page | None | **Shipped.** `<agent-glance>` ([public/glance/element.js](public/glance/element.js)), plus one SVG or PNG URL for a README, a Slack unfurl, or any `<img>` |
| 3 | Android home screen | Already shipped (`ws.three.app`) | **Shipped** in app 1.1.0. Native `AppWidgetProvider` overlay on the Bubblewrap project ([solana-mobile/android-overlay](solana-mobile/android-overlay/README.md)) in a 2x2 and a 4x2 / 4x3 layout, refreshed by `WorkManager` from `GET /api/glance/mine?format=png` about every 30 minutes, keeping the last card when the phone is offline, tapping deep links into the TWA. It carries its own `glw_` widget token, linked from [/glance](public/glance/index.html) ("Link this phone") and revocable there at any time |
| 4 | macOS | Small SwiftUI host app | WidgetKit extension plus a menu bar companion; needs an Apple Developer account |
| 5 | iOS | App Store wrapper | Same WidgetKit extension target as macOS; gated on shipping the iOS app itself |

**Deliverables**

- ✅ A cacheable card endpoint, [/api/glance/card](api/glance/card.js), serving one model as JSON, SVG, PNG and Adaptive Card, plus [/api/glance/mine](api/glance/mine.js) for the owner's own agent, authenticated by the session cookie or by a widget's own bearer token, and answering every state (signed out, widget unlinked, no agent yet) as a designed card rather than a 401. Spec: [specs/GLANCE_CARD.md](specs/GLANCE_CARD.md)
- ✅ Windows 11 widget through the PWA manifest, so it installs with no separate store submission, degrading to the last cached card when the machine is offline and to a sign-in card when nobody is signed in
- ✅ Card content that is worth a home screen slot: the agent, one live number (actions in the last 24 hours), its last action, and a direct way back in
- ✅ A playground and install guide at [/glance](public/glance/index.html), and an npm client, [@three-ws/agent-glance](packages/agent-glance), with a terminal renderer
- ✅ Android app widget in two layouts (2x2, and 4x2 / 4x3), refreshed by WorkManager on a battery-aware schedule, degrading to the last cached card when the device is offline
- A native shell for Apple platforms, which is also the prerequisite for an iOS build of three.ws

**Verification:** a widget installed from the Android app updates without opening the app, survives a reboot and airplane mode, and returns the user into the right screen on tap. The Apple half is one WidgetKit extension over the same endpoint, shared by a Mac menu bar app and the iPhone app; `npm run check:apple-widget` holds its two Xcode projects and its wire contract honest without a Mac. Product doc: [docs/native-widgets.md](docs/native-widgets.md). Sources: [apple/](apple/README.md).

---

### What we need

| Resource                   | Used for                                   | Phase |
| -------------------------- | ------------------------------------------ | ----- |
| **Inference GPUs**         | Avatar generation, agent conversations     | 1, 2  |
| **Training compute**       | Fine-tuned face-fitter, voice models       | 1, 2  |
| **Smart contract audits**  | Reputation, royalty, delegation contracts  | 3     |
| **Token launch liquidity** | Agent token markets                        | 3     |
| **Indexer infrastructure** | Multi-chain crawl + reputation aggregation | 3     |
| **Node operator credits**  | Bootstrap the open inference network       | 4     |
| **Engineering headcount**  | Capture pipeline, contracts, indexer, ops  | 1-4   |
| **Apple Developer account** | macOS and iOS widget host app, App Store review | 5     |

Phases 1 and 2 unblock the consumer story - _anyone gets an agent of themselves_. Phases 3 and 4 unblock the onchain story - _those agents are real economic actors that don't depend on any one company to keep running_. Both are required for the vision; neither is funded yet.

If you want to support the project - compute credits, grants, partnerships, or contributions - open an issue or reach out via [three.ws](https://three.ws).

---
~~~~

