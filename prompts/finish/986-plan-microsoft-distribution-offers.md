# three.ws on every Microsoft surface: transactable SaaS offer, Copilot certification, connectors and store listings

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. The plan it executes is committed at [docs/microsoft-marketplace-offer-plan.md](../../docs/microsoft-marketplace-offer-plan.md); read it in full first. Its path in the repo is `prompts/finish/986-plan-microsoft-distribution-offers.md`.

**Priority:** Gated, every listing ends in an owner Partner Center step. **Area:** distribution, billing. **Written:** 2026-11-04.

## Operating clause (binding)

- Read `CLAUDE.md` at the repo root before anything else. It overrides this file wherever they disagree.
- Finish 100% in this session. Do not end the turn with a question, an option list, a plan, or "let me know". Make reasonable judgment calls, act on them, and note each in one line in the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: signing or sending a transaction, spending or moving funds, paying an x402 endpoint, minting or launching a coin; `git push`, production deploys, publishing or posting externally; committing content that references a crypto project other than $THREE; destroying data that cannot be regenerated. Do every other part around a gate, and batch every such ask into one message at the end.
- Enterprise grade, no shortcuts. No mocks, no fake data, no placeholders, no stub functions, no commented-out code. Real APIs, real endpoints. Errors are handled at the boundaries with a real recovery path.
- Bug fixes are test-first. UI work meets the senior design review bar (hover, focus, active states; designed empty, error and loading states; phone width; verified in a real browser).
- Production stays on Google Cloud. Never claim Azure IP co-sell, MACC eligibility or any Microsoft partner tier.
- Never write the em-dash or en-dash characters anywhere.
- Load `.claude/skills/engineering-standards/SKILL.md` before building and `.claude/skills/changelog-and-docs/SKILL.md` before claiming done.

## Running alongside other sessions

Stage explicit paths only, re-check `git status` and `git diff --staged` before each commit, re-read a file right before editing it, commit finished work promptly, and run dev servers on a free port (`npx vite --port <free port> --strictPort`).

## Step 0: re-derive the current state

1. Read the plan doc and [docs/microsoft.md](../../docs/microsoft.md).
2. Check which items already shipped: `git log --oneline --grep -i microsoft`, `ls api | grep -i -E "marketplace|azure|entra"`, the listings registry ([docs/listings-registry.md](../../docs/listings-registry.md)), and whether `threews.vscode-3d` is on the Visual Studio Marketplace (order 983 covers that publish; do not duplicate it).
3. Record what is done and skip it.

## Tasks (plan item numbers in brackets)

1. **[#1] SaaS offer backend.** Microsoft SaaS Fulfillment API v2 client, landing page that resolves the purchase token and signs the buyer in with Entra ID, connection webhook (ChangePlan, ChangeQuantity, Renew, Suspend, Unsubscribe, Reinstate) with idempotency by operation id, subscription link table migration (`npm run db:status` before `npm run db:migrate`), entitlement mapping onto [api/subscriptions/plans.js](../../api/subscriptions/plans.js), and an hourly Metering API cron in `vercel.json`. Tests for the webhook state machine and metering batching. Landing page error states designed and verified in a browser.
2. **[#2] Copilot MCP certification package.** Finish the package in [marketing/growth/submissions/programs/microsoft-copilot-mcp-certification.md](../../marketing/growth/submissions/programs/microsoft-copilot-mcp-certification.md): generate `mcptools.json` from the live `tools/list`, produce the outline and color icons from `public/logo.png`, and zip the package in-repo so the owner only uploads it.
3. **[#4] Power Platform connector.** OpenAPI 2.0 definition and `apiProperties.json` for generate model, job status, list agents and agent message, validated, kept in-repo beside the API docs.
4. **[#5] Teams app.** Message extension posting Glance Adaptive Cards ([api/_lib/glance-adaptive.js](../../api/_lib/glance-adaptive.js)) and a personal tab with `<agent-3d>`, added to the #2 manifest.
5. **[#7, #8] Edge and Microsoft Store packages.** Edge-ready zips of both `extensions/` builds, and `share_target` plus `shortcuts` in [public/site.webmanifest](../../public/site.webmanifest) for the PWA package.
6. **[#3, #11, #13] Copy and questionnaires.** Professional service offer text (three offers), Publisher Attestation answers, and the Bing Webmaster sitemap list, each in `marketing/growth/submissions/programs/` ready to paste.
7. **Docs.** Update [docs/microsoft.md](../../docs/microsoft.md), [docs/listings.md](../../docs/listings.md), `STRUCTURE.md` for new surfaces, and a `data/changelog.json` entry, then `npm run build:pages` and `npm run audit:docs`.

## Definition of done

- A preview SaaS purchase can be resolved, activated, changed, suspended and cancelled end to end against Microsoft's API, with tests passing (`npm test`).
- Metering reports usage per subscription and dimension, with retries for rejected events.
- The Copilot, Teams, Power Platform, Edge and Microsoft Store packages exist in-repo and pass their validators.
- Every owner step is written as one ordered checklist in the plan doc.
- Docs and changelog updated; `npm run check:rules -- --paths <files>` and `npm run audit:docs` pass.

## Gates

Partner Center submissions, store publishing, Entra app registration, Key Vault creation and the business verification are owner steps. Prepare everything so each is one upload or one command.

## Close out (required)

1. Verify every Definition of done line with real output.
2. Commit with explicit paths and a message that describes the diff. Split unrelated changes.
3. **When every Definition of done line passes, delete this prompt** in your final commit (`git rm prompts/finish/986-plan-microsoft-distribution-offers.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` with the commit SHAs and one sentence on what shipped. Never delete it on a partial.
4. If only owner steps remain, keep this file, add a dated "Status" paragraph under the title saying exactly what remains and who owns it, and append the same to `plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started the session said to.

## Final report

What Step 0 measured; what changed (files and SHAs); evidence for each Definition of done line; the one batched owner message; one line per judgment call.
