# Add a "Holders only" control to Widget Studio so token-gated embeds can be created without the API

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/753-plan-embed-widget-studio-holder-gate-control.md`.

**Priority:** P2, new capability with clear value (score 40 of 100 inside the tier). **Area:** embed. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Token-gated 3D embeds are one of the platform's clearest $THREE utilities (holder-only avatars and scenes, enforced server-side), but the only way to create one is `POST /api/embed/gate-create` or the `create_gated_embed` MCP tool. The no-code builder at `/studio` (Widget Studio) has no control for it, so the surface most creators use cannot reach the feature, and the campaign anchor for the utility story has to point at documentation instead of a working button. Adding the control turns an API-only capability into a product feature on Solana, with the gate defaulting to $THREE.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Server side is complete: `api/embed/gate-create.js` (auth: session or bearer, owner check via `checkAssetOwnership`, body `{ assetId, gate: { mint?, minAmount, chain: 'solana' } }`, returns `gateId`, the gate and a ready snippet), `api/embed/gate-verify.js`, `api/embed/resolve.js` (enforces on every fetch), `api/_lib/embed-gate.js`, MCP tool in `api/_mcp/tools/embed.js`, test `tests/embed-gate.test.js`. `mint` defaults to $THREE and is a runtime parameter.
- Docs: `docs/token-gated-3d-embeds.md`.
- Widget Studio is `public/studio/index.html` with `public/studio/studio.js` (and `studio.css`, panels such as `launch-panel.js`). A grep of `src` and `pages` for `gate-create` finds no caller. `public/studio/studio.js` has no gate control.
- The season pack (edition 05) records the gap: "No creation UI in /studio".

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
cd /home/user/three.ws
grep -rn "gate-create\|gate-verify\|embed/gate" public/studio src pages --include=*.js --include=*.html | head
grep -n "snippet\|embed code\|copy" public/studio/studio.js | head -20
sed -n 1,60p tests/embed-gate.test.js
sed -n 1,40p public/studio/index.html
```

If a gate control already exists and calls the endpoint, close the order as shipped after verifying it in a browser.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Read `public/studio/studio.js` fully to find how the studio chooses an avatar, builds widget config, and produces the embed snippet, and how it knows the signed-in user. Reuse its patterns (state, panel structure, toast/error handling) and tokens in `public/studio/studio.css`.
2. Test first: add `tests/studio-gate-control.test.js` for the pure logic you extract (build the request body from the form, validate min amount, map the endpoint's error codes to user messages, build the snippet from the response). Run it and see it fail before the module exists. Put the logic in a small module (for example `public/studio/gate-panel.js`) so it is testable.
3. Build the panel: a "Holders only" toggle beside the snippet output. When on: token (default $THREE, shown with its symbol and a short mint; an "advanced" field for another SPL mint, passed as runtime data only), minimum amount in tokens, and the tier shortcuts from the ladder in `api/_lib/three-access.js` (Bronze $25, Silver $100, Gold $500, Genesis $2,500 are USD thresholds, so convert with the live price helper the `/three` page uses rather than hard-coding token counts). A "Create gated embed" button calls `POST /api/embed/gate-create` with the session cookie and shows the returned snippet with a copy button and the `previewUrl`.
4. States: hover, focus-visible, active and disabled on every control; loading skeleton or inline spinner tied to the real request; empty state when no avatar is selected ("Pick an avatar first"); error states for 401 (sign in link), 403 not the owner (explain you must own the asset), 429 rate limit, validation errors and network failure, each with a recovery action; success state with the snippet and a link to the gate-verify preview.
5. After creating a gate, show the existing gate on reload if the API exposes it (check `api/embed/` for a read route; if none exists, add a minimal authenticated `GET /api/embed/gate-create?assetId=` to `api/embed/gate-create.js` with a test, so the panel reflects reality instead of local state).
6. Verify in a real browser against the dev server (`npm run dev`, `/studio`): create a gate on a test avatar you own, open the preview URL signed out (blocked, with the hold prompt) and with a wallet that holds the threshold (unlocked). Record the observed results in the report. Do not move funds; reading a balance is enough.
7. Docs and wiring: update `docs/token-gated-3d-embeds.md` and `docs/widget-studio.md` with the new control and a screenshot, point the season edition-05 anchor note at `/studio` now that it works, add a `data/changelog.json` entry and run `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/studio-gate-control.test.js tests/embed-gate.test.js` passes; the new test was seen failing first.
- [ ] In a browser, `/studio` shows the "Holders only" control, creating a gate returns a snippet, and the preview URL is blocked for a non-holder and open for a holder (observed, not assumed).
- [ ] `grep -rn "api/embed/gate-create" public/studio` returns the new call site.
- [ ] No console errors or warnings from the new code; keyboard-only operation works end to end.
- [ ] The default token in the request body is omitted or equals `FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`, and no other mint appears anywhere in the diff.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No holder wallet to test the unlocked path | Use a wallet that already holds $THREE if the environment has one. Otherwise verify the signed-out blocked path live in the browser, cover the unlocked path with the RPC-boundary cases already in `tests/embed-gate.test.js`, and say plainly in the report which path was observed live. |
| No avatar owned by the test account | Create one through the existing Avatar Studio flow or `create-3d-avatar`; the free lane costs nothing. |
| The studio code is not modular | Add the panel as a new file loaded by `studio.js`; do not refactor unrelated code. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/753-plan-embed-widget-studio-holder-gate-control.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `753-plan-embed-widget-studio-holder-gate-control.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `marketing/three-utility-season/05-gated-embed-create.md` (whole file)

~~~~markdown
# Edition 05: What $THREE does this week, token-gated 3D content

| Field | Value |
|---|---|
| Campaign id | `MKT-2026-10-THREE-GATE` |
| Publish date | 2026-10-16 |
| Chapter | Creation |
| Audience | creators and community |
| Campaign anchor (campaigns.csv) | https://three.ws/studio |
| Surface used in this pack | /docs/token-gated-3d-embeds |
| Verified status (2026-09-16) | **Live (API and MCP). No creation UI in `/studio`.** |

## Verification

**Substitute:** None for the utility. The link moves from `/studio` to the documentation page, because Widget Studio has no gate control; creation happens through `POST /api/embed/gate-create` or the MCP tool.

- Handlers: `api/embed/gate-create.js` and `api/embed/gate-verify.js`. An unauthenticated create returned `401 sign in required to gate an embed` (the expected guard) on 2026-09-16.
- Verify path: `POST /api/embed/gate-verify` for the existing demo gate returned a SIWS message with a nonce and `gate: { mint: FeMb...pump, minAmount: 1 }` on 2026-09-16.
- Doc: `/docs/token-gated-3d-embeds` answered 200 and shows "Verified against the code".
- Gap: `src/studio/` contains no gate-create control, so the campaign anchor `/studio` cannot perform the action.

## The three questions

- **What can a holder do now?** Sign in, pick an owned avatar, `POST /api/embed/gate-create` with `{ assetId, gate: { minAmount, chain: "solana" } }`, and paste the returned snippet on a page.
- **Where does $THREE enter?** Held, by the viewer. The server issues a single-use signed-message nonce, reads the wallet's live $THREE balance, and only then returns a short-lived access token for the scene.
- **What verifiable result comes out?** Below the bar, a designed locked teaser ("Hold N $THREE to unlock"). Above it, the interactive 3D scene. Raising the minimum invalidates earlier access tokens.

## Numbers and their sources

| Stable fact | Source and capture date |
|---|---|
| Gate defaults to $THREE when `mint` is omitted | `docs/token-gated-3d-embeds.md`, captured 2026-09-16 |

## Media

- File: [`images/05-gated-embed-docs.png`](./images/05-gated-embed-docs.png), 1600x900, captured 2026-09-16 from `/docs/token-gated-3d-embeds` by `node marketing/three-utility-season/capture.mjs --only 05`.
- Alt text (required on every post):

> The three.ws documentation page "Token-gated 3D embeds", marked Verified against the code, explaining that the scene only renders for a visitor who holds enough of a specific token, verified with a real on-chain balance read, with $THREE-holder-only content as the canonical use case.

## X post

Weighted length: **167 characters** (URL counted as 23, as `scripts/post-tweet.mjs` does).

```text
A token-gated embed renders its 3D scene only for a wallet holding enough $THREE, checked by a signed message and a live on-chain balance read. https://three.ws/docs/token-gated-3d-embeds?utm_source=x&utm_medium=social&utm_campaign=mkt-2026-10-three-gate&utm_content=utility-post
```

## Telegram

```text
What $THREE does this week: holder-only 3D scenes.
Any avatar you own on three.ws can become an embed that only renders for wallets holding enough $THREE. The check is a signed message plus a live on-chain balance read, done on the server.
Below the bar, visitors see a locked teaser instead of the model.
Create one with the API or the MCP tool; the guide is at three.ws/docs/token-gated-3d-embeds.
https://three.ws/docs/token-gated-3d-embeds?utm_source=telegram&utm_medium=community&utm_campaign=mkt-2026-10-three-gate&utm_content=utility-telegram
```

## User action

Sign in, pick an owned avatar, `POST /api/embed/gate-create` with `{ assetId, gate: { minAmount, chain: "solana" } }`, and paste the returned snippet on a page.

## KPI and where to read it

Gates created and verified unlocks. New `embed_gates` rows for the week; successful `gate-verify` phase-two responses in `three-ws-api` logs; UTM sessions for `mkt-2026-10-three-gate`.

Record the 24-hour and seven-day rows in the format in [measurement.md](../growth/measurement.md).

## Posting-day checklist

- [ ] Re-open the linked surface in a clean browser and confirm it loads without errors.
- [ ] Create one gate from a real account and open it with a wallet above and below the bar.
- [ ] Confirm `/docs/token-gated-3d-embeds` still returns 200.
- [ ] Re-run `capture.mjs --only 05`.
- [ ] Attach the image and paste the alt text.
- [ ] Owner presses publish. Nothing in this pack posts automatically.

## Do not

- Do not say "in Studio". There is no Studio control yet.
- Do not suggest gating with any other token in the post.
- No price, return, urgency, or "moon" language. No hashtags, no emoji.
~~~~

### `docs/token-gated-3d-embeds.md` (whole file)

~~~~markdown
# Token-gated 3D embeds

> **Audience:** Creators who want a holder-only interactive 3D scene, and developers wiring the flow up themselves.

three.ws already lets you embed a live, interactive 3D avatar or on-chain agent on any page with one script tag ([Share & embed](./share-and-embed.md), [Embedding Guide](./embedding.md)). Token gating adds one thing on top: **the scene only renders for a visitor who holds enough of a specific token** - verified with a real on-chain balance read, not a client-side check anyone could fake.

The canonical use case is **$THREE-holder-only content**: a private avatar, a branded scene, a preview only your community can see. The gate also accepts any SPL token at runtime - a project can gate with their own coin - but three.ws never markets or defaults to anything other than `$THREE`.

---

## How it's different from a private link

A private/unlisted embed link keeps a scene off search and off the marketplace, but anyone who has the URL can view it. A **gated** embed is public by URL - you can post it anywhere - and still only renders the real 3D scene for a wallet that clears the bar. Below the bar, visitors see a designed locked teaser instead of the model.

---

## Creating a gated embed

You need to already own the asset you're gating (an avatar you uploaded, or an on-chain agent registered to your linked wallet).

### Via the MCP tool (Claude / any MCP client)

```
create_gated_embed({
  asset_id: "avatar:8e3c9b1a-...",
  min_amount: 5000
  // mint omitted → defaults to $THREE
})
```

Returns a `gate_id`, the gate terms, and a ready-to-paste embed snippet. See [docs/mcp.md#create_gated_embed](./mcp.md#create_gated_embed) for the full tool schema.

### Via the REST API

```bash
curl -X POST https://three.ws/api/embed/gate-create \
  -H "content-type: application/json" \
  -H "authorization: Bearer $YOUR_API_KEY" \
  -d '{
    "assetId": "avatar:8e3c9b1a-0000-4000-8000-000000000001",
    "gate": { "minAmount": 5000, "chain": "solana" }
  }'
```

```json
{
  "gateId": "a1b2c3d4e5f6",
  "assetId": "avatar:8e3c9b1a-0000-4000-8000-000000000001",
  "gate": { "mint": "FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump", "minAmount": 5000, "chain": "solana" },
  "embed": {
    "scriptSrc": "https://three.ws/embed/v1.js",
    "snippet": "<script src=\"https://three.ws/embed/v1.js\" async></script>\n<three-d agent=\"avatar:8e3c9b1a-...\" interactive></three-d>",
    "previewUrl": "https://three.ws/embed/v1/gated.html?asset=avatar%3A8e3c9b1a-..."
  }
}
```

Gating with a community's own token instead of $THREE - pass a `mint`:

```json
{ "assetId": "avatar:...", "gate": { "mint": "<your SPL mint>", "minAmount": 1000 } }
```

Setting a new requirement on an already-gated asset replaces the old gate - every access token issued against the old requirement stops working immediately.

---

## Sharing it

Two ways to place a gated embed, same underlying gate either way:

1. **Script tag + custom element** - works on your own site, Webflow, Framer, a blog, anywhere you can drop HTML. This is the primary form: it runs in the visitor's own top-level page, so their wallet extension (Phantom, Backpack, Solflare) is directly reachable.
   ```html
   <script src="https://three.ws/embed/v1.js" async></script>
   <three-d agent="avatar:8e3c9b1a-..." interactive></three-d>
   ```
2. **Standalone URL** - for platforms that only accept a link (Notion, a Claude artifact, an iframe-only CMS): `https://three.ws/embed/v1/gated.html?asset=avatar:8e3c9b1a-...`. A wallet extension needs to be reachable from inside the iframe for the connect flow to work - most extensions inject into top-level embeds reliably; iframe support varies by extension.

---

## What a visitor sees

**Locked** - a blurred poster teaser, "Hold {min_amount} {symbol} to unlock", and a **Connect wallet** button. No wallet installed → the button becomes a "Get a wallet" link to Phantom instead of a dead control.

**Unlocking** - clicking Connect wallet:
1. Connects the visitor's Solana wallet (Phantom / Backpack / Solflare - whichever is injected).
2. Prompts a message signature (no transaction, no gas, nothing leaves the wallet) proving ownership of the address.
3. The server reads the wallet's **real** SPL balance for the gate's mint via Solana RPC.
4. If it clears `min_amount`, the scene fades in and becomes fully interactive (orbit/zoom/pan). If not, the card shows exactly what they hold vs. what's required, with a retry.

**Session** - a successful check is remembered in the browser tab for **10 minutes** (an access token, not the wallet connection itself), so the visitor isn't re-signing on every interaction. Past that, the embed automatically reverts to locked and prompts a fresh connect - this is what keeps a wallet that sold off its holding from staying "unlocked" indefinitely.

---

## Why this can't be faked

Every check that matters happens on the server:

- The balance read is a live Solana RPC call (`getTokenAccountsByOwner`) against the gate's mint - never a number the browser reports.
- Wallet ownership is proven with a signed, single-use, expiring nonce (SIWS) - a visitor can't just paste an address they don't control.
- The access token that unlocks subsequent fetches is HMAC-signed server-side and tied to the exact gate, asset, and wallet it was issued for; it can't be forged, replayed against a different gate, or extended past its 10-minute TTL.
- `POST /api/embed/gate-verify` is rate-limited per IP **and** per wallet, so scripted brute-forcing (guessing your way to a "holder" balance, or hammering the RPC lane) is bounded.

---

## Reference

- Spec (wire formats, resolver contract, token format): [specs/EMBED_SPEC.md § Token Gating](../specs/EMBED_SPEC.md#token-gating)
- MCP tool: [docs/mcp.md § create_gated_embed](./mcp.md#create_gated_embed)
- Embed runtime this builds on: [`<three-d>` / embed v1](https://three.ws/embed/v1/preview), [Share & embed](./share-and-embed.md)
- Nothing rendering where you pasted the snippet? The [Embed Doctor](https://three.ws/embed-doctor) loads your page in a real browser and names the line to change. It checks a `<three-d>` gated snippet exactly like an ungated `<agent-3d>` one, and a locked embed reads as healthy: the lock is the product working, not a failure.
- Related: [Hold-to-access tiers](./hold-to-access.md) (site-wide $THREE tiers, distinct from per-embed gates)
~~~~

