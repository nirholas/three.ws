# Add a drift check for the UX Flow Atlas and trace the highest-traffic routes it never covered

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/781-plan-docs-ux-flows-atlas-route-coverage.md`.

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

`docs/ux-flows/` is a hand-traced reference of what each page does, cited to real source, and it is also the quickest map for an agent or QA person who has to verify a flow. It was written once (clusters 01 to 12) and has no check. Measured today, only about 232 of the 1,014 pages in `data/pages.json` appear in it, and the atlas cites at least 63 routes (for example `/create-review`, `/scan`, `/agent/new`, `/marketplace-analytics`, `/walk-embed`) that are not in the page index, so some are aliases or dynamic and some may be dead. Nothing flags either problem. The docs contain no open defects (the only "fixed" note is the 2026-08-06 CSRF repair on the account page), so this is a P3 reference-quality order, not a bug hunt, but a drift gate keeps the reference trustworthy and gives the QA sweeps a coverage list.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Twelve cluster files, 01 to 12; the `03` to `12` files are in this batch. Each flow has Steps, Decision points, Empty/error states, External calls, with file and symbol citations.
- Page index: `data/pages.json` (1,014 `path` values by a recursive walk), built into `public/sitemap/index.html` and `public/atlas-index.json` by `scripts/build-page-index.mjs` and `scripts/build-atlas-index.mjs`.
- Existing neighbors that must not be duplicated: the guided tour atlas (`scripts/build-tour-atlas.mjs --check` as `npm run audit:tour-atlas`, which is about tour stops and screenshots, not these docs) and `scripts/audit-page-index.mjs`.
- No script reads `docs/ux-flows/` for coverage: `grep -rn "ux-flows" scripts` only matches the docs search-index builder.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
node -e '
const fs=require("fs");const j=JSON.parse(fs.readFileSync("data/pages.json","utf8"));const paths=new Set();
(function w(o){if(Array.isArray(o))o.forEach(w);else if(o&&typeof o==="object"){if(typeof o.path==="string")paths.add(o.path);Object.values(o).forEach(w)}})(j);
const txt=fs.readdirSync("docs/ux-flows").filter(f=>/^\d+.*\.md$/.test(f)).map(f=>fs.readFileSync("docs/ux-flows/"+f,"utf8")).join("\n");
console.log(paths.size,[...paths].filter(p=>txt.includes("`"+p+"`")).length)'
ls scripts | grep -i "audit-page-index\|build-atlas-index"
sed -n 1,30p scripts/audit-page-index.mjs
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Write `scripts/audit-ux-flows.mjs` (and `npm run audit:ux-flows`): parse every `docs/ux-flows/NN-*.md`, extract each backticked route in the routing tables and flow headings, and report (a) cited routes that resolve nowhere (not in `data/pages.json`, not a rewrite in `vercel.json` or `vite.config.js`, not a known dynamic prefix), (b) pages in `data/pages.json` marked as user-facing that no flow cites, ranked by whether the page is linked from the home or nav (use `public/atlas-index.json`). Exit non-zero only on (a); (b) is a report with a committed baseline `scripts/audit-ux-flows.baseline.json` so coverage can only grow.
2. Unit test `tests/audit-ux-flows.test.js`: route extraction from a fixture markdown string, alias resolution through the route table, and the baseline ratchet.
3. Resolve every (a) finding: for each stale route, either the page was renamed (update the doc line and its file citations after re-reading the source), or it is dead (remove the flow and say so in the commit message). Do not guess; re-read the entry module cited.
4. Trace the 12 highest-value uncovered routes into a new cluster file `docs/ux-flows/13-additional-routes.md` in the same format (Steps, Decision points, Empty/error states, External calls, with real file and symbol citations): rank by the (b) report, prefer money and onboarding routes (`/credits`, `/payments`, `/pay/simulator`, `/agent-wallet`, `/wallet`, `/trading`, `/markets`, `/dashboard/account`, `/login`, `/agora`, `/play`, `/launches`) over marketing pages. Each flow is traced from code, not from running the site.
5. Wire the doc into search: confirm `scripts/build-docs-search-index.mjs` picks up the new file; run `npm run build:docs-search`.
6. If a traced flow reveals an unreachable state or a visible bug, do not fix it in this order; write it as a one-line `Finding:` under that flow and report it so the owner can route it (most should be none).

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npm run audit:ux-flows` exits 0 with zero stale routes; the baseline file exists.
- [ ] `npx vitest run tests/audit-ux-flows.test.js` passes.
- [ ] `docs/ux-flows/13-additional-routes.md` exists with at least 12 flows, each citing real files that exist (the audit script also checks that cited file paths exist on disk).
- [ ] `npm run audit:docs` and `npm run check:rules -- --paths docs/ux-flows scripts/audit-ux-flows.mjs` clean.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| A cited route is a dynamic pattern (`/agent/:id`) | Resolve against the route table patterns in `vercel.json`; treat a matching pattern as resolved. |
| A page's entry module is huge (the 9k-line marketplace) | Trace by the handler symbols and say "structural read" as the existing docs do. |
| Disagreement between code and doc | Code wins; update the doc and cite the symbol. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/781-plan-docs-ux-flows-atlas-route-coverage.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `781-plan-docs-ux-flows-atlas-route-coverage.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/ux-flows/12-home-and-content.md` (whole file)

~~~~markdown
# Home & Content Pages

This atlas covers the landing page (`/`) in full and every content / read-only
page on three.ws. The home page is highly interactive (live 3D agents, embedded
Forge / pose / token widgets); the content pages are mostly read-only but several
carry real interactive bits (docs search, glossary filter, changelog tag filter,
status polling, copy-to-clipboard, countdown, newsletter signup, embedded 3D
viewers), all confirmed against source.

---

## Home - `/`

- **Source:**
  - Markup + inline modules: `pages/home.html` (~3900 lines; CSS extracted to `/home.css`; served via `vercel.json` `"/" → "/home.html"`)
  - Lazy-mounted widget modules: `src/home-forge.js` (+ `src/home-forge-controls.js`), `src/home-pose.js`, `src/home-live-token.js`, `src/home-bento.js`, `src/home-sniper.js`, `src/home-live-agents.js`, `src/economy-ticker.js`
  - Other lazy mounts referenced by inline scripts: `src/avatar-drop.js`, `src/walk-embed-preview.js`, `src/pump/homepage-launcher.js`, `src/api-playground.js`, `src/forge-embed-snippets.js`, `src/erc8004/qr.js`
  - Web component runtime: `<script type="module" src="https://three.ws/agent-3d/latest/agent-3d.js">` (near the top of `<head>`) + `/model-viewer-meshopt.js` (no `/embed.js` on this page)
  - Chrome: `/nav.js` + `/seasonal.js`; the footer is hardcoded inline in `home.html` (no `/footer.js` here)
- **Entry point:** Root route. No auth. The hero `<agent-3d>` and the capability/press strips render immediately (the capability strip is decorative: `aria-hidden` and unreachable by keyboard); every widget below the fold is lazy-loaded on `IntersectionObserver` to keep the initial payload light. The hero avatar is not simply the first curated entry: `src/home-live-agents.js` reads each candidate's `size_bytes` from one `GET /api/avatars/featured` response and picks the richest model inside a 2.5 MB budget (the smallest when nothing fits), because the hero GLB is fetched, parsed and uploaded to the GPU while the page is still trying to become interactive.
- **Prerequisites / gates:** None. Fully public, no wallet/login. The mini-Forge uses an anonymous device `forge:cid` handle (localStorage); no sign-up required to generate a model. **Progressive disclosure:** first-time visitors get the "lite" page (`tws-lite` class unless `localStorage['tws:tier'] === 'full'`); eight advanced sections (plus the hero "Earn" bullet) are tagged `data-tier="advanced"` and hidden behind an "advanced platform" gate section (`#advanced-gate`) that links each of them (sniper, capabilities, token economy, live economy, oracle, x402, dev platform, stack).
- **Steps (the landing flow is browse-and-branch, not linear; the "required" path is reach a CTA → click → leave to a product route):**
  1. Land on hero: headline "The 3D agent layer of the internet.", three hero bullets (the third, "Earn USDC per chat", is advanced-tier), a live `<agent-3d>` on stage, and the eyebrow link "New · Text → 3D is live…" → `/forge`.
  2. (Optional) Forge from the hero: `#hero-forge-form` is a live text-to-3D input ("describe anything…" + **"Forge it"** button + three Try chips: low-poly fox / sci-fi helmet / ceramic teapot) that types straight into the mini-Forge, which now sits directly under the hero. An "Open the full Forge →" note links `/forge`. A `<lang-switcher>` sits under the CTA row.
  3. (Optional) Trigger a hero animation chip (🎲 Random, 👋 Wave, 💃 Dance, 🤸 Capoeira, 🦘 Jump, 🧟 Thriller, 🙏 Pray); each chip drives the live agent, and a counter tracks triggers.
  4. Choose a primary CTA: **"Build your agent →"** → `/create`, **"See the embed"** → `#embed` anchor (in-page Playground), or **"▶ Take the tour"** → `/tour`. (The "Text → 3D" hero CTA is gone; that label now only appears in the closing section.)
  5. (Optional) Follow the "Start here · three steps, about five minutes" section: 01 Create a 3D avatar → `/create/prompt`, 02 Build an AI agent → `/create-agent`, 03 Publish anywhere → `#embed`, plus "Power user? Skip to the advanced platform ↓" → `#advanced-gate`.
  6. (Optional) Scroll through the page's ~25 sections, each demoing a capability with a live widget and its own CTA (see Decision points below).
  7. Click any CTA to leave for the target product route.
- **Decision points / branches (every body CTA → destination, exact labels):**
  - Hero / eyebrow: eyebrow → `/forge`; "Build your agent →" → `/create`; "See the embed" → `#embed`; "▶ Take the tour" → `/tour`; hero forge bar → in-page mini-Forge.
  - Press strip: news links → `/news/*` routes (MCP/x402 Bazaar, IBM collaboration, AWS Marketplace, Alibaba Cloud Marketplace, and one numeric X-article slug).
  - Three Doors: "Start building" → `/create`; "Read the docs" → `/docs`; "Set up monetization" → `/dashboard/monetize`.
  - What You Get cards: "Open viewer" → `/playground`; "Widget Studio" → `/widgets`; "Claim your subdomain" → `/dashboard/account`.
  - Community Forge: "Generate yours →" → `/forge`.
  - Autonomous trading (`#home-sniper`, via `src/home-sniper.js`): "Watch the arena →" → `/arena`; "Arm a strategy" → `/oracle/arm`. The engine pill is honest about solvency: a `starved` engine (no wallet can fund a trade) reads "Engine out of SOL" in the down style, and a degraded fleet shows "N/M wallets funded".
  - Pose Studio: "Pose Studio" → `/pose`; "Open this pose in the full studio →" → `/pose?…` (carries pose params).
  - Mini Forge: "open the full Forge →" → `/forge`.
  - AR: "Forge gallery"/"Generate your own model →" → `/forge`; "Open this model in AR →" → `/forge`; "Browse the avatar gallery →" → `/gallery`; "AR feature overview →" → `/features/ar`; "How AR works →" → `/blog/see-your-3d-in-ar`.
  - Capabilities Bento: "Continue in Avatar Studio →" → `/create/selfie`; a sign-language card → `/sign-language`.
  - Pump.fun token: "Explore token agents →" → `/launches`; "Trending tokens" → `/radar`; "Launch yours" → in-page launcher (`src/pump/homepage-launcher.js`).
  - Live economy: "Agent Galaxy" inline link → `/galaxy`.
  - Oracle: "Open Oracle →" / "View all conviction scores →" → `/oracle`; coin cards deep-link `/oracle/coin/<mint>`.
  - Pay-per-call: "Configure monetization →" → `/dashboard/monetize`.
  - Walk: "See walk mode →" → `/temporary` (the `/walk` route still exists but home points at `/temporary`).
  - Developer platform: "Get a key ↗"/"Get API key →" → `/dashboard/api`; "Docs" → `/docs`; "GitHub" → github.com/nirholas/three.ws; "OpenAPI" → `/openapi.json` (the routed spec; the handler is `api/openapi-json.js`); "MCP server" → `/docs/mcp`.
  - The Stack: Studio → `/studio`; Registry → `/discover`; Embed → `/docs`; Pay-per-call → `/dashboard/monetize`; Walk → `/temporary`; SDK → `/docs/sdk`.
  - Showcase 3D: "Browse all" → `/discover`; "Make your own" → `/create`.
  - Avatar Drop & Vclose: "Build your agent →" → `/create`; "Text → 3D" → `/forge`; "Read the docs" → `/docs`.
  - Footer (6 columns, inline in home.html): Product (`/create`, `/forge`, `/image-to-3d`, `/marketplace`, `/discover`, `/pricing`, `/dashboard` labeled "Console"), Explore (`/agents`, `/reputation`, `/characters`, `/gallery`, `/bazaar`), Developers (`/docs`, `/avatar-sdk`, `/dashboard/api`, `/artifact`, `/sitemap`), Integrations (`/galaxy`, `/x402`, `/aws`), Company (`/blog`, `/community`, `/support`, `/status`, X, GitHub, `mailto:support@three.ws`), Legal (`/legal/privacy`, `/legal/tos`), plus a "$THREE contract address" copy button.
- **Embedded interactive widgets (in-page, no navigation required):**
  - **Hero agent**: live `<agent-3d>` + 7 animation chips + the hero forge bar.
  - **Playground (`#embed`)**: editable embed-code textarea (HTML/React/Vue tabs), mode chips (inline/widget), background chips plus a custom color picker (`#pg-color-trigger`/`#pg-color-hex`), an avatar row (`#pg-avatars`), feature toggles (responsive/nameplate/chat/eager), live `<agent-3d>` preview, 7 animation test chips (idle/wave/dance/capoeira/jump/thriller/celebrate), copy-code button.
  - **Mini Forge (`#home-forge`, `src/home-forge.js`)**: real text-to-3D, now directly under the hero: prompt bar with typewriter suggestions (Tab to accept), example chips, POST `/api/forge` (tier `standard`, `backend: null` so the server's health-aware router picks the lane), poll `GET /api/forge?job=…`, live `<model-viewer>` result, session history rail (localStorage `forge:home:history`; a separate `forge:home:count` drives milestone nudges as the device's collection grows), result toolbar of 7 controls (auto-rotate toggle, Variation, Scene Studio → `/scene?model=…`, Embed sheet, Copy share link, GLB download, Clear), and an embed sheet (iframe/web-component snippets, size presets, copy, standalone link). Share copies a real OG-unfurling permalink `/forge/share/<creation_id>` for fresh forges, or a remix link `/?prompt=<encoded>&remix=1` for history-restored results; arriving with `?prompt=`/`&remix=1` auto-forges on load (the module boots eagerly when the URL carries a prompt). An "Options" disclosure (`src/home-forge-controls.js`) adds quality tiers (draft/standard/high, high gated behind $THREE holding), a live engine picker fed by `/api/forge?catalog` + `?health` (TRELLIS.2 is the default image lane; the Modly TripoSG and Modly Hunyuan lanes are labelled there too, and Tencent-model lanes are refused server-side in the EU, UK and South Korea), aspect ratio, and BYOK keys. Cancel/retry wired. Honest elapsed timer only, plus a warming line while a scale-to-zero GPU lane boots: the poll frame carries `cold_start` and the lane's real boot budget, so `coldStartLabel()` (`src/shared/forge-frames.js`) says "Waking up a GPU: about Ns of boot left" instead of implying a slow render, the numbers come off the payload rather than a local clock, and the line clears on the first real "running" poll.
  - **Pose Studio (`#home-pose`, `src/home-pose.js`)** - drag-to-orbit rig, joint sliders, preset chips, reset/snapshot/copy-link/open-studio buttons.
  - **AR (`#home-ar`)**: `<model-viewer>` with `ar` modes (webxr/scene-viewer/quick-look), desktop QR (lazy `src/erc8004/qr.js`), model cycling (fed by a top-sorted `/api/forge-gallery` fetch).
  - **Live token card (`#hlt-card`, `src/home-live-token.js`)** - real Pump.fun data; plus homepage launcher.
  - **Oracle feed**: `GET /api/oracle/feed?network=mainnet&limit=6&min_score=56`, renders top conviction coins ("Oracle is warming up…" empty state; error state renders an "Open Oracle →" button). During a database outage the endpoint answers `503` with `Retry-After` instead of a confident empty feed, so the section shows the error state rather than a dead market presented as fact.
  - **Community Forge gallery**: a live, sortable browse loop over `GET /api/forge-gallery?scope=community&…limit=24`: Fresh/Trending tabs (`sort=fresh` vs `sort=top&window=week`), a 25s background refresh that prepends genuinely-new models on Fresh (the pulsing live chip is earned, not assumed: it needs the newest model in the list to be under six hours old, read off the timestamps rather than arrival order, so a stalled generation pipeline stops the chip instead of pulsing over two-day-old work), prompt-based dedupe, and a "Show more" button (12 shown initially, up to 24). Cards paint as poster images and upgrade to the live rotating mesh only as they near the viewport; community cards stay as posters.
  - **Showcase 3D grid**: `GET /api/explore?source=avatar&only3d=1&category=avatar,creature&limit=24&quality=high` (via `src/home-live-agents.js`), agent cards + CTA cards; each card links the item's `detailUrl` (the canonical `/avatars/<id>` detail page with chat, skills, embed and launch actions), not the bare GLB viewer.
  - **Other live agents** - What-You-Get viewer (50+ animation chips), Bento mini-agents, Vclose agent, Avatar Drop canvas, Walk preview canvas.
- **External calls / dependencies:** `POST/GET /api/forge` (+ `?catalog`/`?health` for the options panel), `GET /api/forge-gallery`, `GET /api/explore`, `GET /api/oracle/feed`; Pump.fun feed (live token card); `agent-3d` runtime + `model-viewer` 4.4.0 from jsDelivr (lazy). Solana RPC indirectly via the launcher.
- **Success state:** User reaches and clicks a CTA into a product route, or completes an in-page demo (e.g. a forged model rendered with a working toolbar; an embed snippet copied).
- **Empty / error states:**
  - Mini Forge: 503/`unconfigured` → "The generator is offline right now" (with a try-again-in-a-bit tail); 429/`rate_limited` → "The forge is busy. Try again in about N seconds."; poll timeout → "Generation timed out" plus a try-a-simpler-single-subject-prompt hint; a high-tier request without the $THREE hold gets its own gate message; viewer load failure surfaced; explicit error state with **Try again** (re-runs `lastPrompt`) and **Cancel**.
  - API-fed sections (Oracle, Community Forge, Showcase) degrade gracefully if their fetch fails (sections render empty rather than break the page).
  - Hero avatar: a slow load adds a "Still loading the live agent" line with a Retry button; an outright failure lays a "The live preview couldn't load right now." card with Retry over the stage rather than wiping it, because disposing a mid-boot WebGL context is synchronous and cost more than the failure it was handling. A CDN failure that leaves `<agent-3d>` undefined falls into the same designed card instead of a silent black stage.
  - Reduced-motion respected throughout (typewriter, parallax, scanline disabled).
  - Clipboard blocked → fallback hidden input + `execCommand('copy')` with "Press ⌘/Ctrl-C" toast.
- **Step count:** ~3 required to leave via a CTA (land → optional browse → click) **(+ many optional)**: the page exposes ~40 distinct CTAs and ~13 self-contained interactive widgets, each an optional sub-flow.

---

## Content & Read-Only Pages

### What is three.ws - `/what-is`
- **Source:** `pages/what-is.html` (static; `<model-viewer>` 4.4.0 from the jsDelivr CDN).
- **Entry point:** `vercel.json` `/what-is → /what-is.html`.
- **Steps (4):** 1) Read hero/overview. 2) Expand/collapse FAQ accordion (4 questions: crypto, free-to-start, skills-needed, where-embed) via `.fl-faq-q` buttons. 3) Drag/orbit the embedded sample avatar (`/animations/soldier.glb`). 4) Follow a nav/CTA link (`#use-cases`, `/`, `/brain`, `/chat`, `/create`, `/create/selfie`, `/docs`, `/features`, `/forge`, `/overlay-control`, `/pay`, `/play`, `/studio`).
- **Notes:** Schema.org FAQPage + WebPage. No API calls. Interactive: FAQ accordion + 3D viewer.

### Features (index) - `/features`
- **Source:** `pages/features.html` (static + 3D widgets; `/footer-newsletter.js`).
- **Entry point:** `vercel.json` `/features → /features.html`. (Subpages `/features/*` covered elsewhere.)
- **Steps (7):** 1) Hero "Core" vs "Optional" pill nav scrolls to `#core`/`#optional`. 2) Animation showcase: ~31 pills swap a live `<model-viewer>` `src` (`/animations/*.glb`) with a "Now Playing" label. 3) Browse the **"New on three.ws"** strip (`#featNewGrid`): populated at runtime from `GET /changelog-recent.json` (the newest 150 entries; the full `/changelog.json` is the fallback when that file is missing), filtered to launches/feature-tagged entries, deduped, 6 newest rendered as cards (kind tag, date, title, summary) linking to the entry's page or `/changelog/<slug>`; skeletons while loading, and a fallback link to `/changelog` on fetch failure. 4) Copy embed snippet (`#embedCopyBtn` → clipboard, "Copied!" 2s). 5) Scroll-reveal cascade (IntersectionObserver). 6) Interact with multiple embedded `<model-viewer>` demos. 7) Newsletter signup (footer `data-newsletter-form` → `POST /api/newsletter/subscribe`).
- **Notes:** The only content fetch is the changelog feed for the newest strip; copy button + animation picker + newsletter form are the other real interactions.

### Status - `/status`
- **Source:** `pages/status.html` (dynamic).
- **Entry point:** `vercel.json` `/status → /status.html`.
- **Prerequisites / gates:** None.
- **Steps (4):** 1) On load, fetch `GET /api/status` and render service cards (status dot, uptime %, avg latency, 90-day history bar); a subsystem that publishes structured `metrics` (today the agent index) also renders metric pills beside its sentence: Solana lag, Solana agents, EVM lag, Events indexed (`subMetrics`). 2) Auto-poll every 5 min (`setInterval`, 300000 ms) updating the `aria-live` banner ("All systems operational" ↔ "X of Y services disrupted"). 3) Hover/focus a 90-day history cell for per-day tooltip. 4) Read the live build stamp: a `GET /api/version` fetch fills `#st-build` with the live commit (linked to GitHub), version, Cloud Run revision, and build time; it stays hidden if the endpoint is unreachable. A "Last check …" stamp (`#st-checked`) sits beside the cadence sentence. Footer links to the SVG status badge (`/api/status?format=svg`) and `/changelog`.
- **External calls:** `GET /api/status`, `GET /api/version`.
- **Success state:** Live service grid rendered with current operational status + "last check" timestamp.
- **Empty / error states:** Skeleton loaders on first paint; on fetch failure renders an error message with retry guidance.
- **Step count:** 1 required (page loads + auto-fetches) (+2 optional: re-poll happens automatically; hover cells).

### Glossary - `/glossary`
- **Source:** `pages/glossary.html` + `src/glossary/page.js`; term data inline in `public/glossary.js` (`window.twsGlossary.terms`, injected site-wide by `nav.js`).
- **Entry point:** `vercel.json` `/glossary → /glossary.html`.
- **Steps (4):** 1) Type in `#glos-q` search (rAF-debounced `applyFilter`, case-insensitive, filters cards). 2) Result count updates (`#glos-count` aria-live: "X terms" / "Y of X terms" / "No terms match '…'"). 3) Deep-link `#<term>` scrolls + flash-highlights a card (`highlightFromHash`). 4) Read a term card.
- **Notes:** No external API; terms are a static inline object (36 terms: usdc, sol, solana, evm, wallet, x402, pay-per-call, on-chain, mint, bonding curve, pump.fun, gas, mainnet, testnet, base, nft, ipfs, mcp, a2a, erc-8004, agent reputation, identity registry, reputation registry, validation registry, attestation, vouch, stake, sybil attack, metaplex core, agenc, trust grade, memo attestation, graduation, skills, brain, rig). page.js polls up to 6s for the injected glossary data (self-injecting `/glossary.js` if nav.js didn't). Site-wide, the same script auto-underlines the first occurrence of each term and shows a tooltip; a page marks a subtree `[data-no-glossary]` to keep the scanner out of it (raw on-chain payloads, truncated labels), and the tooltip no longer puts tab stops inside `aria-hidden` content.

### Support - `/support`
- **Source:** `pages/support.html` (static).
- **Entry point:** `vercel.json` `/support → /support.html`.
- **Steps (5):** 1) Read intro/channels. 2) Copy a contact email via `.copy-btn` (support, security, partnerships, privacy, legal, dmca, abuse @three.ws) → clipboard, "Copied ✓" 1600ms; clipboard-blocked fallback opens `mailto:`. 3) Open a channel card in a new tab: GitHub Issues for bugs and feature requests, or "Questions & help", which opens a question issue template (`issues/new?template=question.yml`) in the same tracker; Discussions is no longer a channel. 4) Use a `mailto:` link. 5) Hover channel cards (border/translate/arrow microinteractions).
- **Notes:** No contact form / no backend submission - email links + copy buttons only. No API.

### Events - Build 3D Agents Live - `/events/build-3d-agents-live`
- **Source:** `pages/events/build-3d-agents-live.html` (static + realtime; `/embed.js`, `/footer-newsletter.js`).
- **Entry point:** `vercel.json` `/events/([a-z0-9-]+) → /events/$1.html`.
- **Steps (5):** 1) The countdown block reflects event phase (event was 2026-06-23 18:00 MT, 60 min, online; rAF tick → days/hrs/min/sec pre-event; "LIVE NOW" during; since EVENT_END passed it now renders the post-event headline "Thanks for joining" with the sub-label "this session has aired"; no replay link exists). Past-event mode also swaps the eyebrow to "Past event · hosted by three.ws" and strips the upcoming-event i18n hooks so the translation pass cannot paint the old copy back. 2) Add to calendar (`#add-cal`/`#add-cal-2` build a Google Calendar render URL from EVENT_START/END, re-applied on every `i18n:change`); both calendar controls are hidden once the event has passed, since adding a past event is a dead path. 3) RSVP email signup (`#rsvp-form`, `data-newsletter-form` → `POST /api/newsletter/subscribe`, aria-live result); after the event the section reads "Next session" / "Hear about the next live build" and asks for an email for the next scheduled session. 4) Interact with the lazy-loaded hero `<agent-3d>` (deferred via `requestIdleCallback` → `/embed.js`). 5) Scroll-reveal sections.
- **Notes:** Schema.org Event. Countdown is local (no API); only newsletter POSTs.

### Legal hub and policy documents - `/legal`, `/legal/privacy`, `/legal/tos`, `/legal/eula`, `/legal/content-policy`, `/legal/risk`, `/legal/agent-wallet`, `/legal/agreements`, `/legal/nvidia-ngc-eula`
- **Source:** `public/legal/index.html` (hub) plus one hand-authored static file per document: `privacy.html`, `tos.html`, `eula.html`, `content-policy.html`, `risk.html`, `agent-wallet.html`, `nvidia-ngc-eula.html`, and `aws-marketplace-eula.html`. The one non-static page is `agreements.html` + `public/legal/agreements.js`, the signing and review surface.
- **Entry point:** `vercel.json` maps each with an optional trailing slash: `/legal/? → /legal/index.html`, `/legal/privacy/?`, `/legal/tos/?`, `/legal/eula/?`, `/legal/content-policy/?`, `/legal/risk/?`, `/legal/agent-wallet/?`, `/legal/agreements/?`, `/legal/nvidia-ngc-eula/?`. `aws-marketplace-eula` has **no extensionless route**; the hub links it as `/legal/aws-marketplace-eula.html`, which resolves through the filesystem phase.
- **Steps (2):** 1) Land on the hub (h1 "Legal", three groups: Policies, Reporting something, Publishers) and pick a document. Real-Funds Agreements leads the Policies group, badged "Required before any real-funds action". 2) Read it; follow cross-links (the documents reference each other, the hub links `/docs/news-rights`, and every page ends in `mailto:` contacts: legal@, privacy@, abuse@, dmca@, support@three.ws).
- **The documents:**

  | Path | Effective | Shape |
  |---|---|---|
  | `/legal/privacy` | 2026-09-11, v3 | 17 h2 sections (through MCP Connectors / AI Processing, Free 3D Actions, Connected Homes, Changes, Contact) |
  | `/legal/tos` | 2026-09-17, v3 | 20 numbered sections; section 8 now covers Real-Funds Features, Agent Wallets and the Risk Disclosure together, and incorporates the Agent Wallet Agreement by reference |
  | `/legal/risk` | 2026-09-17, v2 | 10 numbered sections covering every real-funds surface (agent wallets, trading, sniping, autopilot, launches, swaps, withdrawals, x402, fiat onramps) |
  | `/legal/agent-wallet` | 2026-09-17, v1 | 17 numbered sections (custody, deposits at the depositor's own risk, no guaranteed withdrawal or recovery, no liability for loss, electronic signature and records) |
  | `/legal/eula` | 2026-07-14 | 16 numbered sections (License Grant, Restrictions, IP, Camera & Device Permissions, Customer Content, Blockchain & On-Chain Transactions, Third-Party Services, Confidentiality, warranties, liability, indemnification, term, export, governing law, entire agreement, contact) |
  | `/legal/content-policy` | 2026-06-21 | 10 numbered sections (Scope, ownership warranty, Prohibited content, Agents/personas/AI output, Tokens & financial content, Marketplace & monetisation, Embedded agents, Reporting & enforcement, Changes, Contact) |
  | `/legal/nvidia-ngc-eula` | 2026-09-02 | License terms for the three.ws container images distributed through the NVIDIA NGC catalog |
  | `/legal/aws-marketplace-eula.html` | static | AWS Marketplace standard EULA; reachable only from the hub |

- **Real-Funds Agreements - `/legal/agreements`:** the only interactive page in this family. `public/legal/agreements.js` imports the canonical gate from `/risk-ack.js`, lists each document with its version, and fetches `GET /api/legal/risk-ack?history=1` to render one of four states: **Signed** (name + date, "real-funds features are unlocked"), **Signature required** (three.ws refuses real-funds actions from the account, app and API alike, until it is signed), **Not signed in** (sign in to attach the signature to the account, or "Sign without an account" to cover this browser only, which is what funding someone else's agent needs), and **Signed in this browser** (a browser-only signature that still needs one account-level signing). A signature history table lists each row's date, typed name, version (superseded marked as such) and the surface it was taken from. A failed status fetch renders "We could not load your agreement status." with a working Try again; existing signatures are unaffected.
- **Notes:** No TOC, no anchors, no API on the static documents. They run the standard chrome (theme boot, `/nav.js`, `/footer.js`, `/i18n.js` runtime translation; most also load `/brand.js`) but every legal body is hand-authored static HTML. **`/legal/risk` is wired into product flow:** section 9 documents that before a first real-funds action, and before an agent wallet's deposit address is shown, the visitor signs the Risk Disclosure, the Terms of Service and the Agent Wallet Agreement together by confirming each one and typing their name; that the signature record holds the typed name, the document versions, a fingerprint of the text signed, the time, the feature, the IP and the user agent; that a material revision bumps the version and re-prompts; and that declining leaves the account usable for everything except real-funds actions. Treat that page and `/legal/agent-wallet` as the human-readable spec for the gate, not as inert copy.

### Tutorials index - `/tutorials`
- **Source:** `pages/tutorials.html` (client-rendered from `public/tutorials-manifest.js` → `window.TUTORIALS`, 71 entries today, 3 tiers; count them from the manifest rather than trusting a number here).
- **Entry point:** `vercel.json` `/tutorials → /tutorials.html`.
- **Steps (4):** 1) Use hero jump-links (`.tut-jump`, 3 tiers) to scroll. 2) Browse the tutorial cards (Easy 21 / Middle 27 / Advanced 23 today), grouped with section headers. 3) Click a card → `/tutorials/<slug>`. 4) Bottom CTA: "Open docs →" → `/docs`; "Read source on GitHub" (new tab).
- **Notes:** Dynamic render from the manifest `<script>`, no fetch. Hover: translateY + accent-bar.

### Tutorial article template - `/tutorials/prompts-for-3d`, `/tutorials/generate-3d-api`
- **Source:** `pages/tutorial.html` (route `/tutorials/([a-z0-9-]+) → /tutorial.html`); content markdown in `docs/tutorials/<slug>.md` (`docs/tutorials/prompts-for-3d.md`, `docs/tutorials/generate-3d-api.md`); metadata from `public/tutorials-manifest.js`.
- **Entry point:** Slug parsed from URL via regex, metadata via `window.tutorialBySlug(slug)`.
- **Steps (5):** 1) Read hero (title/meta from manifest). 2) Hero CTA (manifest-driven, e.g. "Open the Forge"). 3) Read article: markdown fetched `GET /docs/tutorials/<slug>.md`, parsed with marked + highlight.js; per-`<pre>` **copy code** buttons ("Copy" → "Copied" 1700ms); `figure:` directives in the markdown resolve to real captured images via `/tutorial-figures.js` + `/tutorial-figures.css` (pipeline shared with the cookbook recipe viewer). 4) Use the sticky TOC (scroll-spy) and heading anchors. 5) Prev/Next pager (adjacent manifest entries); back-to-top button + top progress bar.
- **External calls:** `GET /docs/tutorials/<slug>.md`.
- **Success state:** Rendered article with working TOC, copy buttons, and pager.
- **Crawlers see a complete page, not the shell.** Because the content is fetched client-side, the submitted URLs used to carry no text, and this shell's static fallback read "Tutorial not found" under a blank `<h1>`, so a crawler that did not run the fetch banked a not-found page under a real URL. `server/crawler-body.mjs` now renders the same markdown into the shell server-side (the `/walkthroughs/<slug>` player gets the same treatment from `data/walkthroughs.json`), and the client replaces its root wholesale on load; both sides strip the markdown's leading title, which the hero already owns.
- **Empty / error states:** "Tutorial not found" on an unknown slug or failed markdown fetch.
- **Step count:** 1 required (read) (+4 optional: CTA, copy, TOC nav, pager).
- **Notes:** text-to-3d & image-to-3d tutorials use this same template (covered elsewhere).

### Docs (index + all subpages) - `/docs`, `/docs/start-here`, `/docs/make-your-agent`, `/docs/share-and-embed`, `/docs/do-i-need-crypto`, `/docs/quick-start`, `/docs/agent-system`, `/docs/erc8004`, `/docs/embedding`, `/docs/web-component`, `/docs/mcp`, `/docs/skills`, `/docs/api-reference`, `/docs/sdk`, `/docs/listings` (and ~50 more)
- **Source:** Single SPA shell `docs/index.html` (served for `/docs`, `/docs/`, and `/docs/<slug>` per `vercel.json`); markdown content in `docs/*.md` and `docs/tutorials/*.md`. Marked + highlight.js via CDN.
- **Entry point:** `vercel.json` `/docs → /docs/index.html`, `/docs/([^./]+) → /docs/index.html` (the slug becomes a hash route). `currentPath()` reads `location.hash` (or `/docs/<slug>`), defaulting to `start-here`.
- **Steps (4):** 1) Land: the sidebar NAV is loaded from `GET /docs/nav.json` (currently 14 sections / ~286 links, with a designed failure state if the manifest 404s) + `start-here.md` fetched & rendered. 2) Sidebar **search** live-filters the nav by label AND surfaces a full-text results panel fed by the docs search index (with a Clear search control). 3) Click a sidebar link → hash route → `GET /docs/<slug>.md` rendered (headings get anchor IDs; internal `.md` links rewritten to hash routes; code highlighted). 4) Per-page tools: "Copy page" (markdown to clipboard), "View as Markdown" (`/docs/<slug>.md` new tab), "Open in Claude" (`claude.ai/new?q=…`); Prev/Next pager; mobile sidebar FAB/overlay; a lazy doc-freshness banner (`/doc-freshness.js`, backed by `public/docs-freshness*.json`).
- **External calls:** `GET /docs/nav.json`; `GET /docs/<slug>.md` per page (e.g. `do-i-need-crypto.md`, `quick-start.md`, `agent-system.md`, `erc8004.md`, `embedding.md`, `web-component.md`, `mcp.md`, `skills.md`, `api-reference.md`, `sdk.md`, `listings.md`, `make-your-agent.md`, `start-here.md`); marked + highlight.js CDNs.
- **Empty / error states:** Loading dots during fetch; "Page not found." on a missing slug; a designed nav-manifest failure state.
- **Notes:** Nearly all `/docs/*` slugs share this one SPA; the route is one repeated pattern: navigate (hash/sidebar/search) → fetch markdown → render, with copy-page + pager + TOC behaviors. Real steps per page = 1 required (read) +3 optional (search, copy-page, pager). **Exceptions mapped before the generic rule:** `/docs/widgets` (standalone page, below), `/docs/3d-api` → `/3d.html`, `/docs/agent-3d` → 308 → `/docs/web-component`, and the `/docs/walk*` family.

### Docs - Widgets (standalone) - `/docs/widgets`
- **Source:** `public/docs-widgets.html` (static; `vercel.json` `/docs/widgets → /docs-widgets.html`, mapped *before* the generic `/docs/*` rule).
- **Steps (4):** 1) TOC anchor nav (`#quick-start`, `#widget-types`, `#urls`, `#embedding`, `#postmessage-api`, `#og-oembed`, `#csp-cors`, `#privacy`, `#faq`). 2) Read code blocks (iframe/script/oEmbed/postMessage). 3) Review reference tables (widget types, URL schemes, hash params, postMessage events, OG/oEmbed). 4) Follow links (`/studio`, `/widgets`, `/docs/deployment`, oembed.com). The former footer `<model-viewer>` demo is gone; the page loads the model-viewer runtime but renders no demo of its own.
- **Notes:** Pure static docs, no API. Distinct from the docs SPA.

### Blog index - `/blog`
- **Source:** `blog/index.html` (static; `vercel.json` `/blog → /blog/index.html`).
- **Entry point:** `/blog`.
- **Prerequisites / gates:** None.
- **Steps (2):** 1) Scan the hardcoded list of 35 post cards (each shows title, date, informational tag). 2) Click a post → `/blog/<slug>`. (Also: RSS link `/rss/announcements.xml`; X/GitHub external links.)
- **Decision points / branches:** 35 indexed posts → individual article routes (38 post files exist; three are routable but unlinked from the index); RSS / social out.
- **External calls:** None - fully static list (no fetch, no pagination, no filter/search). Tags are display-only, not filterable.
- **Success state:** User opens an article.
- **Empty / error states:** N/A (static).
- **Step count:** 1 required (click a post) (+ optional RSS/social).

### Blog posts (38): `/blog/<slug>`
- **Source:** `blog/<slug>.html`: 38 routable static HTML files, all on **one shared template** (`.post-wrap`, `.post-meta`, `.post-tag`, shared nav/footer containers). Routed via `vercel.json` `/blog/([a-z0-9-]+) → /blog/$1.html`. One legacy slug redirects: `/blog/all-90-trades` 308s to `/blog/autonomous-trading-experiment`.
- **Slugs:** the routable set is exactly the `blog/*.html` filenames (38 today; enumerate with `ls blog/*.html`), which rots less than restating the list here. (`three-ws-alibaba-cloud-partnership`, `three-ws-play-coin-communities` and `ibm-user-group-first-in-world-meetup-recap` are routable but not linked from the index.)
- **Steps (1):** Read the article; follow the "← Blog" back link, inline links, and the occasional primary CTA (e.g. text-to-3d post → "Try Forge - type a prompt →" → `/forge`).
- **Notes:** Repeated "read article" pattern. No embedded 3D demos / share / TOC / newsletter inside the post body in the sampled pages; copy-button CSS exists in the template but the sampled posts have no code blocks. No API.
- **Source not exposed:** Several `.md` files under `blog/` (drafts and source material such as `decision-optimization-3d-ai-crypto.md`, `internets-second-species.md`, `we-are-the-provider.md`, the autonomous-trading X drafts, plus `README.md`) are NOT routed (no rule maps `.md` blog slugs) and are not in the index; source material only, not live pages.

### Changelog - `/changelog`, `/changelog/<slug>`
- **Source:** `public/changelog/index.html` (list) and `public/changelog/entry/index.html` (detail). Both are client-rendered from the generated feed; `data/changelog.json` is the authored source and `npm run build:pages` regenerates `public/changelog.json`, `public/changelog-recent.json` (the newest 150 entries in the same envelope, plus `total` and `complete`), `public/changelog.xml`, and `CHANGELOG.md` from it.
- **Entry point:** `vercel.json` `/changelog → /changelog/index.html`, `/changelog/([^.]+) → /changelog/entry/index.html` (one shell serves every entry; the slug is read from the URL), plus `/changelog.json` and `/changelog.xml` for the feeds.
- **Prerequisites / gates:** None. Public, no auth.
- **Steps (4):** 1) Land: first paint reads `GET /changelog-recent.json`, entries grouped by date newest-first, each day headed by its formatted date and badged **new** when it is inside the 14-day `RECENT_DAYS` window. The full history is not downloaded to paint the page (`/changelog.json` is every launch since the site existed and grows forever); it is fetched once, on demand, when the reader clicks **Show older updates** or picks a filter that needs to look past the window, and a failed upgrade leaves the 150-entry window on screen instead of erroring. A missing `changelog-recent.json` (an older deploy, a cached shell) falls straight back to the full feed. 2) Filter with the chip row (`all`, `launch`, `feature`, `improvement`, `fix`, `sdk`, `security`, `infra`, `docs`; `aria-pressed` tracks the active chip, and a `launch` entry also renders the page path it shipped). 3) Click an entry card → `/changelog/<date>-<slugified-title>`. 4) On the detail page the recent window is tried first and the full feed only if the slug is not in it, matched by re-deriving that slug, then rendered with a Share row (X intent link + a copy-link button).
- **External calls:** `GET /changelog-recent.json` then, on demand, `GET /changelog.json` (both pages).
- **Success state:** Filtered, dated list of shipped work; an entry page a holder can link to directly.
- **Empty / error states:** A filter matching nothing renders a "nothing here for this filter yet, try another one" line rather than a blank column; a failed feed fetch renders an error that links the raw `/changelog.json`; an unmatched slug renders "Entry not found." with a back link to `/changelog`.
- **Step count:** 1 required (read) (+3 optional: filter, open an entry, share).
- **Notes:** `/changelog.json` is unchanged and stays the documented public feed; the recent window is a paint optimisation, not a new contract. The header carries the subscribe row (`/changelog.xml` RSS, `/changelog.json`, `/llms.txt`, `/sitemap`). Delivery to the holders' Telegram channel is handled by the `changelog-push` cron off the same feed, not by this page.

### News index and articles - `/news`, `/news/<slug>`
- **Source:** `public/news/index.html` plus 112 static article files `public/news/<slug>.html`.
- **Entry point:** `vercel.json` `/news → /news/index.html`, `/news/([a-z0-9_-]+)/? → /news/$1.html`. The home page's press strip links straight into individual `/news/*` slugs, so most arrivals skip the index.
- **Steps (2):** 1) Scan the index: 112 hardcoded `post-link` cards, newest first, each with a `<time>` date, headline, summary paragraph, and a display-only tag list. 2) Click through to an article and read it; a "News" breadcrumb returns to the index, and inline links point at product routes.
- **External calls:** None. Fully static: no fetch, no pagination, no search, and the tags are not filterable.
- **Success state:** User reads the announcement and follows its product link.
- **Empty / error states:** N/A (static).
- **Step count:** 1 required (read) (+1 optional: back to the index).
- **Notes:** Slug shapes are mixed: readable slugs (`text-to-3d-is-live`, `quicknode-startup-program`) alongside numeric X-article ids (`2061713039624405062`). Enumerate with `ls public/news/*.html` rather than trusting a list here. Distinct from `/blog` (essays) and from `/markets/news` (the live market-news reader, covered in the trading walkthrough).

### Press kit - `/press`
- **Source:** `pages/press/index.html` (static; `vercel.json` `/press → /press/index.html`).
- **Entry point:** `/press`. Written for journalists: every asset is downloadable without asking permission.
- **Steps (5):** 1) Download the whole kit (`/brand/three-ws-press-kit.zip`). 2) Grab individual marks from **The marks** (`#prs-marks`): mark PNG, lockup on dark, lockup on light, stacked on dark, stacked on light, and the PWA icon SVG, each an anchor with `download`; the quoted pixel dimensions live in `data-dims` spans that `scripts/render-brand-assets.mjs` rewrites from each PNG's own header when it regenerates the assets, so they cannot go stale against the files. 3) **OpenAI Partner Network** (`#prs-openai`): two announcement social cards plus a link to `/openai`. 4) **Boilerplate** (`#prs-boiler`): four copy buttons, one delegated click listener, label flips "Copy" to "Copied" for 1600 ms, with the same hover and press feedback as the download links. 5) **Fast facts** (`#prs-facts-h`) table and **Contact** (`#prs-contact-h`), linking `/partners`, `/changelog`, GitHub, and X.
- **External calls:** None. Static assets served from `/brand/*` and `/partners/openai/*`.
- **Success state:** A writer leaves with correct marks, current boilerplate, and a contact address.
- **Empty / error states:** N/A (static). A blocked or absent clipboard no longer dead-ends: the handler selects the boilerplate passage and flips the label to "Selected, press Cmd+C" / "Ctrl+C" (or "Copy by hand" when even the selection fails), which closes the gap this page used to have against `/support`.
- **Step count:** 1 required (download or copy something) (+4 optional).

---

## Machine-Readable Endpoints

Agent/crawler endpoints - not user UX (0 user steps). All resolve via `vercel.json` rewrites.

| Endpoint | Route | Served by | Purpose |
|---|---|---|---|
| Sitemap | `/sitemap.xml` | `/api/sitemap` (function) | XML sitemap for crawlers (sub-sitemaps at `/sitemap/{core,agents,avatars,widgets,profiles,news}.xml`) |
| LLMs index | `/llms.txt` | `public/llms.txt` (static, generated by `npm run build:pages`) | Curated guide an agent can read whole: the official-domain and $THREE-mint block, then the pages listed under `site.llms` in `data/pages.json` (the build fails if a curated path stops being a real, indexable page) |
| LLMs full | `/llms-full.txt` | `public/llms-full.txt` (static, same generator) | The complete page list |
| Robots | `/robots.txt` | `public/robots.txt` (static) | Crawler directives |
| OpenAPI | `/openapi.json` | `/api/openapi-json` (function) | OpenAPI spec for the REST API (domain specs also at `/api/crypto/openapi.json`, `/api/3d/openapi.json`) |
| x402 discovery | `/.well-known/x402` | `/api/wk?name=x402` | x402 micropayment service discovery (`/.well-known/x402.json` → `name=x402-discovery`) |
| Agent attestation schemas | `/.well-known/agent-attestation-schemas` | `/api/wk?name=agent-attestation-schemas` | ERC-8004 attestation schema descriptors |
| OAuth AS metadata | `/.well-known/oauth-authorization-server` | `/api/wk?name=oauth-authorization-server` | OAuth 2.0 Authorization Server metadata |
| OAuth protected resource | `/.well-known/oauth-protected-resource` (also under `/api/mcp/`, and per hosted MCP server by RFC 9728 path insertion, e.g. `/.well-known/oauth-protected-resource/api/mcp-agent`) | `/api/wk?name=oauth-protected-resource` (`&path=` for a per-server copy; a path that is not a hosted MCP server 404s) | OAuth 2.0 Protected Resource metadata; each hosted MCP server gets its own `resource` so stock SDK connectors can sign in |
| Chat plugin manifest | `/.well-known/chat-plugin.json` | `/api/wk?name=chat-plugin` | AI chat-plugin manifest (the real LobeChat manifest) |
| Sperax plugin manifest | `/.well-known/sperax-plugin.json` | `/api/wk?name=sperax-plugin` | Sperax plugin manifest |
| Apple app-site association | `/.well-known/apple-app-site-association` | `/api/wk?name=apple-app-site-association` | iOS universal-link association for the App Store shell |
| Vanity metadata | `/.well-known/three-vanity.json` | `/api/wk?name=three-vanity` | Vanity-wallet discovery metadata |
| JWKS | `/.well-known/jwks.json` | `/api/auth/persona/[action]?action=jwks` | Signing keys |
| DID document | `/.well-known/did.json` | `/api/x402/did` | x402 DID document |
| Solana Actions | `/.well-known/solana/actions.json` | static | Solana Actions registry |
| Agent card (per asset) | `/a/sol/<asset>/.well-known/agent-card.json` | `/api/agents/solana/[action]?action=card` | Per-agent A2A card |

All `/.well-known/*` and `/openapi.json` / `/sitemap.xml` responses are JSON/XML for machines (agents, wallets, crawlers, OAuth/MCP clients), not rendered UI. The dynamic `/.well-known/*` family is handled centrally by `api/wk.js` (its `DISPATCH` map is the source of truth; public-discovery names get `Access-Control-Allow-Origin: *`, OAuth metadata stays origin-restricted, unknown names 404). A generic `/.well-known/(.*)` fallthrough additionally serves the static manifests in `public/.well-known/` (agent cards, `ai-plugin.json`, `mcp.json`, `security.txt`, `openapi.yaml`, and similar).
~~~~

### `docs/ux-flows/07-crypto-trading-analytics.md` (whole file)

~~~~markdown
# Crypto Trading & Analytics

UX Flow Atlas - Cluster 07. Read/monitor dashboards plus the interactive trading surfaces
that sit on the pump.fun + Oracle + sniper data engines. Every route traced to real source.

Routing convention in this repo: `/foo` is served from `pages/foo.html` (Vite multi-page input)
or a pre-built `public/foo.html` (static), wired by `vercel.json` rewrites. Client logic is the
inline `<script type="module">` and/or imported `src/*.js` modules. Watchlist state is a single
shared `localStorage` key `ld_watchlist` used by oracle, radar, watchlist, smart-money,
coin-intel, pump-visualizer and pump-live: adding a coin on any surface shows up on `/watchlist`.

---

### Oracle - `/oracle`
- **Source:** `pages/oracle.html`, `src/oracle.js` (~2500 lines), lazy `src/oracle-graph.js` (3D force graph), `src/oracle-tape.js` (live trade tape in the coin drawer)
- **Entry point:** nav link "Oracle"; direct URL; SEO/share links from `coinShareUrl()`. `/oracle/coin/<mint>` is now a standalone full conviction coin page (server-rendered by `api/oracle-share.js` in the markets-hub style: score dial, pillar bars, chart, launch intelligence; `public/oracle-coin.js` adds the shared chart-source switcher, so its Line and Agent trades views sit beside DexScreener, Birdeye, GMGN, DEXTools and GeckoTerminal tabs, and the $THREE page alone adds a Posts view (every @trythreews post plotted at the price it went out at, sized by engagement and coloured by the +4h return, with +1h/+4h/+24h medians against the any-time baseline, read from `public/data/trythreews-post-impact.json`, rebuilt by `npm run x:archive:price`), and the terminal pills carry a `from=oracle-share` tag), reached from the drawer's "Full page ↗" action. The server-rendered hero also carries the score's measured odds (what share of calls in that band won, against the random-launch base rate, read from `conviction-calibration.json` via `hitRateFor`) and a "Since the call" strip (peak multiple, graduated / rugged / still live, market cap now) joined from `pump_coin_outcomes`, so the first paint and the share preview never show an unqualified 100/prime on a coin the market has already resolved; the share description gets a "since:" clause for the same reason. Coin identity falls back to DexScreener when pump.fun does not answer, coin art is proxied through `/api/img`, and the route is GET-only.
- **Prerequisites / gates:** Public dashboard for all read views (feed, movers, wallets, edge, proof, agents, activity, graph). The **Agent** (arm) tab requires sign-in + an existing 3D agent with a custodial Solana wallet; Live mode spends real (capped) SOL.
- **Steps (N):**
  1. Arrive on `/oracle` → `boot()` populates category filter, binds tab/seg listeners, reads URL filters (`tier`, `category`, `minScore`, `view`), loads the **feed** view.
  2. System: `GET /api/oracle/feed?...` renders conviction cards (0 to 100 score, tier pill prime/strong/lean/watch/avoid). Each card's "Oracle's take" quotes the coin's own evidence (up to two reason clauses served with the feed, each with its lift over the base rate; the pillar template survives only for rows cached before reasons shipped), an odds chip states what that score band has actually returned ("N% held 2x+", shown once the band has 100+ resolved coins), and an outcome chip (graduated ✓ / rugged ✕ / peak Nx) lands once the market resolves the coin. If backend not migrated → "Oracle is warming up" honest empty state.
  3. System: opens SSE `EventSource('/api/oracle/action-stream')` - new scored coins stream in live; "Live · fused conviction" / "Reconnecting…" indicator.
  4. (optional) Filter: click `#tierSeg` tier buttons / category select / min-score / sort seg / ★-watchlist-only toggle / breadth-bar tier segments → `syncFilterUrl()` + `loadFeed()` (URL is shareable). A hero "Join the live Telegram feed" button appears when `/api/oracle/stats` reports a configured public signals channel.
  5. (optional) Switch view tab: `movers`, `wallets` (reputation leaderboard), `edge` (tier backtest win-rate; the hero names the specific bands that invert the ladder instead of claiming calibration, states the fitted event's own hit rate (a 3x run or graduation) beside the stricter clean-win rate, and each calibration row shows "claims N%" next to the realized bar, with "n/a" for an unmeasured band), `proof` (resolved wins), `agents` (agent win-rate ledger), `activity` (live agent actions), `graph` (3D force graph, lazy-imports oracle-graph.js).
  6. (optional) Click a coin card → `openDrawer(mint)` → `GET /api/oracle/coin?mint=...` renders the 4-pillar conviction breakdown (who/how/what/move); oracle-tape.js streams that coin's live trades.
  7. (optional) In the drawer: Full page ↗ (`/oracle/coin/<mint>`), pump.fun ↗, GMGN ↗ (via `src/shared/trading-terminals.js`, referral-tagged), solscan ↗, Details ↗ (`/launches/<mint>`), View in 3D ↗ (`/coin3d?mint=`), ☆/★ Watch (writes `ld_watchlist`), Copy mint, Copy link, Share to X; the live Market panel adds GMGN/DEXTools/DexScreener/GeckoTerminal/Birdeye links when available. A DEXTools link that knows only the mint goes through the counted redirect `GET /api/coin/dextools` (it resolves the top pool, redirects to its pair page, and records a per-day, per-surface visit in `dextools_referrals`, since DEXTools Social Boost ranks tokens by pair-page visits); when the pair is already known the link goes straight to its pair page, which is how the Oracle's market panel links the most liquid pair DexScreener names, and $THREE always its Social Boost pair.
  8. (optional, agents view) Follow an agent's signals: expand follow-panel. It shows the Telegram chat linked to the account (read-only, from `GET /api/oracle/telegram-chat`); signed out it asks to sign in, and with no linked chat it points to Settings, Sign-in methods. Follow → `POST /api/oracle/follow`, which answers 401 without a session and 403 without a verified linked chat.
  9. **Arm payoff (gated):** open **Agent** tab → `loadAgentPanel()` → `GET /api/agents`. Pick agent, set Min conviction (Prime/Strong+/Lean+), Size/trade SOL, Max daily SOL, Max open, category filters, the linked Telegram chat shown read-only (Send test → server push, same sign-in and linked-chat requirement), toggle Armed + Live/Simulate switches → **Save configuration** → `POST /api/oracle/watch` `{armed, mode, min_score, per_trade_sol, max_daily_sol, max_open, ...}`. Confirmation: "Armed in simulate/live mode. Your agent is watching the stream." Arming live is judged on the raw request, not the clamped values: a `per_trade_sol` below 0.001 SOL or a `max_daily_sol` below `per_trade_sol` answers 400 before any real-money loop starts (simulate keeps the forgiving clamps), and the GET side rejects a non-uuid `agent_id` with 400. The move INTO live-armed also requires a current signature on the three real-funds agreements (`requireRealFundsAgreement()`, `403 risk_ack_required` pointing at `/legal/agreements`); re-saving a watch that is already live-armed, simulate mode, disarming, and devnet all stay open.
- **Decision points / branches:** view tabs (9); feed warming vs populated vs filtered-empty; drawer coin scored vs "not scored yet"; agent has wallet vs needs creation (`/create/studio`); simulate vs live mode; signed-out → "Sign in and arm an agent".
- **External calls / dependencies:** `/api/oracle/feed`, `/api/oracle/coin`, `/api/oracle/search`, `/api/oracle/movers`, `/api/oracle/categories`, `/api/oracle/backtest`, `/api/oracle/wins`, `/api/oracle/stats` (hero statline + Telegram channel link), `/api/oracle/activity`, `/api/oracle/watch` (GET+POST), `/api/oracle/follow` (GET+POST), `/api/oracle/telegram-chat` (GET), `/api/agents`; SSE `/api/oracle/action-stream`; oracle-tape live trade stream in drawer.
- **Success state:** live conviction feed scoring every pump.fun launch in real time; coin drawer with pillar breakdown; armed agent acting on the stream (simulate logs / live spends capped SOL), actions graded into a win-rate ledger.
- **Empty / error states:** "Oracle is warming up" (backend not live); "No launches clear your filters" + Reset; the symbol search answers in the dropdown rather than closing it, quoting the query back ("No scored coin matches “<q>”. Oracle only searches launches it has scored.") on a miss and "Search is unavailable right now. Try again in a moment." on an outage, and a stale response can no longer overwrite a query the reader has moved on from; drawer "not scored"; "No ranked agents yet"; SSE auto-reconnects ("Reconnecting…"); `api()` returns `{ok:false}` on timeout (12s abort) and degrades gracefully; during a database outage the oracle endpoints (stats, feed, coin, activity, backtest, categories, follow, batch) answer 503 with Retry-After instead of a confident empty record, so the page shows its warming/retry state rather than "0 scored, 0 armed".
- **Step count:** 3 required (arrive → feed → live stream, all automatic) + ~6 optional read interactions, + a 6-field gated arm flow (steps 8-9).

---

### Agent Activity - `/activity`
- **Source:** `pages/activity.html` (self-contained; inline module, no `src/*` import)
- **Entry point:** nav; "Copy trades →" CTAs link to `/trader/<agent_id>`; linked from oracle activity view.
- **Prerequisites / gates:** None - public live monitor.
- **Steps (N):**
  1. Arrive → inline module sets `API='/api/oracle/activity'`, `STREAM_API='/api/oracle/action-stream'`, loads first page.
  2. System: `GET /api/oracle/activity?...` renders rows (agent, verb closed↑/↓/entered, $symbol, tier pill, sim/live tag, outcome win/loss/flat/open, PnL) + summary KPIs. The KPIs merge `/api/oracle/stats` with the 7-day rollup; a value the API does not carry prints "n/a" (never a dash or a fake zero), PnL (7d) stays "n/a" until a settled action carries a realized figure, and the win-rate tile is coloured against the market's own base rate rather than a fixed 50%.
  3. System: opens SSE `/api/oracle/action-stream` - new agent actions prepend live.
  4. (optional) Filter by tier chip, mode pill (sim/live), or outcome → re-fetch with `?tier=&mode=&outcome=`.
  5. (optional) Load more (cursor pagination).
  6. (optional) Click "Copy trades →" on a winning/open row → navigate to that agent's trader profile (`/trader/<id>`).
- **Decision points / branches:** filter combinations; win/open rows show Copy CTA, losses don't; stale badge + retry if a background refresh fails while rows are on screen.
- **External calls / dependencies:** `GET /api/oracle/activity`; SSE `/api/oracle/action-stream`.
- **Success state:** real-time trading floor of every agent's Oracle-driven move, outcomes graded, winners copyable.
- **Empty / error states:** empty feed placeholder; stale/reconnect badge with manual retry button on background-refresh failure; a stats outage renders the KPI tiles as "n/a" instead of leaving the skeleton shimmering.
- **Step count:** 2 required (arrive → feed+stream) + ~3 optional (filter, paginate, copy).

---

### Trending - `/trending`
- **Source:** `pages/trending.html` (inline module; imports `/src/shared/agent-wallet-chip.js`)
- **Entry point:** nav "Trending"; footer; share links.
- **Prerequisites / gates:** None - public dashboard.
- **Steps (N):**
  1. Arrive → inline module binds tab buttons (Agents / Trusted / Coins; arrow keys move between them) + window buttons (24h / 7d / All time), honors a `?tab=` deep link and keeps it in the address bar with `pushState`, loads default (Agents, 24h).
  2. System: `GET /api/trending?window=24h&limit=10` renders ranked list (agents by real chat activity, with wallet chip; coins by Oracle conviction score among coins scored inside the selected window, or every retained coin for All time, with ties broken by momentum and smart-wallet count so the board does not reshuffle on reload).
  3. (optional) Switch tab Agents / Trusted / Coins → renders the other ranked list; Trusted reads `GET /api/reputation/leaderboard?limit=25`, an all-time wallet-trust score, so the window control hides on that tab.
  4. (optional) Switch window 24h/7d/All time → re-fetch with new `window`; the legends and the coin empty state name the window.
  5. (optional) Click a row → `/agents/<id>` for an agent, `/oracle/coin/<mint>` for a coin, `/agents/<id>/wallet#reputation` for a trusted row. The whole row is the link, so the wallet chip renders without its Tip button and popover (tipping lives on the agent page).
- **Decision points / branches:** Agents / Trusted / Coins tab; 3 time windows; per-tab retry button on fetch failure.
- **External calls / dependencies:** `GET /api/trending?window=&limit=10`; `GET /api/reputation/leaderboard?limit=25` (Trusted tab). The `/api/trending` response also carries a `markets` list (open Event Markets ranked by picks placed or changed in the last hour, the same one-hour window for every `window`); this page does not render it.
- **Success state:** what's hot right now - top agents and top conviction coins across windows.
- **Empty / error states:** per-tab designed empty copy that names the window ("No agent chats in this window yet.", "No coins scored in the last 24 hours.") with a widen-the-window hint and a `/create` or `/oracle` link; per-tab error + Retry button (`#agentRetry` / `#coinRetry`). Server side, an unparseable `limit` falls back to 10 (max 20) instead of failing both rankings into a fake "nothing trending", and a ranking that does fail is logged before it degrades to empty.
- **Step count:** 2 required (arrive → list) + ~3 optional (tab, window, drill-in).

---

### Trade Terminal - `/trades`
- **Source:** `pages/trades.html`, `src/trades.js` (controller), `src/trades-detail.js` (deep-dive; imports `src/mission-control/chart.js`, `src/widgets/bonding-curve.js`, `src/trades-bubblemap.js`, `src/trades-tape.js`, `src/trader-format.js`)
- **Entry point:** nav; footer newsletter page link; deep link `?mint=<base58>` (+ `&tab=exits`, `&network=devnet`).
- **Prerequisites / gates:** None; public two-pane pump.fun analytics workstation. Only three.ws data (platform launches + agent exits) feeds the left rail; any mint can be pasted for a deep-dive.
- **Steps (N):**
  1. Arrive → `readUrl()` restores mint/tab/network (network persisted to localStorage `tf_network`); the deep-dive mounts immediately with the URL mint, or $THREE by default (never an empty void).
  2. System: left rail loads the active tab: **Launches** (`GET /api/pump/launches?network=&limit=40`, $THREE pinned at the top) or **Exits** (`GET /api/trades/feed?network=&window=7d&min_pnl_pct=10&limit=40`); refreshes every 30s. Header pulse (`GET /api/pump/helius-stats`, 20s) shows network mint rate, graduations/hour, and SOL price ± 24h change.
  3. System: centre deep-dive (`mountDetail`) paints header + skeleton instantly from the clicked row, then fills progressively from five live endpoints (`/api/pump/launch-detail` (its creator-fee block now carries this coin's own distributed share, summed from its distribution timeline, and the gap to the wallet-level claimed figure as a reconciliation rather than hiding it), `/api/pump/curve`, `/api/pump/intel`, `/api/pump/smart-money`, `/api/coin/:mint/cohorts`; cohorts only for platform-tracked coins) plus three self-fetching widgets: a chart with a source switcher (`mountSwitchableChart` from `src/shared/chart-switcher.js`; tabs for the platform's own TradingView-engine candles, DexScreener, Birdeye, GMGN, DEXTools and GeckoTerminal, the pick remembered in `ld_chart_view` and carried to every coin surface, each provider tab with an "Open in <provider>" link, arrow-key navigation, and an explanation plus retry when a provider cannot draw the coin). The default candle view is `src/mission-control/chart.js` (`GET /api/pump/price-history` over Birdeye, then GeckoTerminal, then pump.fun OHLCV, with the TradingView attribution link the chart library's license requires; a single candle is already a chart, so a coin minutes old draws and grows from the live stream, and a coin that has never traded says "No market yet" instead of blaming the interval), bonding-curve ring, live trade tape. A row clicked in the Exits tab carries its trade with it, so an "Agent exit" card (realized PnL, exit multiple, hold time, entry/exit SOL, exit reason, entry/exit tx links, the agent's `/agents/<id>` link and "Copy trader →" to `/trader/<id>`) paints with the shell, no second round-trip. The price strip reads a migrated coin as Graduated even when the curve account is closed, and swaps the SOL cell for a "Price source" cell (Jupiter / pump.fun curve) once there is no curve price to quote.
  4. (optional) Switch tab Launches ↔ Exits (`#ttTabs`) → reload rail; URL synced.
  5. (optional) Change network mainnet/devnet (`#ttNetwork`, persisted) → reload rail + remount deep-dive.
  6. (optional) Paste a mint into `#ttSearch` (base58-validated) → drives the deep-dive for that coin.
  7. (optional) Click any rail row → `select(mint)` remounts the deep-dive (re-selecting the mounted coin is a no-op); URL reflects `?mint=` for sharing.
- **Decision points / branches:** Launches vs Exits tab; mainnet vs devnet; platform-tracked coin (cohorts fetched) vs external mint (designed no-data state); each detail lane (curve / detail / intel / smart) degrades independently: a lane that threw says "Could not load this section. The request to three.ws failed." with its own ↻ Retry that reruns only that lane, while a coin the first-seconds indexer never observed gets designed not-indexed cards pointing at `/oracle/coin/<mint>`, Bubblemaps and Solscan instead of being blamed for an outage.
- **External calls / dependencies:** `GET /api/pump/launches`, `GET /api/trades/feed`, `GET /api/pump/helius-stats`, `GET /api/pump/launch-detail`, `GET /api/pump/curve`, `GET /api/pump/intel`, `GET /api/pump/smart-money`, `GET /api/coin/:mint/cohorts`.
- **Success state:** live two-pane terminal: rail of platform launches/exits, deep-dive with chart, bonding curve, holders/cohorts, funder bubblemap, smart money, wallet footprint, trade tape, outcome, agent economics; shareable `?mint=` URL.
- **Empty / error states:** per-tab empty copy that stays visible under the pinned $THREE row ("No launches indexed on this network yet." / "No agent exit cleared the +10% bar in the last 7 days." with a "Browse launches" action; on devnet both offer "Switch to mainnet"); feed load failure ("Could not load the launch feed." / "Could not load the agent exit feed." + Retry) only on a cold load, since a failed 30s refresh leaves the rows already on screen alone; per-lane retryable failure and not-indexed states in the deep-dive; the trade tape says "Live trades are unavailable for this coin right now. Showing settled trades only." and drops its live lamp when PumpPortal refuses the subscription; pulse failures silent (decorative).
- **Step count:** 3 required (arrive → rail + deep-dive) + ~4 optional (tab, network, search, row select).

---

### Trader Leaderboard - `/leaderboard`
- **Source:** `pages/leaderboard.html`, `src/leaderboard.js` (imports `src/trader-format.js`, `src/shared/agent-wallet-chip.js`, `src/leaderboard-earned.js`)
- **Entry point:** nav "Leaderboard"; footer.
- **Prerequisites / gates:** None - public ranked board.
- **Steps (N):**
  1. Arrive → `readUrl()` hydrates state (tab/network/window/sort/verified), live-refreshing every 20s. Two boards share the page: **Trading** (default) and **Earned** (`?tab=earned`, picked before first paint so it never flashes the trading view).
  2. System: `GET /api/sniper/leaderboard?network=&window=&sort=&verified=` renders ranked rows (agent name + verified badge, wallet chip, unique coins, copiers count); top 3 styled. Each row also carries `win_streak` and `hot_streak` (3 or more consecutive wins within the last 25 closed positions); the Arena board (`src/play/arena.js`) shows the streak badge, this page does not.
  3. (optional) Window: 24h/7d/30d/all (`#lb-window`) → URL + reload.
  4. (optional) Network: mainnet/devnet (`#lb-network`).
  5. (optional) Sort: score/pnl/winrate/roi (`#lb-sort` select).
  6. (optional) "Verified only" checkbox (`#lb-verified`).
  7. (optional) Click a row → trader profile (`src/trader.js`, `/trader/<agent_id>`) with full track record, equity curve, proof tab with on-chain tx, a "why" drawer on every closed trade (the evidence its gates had at entry, from `GET /api/sniper/receipt?id=`), copy-trading panel, shareable PnL card, a "Watch live room" link to `/trade-rooms/<id>`, and the syndicates and trader duels it appears in.
  8. (optional) **Earned** tab → `GET /api/leaderboard/earnings` ranks public agents by what they earned in the window (creator fees from their coins plus service income from x402 skill sales and hires, each beside the total); it opens on 7d, refreshes every 60s (the snapshot behind it updates every 30 minutes), pages 25 rows at a time, states "Figures refreshed <time>" (or that the fee index is older than usual) only when the window has snapshot rows behind it, and every row links to the agent's page, whose Earned card carries the same figures.
- **Decision points / branches:** Trading vs Earned tab; 4 windows × sort × network × verified (Trading); stale/reconnecting badge when a background refresh fails with a board already on screen.
- **External calls / dependencies:** `GET /api/sniper/leaderboard`; `GET /api/leaderboard/earnings` (Earned tab); row payoff `GET /api/sniper/trader` (on trader page).
- **Success state:** shareable ranked board; every number deep-links to its on-chain transaction via the trader profile.
- **Empty / error states:** "No agent has closed a sniper position in this window…" with guidance (widen window / disable verified); an empty Earned window offers "See all-time earnings"; `#lb-retry` button on load failure; stale badge.
- **Step count:** 2 required (arrive → board) + ~6 optional (filters, sort, drill to trader, Earned tab).

---

### Coin Radar - `/radar`
- **Source:** `pages/radar.html`, `src/radar.js` (imports `src/shared/log.js`, mounted via `mountRadar`)
- **Entry point:** nav; share links.
- **Prerequisites / gates:** None - public dashboard.
- **Steps (N):**
  1. Arrive → `mountRadar()` reads URL (`category`, `minQuality`), builds toolbar, polls every 12s.
  2. System: `GET /api/pump/coin-intel?...` renders coins observed in first ~90s of trading - classified, risk-scored ("organic, or a bundle/rug?"). Unmeasured signals render "not measured", never 0.
  3. (optional) Filter by category chips (meme/ai/tech/…) → URL + reload.
  4. (optional) Min-quality slider → reload on change.
  5. (optional) Watch toggle per coin → `ld_watchlist`.
  5b. (optional) **Fork** (mainnet cards only) → `openFork()` from `src/fork-trade.js` lazily pulls the Solana + pump SDKs (the button holds a busy state for that fetch instead of sitting inert) and opens the real pump.fun trade panel (`src/game/coin-buy.js`) pre-filled with that mint; the user's own wallet signs, nothing is custodied or auto-executed. An inbound `?fork=<mint>&fork_size=<sol>` link opens the same panel on arrival, with the size clamped to `MAX_FORK_SOL` (10 SOL) because it arrives from a link a stranger wrote. Any open modal sets `tws-modal-open` on `<body>` so the shared corner stack stops covering its controls.
  6. (optional) Click a coin card → detail drawer → `GET /api/pump/coin-intel?mint=<mint>&wallets=1` (single-coin wallet breakdown). Each mainnet card's "Full intel →" action and the drawer's "Open full page" link go straight to the coin's full intelligence page at `/oracle/coin/<mint>`; devnet coins have no page, so their button keeps opening the drawer.
- **Decision points / branches:** mainnet (Fork offered) vs devnet (read-only); category × quality filters; risk-flag pills (bundle_launch, dev_dumped, single_whale, low_diversity, fresh_wallet_swarm, sell_pressure, sniped) with danger/warn tones; drawer open/closed.
- **External calls / dependencies:** `GET /api/pump/coin-intel` (list) and `?mint=&wallets=1` (detail); `/api/img` for logos; `src/fork-trade.js` → `src/game/coin-buy.js` (lazy Solana + pump SDKs) for Fork.
- **Success state:** live launch-intelligence feed; every number traces to an observed on-chain trade.
- **Empty / error states:** "not measured" for null signals; empty/loosen-filters guidance; image fallback to seeded identicon.
- **Step count:** 1 required (arrive → live feed) + ~5 optional (filters, watch, inspect).

---

### Watchlist - `/watchlist`
- **Source:** `pages/watchlist.html`, `src/watchlist.js` (imports `src/pump/coin-status-card.js`)
- **Entry point:** nav; closes the loop from any "Watch" button across the platform (writes `ld_watchlist`).
- **Prerequisites / gates:** None - device-local, private, no account. Synced across tabs via `storage` event.
- **Steps (N):**
  1. (prerequisite) On any coin surface (oracle/radar/trades/launches/etc.) click ☆ Watch → mint stored in `ld_watchlist`.
  2. Arrive on `/watchlist` → `readList()` reads + validates mints (base58 32-44).
  3. System: for each mint mounts a live coin-status card (`mountCoinStatus` → one `/api/pump/coin` fetch/coin), with deterministic mint identicon placeholder behind real pump.fun logo; refreshes every 90s. A mint pump.fun's indexer answers "unknown" for (`/api/pump/coin?miss=empty` returns 204) is remembered for the page's life and read from the bonding curve instead, so refreshes do not repeat a known miss. The Trending suggestion chips resolve launch art through `/api/img` (IPFS and metadata-JSON logos included). A parallel `GET /api/oracle/batch?mints=` sweep (chunks of 20) paints a conviction badge per card; a mint the Oracle answered for but has not scored gets an "unrated" badge linking to `/oracle/coin/<mint>`, and a chunk that failed leaves its cards' badges untouched rather than calling them unscored.
  4. System: detects tier upgrades vs `wl_last_tiers` and surfaces changes. The summary tiles (market cap, 24h volume, graduated, average conviction) aggregate only the coins that actually report each figure, with a hover note giving the coverage ("Combined across 3 of 5 watched coins"), and the tier bar carries a muted "not scored yet" segment for the remainder so the distribution never implies an opinion the Oracle has not given.
  5. (optional) Toggle alerts (`#wl-alerts`, `wl_alerts_on`).
  6. (optional) Clear list (`#wl-clear`).
  7. (optional) Click a card → the coin's Oracle page (`/oracle/coin/<mint>`).
- **Decision points / branches:** empty list vs populated; tier-upgrade highlighting; alerts on/off; cross-tab storage sync.
- **External calls / dependencies:** `GET /api/pump/coin` (one per watched coin, via coin-status-card); `GET /api/oracle/batch?mints=&network=mainnet` (conviction badges, chunks of 20).
- **Success state:** private tracked-coin board with live status cards, tier-change detection, deep links back to profiles.
- **Empty / error states:** empty state when no mints saved (tells user to Watch coins elsewhere); invalid mints filtered out; per-card load handled by coin-status widget; a summary tile shows the no-value dash rather than a fabricated $0 when no coin reports the figure, and the tier bar reads "Awaiting Oracle scores" or "Oracle unreachable" when nothing is scored.
- **Step count:** 1 required to view (arrive) - payoff depends on the prerequisite Watch action elsewhere; + ~3 optional (alerts, clear, drill-in).

---

### Pump Dashboard (Token Cockpit) - `/pump-dashboard`
- **Source:** `pages/pump-dashboard.html` (large inline module, ~5000 lines); imports `src/solana/vanity/grinder.js`, `src/solana/vanity/validation.js`, `src/shared/state-kit.js`; uses `src/wallet.js`
- **Entry point:** nav; "Open Token Cockpit →" from `/dashboard/tokens`; `/autopilot`; sitemap; deep link `?agent=<id>` auto-opens the Default Agent panel; `#hash` deep-links any tab.
- **Prerequisites / gates:** Public - no auth/$THREE gate for the core dashboard. Wallet connect is **optional** (unlocks Wallet snapshot). Server-backed tabs (Agents, Alert rules, API keys) return 401 → sign-in prompts. Watches/Claims tabs require a custom PumpKit backend.
- **Steps (N):**
  1. Arrive → `DOMContentLoaded` bootstrap restores config from localStorage (api/ws/rpc/key), resolves `?agent=`/`#hash`, binds nav + controls.
  2. System: `connectApi()` polls `GET /api/healthz` (15s) → status dot; `connectWebSocket()` opens `wss://pumpportal.fun/api/data`, subscribes `subscribeNewToken` + `subscribeMigration` (exponential backoff, 8-attempt cap → manual Reconnect banner).
  3. System: preloads `GET /api/pump/channel-feed?limit=40`, `GET /api/pump/helius-stats` (30s), `GET /api/agents/featured`, `GET /api/pump/trending?limit=25` ($THREE pinned first), config probes, uptime ticker.
  4. (optional) Connect wallet → `wallet:changed` → `POST /api/wallet/balances` renders SOL + top-10 holdings.
  5. (optional) Default tab: inspect monitor stat cards, featured agent, network health, market chart (`chart:tokenChange` → fetch candles; the page's own canvas chart keeps its place and the shared chart-source switcher lines DexScreener, Birdeye, GMGN, DEXTools and GeckoTerminal up beside it), high-conviction Oracle panel, live-feed preview.
  6. (optional) **Live Feed** tab: pause + filter (Launches/Trades/Whales/Graduations/Claims) the rAF-batched WS feed.
  7. (optional) **Token Scanner**: enter mint → scan for risk/honeypot. Every RPC call is timed out (some providers accept `getTokenLargestAccounts` and never answer), and the button plus a persistent status line carry the busy state so a failed scan cannot read as one that was never run: a timeout is distinguishable from an unreachable endpoint in both the toast and the RPC badge, an address with no account on mainnet says exactly that, and a failure tells the reader to press Scan again.
  8. (optional) **Quote Engine**: buy/sell quote forms.
  9. (optional) **Alerts**: build a rule (type/scope/threshold/agent + in-app/webhook/Telegram delivery + cooldown) → `POST /api/alerts/rules` (validation, the 50-rule cap and webhook-secret healing live in `api/_lib/pump-alert-rules.js`); list/toggle/edit/delete; live firing against feed; history from `GET /api/notifications`. The type menu includes **New launch matching filters** (`launch_match`): a "Launch filters" fieldset takes a name or ticker pattern (`dog|cat`, `ai*`), min/max market cap in USD, a minimum safety score, the creator's graduated-coin minimum and earlier-launch maximum, risk flags to skip (dev dumped, bundled, sniped, single whale, low holder diversity, sell pressure) and a require-socials switch. The rule fires for each new pump.fun launch that passes every filter, about 90 seconds after launch once coin intel has scored it. In-app rules are also pushed to the owner's devices and paired Telegram or Discord chats per their notification preferences.
  10. (optional) **Vanity Generator payoff:** enter prefix/suffix → `validatePattern()` (base58, ≤6 chars) → `grindVanity()` spawns up to 8 Web Workers (WASM) → progress (tries/rate/eta) → match → reveal/copy/download keypair JSON (secret never leaves browser).
  11. (optional) **Default Agent**: embed `/agent-embed.html` iframe, speak/gesture via postMessage; manage custom agents (`GET /api/agents`, delete with CSRF).
  12. (optional) **Configuration** (save + reconnect + probes), **API Reference** (create/revoke keys). The Revenue tab and its reporting endpoints were retired from this page on 2026-08-25.
- **Decision points / branches:** 11 hash-routed tabs (dashboard, feed, watches, claims, alerts, scanner, quoting, vanity, animations, config, api); wallet connected vs empty; WS backoff (<8 retry vs ≥8 terminal banner); auth 401 on agents/alerts/keys; PumpKit backend present for Watches/Claims; vanity validation failures; simulate vs server-side alert delivery.
- **External calls / dependencies:** `/api/healthz`, `/api/pump/helius-stats`, `/api/pump/channel-feed`, `/api/pump/trending`, `/api/agents/featured`, `/api/agents` (+CSRF), `/api/wallet/balances`, `/api/pump/scan`, `/api/pump/quote/{buy,sell}`, `/api/alerts/rules` (CRUD), `/api/notifications`, `/api/api-keys` (CRUD); `wss://pumpportal.fun/api/data`; Solana RPC via `/api/solana-rpc`; Phantom/MWA wallet; Web Workers for vanity; model-viewer CDN.
- **Success state:** green API/WS/SOL chips, populated panels, live feed streaming, optional wallet snapshot, working alerts, vanity address found with copy/download.
- **Empty / error states:** featured-agent retry; WS "Realtime feed stopped" + Reconnect after 8 fails; channel-feed retry (downgrades to WS); RPC error chip auto-clears 8s; sign-in prompts on 401; vanity validation toasts; designed empty states for wallet/agents/alerts/feed (state-kit).
- **Step count:** 3 required (arrive → API/WS connect → panels populate) + ~9 optional tab/interaction flows (vanity grind and alert-rule build are the headline interactive payoffs).

---

### Strategy Lab - `/strategy-lab`
- **Source:** `public/strategy-lab.html` (pre-built static; ~720 lines, text-only UI, no 3D); `vercel.json` rewrite `/strategy-lab → /strategy-lab.html`
- **Entry point:** nav / direct URL; `data/pages.json` + changelog entry.
- **Prerequisites / gates:** Validate + Backtest + Simulate run are **public** (read-only MCP, real on-chain data, no signing). **Live run** requires sign-in, an agent with a provisioned Solana wallet, balance ≥ 0.02 SOL, and an explicit confirmation dialog. Network toggle mainnet/devnet.
- **Steps (N):**
  1. Arrive → spec editor + results/portfolio panels render; `GET /api/agents` populates agent dropdown if signed in; pick network.
  2. (optional) Select agent → `onAgentChange()` → `GET /api/agents/{id}/solana?network=` shows wallet address + balance; provision via `POST` if none; low-balance warning < 0.02 SOL.
  3. Load a preset (Momentum / Snipe / Mean-revert) **or** hand-edit the JSON spec (`scan`, `filters`, `entry`, `exit`, `caps`).
  4. **Validate** → `POST /api/pump/strategy-validate` → "Valid - N filters, M exit rules" or red issues list.
  5. (optional) **Backtest** → `POST /api/pump/strategy-backtest` (real on-chain data, no auth) → metrics grid (PnL, ROI, win rate, trades, max drawdown, SOL deployed) + per-trade table.
  6. **Run** → `POST /api/pump/strategy-run` `{durationSec, mode:'simulate'|'live', network, agentId?}` → SSE stream of start/log/enter/exit/skip/done events into the live activity log.
  7. (optional) **Stop** (`activeRun.abort()` → "■ stopped").
  8. (optional) **Portfolio** panel auto-loads on agent select → `GET /api/pump/portfolio?agentId=&network=` (holdings, cost basis, unrealized PnL); **Close All** → `POST /api/pump/strategy-close-all` market-sells everything.
- **Decision points / branches:** preset vs custom spec; Validate→Backtest→Run pipeline; simulate (public) vs live (gated, signs real tx); mainnet vs devnet; portfolio empty vs holdings; balance/auth gates on live.
- **External calls / dependencies:** `/api/agents`, `/api/agents/{id}/solana` (GET+POST), `/api/pump/strategy-validate`, `/api/pump/strategy-backtest`, `/api/pump/strategy-run` (SSE), `/api/pump/portfolio`, `/api/pump/strategy-close-all`; backend MCP → Solana RPC + pump.fun indexer; agent hot wallet signs in live mode.
- **Success state:** spec validates clean; backtest returns trade history + ROI; run executes entries/exits with live-streaming log; portfolio reflects on-chain holdings; positions closable any time.
- **Empty / error states:** "select agent" / "No Solana wallet"; "Invalid - N errors" issues panel; backtest error; low-balance warning; "no token holdings"; "■ stopped"; errors surfaced with `error_description`.
- **Step count:** 4 required (arrive → spec → Validate → Run, simulate path) + ~4 optional (backtest, portfolio, close-all, live mode). Most interactive route in the cluster.

---

### Smart Money Radar - `/smart-money`
- **Source:** `pages/smart-money.html` (self-contained inline module); backend `api/pump/smart-money.js`
- **Entry point:** nav; share links.
- **Prerequisites / gates:** None - public, IP rate-limited only; CORS `*`.
- **Steps (N):**
  1. Arrive → inline module reads `ld_watchlist`, renders 6 skeletons, calls `refresh()`; auto-refresh every 20s (pauses when tab hidden). `?wallet=<addr>` or `?mint=<addr>` (base58) opens that drawer straight away, so a wallet cited elsewhere on the platform lands on its track record instead of an unfiltered board.
  2. System: `GET /api/pump/smart-money?limit=60` (feed: coins ranked by smart_money_score, proven-wallet count, smart buy volume) + parallel `?leaderboard=1&limit=60` (top wallets by reputation).
  3. (optional) Switch view: Feed ("Smart money is buying", with On radar / Graduated / All filters) / Top wallets / Watchlist; the Watchlist view looks up each `ld_watchlist` mint with `?mint=`.
  4. (optional) Watch toggle per coin → `ld_watchlist`; **Fork this trade** on a card or in the coin drawer opens the real pump.fun trade panel for that mint (`src/fork-trade.js` → `src/game/coin-buy.js`), signed by the visitor's own wallet, which is where the page's "proven wallets are in this coin" claim becomes an action.
  5. (optional) Click coin → drawer `GET /api/pump/smart-money?mint=<mint>` (notable wallets, labels) + async `GET /api/oracle/coin?mint=` to enrich with conviction pillars.
  6. (optional) Click wallet → drawer `GET /api/pump/smart-money?wallet=<addr>` (win rate, record, recent coins).
- **Decision points / branches:** Feed vs wallets tab; coin scored vs "not scored"; wallet has record vs none; Oracle enrichment present vs absent.
- **External calls / dependencies:** `GET /api/pump/smart-money` (feed / `?leaderboard=1` / `?mint=` / `?wallet=`), async `GET /api/oracle/coin`. Data sourced from `coin_smart_money` + `wallet_reputation` tables fed by the off-browser sniper engine - no direct browser RPC/WS.
- **Success state:** 60 fresh coins ranked by buyer pedigree; wallet reputation board (smart_money/sniper/dumper/rugger labels); coin + wallet drawers.
- **Empty / error states:** "No proven money on a fresh coin yet"; "No wallets ranked yet"; drawer "Not scored yet" / "No track record yet"; "Couldn't reach the radar" + Retry; stale badge with last-update + "Retry now". A cold failure (nothing cached yet) paints "Couldn't reach the radar" with Retry on both the feed and the Top wallets view and says whether the API answered a status or was unreachable from the browser; the drawers show the explanatory "Not scored yet" (with a pump.fun link) / "No track record yet" (with a Solscan link) only when the radar answered, and offer Retry when it did not; on the Watchlist view a coin the radar could not be reached for reads "Couldn't load this one" with Retry rather than "Not on the radar yet", and if every lookup was unreachable one message covers the whole list.
- **Step count:** 1 required (arrive → feed) + ~5 optional (tab, watch, inspect coin/wallet, fork).

---

### Fade Radar - `/fade`
- **Source:** `pages/fade.html`, `src/fade-radar.js`; backend `api/pump/fade.js` → `api/_lib/fade-radar.js`; reference doc `docs/fade-radar.md`
- **Entry point:** direct URL / `/sitemap`; the hero cross-links `/smart-money`, and the Smart Money Radar's wallet links come back the other way. Deep-linkable via `?view=coins|wallets`, `?hours=1|6|24|72`, `?active=24|168|0` (written with `replaceState`).
- **Prerequisites / gates:** None: public, IP rate-limited. The page **spends nothing and signs nothing**: on a bonding curve the only tradeable form of a fade is not buying, so every action is a link out.
- **Steps (N):**
  1. Arrive → `readUrl()` restores view/window, `loadStrip()` and `loadBoard()` run together against skeletons.
  2. System: `GET /api/pump/fade?calibration=1` paints the verdict strip first, because it is the reason to believe anything below it: per band (Clear / Caution / Avoid) the share of coins that went on to win, the sample size, the lift over baseline, and the out-of-sample note (`getFadeCalibration` builds the reverse-indicator cohort from the earlier half of labelled history and grades it on the later half).
  3. System: `GET /api/pump/fade?hours=<window>&limit=40` renders the coin board (coin, fade score, verdict pill, reverse/buyers, reverse share of SOL, observed buy SOL, launched-ago, pump.fun link), heaviest share first. A **reverse indicator** is a wallet observed buying at least five coins whose outcome is known, with zero winners among them.
  4. (optional) Switch to **Reverse indicators** → `GET /api/pump/fade?wallets=1&limit=40&min_judged=8&active_hours=<active>` renders the wallet board (address + labels, judged buys, winners, losers, last seen, "Track record" → `/smart-money?wallet=<addr>`). The window control swaps to the last-active filter.
  5. (optional) Change window (1h / 6h / 24h / 3d) or last-active (24h / 7d / All time) → URL synced, board reloads; a superseded request cannot paint over a newer one.
  6. **Payoff:** Click a coin symbol → its full intelligence page `/oracle/coin/<mint>`; or a wallet → Solscan / its Smart Money track record.
- **Decision points / branches:** coin board vs reverse-indicator board (each with its own filter and its own empty copy); calibration computed vs still being computed (the strip says so and the board stays live either way).
- **External calls / dependencies:** `GET /api/pump/fade` (`?calibration=1`, `?hours=`, `?wallets=1`, `?mint=`), reading the same `smart_wallet_reputation` graph the trade firewall and the sniper scorer use, so it needs no cron of its own.
- **Success state:** every recent launch ranked by how much of its buy side has never once been right, under measured odds rather than an asserted label.
- **Empty / error states:** coin board empty → "Nothing to fade in <window>" (named as the good outcome) with "Open the Smart Money Radar"; wallet board empty → "No reverse indicator has traded <window>" with the same link; fetch failure → "The board could not be loaded" naming what the server answered, with Try again.
- **Step count:** 2 required (arrive → strip + board) + ~3 optional (view, window, drill-in).

---

### Coin Intelligence - `/coin-intel`
- **Source:** `pages/coin-intel.html` (self-contained inline module); backend `api/pump/intel.js`
- **Entry point:** nav; share links. (Distinct from `/api/pump/coin-intel` used by `/radar`.)
- **Prerequisites / gates:** None - public, IP rate-limited; CORS `*`.
- **Steps (N):**
  1. Arrive → inline module reads `ld_watchlist`, renders category chips + 6 skeletons; `loadStats()` (`?view=learning`) + `loadRadar()`; auto-refresh 15s.
  2. System: `GET /api/pump/intel?view=feed&limit=60` renders cards (quality score ring 0-100, verdict pill strong/watch/caution/avoid, organic-vs-bundle bar, risk flags, narrative).
  3. (optional) Toolbar filters: search (220ms debounce), category chips, verdict dropdown, quality dropdown → `loadRadar()`.
  4. (optional) Watch toggle per coin → `ld_watchlist`.
  5. (optional) Switch tab: Radar / Leaderboard (`?view=leaderboard`) / Smart-Money Traders (`?view=traders`) / What it learned (`?view=learning`, signal weights + outcome distribution + coverage) / **Scout** (`src/coin-intel-scout.js` over `GET /api/pump/sentiment-scout`: the last hour of launches ranked by sourced momentum, every claim carrying its source URL, the time it was true, and for social or paid claims the on-chain facts read in the same run; X posts quoting the exact contract address are counted by distinct voice and one-account shilling is flagged).
  6. (optional) Click coin → drawer `GET /api/pump/intel?mint=<mint>` (full signals + outcome + top wallets classified + funder clusters/bubble-map; in a WebGL browser the bubble map upgrades to a lazy-loaded 3D funder graph (`src/funder-graph.js`: drag to rotate, scroll to zoom, a "Live trades" toggle that adds new buyers as they trade) and falls back to the SVG map without WebGL, wallets, or on a failed load) + async `GET /api/oracle/coin?mint=` conviction enrichment + a Sentiment Scout section injected above the launch signals when the Scout has a read for that coin.
- **Decision points / branches:** 5 tabs; filter combinations; coin observed vs "not observed"; labeled winners vs none; ≥50 labeled coins for trained weights vs baseline; Oracle enrichment present vs absent.
- **External calls / dependencies:** `GET /api/pump/intel` (`view=feed|leaderboard|traders|learning`, `?mint=`), `GET /api/pump/sentiment-scout` (Scout tab and drawer section), async `GET /api/oracle/coin`. Data from `pump_coin_intel`, `pump_coin_outcomes`, `pump_coin_wallets`, `pump_intel_weights` (off-browser engine). No direct browser RPC/WS.
- **Success state:** live classified-coin radar with verdicts + risk flags; leaderboard of best coins + confirmed winners (ATH multiple); cross-coin trader board; "what it learned" signal-weight transparency; per-coin bubble-map drawer.
- **Empty / error states:** "The engine is warming up"; "No coins match these filters" + Reset; drawer "Not observed yet"; "No labeled winners yet"; "No traders recorded yet"; "Not enough data to train yet"; degraded badge; retry on network failure. The leaderboard's own empty state reads "Nothing scored in the last 24 hours" (the radar's "loosen your filters" copy no longer appears on a tab with no filters); every failed tab (radar, both leaderboard rails, traders, all three learning panels, the drawer) carries its own Retry, and the header stat tiles fall back to dashes beside the amber degraded pulse rather than disappearing.
- **Step count:** 2 required (arrive → radar feed) + ~6 optional (search/filters, watch, tabs, inspect coin).

---

### GMGN Smart Money - `/gmgn`
- **Source:** `public/gmgn.html` (pre-built static; ~900 lines); backend `api/agents/gmgn.js`; `vercel.json` rewrite `/gmgn → /gmgn.html`, `/api/agents/gmgn-feed → /api/agents/gmgn?_handler=feed`
- **Two read lanes on one backend:** `GET /api/agents/gmgn-feed` streams SSE (what this page uses); `GET /api/agents/gmgn` returns the same board as one JSON response for callers that cannot hold a stream open (server-side fetches, agent tool calls, curl). Both accept `chain`, `interval`, and `minSmartBuys`; the JSON lane also accepts `limit` (1-50, default 25) and answers `{ data: { chain, interval, min_smart_buys, source, count, items } }` with the same normalized item shape the `smart_entry` events carry.
- **Entry point:** nav / direct URL.
- **Prerequisites / gates:** None - public live feed. Narration needs browser Web Speech API; "My agents" avatar tab needs auth.
- **Steps (N):**
  1. Arrive → 3D agent (CZ default) loads into `<model-viewer>` (auto-rotate); params parsed (chain=sol, interval=1h, minSmartBuys=2, narrate, avatar, mood).
  2. System: SSE `EventSource('/api/agents/gmgn-feed?chain=sol&interval=1h&minSmartBuys=2')` → `hello` event (status pill "Live · SOL · 1h"), last 10 events replayed (dimmed), then `smart_entry` events stream live.
  3. System per event: render card (symbol, market cap, smart-buy delta, price change, and a DEXTools link through the counted `/api/coin/dextools` redirect on chains DEXTools covers), trigger agent animation by delta/new flag, optional TTS narration, increment stats, "↑ N new" jump button if scrolled.
  4. (optional) Change chain (sol/eth/base/bsc), interval (1m-24h), minSmartBuys; mood (chill/normal/hype); narration toggle.
  5. (optional) Avatar picker modal → `GET /api/avatars/public` + `GET /api/avatars` → "Use this avatar" swaps model.
  6. (optional) **Apply** (`#ctl-reconnect`) → `connect()` closes old EventSource, opens new with updated params.
  7. (optional) $THREE spotlight tile updates when smart-money activity hits CA `FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`.
- **Decision points / branches:** chain/interval/minSmartBuys filters; narration on/off; mood; default vs community vs my-agents avatar tabs; manual vs auto reconnect.
- **External calls / dependencies:** SSE `/api/agents/gmgn-feed` (upstream GMGN.ai feed via `connectGmgnFeed`); `/api/avatars/public`, `/api/avatars`; model-viewer CDN.
- **Success state:** green live dot; smart-money entries stream with animated, optionally-speaking agent; stats tick; instant reconnect on filter change.
- **Empty / error states:** "Connecting…" (yellow); "Waiting for events…"; "Error - retrying…" with 4-5s backoff auto-reconnect; "Session ended - reconnecting…"; avatar load error recoverable via re-pick.
- **Step count:** 2 required (arrive → SSE feed) + ~5 optional (filters, mood, avatar, reconnect). Mostly a live monitor with reactive avatar.

---

### Pump.fun Live Agent - `/pumpfun`
- **Source:** `public/pumpfun.html` (pre-built static; ~2000 lines); backend `api/agents/pumpfun.js`; `vercel.json` rewrites `/pumpfun → /pumpfun.html`, `/api/agents/pumpfun-feed → /api/agents/pumpfun?_handler=feed`, `…pumpfun-metadata → ?_handler=metadata`
- **Entry point:** nav / direct URL; `?asset=<pubkey>` binds a specific agent.
- **Prerequisites / gates:** Public for the live feed. Binding an agent / viewing its wallet needs auth (`GET /api/agents`). Provisioning a wallet is a `POST`.
- **Steps (N):**
  1. Arrive → 3D agent (CZ default) renders; params parsed (asset, mint, kind=all/mint/graduation/claims, tier, mcMin/mcMax, minBuy, whale, narrate, mood, avatar).
  2. (optional) `GET /api/agents` → pick agent → `onAgentChange()` → `GET /api/agents/{id}/solana?network=mainnet` shows wallet/balance; provision via `POST` if none.
  3. System: SSE `/api/agents/pumpfun-feed?...` (withCredentials) → `hello`, replay buffer (~30 events dimmed), then `evt` events (mint/trade/graduation/claim) stream live; agent animates + optionally narrates per configured emotion/TTS map.
  4. System: first-time fee-claims sidebar refreshes from `GET /api/pump/first-claims?limit=50&sinceMinutes=1440`.
  5. (optional) Filters: asset, mint search, event kind, min tier (notable+/influencer+/mega), MC range, min buy SOL, whale threshold.
  6. (optional) Avatar picker: five tabs. Defaults ships with the page; Community reads `GET /api/avatars/public`; My Agents reads `GET /api/avatars` behind an `/api/auth/me` check; Recent and Favorites are this browser's own lists (`localStorage` keys `pumpfun-avatar-recents`, capped at 24, and `pumpfun-avatar-favorites`, written by the star on each card).
  7. (optional) Config modal: map emotions→animations and actions→TTS templates (stored in localStorage); narration/announce-mints/mood toggles.
  8. (optional) Share/copy filter-encoded link, or follow the "Launch a coin" link in the header to `/launch`.
- **Decision points / branches:** public feed vs agent-bound (enriches via `?_handler=metadata`); event-kind/tier/MC/whale filters; narration + emotion config; provisioned wallet vs none.
- **External calls / dependencies:** SSE `/api/agents/pumpfun-feed` (upstream Helius webhooks), `/api/agents`, `/api/agents/{id}/solana` (GET+POST), `/api/pump/first-claims`, `/api/agents/{id}/pumpfun/metadata`, avatars endpoints; model-viewer CDN.
- **Success state:** live launch/trade/graduation/claim feed with reacting, narrating 3D agent; first-claims sidebar; accurate wallet info.
- **Empty / error states:** feed panel renders one of four states from `#feed-status`: "Waiting for the next launch" before the first event, "No events match your filters" with a Clear filters button when every card is hidden, "Feed disconnected" with a Reconnect button after 3 failed SSE attempts (8s open timeout each), and nothing at all once a card is visible. First-claims panel: skeleton rows while loading, "None in this window.", or an alert naming the failure with a Try again button. Avatar picker: Recent and Favorites each have their own empty state with a jump to a populated tab; "My Agents" shows a sign-in prompt (gated on `GET /api/auth/me`, so a signed-out visitor never takes a 401); community/mine load failures show the error plus Retry. Status pill: connecting / reconnecting / live / live · quiet / offline · retry (click to reconnect). Avatar load error surfaces as a toast and the previous avatar stays.
- **Step count:** 1 required (arrive → live feed) + ~7 optional (agent bind, filters, avatar pick, emotion config, share, launch). Live monitor + reactive agent (+ optional agent-management).

---

### Pump Visualizer (3D) - `/pump-visualizer`
- **Source:** `pages/pump-visualizer.html` (inline Three.js module: OrbitControls + EffectComposer/UnrealBloom); `vercel.json` rewrite `/pump-visualizer → /pump-visualizer.html`
- **Entry point:** nav / direct URL.
- **Prerequisites / gates:** None - public. WebGL required; degrades to DOM list fallback if unavailable.
- **Steps (N):**
  1. Arrive → theme/nav boot; WebGL capability check → build Three.js scene (camera fly-in, starfield, bloom, auto-rotating OrbitControls).
  2. System: `GET /api/pump/trending?limit=50&rich=1` (+ `GET /api/pump/helius-stats` for SOL→USD) renders top-50 tokens as spheres on a Fibonacci sphere, sized by log market cap, colored by tier, with lazy artwork via `/api/img`; staggered pop-in.
  3. System: reveals mode tabs (Feed/Migrations/Trending), search, sort buttons, top-20 legend, color key, hint.
  4. (optional) Drag to orbit / scroll to zoom (OrbitControls).
  5. (optional) Search (`/` hotkey) → filter legend + dim non-matching spheres; sort by Mcap/Streams/Replies/New; refresh (`R`).
  6. (optional) Feed/Migrations mode → SSE `/api/agents/pumpfun-feed?kind=mint|graduation` adds spheres live (capped 60).
  7. (optional) Hover sphere (tooltip), click → detail panel (`selectToken`), legend click → camera tween + panel.
  8. (optional) In detail panel: Watch (`ld_watchlist`), Oracle badge (`GET /api/oracle/coin?mint=`), Buy (lazy `src/game/coin-buy.js` on-chain trade modal); double-click sphere → `/coin3d?mint=`.
- **Decision points / branches:** WebGL present vs list fallback; Feed/Migrations/Trending mode; search/sort; Oracle enrichment optional; Buy is the real interactive (on-chain) action.
- **External calls / dependencies:** `GET /api/pump/trending`, `/api/pump/recent-graduations`, `/api/pump/helius-stats`, `/api/img`, `GET /api/oracle/coin`; optional SSE `/api/agents/pumpfun-feed` (server-side PumpPortal WS bridge) for Feed/Migrations live mode.
- **Success state:** 50 glowing spheres in an auto-rotating galaxy, sized/colored by market cap, with detail panel, search/sort, and on-chain Buy.
- **Empty / error states:** WebGL warning banner + DOM list fallback; "Could not load trending tokens" + Retry; image canvas fallback; Oracle badge silently empty if down.
- **Step count:** 2 required (arrive → spheres render) + ~6 optional (orbit, search/sort, mode, inspect, Buy/Watch). Live-monitor + interaction hybrid.

---

### Pump Live Feed (3D Agent) - `/pump-live`
- **Source:** `pages/pump-live.html` (inline module + imports `src/viewer.js`, Three.js); `vercel.json` rewrite `/pump-live → /pump-live.html`
- **Entry point:** nav; footer.
- **Prerequisites / gates:** None - public live monitor. 3D agent is optional (feed works without WebGL/GLB).
- **Steps (N):**
  1. Arrive → feed module starts immediately (does NOT wait on Three.js); skeleton cards; viewer.js + GLB load in parallel.
  2. System: `GET /api/pump/helius-stats` for SOL price (caps shown in SOL until USD lands, then rehydrated).
  3. System: connect `wss://pumpportal.fun/api/data`, send `subscribeNewToken` → "● Live"; each `create` event → render token card (image via `/api/img?meta=`, MC, links, empty Oracle slot), prepend (cap 100), update stats, dispatch `pumplive:token`.
  4. System: every 30s batch `GET /api/oracle/batch?mints=...` (chunks ≤20, bounded retries with backoff) → conviction badges on cards; "🔮 Prime scored" counter.
  5. (optional) 3D agent loads `robotexpressive.glb`, plays Idle, waves on each `pumplive:token`.
  6. (optional) Pause button (queues events); conviction filter All/Strong+/Prime (hides cards); Watch toggle (`ld_watchlist`); click card → `/coin3d?mint=` or external links.
- **Decision points / branches:** WebGL/GLB present vs feed-only; paused vs streaming; conviction filter level; Oracle up vs down (badges empty).
- **External calls / dependencies:** `wss://pumpportal.fun/api/data`; `GET /api/pump/helius-stats`; `GET /api/oracle/batch`; `GET /api/img`; `robotexpressive.glb`.
- **Success state:** live launches stream as cards, stats tick, agent waves per launch, Oracle conviction badges enrich after ~30s, filterable.
- **Empty / error states:** "Waiting for new launches…"; WS backoff 2s→60s, terminal error panel + Reconnect after 8 fails; SOL-price hint until USD lands; image seeded placeholder; agent load failure suppressed (feed unaffected).
- **Step count:** 1 required (arrive → live feed) + ~4 optional (pause, filter, watch, drill-in). Pure live monitor + reactive avatar.

---

### Constellation - `/constellation`
- **Source:** `pages/constellation.html`, `src/constellation/main.js` (~790 lines), `src/constellation/embedding.js` (PCA/MDS + neighbor lookup)
- **Entry point:** nav / direct URL.
- **Prerequisites / gates:** The galaxy, its live stats and its semantic layout are public; the per-star Granite analysis needs a signed-in account (it runs on the platform's own model keys), so `GET /api/auth/me` is resolved once at boot and a signed-out visitor gets a sign-in / create-account notice in the panel instead of a doomed request. WebGL required (fatal overlay if absent, no fallback). IBM Granite (watsonx) optional: without it, tokens place by rank instead of semantic space.
- **Steps (N):**
  1. Arrive → boot WebGLRenderer + Three.js scene (camera, starfield, auto-rotate OrbitControls); fatal overlay if WebGL missing.
  2. System: `GET /api/pump/trending?limit=64` → ≥3 valid tokens placed on a Fibonacci sphere (rank layout), colored by hue; loading overlay dismisses.
  3. System (optional/semantic): `POST /api/watsonx/embed` → 1024-d vectors → PCA to 3 axes → nodes lerp from rank positions into semantic clusters; the status names the model that actually produced the vectors: "Embedded by IBM Granite · model · 1024d", or a "Semantic layout live · <fallback embedder>" line when the embed endpoint fell through its failover chain, never a Granite credit for another model's output.
  4. (optional) Drag to orbit / scroll to zoom.
  5. (optional) Hover star → glow + tooltip (symbol/name). The canvas is focusable: arrow keys walk the stars in trending-rank order with the tooltip following, Home/End jump to the ends, and Enter/Space opens the focused star. Picking tolerates a near miss (22px, 34px on a coarse pointer; a tap gets 46/60px and is judged on movement, not hold time) so the visible glow is the target.
  6. (optional) Click star → right detail panel (symbol, name, logo, market cap, price when the feed carries one, rank, nearest semantic neighbors once vectors land, Pump.fun/Solscan links); the panel is `inert` while closed and hands focus back to the canvas after a keyboard open.
  7. (optional) **Analysis payoff:** selecting a star fires `POST /api/brain/chat {provider:'ibm-granite', system: analyst, messages, maxTokens:400}` (SSE) → streams a live token analysis into the panel; Esc/close to dismiss. The byline names what actually answered: the `meta` event's model label, or after a `fallback` event "Analysis by <route>" with a meta line saying Granite could not serve the request.
- **Decision points / branches:** WebGL present vs fatal; signed in (analysis streams) vs signed out (sign-in notice); Granite configured (semantic layout + analysis) vs unconfigured (rank layout, analysis notice) vs served by a fallback (labelled as such); rate-limited; <3 tokens → fatal.
- **External calls / dependencies:** `GET /api/pump/trending?limit=64`; `GET /api/auth/me`; `POST /api/watsonx/embed`; `POST /api/brain/chat` (SSE).
- **Success state:** 64-star galaxy clustered by semantic similarity, hover tooltips, detail panel, and streaming Granite analysis per token.
- **Empty / error states:** WebGL fatal overlay; a feed failure ("Couldn't load live tokens.", naming the pump.fun trending feed) and "No trending tokens right now." both carry a "Try again" button that rebuilds the galaxy (disposing the previous nodes' materials); a semantic-layout-off status when IBM watsonx is not configured (stars placed by trending rank); analysis notices (sign in required / unconfigured / rate-limited / every route refused / stream error), each telling the visitor to pick the star again to retry.
- **Step count:** 2 required (arrive → galaxy renders) + ~5 optional (orbit/zoom, hover, select, Granite analysis). Live-data exploration + AI analysis.

---

### Sniper Experiments: `/sniper/experiments`
- **Source:** `pages/sniper-experiments.html` (shell only), `src/sniper-experiments.js` (imports `src/shared/coin-format.js`), `src/sniper-experiments.css`; backend `api/sniper/experiments.js`
- **Entry point:** `/play/arena` (the page's own breadcrumb points back to "Sniper Arena"); the trading hub rail (`src/trading-hub.js`); sitemap; direct URL.
- **Prerequisites / gates:** None. Public read-only scoreboard, mainnet only, real on-chain fills only (no simulated rows in the main record).
- **Steps (N):**
  1. Arrive → `renderControls()` paints the window switch (24h / 7 days / 30 days / All time, default `7d`), then `refresh()` runs immediately and every 30s. The timer is cleared on `visibilitychange` when the tab hides and restarted on return.
  2. System: `GET /api/sniper/experiments?network=mainnet&window=<key>` fills three regions: summary tiles (`#xp-summary`), the strategy comparison table (`#xp-board`), and the LLM judgment ledger (`#xp-judgment`).
  3. System: summary tiles read armed vs paused count, closed trades + open now, fleet realized P&L for the window, fleet SOL on hand across wallets, best arm, moon bags riding (count + SOL at last quote, deliberately excluded from realized P&L), earned-autonomy split (earned / probation / standard), and the master funding wallet with its balance.
  4. System: one board row per armed strategy: label + autonomy-tier badge, agent link (`/a/<agent_id>`), decision-mode badge (`rules`, or `LLM · <model>`, plus `+ Scout` when the judge also reads the Sentiment Scout's sourced evidence), wallet chip linking to Solscan with a low-balance warning under 0.02 SOL, reasoning-ledger link, entry conditions with per-trade SOL and the exit shape (stop loss, trailing stop, max hold, ladder multiple + moon-bag percentage or "no ladder"), record (`W · L`, open count, moon bags, and a separate paper line for simulate-mode fills), win rate, realized SOL, ROI, average trade, average hold, last trade.
  5. System: a stalled arm gets a loud explanation instead of a bare zero: `stallLine()` renders "not trading" for a blocking condition and "idle" for an arm that simply has not qualified yet, with every other blocking reason listed beneath the headline so fixing the first does not just reveal the second later.
  6. System: the judgment ledger scores each LLM judge on its own verdicts (buy rate, average confidence, buy precision against what the coin did an hour later, missed winners among its skips, average latency).
  7. (optional) Click a window button → re-render controls + refetch that window.
  8. (optional) Click an agent, its wallet, or its ledger link to leave for the agent profile, Solscan, or the decision-by-decision reasoning ledger.
- **Decision points / branches:** 4 windows; rules arm vs LLM-judged arm; enabled vs paused (row dimmed); blocking stall vs idle vs healthy; autonomy tier standard (badge hidden) vs probation / trusted / autonomous; arm with a wallet vs "no wallet"; paper record present vs live only; judgment ledger present vs hidden entirely when no LLM verdicts exist.
- **External calls / dependencies:** `GET /api/sniper/experiments?network=&window=` (single endpoint; no browser RPC or WebSocket).
- **Success state:** a live A/B board answering which entry conditions actually make money, every fill signed by the agent's own wallet and traceable to Solscan and to its reasoning ledger.
- **Empty / error states:** "No strategies armed on this network yet" pointing at `/arm`; "no fills" / "waiting on fills" per arm; "awaiting outcomes" for an unscored LLM judge; "Couldn't load the scoreboard" with the failing message and automatic retry on the next 30s tick.
- **Step count:** 2 required (arrive → board) + ~2 optional (window switch, drill into agent/wallet/ledger).

---

### Alpha Co-pilot: `/alpha-copilot`
- **Source:** `pages/alpha-copilot.html`, `src/alpha-copilot.js` (~680 lines; imports `src/shared/agent-3d.js`, `src/agent-solana-wallet.js`, `src/ui-juice.js`)
- **Entry point:** `/genesis`; sitemap; direct URL. Deep links: `?agent=<uuid or profile URL>` picks the agent, `?mint=<mint>` also fires the read on arrival.
- **Prerequisites / gates:** Reading is public: `resolveInitialAgent()` falls back through `?agent=` → last agent in `localStorage` (`ac_last_agent`) → `GET /api/agents/me` → `GET /api/agents/featured`, so the page always opens live. The **Act** payoff is owner-only and server-gated: the read response carries `gate.can_act`, and a non-owner sees the reason instead of the button. Voice needs TTS (server) or the browser Web Speech API.
- **Steps (N):**
  1. Arrive → `init()` caches DOM, wires the act drawer (Escape and backdrop close it), and starts the agent gallery and the initial-agent resolution in parallel.
  2. System: `loadAgent(id)` → `GET /api/agents/:id` names the co-pilot and labels it "Your alpha co-pilot" for the owner or "Alpha co-pilot · public read" for everyone else; the `<agent-3d>` avatar mounts from `agentAvatarGlb()`.
  3. System: `loadCandidates()` → `GET /api/agents/:id/alpha/candidates?network=mainnet` renders the live pump.fun launch rail behind 4 skeleton cards, counts up the launch total, and marks one "top pick" ranked by real smart-money + quality signals with a penalty for a sybil-dominated funder graph.
  4. **Read payoff:** click a launch (or arrive with `?mint=`) → `POST /api/agents/:id/alpha/read {mint, network}` → thinking state, then a verdict (Snipe / Watch / Pass), a conviction bar that fills from 0, the spoken line, "What could go wrong" risks, and the eight grounded signal rows (liquidity, market cap, age, buy impact at 0.1 SOL, curve filled, quality, smart money + wallet count, organic), with the rows the agent actually cited highlighted.
  5. System: the avatar speaks the verdict: `POST /api/tts/eleven` (with `agentId`, so an owner-cloned voice is served on the owner's saved ElevenLabs key) when the agent has a voice, else `POST /api/tts/speak`, else the browser `speechSynthesis` fallback. If the server's hallucination guard replaced a figure, the panel says so and points at the signals as ground truth.
  6. (optional) Owner extras in the read: the wallet line shows balance, per-trade limit, daily budget, and a paused flag.
  7. (optional) **Act payoff (owner, gated):** click "Act: buy ◎N" → drawer opens (focus moves inside and returns to the trigger on close) → `previewAgentTrade()` fetches a fresh live quote (you pay / expected tokens / price impact, plus any warning) → **Confirm buy** → `executeAgentTrade()` posts through the guarded agent wallet path (spend limits and firewall re-checked at submit, written to the custody audit) → done state with the Solscan tx, the new wallet balance, and a link to the custody trail.
  8. (optional) Replay the last spoken line; refresh the launch rail; paste a different agent ID or profile URL; pick another agent from the public gallery.
- **Decision points / branches:** owner vs public read (act button vs gate message); `gate.can_act` true vs blocked with a reason; agent resolved from URL / storage / session / featured vs none at all (the gallery becomes the call to action, and only if the gallery is empty does the ID row open); ElevenLabs voice vs server TTS vs browser speech; hallucination guard triggered vs clean; reduced motion (bars and counters land at their final values).
- **External calls / dependencies:** `GET /api/agents/:id`, `GET /api/agents/me`, `GET /api/agents/featured`, `GET /api/agents/public?sort=popular&limit=12`, `GET /api/agents/:id/alpha/candidates`, `POST /api/agents/:id/alpha/read`, `POST /api/tts/eleven`, `POST /api/tts/speak`; `previewAgentTrade` / `executeAgentTrade` (`POST /api/agents/:id/solana/trade`) for the act path.
- **Success state:** a named 3D agent reads a real launch aloud in character, shows the live signals behind the call, and the owner can act on it through the same guarded, audited wallet path the conversational copilot uses. The narrator itself never moves funds.
- **Empty / error states:** "No live launches on the feed this second" with "Check again"; "Live feed hiccup" with Retry; read failure with "Try again"; "Couldn't fetch a live quote"; trade errors rendered above the confirm button with the button re-enabled; no-agent fallback copy on the avatar placeholder. The launches column never renders as an empty box: before an agent is on stage it reads "Pick a co-pilot above and the live launches it can read land here." (or the ID-entry variant when the gallery is empty), and an agent that fails to load clears the previous one off the stage rather than leaving its launch cards wired to nothing.
- **Step count:** 3 required (arrive → agent + launch rail → read) + ~5 optional, including the owner-gated buy (steps 7 to 8).

---

## Notes on sourcing
- All 18 routes located and traced to real source. No missing sources.
- The 2026-07 market-data family (`/markets` and its news, digest, archive, trending and Robinhood sub-pages, plus `/coins`, `/heatmap`, `/screener`, `/exchanges`, `/derivatives`, `/stablecoins`, `/dex-volumes`, `/chains`, `/yields`, `/fees`, `/hacks`, `/converter`, `/compare`) runs on CoinGecko, DeFiLlama and the news ingest rather than on the pump.fun + Oracle + sniper engines, so it is out of this cluster's scope and not yet covered by any cluster.
- `/gmgn`, `/pumpfun`, `/strategy-lab` are **pre-built static** pages in `public/` (not `pages/`), wired by `vercel.json` rewrites - easy to miss in a `pages/` listing.
- `/coin-intel` (page `api/pump/intel`) and `/radar` (`api/pump/coin-intel`) are two distinct engines despite similar names - do not conflate.
- The leaderboard/activity payoff is the trader profile at `/trader` (`src/trader.js`), reached by drilling into a row - outside this cluster's enumerated routes but noted as the terminal step.
~~~~

### `docs/ux-flows/09-x402-agent-commerce.md` (whole file)

~~~~markdown
# x402 & Agent Commerce

UX Flow Atlas - cluster 09. Traced end-to-end from real source: page HTML, imported
JS modules, and backend API handlers. Routing is path-based via the `vercel.json`
route table (the live route/cron config the Cloud Run server reads); in dev the
route map in `vite.config.js` mirrors it. Clean URLs resolve to
files under `pages/` or `public/`.

The cluster's spine is the **x402 pay-per-call** loop: hit a paid endpoint → get
`402 Payment Required` with `paymentRequirements` → pay (server-held agent wallet,
or the user's Phantom/MetaMask wallet, via the shared `/x402.js` modal, which also
offers a signed-in user's own agents as server-side payers) → re-send the
request with an `X-PAYMENT` header → facilitator verifies + settles on-chain →
endpoint runs and returns the result. The "agent economy" demos wrap this loop in a
choreographed two-agent narrative driven by Server-Sent Events.

---

### Pay-per-call (x402) - `/pay`
- **Source:** `public/pay/index.html` (route → `public/pay/index.html`; inline module scripts hold all app logic), backend `api/x402-pay.js`, `api/mcp`, `api/x402-checkout`, `api/_lib/x402-bsc-direct.js`; agent wallet via `api/agents/[id]/solana`.
- **Entry point:** Chat-style page. Left = conversation + quick-tool chips + prompt input ("Pay & Run"); right = "x402 settlement timeline"; footer = live "recent paid calls" ticker. First visit shows a 3-step walkthrough overlay (dismissed → `localStorage x402:seen-walk`).
- **Prerequisites / gates:** No signup to use the **shared demo wallet** (platform-funded). Three payer modes: (a) **platform/agent server-payer** (default): optional sign-in loads the user's own agents via `/api/x402-pay?agents=1` (401 → "Sign in" CTA, falls back to demo wallet); selecting an agent with no wallet opens the **generate-wallet overlay** (`POST /api/agents/{id}/solana`, or grind a vanity address at `/vanity-wallet`). Paying from your own agent is a real-funds action: the account must first have signed the real-funds agreements (Terms of Service, Risk Disclosure, Agent Wallet Agreement) at `/legal/agreements`, else `403 risk_ack_required` with the sign link and nothing sent, and an API-key or OAuth bearer caller additionally needs the `wallet:write` scope (`403 insufficient_scope` otherwise; `api/_lib/spend-scope.js`, where `wallet:write` is the strictest of three grades and implies the narrower `wallet:trade` and `wallet:launch`). An agent payer is also held to its owner's spend policy and capped-burner limits (`api/_lib/agent-trade-guards.js`, `reserveSpendUsd`): a call above what the agent may sign alone is refused with a `403` spend-limit code (`policy_step_up` for an owner-approval rule, see [approvals](../approvals.md)) before the payment is built, so nothing moves, and an owner action is exempt from the burner cap. (b) **Phantom** (Solana USDC, user signs). (c) **MetaMask/EVM** on the "BNB Chain" tab (user signs `approve` + `pay(bytes32)`). Wallet must hold ≥ $0.001 USDC for the chosen mode.
- **Steps (4 required + several optional):**
  1. (optional) Read/dismiss the "How this works" walkthrough overlay.
  2. (optional) Pick a payer: sign in and select an agent, generate/import its wallet, or select Phantom / MetaMask card; otherwise the shared demo wallet is used.
  3. Choose a tool: click a quick chip (`/list_tools`, `/validate DamagedHelmet.glb`, `/inspect`, `/optimize`, `/search_avatars`) **or** type a prompt (e.g. `validate https://…/model.glb`) and click **Pay & Run** / Enter. (Deep links `/pay?validate=<glb>`, `?inspect=`, `?optimize=`, `?list=1` auto-fire.)
  4. System POSTs `/api/x402-pay` (SSE) - timeline advances `challenge → built → verified → dispatched → settled`, each stage showing real ms timings and the settle tx prefix.
  5. On `result`: receipt rendered (amount, payment, durations), MCP output rendered in chat - `tools/list` lists tools, `inspect/validate/optimize` show JSON/cards, model-processing tools render an actual `<model-viewer>` GLB. Ticker bumps; balance + feed refresh.
- **Decision points / branches:** payer mode (server agent vs Phantom vs EVM - `run()` dispatches to `runPhantomPayment` / `runEvmPayment` / SSE path); agent has wallet vs not (gen overlay); prompt parse (`parsePrompt`) into a tool call; stream error vs `result` vs "stream ended without result".
- **External calls / dependencies:** `/api/x402-pay` (SSE payer + `?agents=1`, `?balance=1`, `?feed=1`, `/og`), `/api/mcp` (402 probe + dispatch), `/api/x402-checkout?action=prepare|encode`, `/api/agents/{id}/solana`, Solana mainnet RPC (`api.mainnet-beta.solana.com`), x402 facilitator (verify/settle), Solscan for tx links; BSC path uses `ThreeWSPayments` contract `0x…1B72Cc`. The Phantom path imports `@solana/web3.js` through `/load-module.js`, which tries the pinned version on esm.sh, then jsdelivr, then unpkg, each under a deadline, so one blocked CDN no longer stalls the run at the signing step.
- **Success state:** receipt card + rendered MCP result (incl. live 3D model), Solscan tx link, balance ticks down, feed prepends the call, page title shows elapsed ms.
- **Empty / error states:** not-signed-in → demo-wallet note; no agents → "Create your first agent"; agent has no wallet → gen overlay; `402`/network failure → timeline stage flips to error + `x402 call failed` / `Network error` message; stream ends without result → explicit error; wallet underfunded surfaces from server error; unsigned real-funds agreements surface the server's "Sign the real-funds agreements … Nothing was sent" copy; Solana RPC unreadable while the server builds the transfer (every read on that path is guarded and cache-backed first) → `503 rpc_unavailable` with a `Retry-After` header and the copy "No funds were transferred; retry shortly" (the same guard answers `/api/x402-checkout?action=prepare`); a wallet component that fails to load on all three CDN mirrors → the failed step names the hosts it tried.
- **Step count:** 4 required (+ ~4 optional).

### Paid-call permalink - `/pay/calls`
- **Source:** `public/pay/calls/index.html` (static share/OG view).
- **Entry point:** Shareable permalink for a single completed paid call (linked from the `/pay` ticker / OG image rendered by `/api/x402-pay/og`).
- **Prerequisites / gates:** None - read-only.
- **Steps (1):**
  1. Open the link → page renders the recorded call (tool, MCP result card, Solscan tx) and sets the document title/OG metadata for social preview.
- **Decision points / branches:** result renderer branches by tool (`tools/list`, `validate_model`, `inspect_model`, `optimize_model`, generic).
- **External calls / dependencies:** record payload (embedded / fetched), Solscan, `/api/x402-pay/og` for the share image.
- **Success state:** rendered call summary with explorer link.
- **Empty / error states:** missing record → falls back to generic card / JSON dump.
- **Step count:** 1 required.

### Hosted x402 checkout - `/pay/c/<slug>`
- **Source:** `public/pay/c/index.html` + `/x402.js`; backend `api/x402-skus.js`, `api/x402-checkout-record.js`.
- **Entry point:** Hosted checkout for a merchant-defined SKU (`/pay/c/<slug>`), branded with merchant + action name.
- **Prerequisites / gates:** A valid `?slug`/path slug resolving to a SKU; a wallet (Phantom/EVM) with USDC to pay.
- **Steps (3 required):**
  1. Page loads SKU via `/api/x402-skus?slug=…` and renders merchant/action; probes the target endpoint for its live `402` price + networks.
  2. User clicks pay → `window.X402.pay({ endpoint: sku.target_endpoint, … })` opens the shared modal (wallet connect + sign + settle).
  3. On success the page re-calls the endpoint with the payment and records the call via `/api/x402-checkout-record`; result shown.
- **Decision points / branches:** no slug → error; endpoint not returning 402 → "endpoint may have changed"; modal not loaded → error; Base vs Solana network.
- **External calls / dependencies:** `/api/x402-skus`, target merchant endpoint, `/x402.js` modal, `/api/x402-checkout-record`, Solana/Base settlement.
- **Success state:** payment settled + result rendered + call recorded.
- **Empty / error states:** missing slug, endpoint unreachable, non-402 response, modal load failure, payment cancel.
- **Step count:** 3 required.

---

### x402 Bazaar - `/bazaar`
- **Source:** `public/bazaar.html` + `public/bazaar.js` + `/x402.js`; backend `api/bazaar/list`, `api/bazaar/search`, `api/bazaar/context`.
- **Entry point:** Directory of live x402-paid endpoints (merged across facilitators) as a card grid with filters.
- **Prerequisites / gates:** None to browse; a wallet only when paying ("Try it").
- **Steps (5 required + 2 optional):**
  1. Page loads → `GET /api/bazaar/list` → renders endpoint cards. The handler merges every configured facilitator behind a 60s in-process catalog memo (`BAZAAR_CATALOG_TTL_MS`), returns at most `limit` rows (default 200) and reports the pre-cut match count as `total`; `offset` (default 0) skips that many matches so a caller can page past the cap. The page asks for one page at a time (`limit=200`, or 100 for a search) and walks the rest with `offset`: the count reads "200 of 1,234" and a **Load more** button appends the next page, disappearing once everything is shown or when a page comes back empty because the catalog moved. Every request carries a sequence number and aborts the one in flight, so the cards always match the controls the user last touched.
  2. (optional) Filter by type (HTTP/MCP), network (EVM/Solana), max price, extension, sort.
  3. (optional) Search (`/api/bazaar/search?query=`, same `offset` paging) or scroll, then **Load more**.
  4. Click a card action: HTTP → **Try it** (pay flow); MCP tool → **Inspect tool** (details only - JSON-RPC, not auto-callable); **Details** → modal + `/api/bazaar/context?resource=`.
  5. On **Try it**: `window.X402.pay({ endpoint, method, merchant, action, … })` opens the modal; pay → settle.
  6. Inline `.receipt` on the card shows status + on-chain tx + explorer link.
- **Decision points / branches:** HTTP vs MCP (MCP = inspect only); pay success/cancel/error → distinct receipt states; explorer chosen from endpoint network (Solscan/Basescan/Arbiscan/etc.).
- **External calls / dependencies:** `/api/bazaar/list|search|context`, `/x402.js`, merchant endpoint, multi-chain explorers.
- **Success state:** green receipt with tx hash + explorer link + result JSON; SR announcement "Payment succeeded for <service>".
- **Empty / error states:** no results → "No matching services…"; catalog unreachable → "Couldn't reach the catalog… Retry" (every `/api/bazaar/*` handler answers `502 facilitator_error` when all facilitators fail, so a total outage never renders as an empty catalog); modal load fail → "Payment module failed to load"; cancel → receipt hidden; error → red receipt; a **Load more** failure keeps the rows already on screen and puts the reason next to the button ("Couldn't reach the catalog. Try again." or "Could not load more: …"); a cross-origin endpoint whose response carries no CORS headers → the modal's discover step says "<host> does not allow browser requests … Call it from a server, an agent, or the x402 CLI instead" and offers no Try-again button, since the same click can never succeed.
- **Step count:** 5 required (+2 optional).

### x402 Arbitrage - `/arbitrage`
- **Source:** `public/arbitrage.html` + `public/arbitrage.js` + `/x402.js` (loaded on-demand); backend `api/bazaar/arbitrage`.
- **Entry point:** Cross-provider price-disparity board, one card per capability, ranked providers, spread %.
- **Prerequisites / gates:** None to browse; wallet only to pay.
- **Deep links in:** `/arbitrage?focus=<capability>` (what `/bazaar` sends from a listing's priced-peers hint), `?q=<text>`, `?type=http|mcp`. The page writes its own filter state back with `replaceState`, so any filtered view is shareable.
- **Steps (3 required + 3 optional):**
  1. Page loads → `GET /api/bazaar/arbitrage?minSpreadPct=0&limit=200` → skeleton then arb cards (spread %, up to 5 providers cheapest-first, metrics). A source strip (`#sources`, polite live region) names every facilitator that answered with its listing count; one that dropped out reads "<host> unreachable" (reason on hover) under an amber "Partial scan: N of M facilitators unreachable" pill, because the handler ships its `errors` next to `sources` and a half-blind scan must not read as a quiet market.
  2. (optional) Filter type All/HTTP/MCP; (optional) search by capability/host.
  3. Click **Pay cheapest · $X** → lazy-loads `/x402.js`, then `window.X402.pay({ endpoint: cheapest.resource, method:'GET', merchant: host, action: capability })`.
  4. Result shows on the button: "✓ Paid" (auto-revert 4s) / "Failed: …" or "Error: …" (auto-revert 4s) / closing the modal hands the button straight back with no hold.
  5. (optional) Click **Avoid · $Y** → navigates to `/bazaar?q=<capability>` (plus `&type=mcp` for MCP capabilities, since the catalog defaults to the HTTP tab) to see the full spectrum.
- **Decision points / branches:** MCP capability → "Pay" redirects to the catalog (can't call MCP directly); on-demand x402 load; button state management.
- **What counts as an opportunity (backend):** listings are grouped by capability key (MCP tool name, else service name, else the last literal URL segment; route placeholders like `/:solana_address` and `/{mint}` are skipped because they name the argument, not the capability). A group ships only if it spans two or more provider hosts, or if one host has a single resource quoted at two different prices by two different facilitators (a genuine cross-venue gap). A vendor charging different prices for its own distinct endpoints is not arbitrage and is dropped.
- **External calls / dependencies:** `/api/bazaar/arbitrage`, `/x402.js`, the cheapest live endpoint, Solscan/Basescan.
- **Success state:** "✓ Paid" on the cheapest provider; payment settled on-chain.
- **Empty / error states:** filters exclude everything → "No opportunities match these filters" with a Clear-filters button and a catalog link; feed genuinely has no gap → "No cross-provider price gaps right now" with links to `/bazaar` and `/providers`; timeout (20s) → "Request timed out… Retry"; feed error → "Couldn't reach the arbitrage feed…"; a partial scan renders normally with the degraded source strip rather than as an error; modal fail → "Payment modal failed to load".
- **Step count:** 3 required (+3 optional).

### x402 Providers - `/providers`
- **Source:** `public/providers.html` + `public/providers.js`; backend `api/bazaar/providers`.
- **Entry point:** Two modes from one file - **directory** (`/providers`) and **profile** (`/providers?host=<host>`). No payment surface; navigation hub into `/bazaar`.
- **Prerequisites / gates:** None.
- **Steps (2 required + 3 optional):**
  1. Directory load → skeleton → `GET /api/bazaar/providers?limit=500` → provider cards (service count, median/min price, tags, networks).
  2. (optional) Sort (most services / cheapest / most expensive / most networks); (optional) search by host/tag.
  3. Click a card → `/providers?host=…` → profile fetch `GET /api/bazaar/providers?host=` → sidebar (metrics, "Visit site", "Open in catalog") + category/network charts + sorted services table. The listings array is capped at `limit` (default 200, max 1000) while `listingTotal` carries the provider's real count, so the heading reads "N listings (showing 200)" for the multi-thousand-listing hosts.
  4. (optional) Click a listing row → `/bazaar?q=<service>`.
- **Decision points / branches:** directory vs profile keyed on `?host`; sort order; real-time search.
- **External calls / dependencies:** `/api/bazaar/providers` (list + single host), facilitator URLs, downstream explorers via `/bazaar`.
- **Success state:** cards / profile render and are navigable.
- **Empty / error states:** timeout (20s) + retry; directory unreachable; profile 404 → "Failed to load provider" + back link; no search matches; no tags message.
- **Step count:** 2 required (+3 optional).

---

### x402 Live Demo (IBM × three.ws) - `/ibm/x402-demo`
- **Source:** `pages/ibm/x402-demo.html` (self-hosted IBM Plex fonts) + `https://three.ws/x402.js` + `https://three.ws/agent-3d/latest/agent-3d.js`; backend `api/x402/forge.js` (forge-v2/models), `api/x402/symbol-availability.js`.
- **Entry point:** Marketing/live-demo page with 5 stacked sections - two **paid** (Forge, Symbol Check) and three **free/watch** (Agent, Play, IRL); each lazy-boots via IntersectionObserver.
- **Prerequisites / gates:** Free demos: none. Paid demos: MetaMask (Base) or Phantom (Solana) with mainnet USDC - Forge $0.05-$0.50 by tier, Symbol Check $0.001.
- **Steps (Forge: 5 required +1 optional; Symbol Check: 4 required):**
  1. (Forge) Enter a prompt (default "a brass steampunk owl, full body").
  2. Page fetches the live `402` challenge (`GET /api/x402/forge-v2/models?tier=draft`) and shows live price + networks + pay address.
  3. (optional) Pick tier Draft/Standard/High → price updates.
  4. Click **Pay $X & forge** → `window.X402.pay({ endpoint:'/api/x402/forge-v2/models?tier=…&prompt=…', method:'GET', … })` → wallet signs gasless USDC auth → settle.
  5. Endpoint returns a GLB → `<model-viewer>` renders it (orbit/download); the autonomous `<agent-3d>` below celebrates (`expressEmotion('celebration')` + `playEmote('cheer')`).
  - (Symbol Check) Enter ticker (default "GRANITE") → fetch `402` from `/api/x402/symbol-availability?ticker=` → **Pay $0.001 & run** → result panel shows availability pill + similar matches.
  - (Agent/Play/IRL) Scroll into view → 3D avatar auto-reacts / `/play` + `/irl` iframes lazy-load with "Full screen" / "Open on your phone".
- **Decision points / branches:** Forge vs Symbol Check (different endpoints/prices); paid vs free sections; agent reacts autonomously to settlement events; embeds load lazily.
- **External calls / dependencies:** `/api/x402/forge-v2/models`, `/api/x402/symbol-availability`, `/x402.js`, `/agent-3d/latest/agent-3d.js`, `/play`, `/irl` iframes, model-viewer bundle, Base/Solana settlement, explorers.
- **Success state:** Forge → GLB rendered + agent celebrates; Symbol Check → availability result + agent reacts; receipt with tx + explorer link.
- **Empty / error states:** offline → "live price will load when you reconnect"; insufficient balance → "Top up USDC… then try again"; 402 preview fail → "Payment button still works"; modal fail → reload prompt; cancel → result clears; embed timeout (15s) → "Open it in a new tab".
- **Step count:** Forge 5 required (+1 optional tier); Symbol Check 4 required; free sections auto-play.

---

### Endpoint Shopper - `/shopper`
- **Source:** `pages/shopper.html` + `src/shopper-app.js`; backend `api/agents/endpoint-shopper-run.js` (x402, $0.01 base + downstream budget) + the Bazaar registry.
- **Entry point:** "Endpoint Shopper" - describe a task, set a budget, watch an agent discover + chain + call x402 endpoints to answer.
- **Prerequisites / gates:** No auth. Non-empty task and budget ≥ $0.01 to enable **Run Task**; a wallet only if the run hits a `402` paywall.
- **Steps (5 required + 3 optional):**
  1. Enter a task in `#task-input` (or click an example chip).
  2. (optional) Adjust budget slider ($0.10-$2.00, default $0.50).
  3. Click **Run Task** → button "Running…", skeleton cards shown.
  4. `POST /api/agents/endpoint-shopper-run` with `{ task, maxCostUsd }` → agent emits a step trace: **discover** 🔍 → **plan** 🗺 → **call** ⚡ (per endpoint, with URL + USDC cost + snippet) → **synthesize** 🧠.
  5. Timeline renders all steps; **Total spent** row ("$0.00…" or "Free"); **Final Answer** card with synthesized text. Button re-enabled.
- **Decision points / branches:** empty task / budget < $0.01 → button disabled + hint; `402` → paywall card "Pay with Wallet" → `/paywall.html?req=…&return=/shopper`; `400`/`5xx`/network → error card + retry. The error card never repeats the run route's machine output (a snake_case code such as `no_payto_configured`, or a diagnostic with a module prefix such as `paidEndpoint:`): a `5xx` reads "The agent service is temporarily unavailable", a lost connection says the service could not be reached, and a `4xx` uses the server's text only when it reads as a sentence for a person (`readableServerMessage`), else designed copy.
- **External calls / dependencies:** `/api/agents/endpoint-shopper-run`, downstream x402 endpoints discovered via the Bazaar, `/paywall.html`.
- **Success state:** full step timeline + final answer + total cost; ready for a new task.
- **Empty / error states:** initial skeleton/empty hint ("Enter a task…"); a run that returns no plan and no answer → "No endpoints matched" card quoting the task, with rewrite / raise budget / browse the Bazaar suggestions and a run-again button; `402` warning card with CTA; red error card with retry; "Free (no paid calls executed)" if only free steps ran.
- **Step count:** 5 required (+3 optional).

### Fact Checker - `/fact-checker`
- **Source:** `pages/fact-checker.html` + `src/fact-checker-app.js`; backend `api/x402/fact-check.js` ($0.10, 7-day Redis cache).
- **Entry point:** Enter a claim, pick strictness, get a verdict + sources + cost breakdown + verifiable attestation.
- **Prerequisites / gates:** No auth. Non-empty claim ≤ 1000 chars; wallet only on `402`.
- **Steps (4 required + 3 optional):**
  1. Enter a claim in `#claim-input` (or click an example chip); live char counter.
  2. (optional) Pick strictness Low/Medium(default)/High.
  3. Click **Check This Fact** → validate → skeleton + "Searching sources…".
  4. `POST /api/x402/fact-check` with `{ claim, strictness }`.
  5. On `402` → payment panel (Base USDC $0.10 / Solana USDC $0.10) + "Connect wallet to pay →" (`/marketplace`). On `200` → verdict banner (SUPPORTED/CONTRADICTED/MIXED/INSUFFICIENT + confidence), sources grid (stance/authority), cost breakdown, expandable SHA-256 attestation.
- **Decision points / branches:** empty claim → no submit; `402` → payment panel; `429` → "Too many checks…"; `5xx` → internal-error message; retry button re-runs same claim. Cached result returns `200` instantly. When the LLM stages cannot reach a provider, the check degrades instead of failing: real sources still return with neutral stances, the response carries a `degraded` marker, and the result is never cached (so a provider outage is not pinned for 7 days).
- **External calls / dependencies:** `/api/x402/fact-check` (3 search queries → multi-source retrieval → LLM stance → weighted verdict → attestation; optional vision for image evidence, fail-open; the whole pipeline runs under a wall-clock budget, `FACT_CHECK_BUDGET_MS`, default 45s, so it never outlives the edge's 60s cutoff), Base/Solana USDC, Redis cache (7-day TTL, full-chain results only; every cache read and write is bounded at 2s, reads retry once, so a slow Upstash degrades to a cache miss instead of holding a paid request open).
- **Success state:** verdict banner + sources + cost breakdown + attestation toggle.
- **Empty / error states:** initial example chips; skeleton loading; error card (title/msg/code + retry); payment panel with network badges.
- **Step count:** 4 required (+3 optional).

### Unstoppable Agent - `/unstoppable`
- **Source:** `pages/unstoppable.html` + `src/unstoppable-dashboard.js` + `/x402.js`; backends `api/agents/unstoppable-public.js` (free snapshot) and `api/agents/unstoppable-status.js` ($0.01 for the real-time reading).
- **Entry point:** A live dashboard of an autonomous agent that must earn to survive: balance, runway, status (RUNNING/CONSERVING/HALTED), activity feed, latest reflection.
- **Prerequisites / gates:** None to view. The page polls the free snapshot, so it is populated with the agent's real numbers for every visitor. A wallet is needed only to pull the real-time reading.
- **Steps (1 required + 1 recurring optional):**
  1. Load page → paint the last reading from `localStorage unstoppable_last_reading` if present → poll `GET /api/agents/unstoppable-public` immediately, then every 60s (exponential backoff to 5 min on faults, snapping back to 60s on the next good poll, plus an immediate re-poll when the tab regains focus). Renders hero balance + status + runway, 24h earnings/costs, lifetime net, the activity feed (THINK/EARN/REFLECT/IDLE/…), and the latest reflection, labelled "Free snapshot · <age> · refreshed every 5 min".
  2. (optional, repeatable) Click **Unlock the live reading** → `window.X402.pay({ endpoint: status, method:'GET', action:'Fund the … runway' })` → on success a toast plus the real-time reading, relabelled "Live reading". Each payment buys one live query and directly credits the agent's treasury.
- **Decision points / branches:** snapshot `200` → populated; `{ available: false }` → "datastore is not answering" banner; network fault or `5xx` → "status feed is unreachable" banner, with the last known reading shown and labelled as such when cached, and per-panel failure copy plus a Retry button when not; payment low-balance → retry with link to `/pay`; payment cancel → no charge. A caller holding the `x402:bypass` install scope is served the live reading for free and is deliberately NOT recorded as revenue, so the runway the page reports stays honest.
- **External calls / dependencies:** `/api/agents/unstoppable-public` (free, cached one tick), `/api/agents/unstoppable-status` (paid, real-time, 20 rows), `/x402.js`, Base/Solana settlement.
- **Success state:** populated hero + stats + non-empty activity feed + reflection + a data-source label saying whether the numbers are the free snapshot, a paid live reading, or the last known cached reading.
- **Empty / error states:** pre-fetch "Reading the agent's treasury…" with a shimmer on the reflection card; agent with no history → "No activity logged yet" and "No reflection written yet today", both explaining the 5-minute tick; fetch failure → hero alert banner + Retry now + a link to the snapshot endpoint, and every panel states what failed rather than shimmering forever.
- **Step count:** 1 required (+1 recurring optional payment).

### Pay-As-You-Learn Tutor - `/tutor`
- **Source:** `public/tutor.html` + `public/tutor.js` + `/x402.js`; backend `api/x402/tutor.js` ($0.01/question) + `api/tutor/session.js` (free resume).
- **Entry point:** Chat tutor that charges per answer; session total accrues; "End & invoice" produces an itemized, attested invoice.
- **Prerequisites / gates:** No auth. Session id auto-minted to `localStorage three-tutor-session-id`. Wallet connect happens lazily on the first paid question. Question 5-2000 chars.
- **Steps (4 required + 4 optional):**
  1. (optional) Click a suggestion chip, or type a question in `#q` (live char counter).
  2. (optional) Pick expertise level Beginner/Intermediate(default)/Expert.
  3. Click send (or Cmd+Enter) → spinner; question added to thread.
  4. `window.X402.pay({ endpoint:'/api/x402/tutor', body:{ sessionId, question, level }, merchant:'three.ws Tutor', action:'Explain' })`; first time → paywall modal connect + sign + settle.
  5. On success → tutor bubble with answer + key points + example + follow-up; meta row (cost · level · model); session tab updates total + answer count.
  6. (optional) Click a follow-up suggestion to ask again (cost stacks). (optional) **End & invoice** → modal with per-question line items, running total, SHA-256 session attestation.
- **Decision points / branches:** < 5 chars → ignored; `X402.pay` not ready (6s) → error + retry; payment cancel → "no charge"; payment fail → retry; reload → session resumed via `localStorage` + free `GET /api/tutor/session`.
- **External calls / dependencies:** `/api/x402/tutor` (per-question charge, server-side session accrual + attestation), `/api/tutor/session` (resume), `/x402.js`, Base/Solana settlement.
- **Success state:** stacked Q&A thread, session total + count, invoice with attestation.
- **Empty / error states:** initial title + 4 suggestion chips; spinner loading; error bubble in thread; invoice modal on demand.
- **Step count:** 4 required (+4 optional).

### Forever (etch a message into Bitcoin) - `/forever`
- **Source:** `public/forever.html` + `public/forever.js`; backend `api/forever/inscribe.js` (creates a real OrdinalsBot Taproot text inscription on Bitcoin **mainnet**) + `api/forever/status.js` (polling).
- **Entry point:** Compose a message → pay Bitcoin → it's inscribed onto a single satoshi, permanently. NOT an x402/USDC flow - payment is native BTC to a generated charge address (Lightning invoice offered too).
- **Prerequisites / gates:** Creating an order requires a signed-in session or a valid API bearer token (`POST /api/forever/inscribe` answers 401 otherwise), and both endpoints carry a per-IP rate ceiling (429). Message 1-1500 bytes UTF-8. Optional Taproot (`bc1p...`) receive address, verified with a full bech32m checksum so a mistyped address gets a precise 400 instead of an opaque upstream error (else platform vault `BTC_INSCRIPTION_RECEIVE_ADDRESS`). Fee rate 3/8/20/50 sats/vB. **User must hold BTC in their own wallet**: a confirm dialog shows the estimated cost before the order is created.
- **Steps (6 required + 6 optional):**
  1. Type the message (live char + byte counters; orange warning > 1500 bytes).
  2. (optional) Enter a Taproot receive address.
  3. (optional) Select fee rate → live fee estimate (`#feeEstimate`) with sats / BTC / ≈USD (the first of four keyless price feeds to answer: CoinGecko, Coinbase, Kraken, DefiLlama, 4s each, best-effort).
  4. Click **Inscribe forever** → native `confirm()` showing estimated BTC cost + address ("payment is final once broadcast. Continue?").
  5. `POST /api/forever/inscribe` `{ message, receiveAddress, feeRate }` → creates OrdinalsBot order → returns charge address, amount (sats), Lightning invoice, mempool URL; order persisted to `sessionStorage forever:order` → **pay view**.
  6. Pay view: QR (BIP-21; api.qrserver.com, then quickchart.io, and if both fail the payment URI as selectable text so the payer is never left with a broken image), amount, pay-to/Lightning/receive/order-id rows, "Open in wallet" / "View on mempool" / "Cancel". User sends BTC from their own wallet.
  7. Auto-poll `GET /api/forever/status?id=<orderId>` every 6s → `waiting-payment → payment-received → inscribing → inscribed`. Once a reveal txid exists the response also carries `inscription.onchain` (confirmed, confirmations, block height and time) read keyless from Blockstream Esplora, so finality depth comes from the chain rather than from OrdinalsBot's order state; an Esplora outage degrades that field to `null` instead of failing the poll.
  8. On `inscribed` → **win view**: large message, Inscription link (ordinals.com), reveal-tx link (mempool.space), receive address, "Bitcoin mainnet"; share to X / copy permalink / inscribe another.
- **Decision points / branches:** empty / > 1500 bytes / invalid Taproot / invalid fee rate → inline errors; signed-out → the server's 401 copy surfaces in the error banner; confirm-dialog cancel → stays in compose; order-create `502/503` → "Inscription failed. Try again." (the OrdinalsBot order call is bounded at 30s and never retried, since a retry after a request that actually landed would buy a second inscription); a non-OK, non-404 poll (including the `502` the API answers when OrdinalsBot misses its 15s deadline twice) is skipped and the next 6s tick retries; status `failed` → OrdinalsBot contact note; status `404` (the order id no longer resolves upstream) → polling stops, the saved order is cleared, and the page returns to compose with a nothing-was-charged explanation; reload mid-payment → `resumeIfAny()` restores the pay view + resumes polling (unless the saved order 404s, which takes the same retire path).
- **External calls / dependencies:** `/api/forever/inscribe` + `/api/forever/status` → **OrdinalsBot** (`api.ordinalsbot.com`, Bitcoin mainnet Taproot inscription), Blockstream Esplora (`api/_lib/esplora.js`, keyless reveal-tx confirmations, fail-soft), four BTC/USD feeds (CoinGecko, Coinbase, Kraken, DefiLlama; best-effort), two QR services (qrserver, then quickchart), mempool.space + ordinals.com for verification.
- **Success state:** win view with permanent inscription + reveal-tx links + share buttons.
- **Empty / error states:** compose validation errors; inscribe failure banner; pay-view polling states; order `failed` message with support info.
- **Step count:** 6 required (+6 optional).

---

### Agent Exchange - `/agent-exchange`
- **Source:** `pages/agent-exchange.html` + `src/agent-exchange.js`; backend `api/x402-pay.js` (SSE payer), `api/x402/crypto-intel.js` (the paid endpoint).
- **Entry point:** Two 3D avatars (Intel Agent seller, Buyer Agent) face off; topic chips (SOL/BTC/ETH/DOGE/BNB) + **Buy intel - $0.01 USDC** + on-chain transaction feed. Real USDC settles per buy.
- **Prerequisites / gates:** No user auth/wallet. Server-side agent wallet (`X402_AGENT_SOLANA_SECRET_BASE58`) must be funded ≥ $0.01; pre-flight `checkWallet()` (`/api/x402-pay?balance=1`) disables the pay button if unconfigured/underfunded.
- **Steps (2 required; rest auto):**
  1. **[auto]** Avatars load + greet (scripted speech via postMessage).
  2. **[user]** Select a topic chip (default SOL) → buyer agent reacts.
  3. **[user]** Click **Buy intel - $0.01 USDC** → button "Paying…".
  4. **[auto SSE from `/api/x402-pay`]** six narrated stages: `challenge → built → verified → dispatched → settled → done`, each with stage chip + agent animation + narration.
  5. **[auto]** Receipt card (Confirmed on-chain · amount, payer/payee, Solana mainnet, Solscan tx, headline + signal badge + 24h change); session total flashes. Bubbles auto-hide ~5.5s. Repeat with a new topic.
- **Decision points / branches:** topic selection feeds the intel request; wallet pre-flight gate; SSE `error`/timeout (30s) → stage error + red receipt + reset + retry.
- **External calls / dependencies:** `/api/x402-pay` (POST SSE, tool `crypto_intel`, endpoint `/api/x402/crypto-intel`), `/api/x402-pay?balance=1`, `/api/x402/crypto-intel`, Solana RPC settlement, Solscan.
- **Success state:** all 6 stages + receipt with on-chain tx + agents celebrate + session total increments.
- **Empty / error states:** "Demo wallet not configured" (button disabled), "Agent wallet low on USDC" + fund address, timeout/SSE error with "No funds were moved", initial narration describing the flow.
- **Step count:** 2 required (auto SSE pipeline thereafter).

### Agent Commerce - `/agent-trade`
- **Source:** `pages/agent-trade.html` + `src/agent-trade.js`; backend `api/agent-trade/demo` (SSE), guarded by a per-IP read limit and a global daily payout ceiling on the demo buyer wallet (`limits.avatarPayoutDaily`). It signs with the platform's demo keypairs, so the per-agent spend guards in `api/_lib/agent-trade-guards.js` do not apply to it.
- **Entry point:** Three.js scene with two geometric agents (Nexus buyer, Oracle seller) on platforms; topic dropdown + **▶ Run Trade Demo**; central card + step log. Cinematic camera, particle beam, burst on confirm.
- **Prerequisites / gates:** No user auth. Server agent keypairs `AGENT_BUYER_SECRET` + `AGENT_SELLER_SECRET` (+ `AGENT_TRADE_PRICE_SOL`, `AGENT_TRADE_NETWORK`) must be configured + funded. Pre-flight `checkConfig()` (`/api/agent-trade/demo?check=1`) runs with Run disabled and a skeleton card ("Checking the demo wallets") in the centre; configured → ready card + Run enabled; unconfigured → modal overlay walkthrough + env instructions, Run stays disabled; pre-flight unreachable → a "Status check failed" card with **Retry the status check**, and Run is left enabled so the run itself reports what failed.
- **Steps (2 required; rest auto):**
  1. **[user]** Select a topic from the dropdown.
  2. **[user]** Click **▶ Run Trade Demo** → "⏳ Running…".
  3. **[auto SSE `/api/agent-trade/demo?topic=`]** ordered events with choreography: `init` (addresses/balances, camera fly) → `request` (buyer asks) → `challenged` (402 card, SOL price) → `paying` (particle beam buyer→seller; the buyer bubble "Sending X SOL on-chain…" carries an indeterminate progress bar, since a real transfer can take tens of seconds and static text is indistinguishable from a stalled page) → `confirmed` (burst, Solscan tx card, balance debited) → `delivering` ("Analyzing with <model>…", same pending bar) → `delivered` (final analysis card + model + tx link).
  4. Button re-enabled ("Run again"); idle animation resumes.
- **Decision points / branches:** topic feeds the request payload; config gate (dismiss only hides overlay); `error` event → the active chip flips red, a toast fires, and a centre failure card names the cause in its badge (`insufficient_funds` "Buyer wallet is short", `daily_budget_exhausted` "Daily spend limit reached", `analysis_unavailable` "No analysis model available", `analysis_failed` "Analysis failed after payment", `send_failed` "Payment failed", anything else "Trade stopped") with a **Run it again** button; `not_configured` instead re-opens the walkthrough overlay and disables Run; a stream that drops mid-run gets the same card badged "Stream dropped". Below 560px the labels and bubbles leave the 3D projection and stack into a flat strip (the layout the no-WebGL fallback also uses) so the card never paints over a speech bubble.
- **External calls / dependencies:** `/api/agent-trade/demo` (`?check=1` + `?topic=` SSE), real SOL settlement on Solana mainnet/devnet, AI model inference for the delivered analysis, Solscan.
- **Success state:** all 7 SSE stages + final delivered-skill card with model-generated content + on-chain tx.
- **Empty / error states:** pre-flight skeleton card; not-configured modal overlay + unconfigured card; status-check-failed card with retry; failure card (badge + message + Run it again) on any `error` event or dropped stream; idle ready card.
- **Step count:** 2 required (auto SSE thereafter).

### Agent Economy (Live) - `/agent-economy`
- **Source:** `pages/agent-economy.html` + `src/agent-economy.js`; backend `api/agent-economy/status` + `api/agent-economy/transact`.
- **Entry point:** Three-column layout - buyer Nova (3D iframe) | service catalog + transaction feed | seller Oracle (3D iframe). Catalog: Market Analysis ($0.001), On-Chain Insight ($0.002), Risk Score ($0.003) + optional topic input.
- **Prerequisites / gates:** No user auth. Server wallet (`AVATAR_WALLET_SECRET`) must be configured + funded; `refreshWalletStatus()` (`/api/agent-economy/status`) on init + after each trade shows fund alert / pause banner.
- **Steps (2 required + 1 optional; rest auto):**
  1. **[auto]** Avatars load + greet.
  2. **[user]** Select a service button.
  3. **[user, optional]** Enter a topic (≤120 chars).
  4. **[auto]** Buyer Nova requests + pays (column flash, feed item 📡), `POST /api/agent-economy/transact { service, topic }`.
  5. **[auto ~900ms]** Oracle "receives" - payment particle buyer→seller, feed item 💸 with receipt + Solscan link; balances refresh.
  6. **[auto ~400ms]** Oracle delivers (speech via LLM, feed item ✅ with content). Status "Transaction complete". Repeat.
- **Decision points / branches:** service price tier; optional topic; wallet states - `wallet_unconfigured` ("Live transactions paused"), `insufficient_balance` ("Not enough funds" + Add funds), `no_recipient`, generic error.
- **External calls / dependencies:** `/api/agent-economy/status`, `/api/agent-economy/transact`, Solana RPC settlement, LLM for buyer/seller speech, `/a-embed` avatar iframes (postMessage), Solscan.
- **Success state:** 3 feed items (request / payment+receipt / delivery) + updated balances + ready for next service.
- **Empty / error states:** unconfigured pause; underfunded fund banner + "Add funds"; network error feed item; initial empty feed ("Pick a service above…").
- **Step count:** 2 required (+1 optional topic; auto orchestration thereafter).

### Agent Economy - NOVA & ORACLE - `/demo`
- **Source:** `pages/demo-economy.html` + `src/demo-economy.js`; backend `api/demo-economy` (SSE).
- **Entry point:** Single Three.js scene - NOVA (blue) + ORACLE (gold) on platforms with a TV screen between them; **Run demo** button; sidebar wallet chips + payment details + activity log.
- **Prerequisites / gates:** No user auth. Server agents configured + funded for live settlement; no pre-flight overlay - the stream emits error/demo_mode events if not configured. Unsigned-in/anonymous users get a **simulated** payment path.
- **Steps (1 required; rest auto):**
  1. **[auto]** Idle scene renders (TV idle, particles, auto-rotate, wallet chips).
  2. **[user]** Click **Run demo** → "Running…", log cleared, scene reset.
  3. **[auto SSE `/api/demo-economy`]** typed events: `step` (e.g. agents_ready → camera fly) → `bazaar` (TV draws x402 service list) → `wallet` (chips updated) → `payment` (pay card; SOL amount; signature link or "SIMULATED" badge; mobile sheet slides up) → `content` (TV draws ORACLE market briefing with pools) → `done`.
  4. Button re-enabled ("Run again").
- **Decision points / branches:** configured+funded vs underfunded (error w/ fund notice) vs not-configured (error, prompts anon to sign in); `simulated=true` → the pay card reads "Simulated payment" and asks the visitor to sign in to run a live on-chain transfer, plus a "Mode: Simulated" row. 35s hard timeout.
- **External calls / dependencies:** `/api/demo-economy` (SSE), Solana RPC settlement (if live), GeckoTerminal trending pools for the briefing (read through the shared upstream fetch: 8s deadline, one retry, breaker-guarded, and backed by a last-known-good copy up to 30 min old, so a throttled upstream leaves the demo with a briefing flagged `stale` + `as_of` rather than nothing to sell), Solscan.
- **Success state:** TV shows final briefing with markets + prices + 24h changes; full activity log; "Run again".
- **Empty / error states:** not-configured error; underfunded fund notice; simulated mode; initial idle scene with "not configured" wallet chips.
- **Step count:** 1 required (auto SSE thereafter).

### Agent Economy - Live - `/live`
- **Source:** `pages/live.html` (inline module) + `src/live-economy.js`; backend `api/demo/economy` (`?status=1` + `?trade=1` SSE) + `api/chat` (LLM dialogue).
- **Entry point:** Full-screen Three.js scene - Oracle + Trader on pedestals + TV; CSS-overlaid name tags, balance chips, speech bubbles, HUD with **▶ Agent Trader pays Oracle for Solana market data** + event log. Agents speak LLM-generated lines.
- **Prerequisites / gates:** Viewing is open; the **live trade** stream `/api/demo/economy?trade=1` is **auth-gated** - anonymous users get a "Sign in to run a live on-chain trade" notice. Server agents must be configured + funded. `refreshStatus()` polls `?status=1` every 10s.
- **Steps (1 required; rest auto + LLM):**
  1. **[auto]** Scene renders; Oracle greets (~3s, LLM via `/api/chat`), Trader greets (~5.5s).
  2. **[user]** Click the trade button → "⏳ Trade in progress…", Trader waves + LLM intro line.
  3. **[auto SSE `?trade=1`]** events: `thinking` → (`demo_mode` if unsigned/unconfigured → "No real payment in demo mode") → `paying` (beam Trader→Oracle + LLM line) → `paid` (white flash, Oracle pedestal flash, balances refresh, Solscan log link, LLM lines) → `fetching` → `delivering` (TV draws market grid, reverse beam, LLM lines) → `done`.
  4. Button re-enabled ("▶ Run Another Trade"). 45s hard timeout.
- **Decision points / branches:** signed-in + funded (live SOL) vs not-configured/underfunded (`error` with fund address + Copy/View/Retry) vs anonymous (`error` → "Sign in" notice) vs `demo_mode` (data only, no payment).
- **External calls / dependencies:** `/api/chat` (LLM), `/api/demo/economy?status=1` (poll) + `?trade=1` (auth-gated SSE), Solana RPC settlement, market-data source, `/avatar-embed.html` iframes (postMessage), Solscan.
- **Success state:** paid + delivered, TV market grid, log with Solscan link, balances updated, "Run Another Trade".
- **Empty / error states:** not-signed-in notice; underfunded fund notice; stream interrupted; demo-mode (no real SOL); initial idle TV + greetings.
- **Step count:** 1 required (auto SSE + LLM thereafter).

---

### Sniper Arena - `/play/arena`
- **Source:** `pages/play/arena.html` + `src/play/arena.js` + `src/play/rivalries.js`; backend `api/sniper/leaderboard`, `api/sniper/rivalries` (see `docs/rivalries.md`), `api/sniper/stream` (SSE), `api/sniper/trader`, `api/oracle/agent-stats`.
- **Entry point:** A 3D world where **autonomous** AI agents trade real pump.fun tokens on Solana mainnet, live. Left = live leaderboard; right = live trade tape; bottom = movement hints. **No x402 micropayments here** - agents have pre-funded wallets and trade autonomously.
- **Prerequisites / gates:** None to watch. Picking an avatar is local (`localStorage arena:avatar:v1`), no payment. Agents trade with their own funded Solana wallets.
- **Steps (4 required + 3 optional):**
  1. **[auto]** Page boots `ArenaWorld` (Three.js 60fps) and, without waiting on the 3D load, fetches `/api/sniper/leaderboard?network=mainnet` and mounts the grudge-match strip (`GET /api/sniper/rivalries?window=7d&lookback=24h&limit=2`, refreshed every 90s: each row pairs a trader with the one above them, labelled Passed / Debut / Chasing, with links to the leader's record and Ghost-copy). The board and tape paint while the animation manifest + avatar GLB download; the loading curtain sits below the side panels, so it only hides the empty canvas. Once the world is walkable, SSE `/api/sniper/stream` opens after the first board read.
  2. **[auto]** Agents spawn once the world is ready (deterministic avatar by `agent_id` hash, arc formation, floating DOM labels with rank/name/P&L).
  3. **[auto/live]** SSE `buy`/`sell`/`update` events → agent emotes + particle burst, trade tape prepends (BUY/SELL ▲▼, symbol, Solscan link), big-win banner, board refresh.
  4. **[user, optional]** **Choose your avatar** → modal → select → spawn player (saved to localStorage).
  5. **[user, optional]** Move with WASD / drag look / scroll zoom / touch joystick.
  6. **[user, optional]** Click an agent label → camera focus + right drawer profile (equity sparkline, stats grid, recent closed trades with on-chain proof, Oracle conviction section) → **Full proof & copy ↗** → `/trader/<agent_id>` new tab.
- **Decision points / branches:** fully autonomous trading, so the user only watches/moves/inspects; header links out to `/duels` (call which trader books more, free to play), `/syndicates` (copy the winners as a team), and `/quests` (today's trading quests); SSE vs periodic board refresh; avatar selection local; focus/unfocus; big-win banner threshold (≥0.4◎ or ≥100%).
- **External calls / dependencies:** `/api/sniper/leaderboard`, `/api/sniper/rivalries`, `/api/sniper/stream` (SSE), `/api/sniper/trader`, `/api/oracle/agent-stats`, `/animations/manifest.json`, avatar GLBs, Solscan, `/trader/<id>`. Solana mainnet (real pump.fun trades).
- **Success state:** agents render + leaderboard + live tape; user can move + inspect; real trades animate in real time.
- **Empty / error states:** no live agents → "No agents are live yet… arm a trader and enter"; SSE drop → "Reconnecting…" (retry 2.5s); board never read → "Can't reach the leaderboard." + **Retry now** (KPI strip hidden); refresh fail after a good read → "Standings are stale." keeping the last good board and its KPI strip; rivalries → skeleton, an empty note when fewer than two traders have 3+ closed round-trips, or "Can't reach the rivalry feed." + Retry; drawer fail → "Couldn't load this trader"; avatar load fail → mono-initial tile.
- **Step count:** 4 required (auto boot) + 3 optional (avatar, move, inspect).

### Agent Exchange (feature page) - `/features/agent-exchange`
- **Source:** `pages/features/agent-exchange.html` (static marketing landing; `/nav.js` + `/footer.js`).
- **Entry point:** Static feature page explaining the Agent Exchange concept. NOT a demo - it links to the live demo at `/agent-exchange`.
- **Prerequisites / gates:** None.
- **Steps (1 required):**
  1. Read the page (hero, "How it works" 3-step, highlights, FAQ).
  2. (optional) Click **Watch live →** (`/agent-exchange`) to run the real demo, or **All features** (`/features`).
- **Decision points / branches:** none (static).
- **External calls / dependencies:** none beyond nav/footer includes.
- **Success state:** user navigates to the live `/agent-exchange` demo.
- **Empty / error states:** none (static content).
- **Step count:** 1 required (+1 optional CTA).

---

## Notes

- **Routing:** all clean URLs resolve through the `vercel.json` route table - read directly by the Cloud Run server (`server/index.mjs`) in production and mirrored by the `vite.config.js` `historyApiFallback` map in dev. `/pay`, `/bazaar`, `/arbitrage`, `/providers`, `/forever`, `/tutor` live under `public/`; the rest under `pages/`.
- **Shared payment modal:** `/x402.js` (`public/x402.js`, ~2.7k LOC) is the drop-in `window.X402.pay()` modal used by `/pay/c`, `/bazaar`, `/arbitrage`, `/ibm/x402-demo`, `/shopper` (paywall), `/fact-checker`, `/unstoppable`, `/tutor`. It handles wallet connect (Phantom/Solana, MetaMask/Base via EIP-3009), the 402→sign→retry loop, and SIWX re-entry. Before the first payment it collects the real-funds agreements (Terms of Service, Risk Disclosure, Agent Wallet Agreement) through the lazily loaded `risk-ack.js`, degrading to a native `confirm()` with the same wording if that module cannot load. A resource that prices itself in several Solana tokens (USDC and $THREE, a Token-2022 mint the Solana rail now settles) gets a token chooser. Solana transactions are signed through the wallet's Wallet Standard `solana:signTransaction` feature when it offers one, falling back to the injected provider; Phantom's Lighthouse guard instructions (up to 3) are accepted rather than vetoed, unless one names the sponsor's fee-payer account. Only a wallet's own refusal (EIP-1193 code 4001, ethers' `ACTION_REJECTED`) reads as a cancel; a server-side refusal keeps its real reason. Its Solana web3.js and SIWX hashing imports go through `/load-module.js` (the pinned version on esm.sh, then jsdelivr, then unpkg, each under a deadline); only when all three fail does the modal steer the buyer to MetaMask on Base, which needs no third-party code. A cross-origin endpoint whose response carries no CORS headers is reported as "<host> does not allow browser requests" with a pointer to a server, an agent, or the x402 CLI, and no Try-again button.
- **Chain order in the 402:** every `paidEndpoint` route in this cluster (`/api/x402/fact-check`, `/api/x402/tutor`, `/api/x402/symbol-availability`, and the rest) inherits the platform default of Solana first, then Base, so the live challenge lists networks in the same order the discovery catalog advertises and a client that takes the first accept settles on Solana. `tests/x402-solana-first-ordering.test.js` fails the suite if a route pins Base first again.
- **Server-payer vs user-payer:** the "agent economy" narratives (`/agent-exchange`, `/agent-trade`, `/agent-economy`, `/demo`, `/live`) pay from **server-held agent wallets** and stream the choreography over SSE - the user only triggers/selects, then watches. The "showcase" apps (`/shopper`, `/fact-checker`, `/tutor`, `/bazaar`, `/arbitrage`, `/ibm`) make the **user** pay via the `/x402.js` modal.
- **Auto-play demos:** `/agent-exchange`, `/agent-trade`, `/agent-economy`, `/demo` need one user click to start, then auto-play. `/live` adds an auth gate for real settlement. `/play/arena` is fully autonomous (agents trade themselves; user only watches/moves/inspects) and uses **no x402** - real pre-funded Solana trades.
- **Forever** is the only **non-x402** payment in the cluster: native Bitcoin (or Lightning) to an OrdinalsBot charge address, inscribing a real Taproot text inscription on Bitcoin mainnet.
- **Adjacent economy surfaces (2026-08-01, not yet traced as full sections):** `/economy-lab` (`pages/economy-lab.html`; Runway Lab, a live digital twin of the x402 payment rail; backend `api/x402/runway-lab.js`), `/pay/simulator` (Spend Policy Simulator: dry-run an agent spending policy against real x402 prices), `/flow` (Money Flow Map, see `docs/money-flow-map.md`), `/play/solver` (see `docs/economy-solver.md`), and `/conversions`.
- **Inline handlers are gone:** every HTML response in this cluster ships a CSP whose `script-src` lists SHA-256 hashes of the inline scripts in the bytes actually sent, so no page here may carry an `onclick=`/`onerror=` attribute (not even inside a template literal). The card markup these flows render declares intent with `data-fallback`, `data-action="reload"` or `data-stop-propagation` and `public/inline-behaviors.js` delegates it; `scripts/audit-inline-handlers.mjs` fails the build if one comes back.
- **Source coverage:** all 19 routes located and traced from real source. `/tutor` resolves to `public/tutor.html` + `public/tutor.js` (served statically; no explicit vite map entry needed). No source was missing.
~~~~

