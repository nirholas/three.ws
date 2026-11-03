# Make the public A2A Agent Card spec-compliant and generate a separate enterprise Marketplace card

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/729-plan-a2a-agent-card-compliance-marketplace.md`.

**Priority:** P2, new capability with clear value (score 52 of 100 inside the tier). **Area:** a2a. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The live Agent Card at `https://three.ws/.well-known/agent-card.json` follows the old draft shape. It has no `protocolVersion` or `preferredTransport`, points its `url` at the website instead of the A2A JSON-RPC endpoint, declares auth with the old `authentication.schemes` shape instead of A2A `securitySchemes`/`security`, marks a per-call on-chain payment extension as `required: true`, and carries version 1.5.1 while the platform is 1.5.2. Any strict A2A client, and Google's Marketplace validator, can reject or mis-route it. Fixing it is pure engineering, needs no permission, and improves discovery for every agent client, not only Google. A separate, enterprise-worded card for the Google Cloud Marketplace A2A listing is also needed: the public card is read by other clients and must not be edited into a Marketplace shape, and Marketplace customers are billed by Google, so the payment extension must be optional there. The card generator and validators exist; the fixes are small, testable and agent-doable. Clearing the Vertex AI billing hold and submitting the listing are owner actions.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `public/.well-known/agent-card.json` (still the old shape on 2026-11-03): top-level keys are name, description, url, provider, version, capabilities, authentication, defaultInputModes, defaultOutputModes, skills. `"url": "https://three.ws/"`, `"version": "1.5.1"`, `"authentication": { "schemes": ["bearer"], "credentials": null }`, `capabilities.extensions[0].required: true` for the `https://github.com/google-a2a/a2a-x402/v0.1` extension, and a description that leads with crypto market data. `package.json` version is 1.5.2. No `protocolVersion`, `preferredTransport` or `securitySchemes`; `grep -rn securitySchemes public/.well-known api` finds it only in the OpenAPI documents.
- The card is generated and patched by `scripts/build-discovery-cards.mjs` (`npm run build:discovery`, wired into `prebuild`; it reads the card, sets the description, upserts the generated `x402-service-catalog` skill and writes it back), with text in `scripts/lib/discovery-copy.mjs`. Edits to the JSON alone will be overwritten. `scripts/validate-agent-cards.mjs` (`npm run validate:cards`) validates against `public/.well-known/3d-agent-card.schema.json`, which is a different (3D agent) card, not the A2A card.
- The A2A JSON-RPC endpoint is `api/agents/a2a-paid.js` (routed in `vercel.json`, already referenced from one skill entry as `https://three.ws/api/agents/a2a-paid`; a bare `message/send` returned `-32602 Invalid params: message is required` on 2026-09-17); there is no `/api/a2a` route. Related: `a2a-call.js`, `a2a-hire.js`, `a2a-mandate.js`, `a2a-cart-verify.js`.
- `api/wk.js` serves the well-known documents; `vercel.json` line 724 serves per-agent cards at `/a/sol/<id>/.well-known/agent-card.json`.
- Existing tests nearby: `tests/a2a-paid-endpoint.test.js`, `tests/agent-cards-service.test.js`, `tests/agent-cards-provider.test.js`. None validates the card against the A2A schema.
- Vertex billing hold: on 2026-09-17 Cloud Run logs showed `Lightning dunning decision is deny` for the Vertex path, and the Google packet lists `VERTEX_CLAUDE_PRIMARY=0` as a listing blocker. Re-check; this is the owner's blocker for the Marketplace listing (Google requires a Gemini or Model Garden default model). It is a billing and model-default decision outside this order: note it in the report, do not change it here.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
curl -s https://three.ws/.well-known/agent-card.json | node -e "const c=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log({url:c.url,version:c.version,protocolVersion:c.protocolVersion,preferredTransport:c.preferredTransport,auth:c.authentication,securitySchemes:!!c.securitySchemes,ext:c.capabilities?.extensions})"
python3 -c "import json;d=json.load(open('public/.well-known/agent-card.json'));print(sorted(d))"
curl -s https://three.ws/api/version
curl -s -X POST https://three.ws/api/agents/a2a-paid -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"message/send","params":{}}'
grep -n "a2a-paid" vercel.json
sed -n 1,80p api/agents/a2a-paid.js
grep -n "agent-card\|well-known" scripts/build-discovery-cards.mjs | head -20
grep -rn "agent-card.json" scripts tests api src --include=*.js --include=*.mjs -l
ls tests | grep -i "agent-card\|a2a\|discovery"
gcloud logging read 'resource.type=cloud_run_revision AND textPayload:"dunning"' --project aerial-vehicle-466722-p5 --limit 3 --freshness 7d 2>&1 | head
```

Fetch the current A2A specification (`https://a2a-protocol.org/dev/specification/`) and the Marketplace Agent Card doc (`https://docs.cloud.google.com/marketplace/docs/partners/ai-agents/agent-card`) with a plain GET. Build against what they say today, not against the packet's table.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Test first: add `tests/a2a-agent-card.test.js` that loads `public/.well-known/agent-card.json` and asserts the A2A shape: `protocolVersion` and `preferredTransport` present, `url` is an absolute `https` URL ending in the A2A endpoint path (`/api/agents/a2a-paid`), `version` equals `package.json` version, `securitySchemes` with a matching `security` are present and `authentication` is absent, no extension has `required: true` unless the endpoint genuinely cannot work without it, `capabilities` present, every skill has `id`, `name`, `description`, `tags`, and `defaultInputModes`/`defaultOutputModes` are valid MIME types. Encode the rules from the fetched spec as a local JSON Schema checked with an existing validator in `package.json` (Ajv if present, otherwise the smallest well-maintained validator). Run it and confirm it fails for exactly those reasons.
2. Fix at the source: update `scripts/build-discovery-cards.mjs` (and `scripts/lib/discovery-copy.mjs` where text lives) to emit the compliant public card: `protocolVersion` set to the exact string the spec page shows today, `preferredTransport: 'JSONRPC'`, `url` set to `https://three.ws/api/agents/a2a-paid`, the website kept reachable as `documentationUrl`, `version` read from `package.json`, A2A `securitySchemes`/`security` describing only the auth the endpoint actually enforces (read `api/agents/a2a-paid.js` and its tests: x402 payment on retry as an optional capability, plus any bearer scheme the handler verifies), extension `required: false`. Keep the legacy `authentication` key only if a current consumer reads it (grep first and record the result), otherwise remove it. Keep hand-written skills and the generated `x402-service-catalog` skill. Regenerate with `npm run build:discovery` and re-run the test.
3. Confirm the `url` actually serves JSON-RPC: in a local server run, `POST` `message/send` and `tasks/get` against `/api/agents/a2a-paid` with a valid message and assert a well-formed JSON-RPC result (the 402 payment-required task state without a payment, per the a2a-x402 flow), not just a parameter error. Add that as a test in `tests/a2a-paid-endpoint.test.js` (or a sibling). Fix the handler test-first if it does not return a spec-shaped error for an unknown method, or if a documented skill id in the card does not route (every `skills[].id` must be reachable or removed from the card).
4. Generate the Marketplace card as a separate artifact: add `scripts/build-marketplace-agent-card.mjs` (and `npm run build:marketplace-card`) that writes `dist/marketplace/agent-card.json` (not under `public/`, because the listing takes a JSON object uploaded to Cloud Storage and the public card must stay untouched). It carries enterprise wording describing only the 3D skills (text or image to rigged 3D character, glTF validation and inspection), no crypto market claims, the same A2A endpoint, `protocolVersion`, `preferredTransport`, `securitySchemes`, the x402 extension marked `required: false` (or removed if the Marketplace validator rejects unknown extensions), a billing note that Marketplace customers are invoiced by Google, only skills the listing will actually offer, a model field naming the Google model used by default (written from a config constant, to be confirmed once the owner clears billing), and the skills, competence, models and security fields Google's Agent Card doc recommends. Add test cases to `tests/a2a-agent-card.test.js`: it validates against the same A2A schema and differs from the public card only in wording, the extension flag, the skill set and the model/billing fields.
5. Add the upload runbook `docs/ops/google-marketplace-agent-card.md`: where the file goes (a JSON object in Cloud Storage in the listing project `aerial-vehicle-466722-p5`), the `gcloud storage cp` command prepared but not run, attaching it with "Save and validate" in Producer Portal (the Agent ScoreCard run is an owner step), the Step 0 billing check and the refreshed production-evidence queries from the source. Mark it owner-run.
6. Idempotence and regression guard: run `npm run build:discovery` twice and confirm `git diff --exit-code` on the card files after the second run. Add `npm run validate:a2a-card` (a sibling of `scripts/validate-agent-cards.mjs`, or a section in it) so a future edit that reverts `url` or `securitySchemes` fails locally. `tests/a2a-agent-card.test.js` is picked up by the existing `npm test` glob.
7. Docs: update the A2A discovery documentation in `docs/` (`grep -rln "a2a" docs | head`, `grep -rn "a2a-x402" docs`) with the corrected card shape, update the Marketplace packet table in `marketing/partner-packets/google-cloud-ai-agents.md` to show the card gaps closed and the one remaining listing blocker (Vertex billing and Model Garden default), add a `data/changelog.json` entry, run `npm run build:pages`, `npm run audit:docs`, and `npm run check:rules -- --paths <files>`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `curl -s localhost:3000/.well-known/agent-card.json | jq '{url,version,protocolVersion,preferredTransport,securitySchemes,security}'` (local server after rebuild) shows the A2A endpoint URL ending in `/api/agents/a2a-paid`, the package version and non-null security fields, and no `authentication` key.
- [ ] `node --test tests/a2a-agent-card.test.js tests/a2a-paid-endpoint.test.js` passes (the card test shown failing first on the old card).
- [ ] A real `message/send` against the local `/api/agents/a2a-paid` returns a well-formed JSON-RPC result for at least two card skills.
- [ ] `npm run build:marketplace-card` writes `dist/marketplace/agent-card.json` that validates against the same schema, has no crypto-market wording and no required payment extension.
- [ ] Running `npm run build:discovery` twice leaves `git diff` empty for the card files.
- [ ] `docs/ops/google-marketplace-agent-card.md` exists with the exact commands, marked as owner-run.
- [ ] No existing consumer of the old `authentication` key is broken (grep result recorded in the report).
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Vertex AI billing hold still denies | Build and test everything; the card's default-model field is written from a config constant and the runbook states the hold as the one remaining owner step. Prefer fixing the Gemini lane on GCP credits per the standing approval if the hold is a billing-account link issue you can read with `gcloud billing projects describe` |
| `gcloud` times out from this workspace | Retry with `--project aerial-vehicle-466722-p5` and a shorter `--limit`; the code work does not depend on it |
| Unsure whether the x402 extension should be required | Mark it optional. Paying per call is an option on this endpoint, never a precondition for reading the card |
| The A2A spec version moved since the packet was written | Build to the version the spec page shows today and set `protocolVersion` to that exact string |
| Cannot reach Producer Portal to run the Agent ScoreCard | Owner step. Validate against the published schema locally and list the portal upload as the one remaining owner action |
| Unsure what auth the endpoint really enforces | Read `api/agents/a2a-paid.js` and its tests. Declare only enforced schemes |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

The Marketplace listing needs the owner to clear the Vertex billing hold, enroll in the Partner Network, accept the vendor agreement and submit in Producer Portal. Those are owner actions and external submissions; this order only prepares the card and runbook. The card text references Google Cloud and Gemini, which are not crypto projects, but the public card also names USDC and other chains today; if the regenerated diff names any crypto project other than $THREE, ask the owner once for commit approval, batched at the end.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/729-plan-a2a-agent-card-compliance-marketplace.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `729-plan-a2a-agent-card-compliance-marketplace.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `marketing/growth/applications/google-cloud-ai-agents.md` (whole file)

~~~~markdown
# Google Cloud: Partner Network, AI Agent Ecosystem Program, Marketplace

**Status:** enrollment answers ready to paste. Marketplace A2A listing **not ready** (two blockers below).
**Verified:** 2026-09-17 (live curl, Cloud Run logs, Google docs). Background, architecture, and the
full business case live in the partner packet
[google-cloud-ai-agents.md](../../partner-packets/google-cloud-ai-agents.md) (verified 2026-09-16);
this file is the field-by-field paste sheet and only restates what changed or what a form needs.
**Deadline:** none published. Pipeline target 2026-09-25.

Nothing here has been submitted. Every submission is an owner action.

---

## Owner-only inputs

| Field | Why only the owner can fill it |
|---|---|
| Legal entity name and state or country of incorporation | Not recorded in the repo. Google requires incorporation "in a supported region" |
| Google account that becomes Partner Administrator | Accepts the Marketplace Vendor Agreement on the company's behalf |
| Payments profile and bank details (Marketplace vendor account) | Financial identity |
| Signatory for the Marketplace Vendor Agreement | Legal acceptance |
| Headcount, revenue, funding stage (if the enrollment or program form asks) | Not recorded in the repo; never estimate |

---

## Blockers re-checked on 2026-09-17

**1. Vertex AI is still billing-denied.** `gcloud logging read` on `three-ws-api` returned
`vertex imagen failed, falling back: Lightning dunning decision is deny for project:
projects/93741856042` at 2026-09-17T03:14:37Z, and two turnaround-view failures with the same
reason seconds later. Google's listing requirements say A2A agents must "Use Google foundation or
3rd party models hosted in Model Garden as a default configuration"
([requirements](https://docs.cloud.google.com/marketplace/docs/partners/ai-agents)). The AI Agent
Ecosystem Program also expects a Gemini or Model Garden model. Clear the billing hold first.

**2. The live Agent Card is not a Marketplace-ready card.** `curl -s
https://three.ws/.well-known/agent-card.json` on 2026-09-17:

| Check | Live value | What the Marketplace copy needs |
|---|---|---|
| `url` | `https://three.ws/` (the website) | The A2A JSON-RPC endpoint. `POST https://three.ws/api/agents/a2a-paid` answers JSON-RPC (a bare `message/send` returned `-32602 Invalid params: message is required`), while `POST /api/a2a` returns 404 |
| `version` | `1.5.1` | Match the platform (`/api/version` reports `1.5.2`, commit `477eb6f8c`, revision `three-ws-api-00438-cg2`) |
| Auth declaration | Older `authentication: { schemes: ["bearer"] }` | A2A `securitySchemes` plus `security` |
| `capabilities.extensions` | One per-call on-chain payment extension with `"required": true` | Remove it or mark it optional: a Marketplace customer is billed by Google, not per call on-chain |
| `description` | Advertises crypto market data and names stablecoin chains | An enterprise description of the 3D skills only |
| Storage | Served from the website | A JSON file in Cloud Storage, in the same project as the listing, attached with **Save and validate** in Producer Portal ([Agent Card doc](https://docs.cloud.google.com/marketplace/docs/partners/ai-agents/agent-card)) |

Google's Agent Card doc recommends the card cover "skills, competence, models, and security". Build a
separate Marketplace card rather than editing the public one, which other clients already read.

---

## Form 1: Google Cloud Partner Network enrollment

**URL:** https://partners.cloud.google.com/enrollment (Google sign-in required, so the exact field
labels could not be read logged out). Google's
[Marketplace requirements](https://docs.cloud.google.com/marketplace/docs/partners/get-started)
state what enrollment must establish: membership "in good standing", incorporation in a supported
region, and a Partner Administrator. The answers below cover every item those docs name, plus the
standard company-profile items.

| Item | Answer |
|---|---|
| Company name | three.ws (legal entity: **OWNER INPUT**) |
| Website | https://three.ws |
| Business contact email | partners@three.ws (the partnership inbox named on `/partners`, per [docs/partners.md](../../../docs/partners.md)) |
| Partner type, if asked | The software or ISV option. three.ws builds a product; it does not resell or deliver services |
| Product description, if asked | three.ws turns a text prompt or photo into a textured, rigged, animation-ready 3D character and embeds it on any page with one web component. Production runs on Google Cloud Run, Cloud Scheduler, and a Cloud Run GPU fleet. |
| Existing Google relationship, if asked | Member of Google Cloud for Web3 Startups (exact wording from [docs/partners.md](../../../docs/partners.md)). Do not write "Google Cloud Partner" anywhere until enrollment is accepted |
| Google Cloud project for the listing | `aerial-vehicle-466722-p5` (production, region `us-central1`) |
| Partner Administrator | **OWNER INPUT** |

**After enrollment:** in Partner Network Hub, **View tasks → Partner tasks → Initiate onboarding
your product to Marketplace**; accept the
[Marketplace Vendor Agreement](https://cloud.google.com/terms/marketplace-vendor-agreement)
(Partner Administrator); complete the **Project Info form** the Marketplace team sends, which grants
Producer Portal access ([vendor steps](https://docs.cloud.google.com/marketplace/docs/partners/offer-products)).

---

## Form 2: Marketplace onboarding "supporting documentation"

Google's vendor doc says this step may require "architecture diagrams or business inputs" and does not
publish field names. Paste from these sources:

| Input | Source |
|---|---|
| Architecture | Packet section "Architecture (for the diagram)": `three-ws-api` Cloud Run service, the Cloud Run GPU services, `three-ws-multiplayer`, Cloud Scheduler, Cloud Build, Vertex AI. Re-read the fleet with `gcloud run services list --region us-central1 --project aerial-vehicle-466722-p5` on the day of submission; the command timed out from this workspace on 2026-09-17, so the packet's 2026-09-16 read is the latest |
| Cloud Scheduler job count | **120** jobs in us-central1 (`gcloud scheduler jobs list`, 2026-09-17), synced from **118** cron definitions in `vercel.json` |
| Product and customer problem | Packet section "Marketplace business case" |
| Hosting pattern | The "AI agents" pattern for the A2A listing type; Google lists it among its approved hosting patterns |
| Production readiness | Google requires "production-ready (not alpha or beta)". Evidence table below |
| Pricing model | **Free** first listing (Google supports Free, Subscription, Usage-based, Combined). Rationale in the packet |

**Production evidence, refreshed 2026-09-17**

| Metric | Value | Source | Captured |
|---|---|---|---|
| Generations recorded / completed (`status = 'done'`) | 40,506 / 34,738 since 2026-06-11 | Production `forge_creations` (read-only query) | 2026-09-17 |
| Generations in the last 30 days | 23,444 (average 756 per day, peak day 1,960) | Same | 2026-09-17 |
| Auto-rig jobs in the last 30 days | 3,929 | Same, `prompt = 'auto-rig'` | 2026-09-17 |
| Avatars / agents / embedded widgets | 75,959 / 3,831 / 632 | `https://three.ws/api/platform/stats` | 2026-09-17T02:58Z |
| Agent Card skills | 10 | `https://three.ws/.well-known/agent-card.json` | 2026-09-17 |
| 90-day uptime | 99.85% overall | `https://three.ws/status` (packet) | 2026-09-16 |

Re-run the counts on the day of submission:

```bash
node --env-file=.env.local --input-type=module -e "
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
console.log(await sql\`select count(*)::int total,
  count(*) filter (where status = 'done')::int done,
  count(*) filter (where created_at > now() - interval '30 days')::int last30
  from forge_creations\`);"
curl -s https://three.ws/api/platform/stats
```

---

## Form 3: Google Cloud AI Agent Ecosystem Program

**Routes** (from Google's program announcement,
[Build, deploy, and promote AI agents](https://cloud.google.com/blog/topics/partners/build-deploy-and-promote-ai-agents-through-the-google-cloud-ai-agent-ecosystem-program),
published 2024-11-20): the application form at
`https://docs.google.com/forms/d/10U-lTYO4J1fgSTjfKWl-EiqjFDnLLqaYvxtLVHSpUf0/viewform`, the partner
representative, or the Marketplace sell page. The form returned **HTTP 401** to an unauthenticated
request on 2026-09-17, and the Partner Network resource page
(`https://partners.cloud.google.com/resources/google-cloud-ai-agent-program`) redirects to Google
sign-in. Field labels are therefore unverified; the answers below cover the program's published
qualification points.

| Published criterion | three.ws answer | Verdict |
|---|---|---|
| Agent addresses a specific goal | Turns a text prompt or image into a textured, rigged 3D character or asset, and validates, inspects, and renders glTF/GLB models for other agents | Meets |
| Uses a Gemini model or a third-party model from Model Garden | Gemini and Imagen lanes exist in code but are billing-denied today (see blocker 1) | **Fails until the billing hold is cleared** |
| Deployed on Google Cloud | Cloud Run service `three-ws-api` in `us-central1`, plus Cloud Run GPU model services | Meets |
| Uses or plans to migrate to Vertex AI services beyond the LLM | Imagen on Vertex for reference images; production 3D reconstruction and rigging already run on Cloud Run GPUs | Meets once Vertex billing is restored |
| Program audience: ISV and services partners | ISV | Meets after Partner Network enrollment |

**Paste-ready answers**

**Company and agent, one sentence:**

> three.ws is a 3D agent platform on Google Cloud whose A2A agent turns text or images into
> textured, rigged, embeddable 3D characters, and validates and inspects glTF models for other agents.

**What does the agent do and for whom?**

> Enterprise product, marketing, and commerce teams want 3D assets and embodied agents but have no 3D
> pipeline. Our agent takes a text prompt or reference image and returns a textured GLB, rigs humanoid
> characters for animation, and returns an embeddable viewer. It also validates glTF/GLB files with
> the Khronos validator and reports mesh, material, and texture statistics with optimization advice,
> so other agents in a multi-agent workflow can check 3D output before using it.

**How is it built on Google Cloud?**

> Production is one Cloud Run service that serves the site, API, and agent endpoints, with Cloud
> Scheduler running 120 jobs and a Cloud Run GPU fleet running the 3D reconstruction, rigging, and
> motion models. Over the last 30 days the platform recorded 23,444 generations. Vertex AI provides
> the Gemini and Imagen lanes.

Send the last sentence only after blocker 1 is cleared, because today every Vertex call falls back.

**What do you want from the program?**

> Technical guidance to make a Model Garden model the agent's default, Gemini Enterprise validation
> of the A2A agent, a Marketplace listing, and placement in the AI agent finder.

**Relationship wording:** member of Google Cloud for Web3 Startups. Not a Google Cloud Partner until
enrollment is accepted. No Marketplace listing exists.

---

## Form 4: Producer Portal (after Project Info form)

Google's seven onboarding steps, each with the answer or the engineering prerequisite:

| Step | Input | Ready? |
|---|---|---|
| 1. Create the AI agent and Agent Card | Marketplace copy of the card, fixes in the table above | **No: engineering** |
| 2. Add the agent in Producer Portal | Listing type "AI Agents as a Service (A2A protocol)" | After step 1 |
| 3. Add the Agent Card | Upload to Cloud Storage in `aerial-vehicle-466722-p5`, **Browse**, **Save and validate** | After step 1 |
| 4. Product details | Name: three.ws 3D Agent. Short description: "Text or image to a textured, rigged, embeddable 3D model, plus glTF validation and inspection for agents." Link: https://three.ws/forge. Screenshot: [forge.png](../../partner-packets/images/forge.png) | Yes |
| 5. Pricing (about 4 business days of review) | Free | Yes |
| 6. Marketplace integration: account creation, Google account linking, sign-in | Not built. `git grep` over `api/`, `server/`, and `src/` on 2026-09-17 found no Cloud Commerce Procurement integration, and `api/auth/` has no Google sign-in provider | **No: engineering** |
| 7. Publish after review | n/a | After 1 to 6 |

## After submitting

Record the Partner Network ID and any program receipt in
[opportunities.csv](../opportunities.csv) row "Google Cloud AI Agents program and finder".
~~~~

### `marketing/partner-packets/google-cloud-ai-agents.md` (section "Read this first: two findings that change the ask")

~~~~markdown
## Read this first: two findings that change the ask

**1. Vertex AI is denied on the production project today.** Cloud Run logs for `three-ws-api` on
2026-09-16 at 16:14Z and 16:15Z read `vertex imagen failed, falling back: Lightning dunning decision is
deny for project: projects/93741856042` (that is `aerial-vehicle-466722-p5`), and the Vertex reference
image lane returned 403. Google's AI agent listing requirements say an A2A agent must "use Google
foundation or 3rd party models hosted in Model Garden as a default"
([requirements](https://docs.cloud.google.com/marketplace/docs/partners/ai-agents)). Production does not
meet that today: Vertex is billing-denied and `VERTEX_CLAUDE_PRIMARY` is `0` on the service, so the
default brain is the free third-party chain. **Clear the billing hold and make a Model Garden model the
default before submitting the A2A agent type.** Partner Network enrollment itself does not depend on
it, which is why enrollment is still the first step.

**2. The public Agent Card is not yet a valid Marketplace Agent Card.** Read from
`https://three.ws/.well-known/agent-card.json` on 2026-09-16:

| Requirement | Current card | Gap |
|---|---|---|
| A2A Agent Card specification ([a2a-protocol.org](https://a2a-protocol.org/dev/specification/)) | Has `name`, `description`, `url`, `provider`, `version` 1.5.1, `capabilities`, `defaultInputModes`, `defaultOutputModes`, 10 `skills` | Missing `protocolVersion`, `preferredTransport`, and `securitySchemes`/`security` (uses the older `authentication` key) |
| The card's `url` is the agent's A2A endpoint | `https://three.ws/` (the website) | The A2A JSON-RPC handler lives at `/api/agents/a2a-paid`; `POST /api/a2a` returns 404 |
| Stored as a JSON file in Cloud Storage and attached in Producer Portal ([Agent Card doc](https://docs.cloud.google.com/marketplace/docs/partners/ai-agents/agent-card)) | Served from the website only | Upload a Marketplace copy to a Cloud Storage bucket in the project |
| Customers are billed through Google Cloud Marketplace | Declares the x402 payments extension with `"required": true` | A Marketplace customer cannot be required to settle each call on-chain; the Marketplace variant must make that extension optional or omit it |
| Passes the Agent ScoreCard thresholds | Never run | Run validation in Producer Portal after upload |

Fixing the card is engineering work that needs no permission; it is listed here so the owner does not
submit the current file.

---
~~~~

### `marketing/growth/kits/MKT-2026-11-GCP-AGENT.md` (whole file)

~~~~markdown
# MKT-2026-11-GCP-AGENT: a production A2A agent with a browser-native 3D interface

**Kit status:** copy complete and **held behind three blockers.** Nothing announcing a Google Cloud
listing may post until the listing exists; this kit also carries a fallback post that is true today.

## Blockers (verified 2026-09-17)

1. **Vertex AI is billing-denied on the production project.** Cloud Run logs for `three-ws-api` at
   2026-09-17T03:12Z read `vertex imagen failed, falling back: Lightning dunning decision is deny for
   project: projects/93741856042`. Google's AI agent listing requirements ask an A2A agent to use a Model
   Garden model as its default; production cannot today. Clear the billing hold first.
2. **The Agent Card is not yet a valid Marketplace Agent Card.** `https://three.ws/.well-known/agent-card.json`
   (version 1.5.1, 10 skills) has no `protocolVersion`, no `preferredTransport`, no
   `securitySchemes`/`security` (it uses the older `authentication` key), and its `url` is the website
   `https://three.ws/`, not the A2A endpoint. Full gap table:
   [marketing/partner-packets/google-cloud-ai-agents.md](../../partner-packets/google-cloud-ai-agents.md).
3. **No Partner Network enrollment.** three.ws is a member of Google Cloud for Web3 Startups, not a Google
   Cloud Partner, and has no Marketplace listing (campaigns.csv status `awaiting_enrollment`).

## At a glance

| Field | Value |
|---|---|
| Campaign id | `MKT-2026-11-GCP-AGENT` |
| Publish date | 2026-11-10 (slides until the listing is live) |
| Summary | Enterprise agent builders can discover a three.ws A2A agent in Google Cloud Marketplace that turns a prompt into a rigged, embeddable 3D character, running on the same Cloud Run stack as three.ws |
| Audience | enterprise agent builders |
| Primary channel | Google Cloud Marketplace or the AI agent finder |
| Secondary channels | LinkedIn, X, three.ws news |
| Proof | https://three.ws/.well-known/agent-card.json |
| Tracked links | X `https://three.ws/.well-known/agent-card.json?utm_source=x&utm_medium=social&utm_campaign=mkt-2026-11-gcp-agent&utm_content=fallback`; LinkedIn `https://three.ws/forge?utm_source=linkedin&utm_medium=social&utm_campaign=mkt-2026-11-gcp-agent&utm_content=post` |
| The single CTA | Inspect the Agent Card and run the live agent |
| Partner ask | AI Agents validation and finder placement |
| KPI | agent calls, listing visits, and placement |

`{{LISTING_URL}}` is the Google Cloud Marketplace product page, which exists only after Producer Portal
publication.

## Audit: what already exists

| Channel | Existing asset | State | How this kit uses it |
|---|---|---|---|
| Enrollment path, business case, architecture | [marketing/partner-packets/google-cloud-ai-agents.md](../../partner-packets/google-cloud-ai-agents.md) | Ready; records blockers 1 and 2 | Is the partner-facing material |
| Google Cloud Community long-form | [docs/google-cloud-community-post.md](../../../docs/google-cloud-community-post.md) | Draft | Optional companion; not part of this anchor |
| Production facts | [docs/ops/gcp-production.md](../../../docs/ops/gcp-production.md) | Current | Source for Cloud Run claims |
| Media | [partner-packets/images/forge.png](../../partner-packets/images/forge.png) | Exists | Fallback post image |
| X, LinkedIn, news, finder ask | none | Missing | Written below |

## X

**Launch anchor, only after the listing is live** (175 weighted characters measured with a placeholder
Marketplace URL):

```text
three.ws is listed in Google Cloud Marketplace as an A2A agent: a prompt in, a rigged, embeddable 3D character out, served from Cloud Run: {{LISTING_URL}} @googlecloud
```

**Fallback, true today, if the owner wants the campaign slot used before the listing** (177):

```text
Our Agent Card is public JSON: ten declared skills an agent can read before it calls anything, from avatar search to GLB validation. Served by Cloud Run: https://three.ws/.well-known/agent-card.json?utm_source=x&utm_medium=social&utm_campaign=mkt-2026-11-gcp-agent&utm_content=fallback
```

**Media:** a capture of `{{LISTING_URL}}` for the launch anchor; `forge.png` for the fallback.
**Alt text (fallback):** The three.ws Forge page: a prompt box, quality and engine selectors, and a
Generate button.

## LinkedIn (launch day)

```text
Agents built for the enterprise mostly answer in text. Some questions deserve an object.

three.ws is now available in Google Cloud Marketplace as an AI agent that speaks the A2A protocol. Other agents can read its public Agent Card, see its declared skills, and call it to turn a prompt or a photo into a textured, rigged 3D character that can be inspected, placed in a room in AR, or embedded on a page with one tag.

The agent runs on Google Cloud in production: Cloud Run serves the API, a Cloud Run GPU fleet runs 3D generation, rigging, and motion, and Cloud Scheduler runs the background jobs. Procurement goes through the Google Cloud account your organization already uses.

three.ws is a member of Google Cloud for Web3 Startups.

Find it in Marketplace: {{LISTING_URL}}
```

(128 words; tracked alternative link in the table above if the listing does not unfurl.)

## three.ws news blurb

three.ws is available in Google Cloud Marketplace as an A2A agent: other agents can read its Agent Card
and call it to generate rigged, embeddable 3D characters from a prompt or photo. It runs on the same
Cloud Run and GPU stack that serves three.ws. Listing: {{LISTING_URL}}.

## Partner message

Step 1 has no message: enroll at `https://partners.cloud.google.com/enrollment`. After enrollment, and
only after blockers 1 and 2 are closed, send this to the partner manager Google assigns (no contact name
exists in the repo):

```text
Subject: three.ws A2A agent: AI Agents program validation and agent finder placement

three.ws (Partner ID {{PARTNER_ID}}) runs its production stack on Google Cloud: Cloud Run for the API and a Cloud Run GPU fleet for 3D generation, rigging, and motion. Our A2A agent is onboarded in Producer Portal as {{PRODUCER_PORTAL_PRODUCT}}, with the Agent Card uploaded to Cloud Storage and a Model Garden model as the default.

Two asks: route the agent into AI Agents program validation (and Gemini Enterprise validation if it qualifies), and confirm how an approved listing is placed in the AI agent finder at cloud.withgoogle.com/agentfinder.

The forwardable packet, architecture, and business case are attached.
```

Attach the forwardable packet and architecture section from the Google Cloud packet, with its metrics
re-read on the day.

## T+7 result fields

| Field | Source |
|---|---|
| Listing visits | Producer Portal analytics |
| Agent calls | production logs for the A2A handler (`/api/agents/a2a-paid`) in the window |
| Agent Card fetches | production logs for `/.well-known/agent-card.json` |
| Placement | agent finder URL, or "not placed" |

## Claims check

| Claim | Proof | Verified |
|---|---|---|
| Agent Card is public, version 1.5.1, 10 skills | `curl https://three.ws/.well-known/agent-card.json` | 2026-09-17 |
| Card missing `protocolVersion`, `preferredTransport`, `securitySchemes`; `url` is the website | same fetch, key list | 2026-09-17 |
| Vertex AI billing-denied | Cloud Run log line at 2026-09-17T03:12Z | 2026-09-17 |
| Production runs on Cloud Run with a Cloud Run GPU fleet and Cloud Scheduler | [docs/partners.md](../../../docs/partners.md) Google Cloud section; `/api/version` reports service `three-ws-api` | 2026-09-17 |
| Member of Google Cloud for Web3 Startups; not a Google Cloud Partner; no listing | [docs/partners.md](../../../docs/partners.md), packet relationship wording | repo |
| Prompt or photo to textured, rigged 3D character; AR; one-tag embed | live `forge_free` generation returned GLB and AR URLs on 2026-09-17; `<agent-3d>` web component docs | 2026-09-17 |
| Enrollment and agent finder URLs resolve | both returned HTTP 200 | 2026-09-17 |

Dropped: generation totals and uptime percentages (quoted in the packet with 2026-09-16 capture dates;
re-read on sending day rather than frozen into public copy), and "Vertex AI powers the agent" (false while
billing is denied).

## Owner does

Clear the Vertex billing hold and enroll at `partners.cloud.google.com/enrollment`; the Agent Card fixes
are engineering work that needs no approval.
~~~~

