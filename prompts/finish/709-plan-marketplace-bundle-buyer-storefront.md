# Buyers can see and purchase published skill bundles from the marketplace and agent profile

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/709-plan-marketplace-bundle-buyer-storefront.md`.

**Priority:** P2, new capability with clear value (score 60 of 100 inside the tier). **Area:** marketplace. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Skill bundles (several skills sold at one price) are fully built on the API side: the seller builder `pages/bundles.html`, the public GETs, and checkout at `POST /api/marketplace/purchase-bundle` with `/:id/confirm`. But no marketplace or agent-profile view renders a published bundle, so the only way a human buyer can purchase one is by calling the API. Bundles therefore earn nothing. `docs/skill-bundles.md` states plainly that rendering bundles on the agent's marketplace listing is the next step.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Tables `skill_bundles`, `bundle_items`, `bundle_purchases`; unlock is a `skill_purchases` row with `kind = 'bundle'` read by `hasSkillAccess()` in `api/_lib/skill-access.js`.
- Handlers: `api/agents/[id]/bundles.js` (CRUD + public GET), `api/marketplace/purchase-bundle.js` (Solana Pay reference + confirm). Seller UI: `pages/bundles.html`.
- `src/marketplace.js` has a payment modal (~lines 7470-7950, `apiPostWithCsrf`, `pollConfirm`) used for single-skill purchases; no bundle rendering (`grep -n bundle src/marketplace.js` only hits skill-bundle upload fields).
- `pages/marketplace.html` and `pages/agent-market.html` exist; no bundle section in either.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
grep -n "bundle" -i src/marketplace.js pages/marketplace.html pages/agent-market.html | grep -vi "skill_bundle\|readSkillBundleFields\|vite\|three.js" | head
ls api/marketplace | grep -i bundle; sed -n 1,60p 'api/agents/[id]/bundles.js'
curl -s https://three.ws/api/agents/<an-agent-id-with-a-bundle>/bundles | head -c 600
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Read `docs/skill-bundles.md` (checkout contract) and the single-skill payment modal in `src/marketplace.js` so the bundle flow reuses `apiPostWithCsrf`, `pollConfirm` and the modal, not a second implementation.
2. Find where a listing's skills render on `pages/marketplace.html` / the agent profile and add a "Bundles" section above or beside them, populated from the real public `GET /api/agents/:id/bundles`. Each card: name, description, included skills, price in $THREE/USDC with the savings versus buying skills individually (computed from real per-call or purchase prices, never invented), and a Buy button.
3. Buy flow: open the existing modal in bundle mode, call `POST /api/marketplace/purchase-bundle`, show the Solana Pay reference/QR and poll `/:id/confirm`; on confirmed verdict refresh entitlements so the included skills show as owned. Owned bundles show an "Owned" state and the Buy button is disabled.
4. States: loading skeleton cards, designed empty state (no bundles: the section is hidden for buyers; for the owner it links to `pages/bundles.html`), error state with retry, hover/focus-visible/active on cards and buttons, keyboard operable, 44px touch targets at phone width.
5. Tests: add `tests/marketplace-bundle-storefront.test.js` for the pure rendering/price-savings logic (extract it into a small module under `src/` so it is testable), plus an API-level test confirming `purchase-bundle` rejects an inactive bundle and an already-owned buyer. Solana Pay confirm is tested with the existing confirm fixtures; no mainnet spend.
6. Docs: update `docs/skill-bundles.md` "Reach today" paragraph, add a `data/changelog.json` entry, STRUCTURE.md row if a new module lands, run `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/marketplace-bundle-storefront.test.js` passes.
- [ ] In a real browser at `npm run dev`, an agent with an active bundle shows the Bundles section with real data, the Buy modal opens and shows a Solana Pay reference, with no console errors.
- [ ] `grep -n "Reach today" -A6 docs/skill-bundles.md` no longer says the browser surface is missing.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No published bundle exists to render | Create one on a local dev account through `pages/bundles.html` against the dev DB; do not seed fake rows in code. |
| Cannot complete a real payment | Stop the browser check at the displayed Solana Pay request; verify confirm via the API test fixtures. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

The actual on-chain purchase of a bundle is a spend action. Do not complete one during verification; render recipient + amount + token and stop for the owner's yes/no if a live purchase is ever wanted.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/709-plan-marketplace-bundle-buyer-storefront.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `709-plan-marketplace-bundle-buyer-storefront.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/skill-bundles.md` (whole file)

~~~~markdown
# Skill bundles

A **skill bundle** sells several of one agent's skills as a single purchase. One
payment, one confirmation, and every skill in the bundle unlocks at once.

The hard part of a bundle was never grouping the skills. It was the price. The
usual answer is "take 20% off the sum of the parts", which is a guess dressed as
advice. three.ws answers it from the seller's own ledger instead: some buyers have
already bought two or more of these skills separately, and what they actually paid
is real evidence of what the combination is worth.

Build one at **[three.ws/bundles](https://three.ws/bundles)**. The page is
owner-only: it lists the agents you own, the skills on each that carry an active
price, and a price panel that backtests any price you type against those buyers.

> Source: [`pages/bundles.html`](../pages/bundles.html) (the builder),
> [`api/agents/[id]/bundles.js`](../api/agents/[id]/bundles.js) (management and
> pricing), [`api/_lib/bundle-pricing.js`](../api/_lib/bundle-pricing.js) (the
> arithmetic), [`api/marketplace/purchase-bundle.js`](../api/marketplace/purchase-bundle.js)
> (checkout and unlock).

---

## How the price is derived

Two bases, and the API always says which one it used, so a default is never
mistaken for a finding.

| `history.basis` | When | What the suggested price is |
|---|---|---|
| `median_basket` | At least one buyer bought 2+ of the selected skills | The **median** of what those buyers really spent across them, capped at the sum of the parts |
| `discount_off_list` | Nobody has bought 2+ of them yet | A flat **20% off** the sum of the parts, labelled as a starting point |

Only confirmed, paid purchases count. Trials and access rows granted by an earlier
bundle are excluded (`kind` is filtered to the paid kinds
[`api/_lib/marketplace-kinds.js`](../api/_lib/marketplace-kinds.js) publishes), so
nothing inflates the evidence a seller is shown.

Every amount in and out of these endpoints is an **atomic integer as a string**
(the currency's smallest unit). A 9-decimal mint puts real balances past
`Number.MAX_SAFE_INTEGER`, so the server carries every amount as a BigInt and the
browser scales through `BigInt` too. `mint_decimals` in the pricing response is
how a client turns an atomic amount into a human one.

---

## Endpoints

All four live under the agent. `:id` is the agent's UUID.

| Method | Path | Auth | Does |
|---|---|---|---|
| `GET` | `/api/agents/:id/bundles` | public | List the agent's active bundles |
| `GET` | `/api/agents/:id/bundles?include_inactive=1` | owner | The same list with paused bundles included |
| `GET` | `/api/agents/:id/bundles?action=pricing&skills=a,b` | public | Price a candidate bundle against real sales |
| `POST` | `/api/agents/:id/bundles` | owner | Publish a bundle |
| `PATCH` | `/api/agents/:id/bundles/:bundleId` | owner | Rename, reprice, or change its skills |
| `DELETE` | `/api/agents/:id/bundles/:bundleId` | owner | Deactivate it (nothing is deleted) |

Owner calls need a signed-in session cookie plus the `x-csrf-token` header that
[`src/api.js`](../src/api.js) attaches automatically in the browser (outside the
browser, mint one from `GET /api/csrf-token` with the same cookie). Bearer tokens
and API keys are not accepted on these owner calls: without a session they answer
`401 unauthorized`, and a session that does not own the agent gets
`403 forbidden`. The two `GET`s are public on purpose: they read only aggregate counts and
the agent's own list prices, both of which the marketplace already publishes per
skill. No buyer identity and no row-level history ever leaves the handler.

### Price a candidate bundle

```bash
curl -s "https://three.ws/api/agents/$AGENT_ID/bundles?action=pricing&skills=research,summarize"
```

```json
{
  "data": {
    "agent_id": "00000000-0000-4000-8000-00000000a9e7",
    "currency_mint": "FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump",
    "chain": "solana",
    "mint_decimals": 6,
    "skills": [
      { "skill": "research",   "list_amount": "2000000", "units_sold": 0, "gross_atomic": "0", "buyers": 0 },
      { "skill": "summarize",  "list_amount": "1000000", "units_sold": 0, "gross_atomic": "0", "buyers": 0 }
    ],
    "unpriced_skills": [],
    "sum_of_parts_atomic": "3000000",
    "history": {
      "multi_skill_buyers": 0,
      "revenue_atomic": "0",
      "median_basket_atomic": null,
      "basis": "discount_off_list"
    },
    "suggested": {
      "price": "2400000",
      "discount_atomic": "600000",
      "discount_percent": 20,
      "backtest_revenue_atomic": "0",
      "revenue_delta_atomic": "0",
      "buyers_better_off": 0
    },
    "asked": null
  }
}
```

Add `&price=<atomic>` to backtest a specific price. The response's `asked` block
then carries the same shape as `suggested` for that price: what the bundle would
have collected from the same buyers (`backtest_revenue_atomic`), how that compares
to what they really paid (`revenue_delta_atomic`, negative means the price left
money on the table), and how many of them would have come out ahead
(`buyers_better_off`). The builder page calls exactly this as you drag the price.

A skill you named that has no active price is not silently dropped: it comes back
in `unpriced_skills` and is left out of the sum. Skills priced in **different
mints** are refused with `409 mixed_currency`, because adding two currencies
produces a number that means nothing.

### Publish

```bash
curl -s -X POST "https://three.ws/api/agents/$AGENT_ID/bundles" --cookie "$JAR" \
  -H "x-csrf-token: $CSRF" \
  -H "content-type: application/json" \
  -d '{
    "name": "Research starter pack",
    "description": "Research plus summarize, one payment.",
    "price_amount": "2400000",
    "currency_mint": "FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump",
    "chain": "solana",
    "skills": ["research", "summarize"]
  }'
```

`price_amount` takes an atomic integer as a string or a number; a string is the
safe form on a 9-decimal mint. `skills` needs at least two names and takes at most
fifty. The response is `201` with the created bundle and its skills.

`DELETE` sets `is_active = false`. Buyers who already paid keep their access,
because access lives on their `skill_purchases` rows, not on the bundle.

Pausing is reversible. `PATCH` with `{"is_active": true}` puts the bundle back on
sale, and `include_inactive=1` is how you find it again: the plain `GET` is the
buyer-facing list and stays active-only, so a paused bundle is returned only to a
session that owns the agent. Anyone else passing the flag gets the public list
unchanged. The builder page uses exactly this, which is why a paused bundle stays
on screen, dimmed, with a **Reactivate** button.

---

## Checkout

A bundle is bought through the marketplace, not through the bundle endpoints:

```
POST /api/marketplace/purchase-bundle              { "bundle_id": "..." }
POST /api/marketplace/purchase-bundle/:id/confirm  { }        # Solana
POST /api/marketplace/purchase-bundle/:id/confirm  { "tx_signature": "0x..." }   # EVM
```

`create` writes a `pending` row in `bundle_purchases` and returns Solana Pay
parameters: recipient (the creator's payout wallet), `price_amount`,
`currency_mint`, `chain`, a freshly minted `reference`, and the platform fee split.
`confirm` proves the payment on-chain **before** anything unlocks: Solana is
located by the reference the server minted (no client-supplied signature is
trusted), EVM by the submitted tx hash. On a confirmed verdict the handler writes
one `skill_purchases` row per skill with `kind = 'bundle'` and `amount = 0`, which
is what [`hasSkillAccess()`](../api/_lib/skill-access.js) reads, and records a
single bundle-level revenue event so one bundle sale is never counted as N skill
sales in GMV. That event is marked `settled_to_wallet`: the buyer paid the
creator's payout wallet directly, so the sale counts as income already held and
never as a balance withdrawable from the platform treasury.

**Reach today:** the builder, the two public `GET`s, and this checkout are live.
The buyer-facing *browser* surface is not: no marketplace or agent-profile view
renders a published bundle yet, so a human buyer reaches one through the API
above, while the seller-side builder is fully wired. Rendering bundles on the
agent's marketplace listing is the next step.

---

## Storage

| Table | Holds |
|---|---|
| `skill_bundles` | One row per bundle: name, description, `price_amount`, `currency_mint`, `chain`, `is_active` |
| `bundle_items` | The skill names in a bundle, one row each |
| `bundle_purchases` | One row per checkout: status, reference, tx signature, platform fee |
| `skill_purchases` | The unlock itself, one row per skill, `kind = 'bundle'` |

## Related

- [Marketplace](marketplace.md): how skills and assets are listed, bought, and settled
- [Agent skills](agent-skills.md): what a skill is in the first place
- [Agent wallets](agent-wallets.md): where a bundle's payment lands
~~~~

