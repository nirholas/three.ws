# packages/README.md lists every package and a check keeps it that way

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/785-plan-docs-packages-index-complete-and-checked.md`.

**Priority:** P3, polish, developer experience, or exploratory (score 22 of 100 inside the tier). **Area:** docs. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

`packages/README.md` is the front door to the repo's publishable packages, but 18 of the 110 package directories are missing from its table, including some of the most visible (`three-ws-cli`, `agents-sdk`, `ai-sdk`, `langchain`, `agent-cli`, `ar-studio`, `assets-cli`, the Unity, Unreal and Godot bridges). A newcomer reading the index cannot discover them, and nothing enforces completeness, so the gap grows with every new package.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Missing from the table: `agent-cli`, `agents-sdk`, `ai-sdk`, `ar-studio`, `assets-cli`, `blender-mcp`, `companion-sdk`, `godot-bridge`, `hood-portfolios-sdk`, `langchain`, `mcp-policy`, `node-operator`, `skill-import`, `solana-memo-media-mcp`, `three-ws-cli`, `unity-bridge`, `unreal-bridge`, `wallet-linkage`.
- Every one of those directories already has a `README.md` (so only the index is stale). `godot-bridge` and `unreal-bridge` have no `package.json`; their descriptions must come from their READMEs.
- `packages/README.md` is a single two-column table `| Package | Description |`, alphabetical, one line per package.
- `npm run audit:docs` (scripts/audit-docs.mjs) does not check this index.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
ls packages | wc -l
for d in $(ls packages); do [ -d packages/$d ] && ! grep -q "\[$d\](" packages/README.md && echo "missing: $d"; done
ls scripts | grep -i audit-docs
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Test-first: write `tests/packages-index.test.js` that enumerates every directory under `packages/` and asserts each appears as a `[name](name/README.md)` link in `packages/README.md`, and that every linked README exists. Run it, confirm it fails listing the missing packages.
2. Add one table row per missing package in alphabetical position, in the same style (one sentence, no em-dash, describing what it does, taken from each package's own README first paragraph or `package.json` description). Verify each claim against the package README; do not invent capabilities.
3. Mark private/unpublished packages truthfully (the intro says "Publishable npm packages"): for any directory whose `package.json` has `"private": true` or that has no `package.json`, either add a "(not published)" note in its row or move it into a short second table "Internal and bridge packages". Choose whichever keeps the table accurate.
4. Fold the new test into the repo gate by confirming `npm run test:gate` or `npm run audit:docs` picks it up (add the file to whichever list those scripts use), so the index cannot rot again.
5. `npm run audit:docs` and `npm run check:rules -- --paths packages/README.md tests/packages-index.test.js` pass.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/packages-index.test.js` passes, and failed before task 2.
- [ ] The Step 0 loop prints nothing.
- [ ] `grep -c "^| \[" packages/README.md` is at least the number of directories in `packages/` (or the split second table accounts for the rest).
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| A package has no description anywhere | Read its `src/` entry point and write the one-line description from what it exports |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/785-plan-docs-packages-index-complete-and-checked.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `785-plan-docs-packages-index-complete-and-checked.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `packages/README.md` (whole file)

~~~~markdown
# packages/

Publishable npm packages for the three.ws platform: client SDKs, agent tooling, and a large family of MCP servers under the `@three-ws/*` scope. Several are npm workspaces declared in the root [package.json](../package.json). Publishing is decided by the filesystem, not by a hand-kept list: a directory holding a `server.json` publishes through `npm run publish:mcp` (npm plus the official MCP registry), everything else with a non-private `package.json` through `npm run publish:packages` (both have `--dry-run` variants). `npm run sync:repos` stages each one as a standalone GitHub mirror under `dist/standalone-mirrors/` and prints the push command; publishing is the owner's call. [data/standalone-mirrors.json](../data/standalone-mirrors.json) is the source of truth for which directory maps to which repo. The full runbook, including the publish preflight, is in [docs/contributing.md](../docs/contributing.md#publishing-packages--standalone-mirrors). Each package's README covers its install, API, and examples.

| Package | Description |
| --- | --- |
| [activity-mcp](activity-mcp/README.md) | Read-only MCP server for live discovery: trending agents and coins, the $THREE holder leaderboard, and the activity ticker. |
| [agenc](agenc/README.md) | Client SDK for the AgenC agent-coordination protocol on Solana: tasks, lifecycle, and the agent registry. |
| [agenc-mcp](agenc-mcp/README.md) | MCP server for AgenC coordination: on-chain task marketplace, agent registry, and x402 service discovery. |
| [agent-glance](agent-glance/README.md) | Puts a live three.ws agent on any surface with a slot: home-screen widgets, README badges, Slack unfurls, and an `<agent-glance>` web component. |
| [agent-guards](agent-guards/README.md) | Per-agent spend policies and trade guards that cap what an agent can spend before a transaction is signed. |
| [agent-memory](agent-memory/README.md) | Persistent embeddings-backed memory for agents: store facts, recall semantically, surface working context. |
| [agent-runtime](agent-runtime/README.md) | The three.ws agent engine: a plan and execute decision loop with human-approval gates and a seven-layer GuardChain. |
| [agent-sniper](agent-sniper/README.md) | Embeddable pump.fun sniper engine: library, CLI, MCP server, and x402 paid API. |
| [agent-vitals](agent-vitals/README.md) | Capability attestation for agents: models an agent's preconditions as a causal graph and returns the root blocker plus the command that clears it. |
| [agentcore-payments-mcp](agentcore-payments-mcp/README.md) | MCP server for platform-managed payment sessions: budgeted, governed x402 spending without private keys. |
| [agora-mcp](agora-mcp/README.md) | MCP server for Agora, the agent and human economy: job board, economy pulse, passports, and signed real work. |
| [alerts-mcp](alerts-mcp/README.md) | MCP server to manage pump.fun alert rules with in-app, webhook, and Telegram delivery. |
| [alibaba-cloud-mcp](alibaba-cloud-mcp/README.md) | MCP server for Alibaba Cloud DashScope: Qwen chat, embeddings, and model discovery with your own key. |
| [assistant-mcp](assistant-mcp/README.md) | MCP server that generates paste-ready three.ws assistant widget embed code, offline and deterministic. |
| [audio-mcp](audio-mcp/README.md) | MCP server for voice and face: TTS, STT, audio-to-face lipsync, and the motion-capture clip library. |
| [autopilot-mcp](autopilot-mcp/README.md) | MCP server for an agent's autonomous-execution control plane: scopes, daily spend cap, and the propose, execute, undo loop. |
| [avatar-agent-mcp](avatar-agent-mcp/README.md) | MCP server that spawns a textured GLB avatar with a Solana wallet, a voice, and pump.fun launch powers. |
| [avatar-cli](avatar-cli/README.md) | Terminal tooling to scaffold, validate, hash, and preview avatar manifests from your shell or CI. |
| [avatar-schema](avatar-schema/README.md) | JSON Schema and validator for three.ws on-chain avatar manifests. |
| [avatar-stream](avatar-stream/README.md) | Progressive 3D over plain HTTP: a layered A3S stream whose first 50 KB is already a complete, skinned avatar, refined in place by byte-range requests. |
| [billing-mcp](billing-mcp/README.md) | Read-only MCP server for account economics: quotas, metered usage, invoices, receipts, and earnings. |
| [brain-mcp](brain-mcp/README.md) | MCP server for the multi-provider LLM router: discover models and run chat completions through any of them. |
| [brownout](brownout/README.md) | Data-provenance headers plus request-scoped fault injection, so you can break an API's upstreams on purpose and prove your integration survives it. |
| [clash-mcp](clash-mcp/README.md) | MCP server for Coin Clash: read the live battle board, or enlist a wallet and rally power for a faction. |
| [concierge-mcp](concierge-mcp/README.md) | MCP server that answers grounded questions about any website and generates Concierge embed code. |
| [copy-mcp](copy-mcp/README.md) | MCP server to manage copy-trade follows: leaders, sizing and guard rules, intent inbox, and fees owed. |
| [create-agent](create-agent/README.md) | One command from a sentence to a rigged, animated 3D agent: `npm create @three-ws/agent`. |
| [defi-utils](defi-utils/README.md) | Zero-dependency chain IDs, token addresses, ERC-20 ABI fragments, and address validation for EVM chains and Solana. |
| [forge](forge/README.md) | Generation SDK: text, image, or sketch to a textured, rig-ready GLB in one call. |
| [glb-diff](glb-diff/README.md) | Structural diff for glTF/GLB: geometry, materials, textures, skeletons, and animations, with rename detection, as a library and a CI-ready CLI. |
| [glb-tools](glb-tools/README.md) | Inspect, re-theme, and bake GLB models from the shell or CI over live three.ws endpoints. |
| [guardian](guardian/README.md) | Content safety and governance: risk classification, moderation, autonomous-send caps, and a tamper-evident audit ledger. |
| [herald-mcp](herald-mcp/README.md) | MCP server that has a 3D character walk onto the browser tab a human already has open and say something out loud. |
| [home-bridge](home-bridge/README.md) | Connects an agent to a real Home Assistant instance: live entity state, guarded service calls, and a room graph for the 3D scene. |
| [home-mcp](home-mcp/README.md) | MCP server giving an assistant safe control of a real Home Assistant house, behind a gate that refuses anything which opens the building. |
| [ibm-watsonx-mcp](ibm-watsonx-mcp/README.md) | MCP server for IBM watsonx.ai with Granite foundation models, using your own IBM Cloud credentials. |
| [ibm-x402-mcp](ibm-x402-mcp/README.md) | x402 pay-per-use MCP server for IBM Granite AI, paid in USDC on Solana, no IBM account required. |
| [intel](intel/README.md) | Intelligence SDK: sentiment pulse, narrative intel, momentum-ranked scans, and live Solana token snapshots. |
| [intel-mcp](intel-mcp/README.md) | Read-only MCP server for market intelligence: smart-money scoring, wallet intel, signals, and KOL leaderboards. |
| [irl](irl/README.md) | Client for geofenced real-world presence: check-ins, nearby discovery, encounters, drops, and proof-of-presence quests. |
| [knock-mcp](knock-mcp/README.md) | MCP server to reach a real person: read what they charge, browse open doors, knock, and read the reply. Quotes paid doors, holds no wallet. |
| [knock-sdk](knock-sdk/README.md) | Publish a priced door and let anyone pay to send one message through, delivered in person by the recipient's 3D companion. |
| [kol-mcp](kol-mcp/README.md) | Read-only MCP server for one tracked KOL wallet: portfolio P&L and its trades on a given mint. |
| [loom-mcp](loom-mcp/README.md) | MCP server for the Loom community 3D-creation gallery: browse the feed, fetch a creation, submit your own. |
| [marketplace-mcp](marketplace-mcp/README.md) | Read-only MCP server for the agent marketplace and skills catalog. |
| [metaplex-agent-mcp](metaplex-agent-mcp/README.md) | MCP server that deploys an agent on-chain into the Metaplex Agent Registry on Solana in one atomic transaction. |
| [mocap](mocap/README.md) | Motion capture as an API: webcam or video to face, pose, and hand animation clips, replayable on any avatar. |
| [motion](motion/README.md) | Text and structure to a three.js AnimationClip: forward and inverse kinematics, balance, ground contact, and secondary motion, with no mocap data. |
| [names](names/README.md) | ENS and SNS name resolution, threews.sol subdomain minting, and pay-by-name in one import. |
| [naming-mcp](naming-mcp/README.md) | MCP server to resolve .sol names and check threews.sol agent-handle availability. |
| [notifications-mcp](notifications-mcp/README.md) | MCP server for the notification inbox: list events, mark read, tune delivery, register Web Push devices. |
| [onchain-agent-wallets](onchain-agent-wallets/README.md) | Gives an agent a real Solana wallet with a spending allowance instead of your keys. |
| [oracle-model](oracle-model/README.md) | The three.ws Oracle conviction model running locally: score any pump.fun launch offline from the real bucket weights, no API key. |
| [portal](portal/README.md) | Turns any website into a walkable 3D city: sections become buildings, links become doors, images become billboards. |
| [portfolio-mcp](portfolio-mcp/README.md) | MCP server for an agent's trading state: portfolio, balances, PnL feed, and one signed Solana transfer. |
| [pose](pose/README.md) | Deterministic named pose seeds: a natural-language prompt to a stable seed and full joint-rotation map. |
| [provenance-mcp](provenance-mcp/README.md) | MCP server for the agent action-provenance log: append-only, ERC-191 signed, on-chain verifiable. |
| [pumpfun-mcp](pumpfun-mcp/README.md) | Free read-only pump.fun and Solana MCP server: token discovery, curve and holder analysis, fee tracking, quotes. |
| [pumpfun-skills](pumpfun-skills/README.md) | pump.fun launch and trade skills as composable agent tools, with a runtime-supplied mint. |
| [react](react/README.md) | React components for embedding three.ws 3D AI agents in two lines. |
| [readme-3d](readme-3d/README.md) | Converts GLB, glTF, OBJ, and STL models into ASCII STL blocks GitHub renders as live 3D viewers in a README. |
| [render](render/README.md) | Renders rigged, animated avatars to PNG, GIF, and truecolor terminal ANSI with no GPU, no WebGL, and no headless browser. |
| [reputation](reputation/README.md) | SDK to read ERC-8004 agent trust scores and attest agent-to-agent feedback on-chain. |
| [retarget](retarget/README.md) | Retargets animations onto any humanoid GLB by canonicalizing bone names across every major rig convention. |
| [scene-mcp](scene-mcp/README.md) | MCP server that turns one sentence into a placed 3D diorama over the live three.ws pipeline. |
| [see](see/README.md) | Lets an agent see a 3D model: renders any GLB from several angles and returns frames it can look at, plus the geometry facts. |
| [shipfeed](shipfeed/README.md) | Turns raw commit history into a release feed humans read: conventional-commit parsing, audience classification, and changelog-to-commit provenance. |
| [sign-language](sign-language/README.md) | American Sign Language for 3D avatars: compiles text into one continuous signed animation clip, fingerspelling what it does not know. |
| [signals-mcp](signals-mcp/README.md) | MCP server for copy-trade signal feeds: marketplace, publisher leaderboard, subscribe, and kill switch. |
| [skill-license](skill-license/README.md) | On-chain skill licenses: each purchased skill is a 1/1 SPL NFT plus a deterministic PDA. |
| [spatial-mcp](spatial-mcp/README.md) | Validator, builder, and conformance fixtures for the Spatial MCP spec (live 3D scenes as MCP tool results). |
| [strategies](strategies/README.md) | Automated on-chain trading strategies for agents: DCA, copy-trading, and mirror execution. |
| [three-token-mcp](three-token-mcp/README.md) | MCP server that lets agents price, hold, and burn $THREE on-chain via the live token rail. |
| [threews-avatar-mcp](threews-avatar-mcp/README.md) | MCP server that renders a live rotatable avatar inline, plus embed iframe and metadata. |
| [tool-sdk](tool-sdk/README.md) | Typed tool authoring for three.ws MCP servers, with per-tool permission manifests. |
| [tty-3d](tty-3d/README.md) | The terminal 3D renderer core: GLB in, skinned and animated ANSI frames out, plus the `three-tty` CLI. |
| [tty-avatar](tty-avatar/README.md) | A live 3D avatar in the terminal: any GLB or three.ws avatar/agent rendered to truecolor half-blocks or braille, with moods, and Claude Code hooks that make it your coding agent's face. |
| [tutor-mcp](tutor-mcp/README.md) | MCP server for the Pay-As-You-Learn tutor ledger: itemized running tab and attested invoice. |
| [vanity](vanity/README.md) | WASM-accelerated Solana vanity address mining in the browser or Node, with a paid x402 fallback. |
| [vanity-mcp](vanity-mcp/README.md) | Read-only MCP server for the vanity grind-bounty market and proof-of-grind rarity gallery. |
| [viewer-presets](viewer-presets/README.md) | Tuned visual presets for avatar viewers: light rigs, floor reflection, bloom, and PBR materials. |
| [vision-mcp](vision-mcp/README.md) | MCP server that analyzes and describes images through the three.ws vision pipeline. |
| [voice](voice/README.md) | Speech for avatars: ASR, TTS, and Audio2Face lipsync visemes in one import. |
| [vscode-3d](vscode-3d/README.md) | VS Code extension that renders .glb and .gltf files in an editor tab, retargets library or text-described animations onto them and bakes the result, generates and refines models, optimizes and git-diffs them, AI quality-checks a render, and lint-checks `<agent-3d>` embeds with quick fixes. |
| [vscode-x402](vscode-x402/README.md) | VS Code extension to browse the x402 bazaar, decode 402 challenges, and pay per call from the editor. |
| [witness](witness/README.md) | Records a real user session as intent, not pixels, and compiles it into a Playwright spec that stays red until the reported bug is fixed. |
| [x402-fetch](x402-fetch/README.md) | Drop-in fetch wrapper that automatically pays x402 payment challenges. |
| [x402-mcp](x402-mcp/README.md) | MCP server giving any agent a self-custodial x402 wallet: search the bazaar, inspect prices, pay and call. |
| [x402-preflight](x402-preflight/README.md) | Verifies a signed, time-bounded payability attestation from an x402 seller before you sign anything, and routes you to a rail that works. |
| [x402-server](x402-server/README.md) | The merchant side of x402: issue 402 challenges, price SKUs, verify and settle payments on Solana and Base. |
~~~~

