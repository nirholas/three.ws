# Count AR opens, oEmbed unfurls and shared-creation views so the revenue readout can say whether shares convert

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/716-plan-forge-share-distribution-funnel-metrics.md`.

**Priority:** P2, new capability with clear value (score 57 of 100 inside the tier). **Area:** forge. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The owner playbook says it plainly: AR, oEmbed and shared creation links are built, "the capability is built, the funnel is not measured", and nothing in Tier 2 matters until a stranger pays twice. `scripts/x402-revenue-readout.mjs` already separates external revenue from ring volume, and `api/_lib/forge-funnel.js` already answers "did a generation turn into something kept" (accepted or downloaded, retention, per-lane). What is missing is the second half: after a creation is shared, is the link opened, does the AR button get pressed, does the unfurl card render, and does any of it lead to a new forge or a paid call. Without those counters the "distribution wired but not defaulted into every share path" item in the playbook cannot be prioritized or proven.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Share surfaces exist: `api/ar.js` with `planArLaunch` in `api/_lib/ar-launch.js` (AR route planning), `api/agent-oembed.js`, `api/play-oembed.js` (tested by `tests/play-oembed.test.js`), the `/m/:id` creation card with `3DModel` JSON-LD (`server/creation-head.mjs`, `api/_lib/creation-jsonld.js`), the OG image endpoints (`api/avatar-og.js`, `api/og/`), and `src/diorama/share.js`.
- `api/_lib/forge-funnel.js` (read-only SELECTs over `forge_creations`; `api/ops/forge-funnel.js`; `scripts/forge-funnel-report.mjs`; `tests/forge-funnel.test.js`) carries `destination` including `ar` (`src/shared/forge-destinations.js`) but nothing downstream of the share: no table or counter records an AR launch, an oEmbed fetch, a creation-page view, or a "make your own" click from a shared page. `grep -rn "oembed" api/_lib` finds no counter.
- `api/_lib/platform-analytics.js` defines `METRICS` and `SOURCES` (windows 30d, 90d, all) for the public analytics page; `scripts/x402-revenue-readout.mjs` is the sanctioned revenue readout.
- Privacy constraint: the platform avoids raw-IP logging elsewhere (`ip_hash` patterns in `api/irl/pins.js`); counters here must be aggregate and non-identifying.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
sed -n 100,135p docs/internal/fable-playbook.md
grep -rn "forge_share\|share_funnel\|ar_opens\|oembed_hits" api scripts tests | head
sed -n 1,60p api/ar.js
sed -n 275,300p api/_lib/platform-analytics.js
npm run db:status          # read before any migration; db:migrate applies immediately
node scripts/forge-funnel-report.mjs --help 2>&1 | head -20
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Design the counter: one aggregate table `share_funnel_daily (day date, surface text, kind text, count bigint, primary key (day, surface, kind))` via a new idempotent migration in `api/_lib/migrations/`. `surface` is one of `ar`, `oembed_agent`, `oembed_play`, `creation_page`, `og_image`, `diorama_share`; `kind` is `view`, `action`, `cta_click`. No IP, no user id, no URL path with ids; counts only. Read `npm run db:status` first.
2. A single helper `api/_lib/share-funnel.js` with `recordShareEvent(surface, kind)` doing a fire-and-forget upsert (`on conflict do update set count = count + 1`), failing open with a logged warning so a counter outage never breaks an unfurl. Test in `tests/share-funnel.test.js`: surface and kind are validated against an allowlist, a DB failure does not throw, and the SQL increments atomically.
3. Wire the helper at each surface's handler: `api/ar.js` (AR launch route planned), `api/agent-oembed.js`, `api/play-oembed.js`, the creation page head builder (`server/creation-head.mjs`) for `creation_page` views, and the share sheet copy and AR buttons in `src/diorama/share.js` through a small beacon endpoint (`POST /api/share-funnel` with allowlisted body, rate limited, registered in `vercel.json`). Crawlers and unfurl bots count as `view` only on oEmbed and OG surfaces; user-agent filtering is not required, but the report must label oEmbed counts as "unfurls", not human views.
4. "Make your own" conversion: the creation page's call to action to `/forge` carries a `?from=share` query parameter; `api/forge*.js` stores it on the new `forge_creations` row only if a nullable `source` column already exists, else add one with the same migration, and `api/_lib/forge-funnel.js` gains a "from a share" section: creations started from a shared link, their useful rate, and the share-to-forge ratio over the window. Extend `tests/forge-funnel.test.js` with a case for the new section.
5. Surface it: add the share counters to `scripts/forge-funnel-report.mjs` output and to `api/ops/forge-funnel.js` JSON, and add one line to `scripts/x402-revenue-readout.mjs` (leading indicators beside the external revenue figure: AR launches, unfurls, share-to-forge). The readout must keep refusing to print an external figure it cannot stand behind; do not change that rule.
6. Default distribution into the share paths the playbook calls out: every generated artifact result (forge result card, diorama save, avatar save) shows a visible "Open in AR" action when a USDZ or WebXR route is available (reuse `planArLaunch` to decide which); verify in a real browser that the button appears on desktop (QR to phone) and on a phone viewport (direct launch), with hover, focus, and active states, a disabled state with an explanation when AR is unsupported, and no console errors.
7. Docs: a section in `docs/seo.md` or `docs/api/forge-x402.md` describing the counters and privacy stance; a `data/changelog.json` entry only if the AR button or `?from=share` is user-visible; `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/share-funnel.test.js tests/forge-funnel.test.js tests/play-oembed.test.js` passes.
- [ ] Migration applies twice with the second run a no-op; after clicking through a real AR open and a real oEmbed fetch locally, `select * from share_funnel_daily` shows the two increments.
- [ ] `node scripts/forge-funnel-report.mjs` prints the share section with real data or a designed empty state ("no shares recorded in this window") and `node scripts/x402-revenue-readout.mjs --window 7d` still exits 0 or 2 exactly as before.
- [ ] No identifier (IP, user id, creation id) is stored in the counter table; the test asserts the insert parameters contain only day, surface and kind.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| `DATABASE_URL` not local | Follow the `self-unblock-playbook` database row; use a scratch Neon branch for the migration test. |
| Unfurl bots inflate counts | Report oEmbed numbers as unfurls and do not mix them into human conversion figures; conversion is share-to-forge and AR opens, which need a real client. |
| AR cannot be tested in headless Chromium | Test the route planner as pure logic and the button states in the DOM; state that WebXR session start is device-only. |
| Revenue readout classification fails (exit 2) | That is the readout working; leave it, report the reason, and still ship the funnel counters. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/716-plan-forge-share-distribution-funnel-metrics.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `716-plan-forge-share-distribution-funnel-metrics.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/internal/fable-playbook.md` (section "Tier 1: direct revenue or conversion")

~~~~markdown
### Tier 1: direct revenue or conversion

1. **Forge as a paid service, hardened** (wraps `packages/forge/`, `api/forge*.js`).
   The text-to-3D API is our cleanest product-shaped revenue: metered x402
   pricing, free TRELLIS lane as the funnel, paid tiers for quality, speed and
   rigging. The work is latency (caching, warm lanes), output quality
   (prompt-director tuning, auto-repair of bad meshes), and reliability SLOs.
   Everything else in this tier feeds this endpoint. **This is the one Tier 1
   item still substantially open, and it is where effort should go.**
2. **Asset pipeline compression.** *Shipped.* `@gltf-transform/*` and
   `meshoptimizer` are dependencies and the decode path is enforced: any worker
   reading a caller's mesh routes through `gltf_meshopt.decode_if_meshopt`
   (`npm run check:vendored` keeps the vendored copies honest). Remaining upside
   is measurement, not plumbing: prove the byte and first-render win per surface.
3. **AR everywhere.** *Shipped.* `src/usdz-pipeline.js`, `src/usdz-animated.js`,
   `src/ar-studio.js` (also extracted as the standalone `packages/ar-studio`,
   kept in step with the app by a parity test), `api/ar.js` and `api/_lib/ar-launch.js` exist, with an AR
   MCP tool at `api/_mcp3d/tools/ar.js`. Remaining upside is placement: make the
   AR link unmissable on every generated artifact rather than a page you find.
4. **Embed, oEmbed and OG thumbnails.** *Shipped.* `api/agent-oembed.js`,
   `api/play-oembed.js`, the `/embed/*` route family in `vercel.json`, and OG
   image endpoints (`api/avatar-og.js`, `api/avatar-detail-og.js`,
   `api/og/`). Shared `/m/:id` creation links now unfurl as a render card with
   `3DModel` JSON-LD (`server/creation-head.mjs`, `api/_lib/creation-jsonld.js`,
   [docs/seo.md](../seo.md)). Remaining upside is the same as 3: distribution is
   wired but not yet defaulted into every share path.

The honest reading of 2 through 4: the capability is built, the funnel is not
measured. A generation that produces an AR link nobody clicks converts nothing.
Before building the next lane, instrument the ones that exist.
~~~~

### `docs/internal/fable-playbook.md` (section "Sequencing")

~~~~markdown
## Sequencing

**Now.** Instrument the shipped Tier 1 funnel (compression, AR, embeds) so the
conversion question has an answer, and harden Forge as the paid product. Both
report into `npm run readout:revenue`. Getting the external figure off zero is
the whole job at this stage; nothing in Tier 2 matters until a stranger pays us
twice.

**Next.** Procedural animation, the splat pipeline, text to game (§3.5 to §3.8),
alongside the rung-2 motions (SDK to key funnel, the AWS listing).

**Then.** Open-core the retargeter, the data-moat endpoints, partnership
routines.

Review quarterly against the readout. If a play has not moved the external
number or its leading indicator (generations, embeds live, SDK installs) in a
quarter, cut it and promote the next one.
~~~~

### `docs/api/forge-x402.md` (whole file)

~~~~markdown
# Forge: paid 3D generation API (x402)

Pay-per-call text→3D and image→3D for AI agents. One USDC payment buys one
generation, settled autonomously over [x402](https://x402.org): no API key, no
account, no signup. This is the monetized twin of the free, browser-facing
`/api/forge`.

|  |  |
|---|---|
| **Endpoint** | `POST https://three.ws/api/x402/forge` |
| **Price** | $0.05 / $0.15 / $0.50 USDC per generation, by quality tier |
| **Payment** | x402 `exact` scheme, USDC on **Solana mainnet** |
| **Polling** | free, on `GET /api/forge?job=<id>` |
| **Discovery** | `GET /api/x402/forge` (free), `/.well-known/x402`, `/openapi.json` |
| **Source** | [api/x402/forge.js](../../api/x402/forge.js), listing metadata in [api/_lib/forge-listing.js](../../api/_lib/forge-listing.js) |

New here? Prove the concept on the free, keyless draft lane at
`POST /api/3d/generate` ([3D API](../3d-api.md)) first, then pay for a tier when
you need standard/high quality or image→3D.

## Pricing

Flat per-call retail price by tier. The single source of truth is
[api/_lib/forge-tiers.js](../../api/_lib/forge-tiers.js) (`priceUsdcAtomics`);
the 402 challenge quotes the exact price for the tier you asked for, so an agent
never has to hardcode a number from this page.

| Tier | Price (USDC) | Geometry | Textures | Best for |
|---|---|---|---|---|
| `draft` | **$0.05** | ~12k tris | none | Blockout, iteration, previews |
| `standard` (default) | **$0.15** | ~30k tris | none | Most shippable assets |
| `high` | **$0.50** | ~200k tris | PBR + HD | Hero assets, product and NFT renders |

The price is per generation and does not vary with which engine lane serves it
(see [Engine lanes](#engine-lanes)).

### Discover the price before paying (free)

<!-- runnable: 200 the free pricing catalog, no payment involved -->
```bash
curl -s https://three.ws/api/x402/forge
```

```jsonc
{
  "route": "/api/x402/forge",
  "description": "three.ws Forge: pay-per-call text→3D and image→3D ...",
  "method": "POST",
  "input_schema": { "$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object", "properties": { /* … */ } },
  "poll": "GET /api/forge?job=<id>",
  "pricing_usdc": [
    { "tier": "draft", "price_usdc": "0.05" },
    { "tier": "standard", "price_usdc": "0.15" },
    { "tier": "high", "price_usdc": "0.50" }
  ]
}
```

The same schemas are mirrored into `/.well-known/x402` and into the 402
challenge's `bazaar` block, so a facilitator listing (CDP Bazaar, x402scan,
agentic.market) and the live endpoint can never disagree.

## Request

`POST /api/x402/forge` with a JSON body. Provide **exactly one** of `prompt`
(text→3D) or `image_urls` (image→3D).

| Field | Type | Default | Notes |
|---|---|---|---|
| `prompt` | string | none | Text→3D. 3 to 1000 characters, describing one subject. |
| `image_urls` | string[] | none | Image→3D. 1 to 6 public `https` reference views of **one** object. |
| `image_url` | string | none | Convenience alias for a single reference view. |
| `tier` | `draft` / `standard` / `high` | `standard` | Quality and price. An unknown value falls back to `standard`. |
| `aspect_ratio` | `1:1` / `4:3` / `3:4` / `16:9` / `9:16` | `1:1` | Aspect ratio of the synthesized reference view. Text→3D only. |

```jsonc
{
  "prompt": "a brass steampunk owl, full body",
  "tier": "standard",
  "aspect_ratio": "1:1"
}
```

```jsonc
{
  "image_urls": [
    "https://example.com/owl-front.png",
    "https://example.com/owl-side.png"
  ],
  "tier": "high"
}
```

Input rules worth knowing before you pay:

- **Views past the sixth are dropped**, not rejected. Send your best six.
- **Non-`https` entries are dropped.** If you supplied `image_urls` and none
  survive that filter, the call fails with `400 invalid_image_urls` rather than
  silently degrading to a text prompt.
- **Caller-supplied urls are SSRF-guarded** before any reconstructor fetches
  them, on every lane. Private, link-local, and loopback targets are refused.
- **A body with neither field is a probe.** Unpaid, it still returns the 402
  challenge so an agent can discover the price with no input. Paid, it is
  rejected with `400 missing_input` before any settlement runs.

## The 402 challenge

An unpaid request is answered with `402 Payment Required` and an `accepts[]`
array quoting the price for the tier you requested.

<!-- runnable: 402 the challenge is the lesson: an unpaid call must quote a price -->
```bash
curl -s -X POST https://three.ws/api/x402/forge \
  -H 'content-type: application/json' \
  -d '{"prompt":"a brass steampunk owl, full body","tier":"standard"}'
```

```jsonc
{
  "x402Version": 2,
  "error": "X-PAYMENT header is required",
  "resource": {
    "url": "https://three.ws/api/x402/forge",
    "serviceName": "three.ws Forge: text/image to 3D",
    "tags": ["3d", "ai", "text-to-3d", "image-to-3d", "utility"]
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",  // Solana mainnet
      "amount": "150000",                                     // 0.15 USDC, 6 decimals
      "payTo": "<the platform's live receiving address>",
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC mint
      "maxTimeoutSeconds": 60,
      "resource": "https://three.ws/api/x402/forge",
      "extra": { "name": "USDC", "decimals": 6, "feePayer": "<sponsor>" }
    }
  ]
}
```

**Solana mainnet USDC only.** Every quote on the live route is a Solana 402, and
the fee payer is sponsored, so a buyer needs USDC but not SOL. A self-hosted or
preview deploy that has not configured `X402_PAY_TO_SOLANA` falls back to
quoting Base USDC (EIP-3009 plus a Permit2 variant) so the route never
dead-ends with an empty challenge; production sets it, so that branch never runs
on three.ws.

Pay the challenge with any x402 client (`@x402/fetch`, CDP, PayAI) and retry the
identical request with the proof in the `X-PAYMENT` header.

## Response

A paid call returns `200` in one of two shapes. `status` is the only guaranteed
field: branch on it.

**Queued** (the usual case) hands back a job token you poll for free:

```json
{
  "job_id": "f1.eyJwIjoibnZpZGlhIn0.sig",
  "status": "queued",
  "poll_url": "/api/forge?job=f1.eyJwIjoibnZpZGlhIn0.sig",
  "mode": "text_to_3d",
  "tier": "standard",
  "backend": "nvidia",
  "eta_seconds": 22,
  "price_usdc": "0.15"
}
```

**Done inline** happens when the lane finishes inside the submit window (common
on `draft`). There is nothing to poll, and `job_id` / `poll_url` are `null`:

```json
{
  "job_id": null,
  "status": "done",
  "poll_url": null,
  "glb_url": "https://three.ws/cdn/forge/nvidia/9f2c….glb",
  "mode": "text_to_3d",
  "tier": "draft",
  "backend": "nvidia",
  "eta_seconds": 13,
  "price_usdc": "0.05"
}
```

| Field | Type | Meaning |
|---|---|---|
| `status` | string | `queued` (poll it) or `done` (`glb_url` is ready). |
| `job_id` | string \| null | Poll token. `null` on inline completion. |
| `poll_url` | string \| null | Free status path. `null` on inline completion. |
| `glb_url` | string | The finished GLB. Present only when `status` is `done`. |
| `mode` | string | `text_to_3d` or `image_to_3d`. |
| `tier` | string | The resolved tier (after the default is applied). |
| `backend` | string | Which engine lane served the job. |
| `eta_seconds` | integer | Estimated time to completion for that lane and tier. |
| `price_usdc` | string | What you were charged, e.g. `"0.15"`. |

The settlement receipt rides back in the `x-payment-response` header.

Any client that only handles the queued shape will build a poll url out of
`null` and hang. Handle both, as the [example](#example-x402fetch) does.

## Engine lanes

One price, several engines. The endpoint is free-first internally: it spends
platform vendor credit only when no zero-cost lane can serve the job, and it
degrades rather than failing a paid call. `backend` in the response names the
lane that ran.

**Text→3D**, in order:

1. **NVIDIA NIM native text→mesh** (`nvidia`). Zero vendor cost, no intermediate
   image. Completes inline often enough that `draft` frequently skips polling.
2. **HuggingFace Spaces reconstruct** (`huggingface`). Free. Synthesizes a
   reference view, reconstructs it, and the result is copied into three.ws
   storage so the url outlives the Space's ephemeral files. Preference is
   controlled by `FORGE_PREFER_FREE`.
3. **FLUX→TRELLIS on Replicate** (`trellis`). The paid platform backstop.

**Image→3D** skips step 1 (NVIDIA's hosted preview is text-only) and runs the
reconstruct lanes on your supplied views.

Only the platform-keyed pipeline is sold here. The BYOK geometry backends
(Meshy, Tripo) bill through the caller's own provider key on the free
`/api/forge` and are not monetized via x402.

## Poll for free

Polling costs nothing and needs no payment header.

<!-- runnable: no the job id is illustrative; use the one the paid call returned -->
```bash
curl -s 'https://three.ws/api/forge?job=f1.eyJwIjoibnZpZGlhIn0.sig'
```

```json
{
  "job_id": "f1.eyJwIjoibnZpZGlhIn0.sig",
  "status": "done",
  "glb_url": "https://three.ws/cdn/forge/…/model.glb",
  "durable": true,
  "backend": "nvidia",
  "tier": "standard",
  "path": "x402"
}
```

| `status` | What to do |
|---|---|
| `queued` | Keep polling. The job is accepted and waiting on the engine. |
| `running` | Keep polling. A transient poll error also reports `running` rather than failing the job. |
| `done` | `glb_url` is ready. |
| `failed` | Stop. `error` carries a sanitized, buyer-safe reason. |

`durable: true` means the GLB was copied into three.ws storage and the url is
stable. `durable: false` means you are looking at the provider's own delivery
url, which expires: download it promptly.

A 2 second poll interval is polite and well inside every lane's ETA. Poll
`/api/forge?job=`, never `/api/x402/forge?job=`; the paid route answers that
mistake with `400 wrong_endpoint` and a pointer rather than a 404.

## Payment safety: verify, submit, settle

The handler runs in that order deliberately. The generation job is submitted
**after** your payment verifies but **before** it settles, so a submit that
fails (engine down, out of capacity, bad input) never takes your money. Every
error the endpoint returns from that window says so in plain language, and the
raw upstream text (which can carry the platform's own vendor billing state) is
logged, never relayed.

## Idempotency and replay protection

A retried payment returns the **same** job token instead of submitting a second
generation, so a network retry can never double-charge.

- The dedup key is the client's payment identifier when the client opts into the
  `payment-identifier` extension advertised in the challenge `extensions`. When
  it does not, the endpoint falls back to a hash of the payment proof itself,
  which only the original payer can reproduce. **Replay protection is therefore
  unconditional**, not opt-in.
- A replayed request that matches gets the original response body with
  `x-x402-idempotent: replay`.
- A second request carrying the same payment while the first is still running
  gets `409 payment_in_flight`, `x-x402-idempotent: in-flight`, and
  `retry-after: 1`. Retry to receive the cached response instead of paying again.
- Reusing one payment identifier for a **different** body gets
  `409 payment_identifier_conflict` with `attemptedPayloadHash` and
  `existingPayloadHash`. Retry the original payload or generate a fresh id.

## Errors

| Status | `error` | Meaning |
|---|---|---|
| `400` | `invalid_json` | Body was not valid JSON. |
| `400` | `invalid_prompt` | Prompt outside 3 to 1000 characters. |
| `400` | `invalid_image_urls` | You sent `image_urls` but none were public `https` urls. |
| `400` | `missing_input` | Paid call with neither `prompt` nor `image_urls`. |
| `400` | `body_read_failed` | Body unreadable or over the 1 MB cap. |
| `400` | `wrong_endpoint` | `GET /api/x402/forge?job=…`. Poll on `/api/forge?job=…`. |
| `402` | (challenge) | No `X-PAYMENT` header, or the proof failed verification. Re-read `accepts[]` and pay. |
| `405` | `method_not_allowed` | Use `POST` to generate, `GET` for pricing. |
| `409` | `payment_in_flight` | Same payment already being processed. Retry shortly. |
| `409` | `payment_identifier_conflict` | Payment identifier reused for a different body or a different proof. |
| `429` | `rate_limited` | Either the unpaid path's per-IP limit, or the engine is briefly busy. In the busy case **your payment was not taken**; honour `retry_after`. |
| `502` | `verify_failed` / `settle_failed` | Facilitator problem. On `verify_failed` nothing was charged. |
| `502` | `generation_failed` | Engine fault after verify, before settle. Not charged. |
| `503` | `generation_unavailable` | Every lane is down or out of capacity. Not charged; `retry_after: 30`. |
| `503` | `unconfigured` | Generation is not configured on this deployment. |

The unpaid path is IP rate limited so the challenge and validation cannot be
hammered; those responses carry `X-RateLimit-*` and `retry-after` headers.
Generation itself is paywalled, not rate limited.

Platform callers holding the `x402:bypass` scope (subscription or OAuth) skip
payment entirely and get the same response body plus an `x-payment-bypass`
header. Anonymous agents always pay.

## Provenance: paid generations join the public gallery

Every settled generation becomes a real row in the community gallery, stamped
with the paying wallet, the settle signature, and the price, and rendered with a
Solscan-linked "x402" provenance badge. Inline-done lanes publish immediately;
async lanes are completed server-side by `api/cron/forge-finalize`, so the
artifact lands even if you never poll. Recording happens after your response is
sent and never affects your result. See
[x402 endpoints](../x402-endpoints.md) and
[the autonomous economy](../autonomous-x402.md).

Treat prompts as public. If you need a private lane, use the account-scoped
surfaces instead of this one.

## Example (`@x402/fetch`)

Handles both response shapes, the free poll, and terminal failure.

```js
import { wrapFetchWithPayment } from '@x402/fetch';

const BASE = 'https://three.ws';
const fetchWithPay = wrapFetchWithPayment(fetch, wallet);

const res = await fetchWithPay(`${BASE}/api/x402/forge`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ prompt: 'a brass steampunk owl, full body', tier: 'standard' }),
});
if (!res.ok) throw new Error(`forge ${res.status}: ${(await res.json()).error}`);

const submitted = await res.json();

// The lane may have finished inside the submit window: there is nothing to poll.
let glbUrl = submitted.glb_url ?? null;

if (!glbUrl) {
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const job = await (await fetch(`${BASE}${submitted.poll_url}`)).json();
    if (job.status === 'done') { glbUrl = job.glb_url; break; }
    if (job.status === 'failed') throw new Error(job.error);
  }
  if (!glbUrl) throw new Error('generation timed out');
}

const glb = Buffer.from(await (await fetch(glbUrl)).arrayBuffer());
```

## Related

- [3D API](../3d-api.md): the free draft lane, inspection, validation, and the
  full Forge Pro walkthrough.
- [Forge pipeline](../forge-pipeline.md): how the lanes, tiers, and failovers fit
  together internally.
- [3D Studio MCP server](../mcp-3d-studio.md): the same generation as
  `text_to_3d` / `image_to_3d` tools for in-conversation use, priced from the
  same tier table. This REST endpoint is the pay-per-call surface for autonomous
  agents.
- [x402 endpoints](../x402-endpoints.md): every paid endpoint on the platform.
~~~~

