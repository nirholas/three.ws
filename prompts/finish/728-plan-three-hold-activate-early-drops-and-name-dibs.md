# Gold holders enter drops early and Genesis holders get first dibs on rare threews.sol names

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/728-plan-three-hold-activate-early-drops-and-name-dibs.md`.

**Priority:** P2, new capability with clear value (score 54 of 100 inside the tier). **Area:** three. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

`drops.early` (Gold, minLevel 3) and `names.first_dibs` (Genesis, minLevel 4, pay-per-use `name.auction`) are listed as holder perks on `/three` but are `enforced: false` in `api/_lib/three-access.js`, so holding $THREE gives no real edge on drops or rare names, and the honesty gate forces the UI to say "Planned". Both have working backends (`api/drops/[action].js`, `api/irl/drops.js`, `api/vanity/drops.js`, `api/sns.js`), which makes them cheap activations that give the top tiers a tangible benefit and strengthen the hold-to-access story on Solana. `mcp.priority` and `worlds.branded` have no backend (no shared MCP queue, no custom environments), and `docs/hold-to-access.md` says to build the feature first, so they stay deferred. This order is independent of the private-worlds perk order.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `api/_lib/three-access.js`: `drops.early` (minLevel 3) and `names.first_dibs` (minLevel 4, `payPerUse: 'name.auction'`) both `enforced: false`; `mcp.priority` and `worlds.branded` also `enforced: false` and deferred. Nothing calls `requireFeatureAccess` for these two ids.
- Drop surfaces: the generative `drops` table (`api/_lib/migrations/20260901120000_generative_drops.sql`, handler `api/drops/[action].js`) has status draft/live/closed and no early window or claim time; also `api/irl/drops.js` and `api/vanity/drops.js`. Names: `api/sns.js` with `api/_lib/pricing/name-rarity.js` and `api/_lib/pricing/catalog.js` (`name.auction`).
- `api/_lib/require-three.js` exports `requireFeatureAccess(req, res, featureId, { body })` (writes the 402 `three_hold_required` itself); token tier lookups are in `api/token/[action].js`. Pattern and tests to mirror: `tests/forge-high-gate.test.js`. Signed tier passes are pure HMAC (`verifyTierPass` in `api/_lib/three-tier.js`).
- `docs/hold-to-access.md` lines ~262 to 267 specify the activation order: window-gate the `*.threews.sol` auction for Genesis, time-gate the existing drop endpoints for Gold.
- No tests assert either flag is enforced; no `tests/drops-early-*.test.js` or `tests/names-first-dibs-*.test.js` exist.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
grep -n "drops.early\|names.first_dibs" -B1 -A6 api/_lib/three-access.js
grep -rn "drops.early\|names.first_dibs" api src tests --include=*.js | grep -v three-access.js
grep -n "early\|window\|opens_at\|starts_at\|status" api/drops/\[action\].js api/irl/drops.js api/vanity/drops.js api/sns.js | head -40
grep -n "status\|opens_at\|early" api/_lib/migrations/20260901120000_generative_drops.sql
grep -n "auction" api/_lib/pricing/catalog.js
grep -n "requireFeatureAccess\|call site" tests/three-tier-honesty.test.js | head
sed -n 250,345p docs/hold-to-access.md
npm run db:status
```

Skip any perk whose `enforced` flag is already true with a passing test. `requireFeatureAccess` already exists; if the honesty tripwire from task 8 is already in `tests/three-tier-honesty.test.js`, skip it.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Read the drop handlers and `api/sns.js` to find each existing claim, mint, bid or entry action and its open time. Decide the surfaces to gate: every drop endpoint that has a claim or mint action with a limited supply (at minimum the generative `api/drops/[action].js`; `api/irl/drops.js` and `api/vanity/drops.js` if they have claims); record the choice in the changelog entry. Listings stay ungated so everyone sees the countdown.
2. Data: add an additive migration (read `npm run db:status` first; `npm run db:migrate` applies immediately) giving drops `early_opens_at` and `public_opens_at` (or `early_until`), for each drop table that needs it, and surface the open time in the responses. The window length comes from the drop row, never a hard-coded constant; where a default is needed it is a named config constant read from env (defaults: 10 to 15 minutes for drops, 24 hours or 60 minutes for names, state the choice in the report). A drop with no early window behaves exactly as today.
3. Tests first, mirroring `tests/forge-high-gate.test.js` with signed tier passes and an injected clock: `tests/drops-early-gate.test.js` (before the public window a Bronze or non-holder claim gets 402 `three_hold_required` and a Gold holder succeeds; after the window both succeed; no-window drop unchanged) and `tests/names-first-dibs-gate.test.js` (before the Genesis window only Genesis passes; between windows Gold-and-below behavior is unchanged; rare names, per `name-rarity.js`, show a holder-only window before open auction). Run and confirm the failures are the missing behavior.
4. Gate drop claim/entry paths with `requireFeatureAccess(req, res, 'drops.early', ...)` only during the early window, in every surface chosen in task 1.
5. Gate the `*.threews.sol` auction bid/claim path in `api/sns.js` with `names.first_dibs` during the Genesis window, driven by `name-rarity.js`, enforced server side, leaving the pay-per-use path as defined by `payPerUse: 'name.auction'`.
6. Flip `drops.early` and `names.first_dibs` to `enforced: true`, each only once its test passes, citing the tests in comments. Keep `mcp.priority` and `worlds.branded` `enforced: false` and make sure `/three` labels them "Planned" honestly. Keep `tests/three-tier-honesty.test.js` green and update UI copy with live tier values.
7. UI: where drops and the name auction are shown (grep `pages/` and `src/` for `drops` and `sns`), render a countdown to public open and, for eligible holders, an "Early access" state. Include hover/focus/active, a skeleton while the tier resolves, and an error state that links to `/three` on 402. Verify in a real browser with no console errors.
8. Tripwire (skip if present): add an assertion in `tests/three-tier-honesty.test.js` that every feature with `enforced: true` has at least one call site of `requireFeatureAccess` with its id.
9. Add both gates to the read-only checks in `scripts/verify-three-gate.mjs`. Update `docs/hold-to-access.md` (move both perks from roadmap to live, document schema and gate locations) and the `/three` tiers page labels (PLANNED to LIVE), add a `data/changelog.json` entry, run `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/drops-early-gate.test.js tests/names-first-dibs-gate.test.js tests/three-access.test.js tests/three-tier-honesty.test.js` passes; the new tests were shown failing first.
- [ ] `grep -n "drops.early\|names.first_dibs" -A5 api/_lib/three-access.js | grep -c "enforced: true"` prints 2, and `grep -rn "requireFeatureAccess(req, res, 'drops.early'\|requireFeatureAccess(req, res, 'names.first_dibs'" api` shows a call site for each.
- [ ] Browser check on the drops surface: countdown renders pre-window, early state renders for a Gold tier pass in dev, the 402 state renders for a non-holder; no console errors.
- [ ] The migration is applied and `npm run db:status` shows nothing pending.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Unsure of window lengths | Make them configurable env/config values with the defaults above and state the choice in the report |
| No live drop to test against | The gate logic is time-based; tests inject the clock. Use the dev server with a drop row whose open time is in the future |
| No holder wallet on staging | Use signed tier passes or the seeded-entitlement pattern from the forge gate tests |
| SNS mainnet auction cannot be exercised | Test the gate and window only; never submit a mainnet SNS transaction |
| Unsure which drop surface the roadmap means | Gate every drop endpoint with a limited-supply claim, starting with `api/drops/[action].js`, and say so in the changelog entry |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

Nothing here moves funds. Do not mint, claim or auction a real name or drop on mainnet while verifying; use devnet, the test database or injected clocks.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/728-plan-three-hold-activate-early-drops-and-name-dibs.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `728-plan-three-hold-activate-early-drops-and-name-dibs.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/hold-to-access.md` (section "Activation roadmap")

~~~~markdown
## Activation roadmap

Goal: **drive $THREE demand** by activating registered-but-dormant perks. A perk is only
worth gating when its backend genuinely exists - wiring a gate onto a missing feature
would be a fake perk, exactly what `enforced` guards against.

Priority order by demand value × backend readiness:

1. **`worlds.private` (Silver)** - strongest *standing-hold* lever: a persistent private
   space you keep only while you hold Silver. Backend closest to ready. **Spec below.**
2. **`names.first_dibs` (Genesis)** - window-gate the `*.threews.sol` auction so Genesis
   holders get a head start. SNS backend exists ([`api/sns.js`](../api/sns.js)).
3. **`drops.early` (Gold)** - time-gate the existing drop endpoints
   ([`api/irl/drops.js`](../api/irl/drops.js), [`api/vanity/drops.js`](../api/vanity/drops.js))
   so Gold holders enter the window early.
4. **`mcp.priority`, `worlds.branded`** - deferred: no backend (shared MCP queue / custom
   environments) exists to gate. Build the feature first, then the gate.

Each activation is the same shape: add the gate call, flip `enforced: true`, add a gate
test mirroring `tests/forge-high-gate.test.js`, add a changelog entry. Nothing else
changes - the access endpoint and `/three` pick it up automatically.

---
~~~~

### `docs/hold-to-access.md` (whole file)

~~~~markdown
# Hold-to-Access - the $THREE demand lever

three.ws monetizes premium capability by **holding $THREE, not by spending it**. A
wallet's live USD value of $THREE resolves to a membership tier; tiers unlock fee
discounts, higher free quotas, and gated features. Holding removes float and rewards
bag size without depleting it - a deflation-free status lever that creates *standing*
demand rather than one-time spend.

This is the canonical reference for the system: the tier ladder, the enforcement
primitive, the perk registry, and the roadmap for activating the perks that are
registered but not yet enforced.

> The only coin this platform references is **$THREE**
> (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`). Every threshold below is denominated
> in the USD value of $THREE held.

---

## The tier ladder

Resolved from the USD value a wallet currently holds of $THREE, priced live. Source of
truth: [`api/_lib/three-tier.js`](../api/_lib/three-tier.js).

| Level | Tier | Hold (USD) | Compute discount | Free-quota multiplier |
|------:|------|-----------:|-----------------:|----------------------:|
| 0 | Member | $0 | - | 1× |
| 1 | Bronze | $25 | 5% | 2× |
| 2 | Silver | $100 | 10% | 3× |
| 3 | Gold | $500 | 20% | 5× |
| 4 | Genesis | $2,500 | 30% | 10× |

A wallet that can't be priced (RPC/price hiccup) resolves to the **Member floor**, never
an error - a balance read must never block a charge.

---

## How resolution works

Three resolvers, picked by what the caller already knows:

| Resolver | I/O | Use |
|----------|-----|-----|
| `tierForUsd(usd)` | none (pure) | a level from a known USD value |
| `resolveUserTier(user)` | RPC + price | a session user's on-chain tier (degrades to Member) |
| `verifyTierPass(token)` | none (pure HMAC) | a presented signed pass - no RPC, zero latency |

**Signed tier passes** ([`signTierPass` / `verifyTierPass`](../api/_lib/three-tier.js))
seal a resolved `{ wallet, level, usd }` into a 10-minute HMAC token (`HOLDER_PASS_SECRET`).
A service that can't run a Solana RPC - the multiplayer/Colyseus server, an edge worker - gates on the pass alone. Because the pass is pure-HMAC, a holder presenting one is **never
wrongly blocked during an RPC or price outage**.

---

## Enforcing a gate

One helper turns the registry into an actual gate:
[`requireFeatureAccess`](../api/_lib/require-three.js). It mirrors `cors()`/`method()`
semantics - on a blocked request it writes the response itself; on an allowed request it
writes nothing:

```js
import { requireFeatureAccess } from './_lib/require-three.js';

const gate = await requireFeatureAccess(req, res, 'forge.high', { body });
if (!gate.ok) return; // 402 three_hold_required already sent
// ...gate.access, gate.level, gate.wallet are available here
```

Resolution is **comp-first, then pass-first**: a comped account (below), then a signed
tier pass (header `x-three-tier-pass` or `body.tier_pass`), then the session user's
on-chain tier, then anonymous Member. Every failure degrades to Member: a clean 402,
never a 500.

### Comped accounts

Some accounts are exempt from the ladder entirely: the owner's own accounts, and
creators/partners granted lifetime access. They clear **every** gated feature with no
wallet, no holding, and no payment.

The allowlist is [`api/_lib/comp-access.js`](../api/_lib/comp-access.js), and it is the
only place the exemption lives, because `requireFeatureAccess` is the single keystone
every enforced gate resolves through, one entry covers `forge.high`, `forge.gameready`,
and any gate added later. `GET /api/three/access` applies it too, so the UI renders those
features unlocked rather than showing a lock the API would let straight through; that
response carries `tier.comped: true` to explain why a $0 holder reads as entitled.

```js
import { isCompedUser, resolveCompAccess } from './_lib/comp-access.js';

const { comped } = await resolveCompAccess(req);  // from a request (session-aware)
if (isCompedUser(user)) { /* from an already-resolved user */ }
```

Grant access by adding a handle to `COMPED_ACCOUNTS` in that module, or by setting
`THREE_COMP_ACCOUNTS` to a comma-separated list of handles / emails / user ids. Env
entries are **merged** with the built-ins, never replace them, so an env typo cannot
silently revoke a comp granted in code.

Three properties keep it safe and cheap:

- **Only unique identifiers count.** `username`, `email`, and `id` are uniquely indexed
  on `users`, as is the handle in a platform-issued `<handle>@users.three.ws.local`
  address (minted by `handleRegister` for username registrations, which leave the
  `username` column null). `display_name` is deliberately **not** matched, because it is
  user-settable and not unique, so honoring it would let anyone comp themselves by
  renaming.
- **Anonymous requests pay nothing.** The lookup is guarded by `hasSessionCookie()`, so a
  request with no session never issues a query and the zero-latency anonymous free lane
  is untouched.
- **It fails closed on the perk.** An auth or DB hiccup resolves to "not comped", which
  simply means the normal hold-or-pay gate applies. It never fails the request.

A comp also lifts the free-lane rate multiplier to the top tier (`api/forge.js`,
`api/gpt-forge.js`). It does **not** bypass BYOK (a caller's own vendor key is still
their own key), nor the platform-wide spend ceilings that protect real vendor budget.

### The hold-or-pay 402

A blocked request returns a structured `402 three_hold_required` carrying everything the
UI needs to recover - no second round-trip:

```jsonc
{
  "error": "three_hold_required",
  "message": "High-quality generation requires holding $THREE (Bronze+) - or pay per use.",
  "feature": "forge.high",
  "reason": "insufficient_tier",   // or sign_in | link_wallet
  "held":     { "level": 0, "id": "member", "usd": 12.50 },
  "required": { "level": 1, "id": "bronze", "min_usd": 25 },
  "usd_to_go": 12.50,
  "acquire": { "mint": "Fe…pump", "symbol": "THREE", "swap_url": "…", "pump_url": "…" },
  "pay_per_use": { "action": "forge.high", "usd": 0.50 }   // null when hold-only
}
```

A feature with a `payPerUse` action lets a non-holder pay once in $THREE instead of
holding. A hold-only feature omits `pay_per_use`.

A handler that owns its own 402 (a pay-per-use action whose price depends on the request,
like pay-to-keep below) uses `checkFeatureAccess(req, res, featureId, { body })` from the
same module instead. It resolves the caller the same way (comp, pass, on-chain tier) but
only reports `{ eligible, level, wallet }` and writes no gate response.

---

## The perk registry

Source of truth: [`api/_lib/three-access.js`](../api/_lib/three-access.js). Each feature
maps to a minimum tier, a pay-per-use fallback (or `null`), and an **`enforced`** flag.

`enforced` is the integrity contract: it is `true` only when the gate is **wired and live
in the product** - a request for it is actually checked. `false` means the perk is
registered/planned but not enforced anywhere. The `/three` page reads this flag to mark a
feature **Live** vs **Planned**, so the platform never promises an unwired perk.

The same honesty applies to the prose perk lines on each tier card. `TIERS` carries two
lists: **`perks`** is what the hold buys today, and **`planned`** is what is registered
but not enforced yet. Every surface that renders the ladder (`/three`,
`GET /api/pricing`, `GET /api/three/tier`) serves both, and `/three` draws the `planned`
lines with the same Planned flag as the gated-feature rows. Keeping them in one list is
how an unbuilt feature ends up reading as a benefit, so when a gate ships, flip its
`enforced` here and move its line from `planned` to `perks` in the same change.
`tests/three-tier-honesty.test.js` fails if an unenforced feature's label reappears in a
`perks` list, and `npm run verify:three-gate` checks the same thing against the live
`/api/pricing` payload.

| Feature | Min tier | Status | Pay-per-use | Backend |
|---------|----------|--------|-------------|---------|
| `forge.high` - High-quality generation (200k poly + PBR) | Bronze | **Live** | yes | [`api/forge.js`](../api/forge.js) |
| `forge.gameready` - Game-ready export (Unity/Unreal) | Bronze | **Live** | yes | [`api/forge-gameready.js`](../api/forge-gameready.js) |
| `forge.keep`: Keep a Forge generation (original file) | Bronze | Off by default (`enforced: false`) | per-tier `forge.keep.<tier>` | [`api/forge-keep.js`](../api/forge-keep.js) |
| `worlds.private` - Private, invite-only worlds | Silver | Planned | - | partial (no visibility dim yet) |
| `mcp.priority` - Priority MCP routing | Silver | Planned | - | not built (no shared queue) |
| `worlds.branded` - Branded worlds + custom environments | Gold | Planned | - | not built |
| `drops.early` - Early access to drops | Gold | Planned | - | drop endpoints exist |
| `names.first_dibs` - First dibs on rare `*.threews.sol` | Genesis | Planned | `name.auction` | SNS exists |

### Pay-to-keep (`forge.keep`)

[`api/forge-keep.js`](../api/forge-keep.js) is an optional gate on the original file of a
Forge generation. It is **off** unless `FORGE_PAY_TO_KEEP=on` (flip it with
`npm run forge:pay-to-keep -- on|off|status`, which uses `--update-env-vars`). While off,
every generation is keepable and the endpoint answers `enabled: false, kept: true`. While
on, generating and previewing on a free lane stays free, and the original file is released
once per creation to a Bronze+ holder, or against one settled $THREE payment for
`forge.keep.draft` ($0.05) or `forge.keep.standard` ($0.15). High needs no keep payment
because it is already held or paid for at generation time. Because the registry flag
describes a gate that is off by default, `forge.keep` stays `enforced: false` and `/three`
shows it as Planned. `GET /api/forge-quote` prices a generation (and the keep step) per
path, tier and options from the same tier and catalog code.

### Adjacent levers (live, not feature-gated)

- **Compute discount** - every fixed-price action is re-priced by the holder's
  `discountBps` in [`api/pricing.js`](../api/pricing.js) (`personalizedActions`).
- **Free-quota multiplier** - a verified tier pass lifts the anonymous free-generation
  ceiling by `rateMultiplier` in [`api/forge.js`](../api/forge.js) (`freeLaneMultiplier`),
  zero added latency.
- **Charged-at tier on `/credits`**: every credit debit already applies the discount, and
  `GET /api/credits` reports the caller's resolved tier as `holder` (the same shape
  `/api/pricing` returns, degrading to `null` on an RPC hiccup rather than failing the
  balance read), so the [`/credits`](../pages/credits.html) page shows the tier you are
  actually being charged at and the next one up.

---

## Proving a holding from the browser

The server only ever sees what the page sends it, so a gated surface that mints its proof
from the wrong identity charges holders. **[`src/three-access.js`](../src/three-access.js)
is the one client module a gated surface may use.** It resolves both identities a holder
can arrive with:

| Identity | How the pass is minted | Prompt? |
|----------|------------------------|---------|
| Signed in, wallet linked to the account | `POST /api/three/tier-pass` with the session cookie | silent |
| Wallet connected, no account (Phantom, Seeker) | signs a domain-bound message, `POST { wallet, message, signature }` | one free signature |

Wire a gated request in three steps:

```js
import { getAccess, getTierPass, attachTierPass } from './three-access.js';

const { access } = (await getAccess('forge.gameready', { fresh: true })) || {};
// Interactive only when the read says this identity is eligible, so a non-holder is
// never asked to sign for something that could not unlock anything.
await getTierPass({ interactive: Boolean(access?.eligible) });
const res = await fetch('/api/forge-gameready', {
  method: 'POST',
  headers: attachTierPass({ 'content-type': 'application/json' }),
  body: JSON.stringify(payload),
});
```

Rules that keep the two identities from drifting apart:

- **Mint before the request, not on page load.** A pass lives 10 minutes; minting at the
  moment of the gated call is what guarantees the header is fresh.
- **Read access with `{ fresh: true }`, and re-read on `wallet:changed`.** Connecting or
  switching a wallet changes who is asking; the cached matrix is then the wrong identity's.
- **Never gate the UI on the client's answer.** The server is the only authority; the
  client read exists so the surface can state the viewer's real price up front instead of
  a generic pitch.

`src/three-tier-pass.js` is the earlier, session-only helper. It backs `<three-gate>`'s
access read and mints nothing for a connected wallet, so a surface that uses it to build
headers silently bills every account-less holder. Do not use it for a new gated request.

---

## Activation roadmap

Goal: **drive $THREE demand** by activating registered-but-dormant perks. A perk is only
worth gating when its backend genuinely exists - wiring a gate onto a missing feature
would be a fake perk, exactly what `enforced` guards against.

Priority order by demand value × backend readiness:

1. **`worlds.private` (Silver)** - strongest *standing-hold* lever: a persistent private
   space you keep only while you hold Silver. Backend closest to ready. **Spec below.**
2. **`names.first_dibs` (Genesis)** - window-gate the `*.threews.sol` auction so Genesis
   holders get a head start. SNS backend exists ([`api/sns.js`](../api/sns.js)).
3. **`drops.early` (Gold)** - time-gate the existing drop endpoints
   ([`api/irl/drops.js`](../api/irl/drops.js), [`api/vanity/drops.js`](../api/vanity/drops.js))
   so Gold holders enter the window early.
4. **`mcp.priority`, `worlds.branded`** - deferred: no backend (shared MCP queue / custom
   environments) exists to gate. Build the feature first, then the gate.

Each activation is the same shape: add the gate call, flip `enforced: true`, add a gate
test mirroring `tests/forge-high-gate.test.js`, add a changelog entry. Nothing else
changes - the access endpoint and `/three` pick it up automatically.

---

## Spec: `worlds.private` (first activation)

Today worlds are **owner-based with no visibility concept**
([`api/_lib/world-store.js`](../api/_lib/world-store.js),
[`api/world/[action].js`](../api/world/[action].js)). A world's doc is readable by anyone
with its id. Making "private" a real perk means adding a visibility dimension and
enforcing it on read.

**1. Schema**: a new migration in `api/_lib/migrations/` (timestamp-prefixed, like
`20261015000000_world_gems.sql`) against the `world_docs` table from
`2026-06-01-world-docs.sql`:

```sql
ALTER TABLE world_docs ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public';
```

Thread `visibility` through `world-store.js` `saveWorld` / `loadWorld` and the returned
shape. Default `'public'` so every existing world is untouched.

**2. Create gate** - in `api/world/[action].js` `handleSave`, when a write sets
`visibility: 'private'`:

```js
const gate = await requireFeatureAccess(req, res, 'worlds.private', { body });
if (!gate.ok) return; // 402 three_hold_required (hold-only, Silver+)
```

Hold-only (no pay-per-use) - a private world is a held perk, not a per-call cost.

**3. Load enforcement** - in `handleLoad`, a `private` world's doc is returned only to its
owner (or a service-token writer); any other caller gets `403 forbidden`. This is the step
that makes the perk *real* rather than a label.

**4. Activate** - flip `enforced: true` on `worlds.private` in
[`three-access.js`](../api/_lib/three-access.js). `/three` auto-flips it to **Live**.

**5. Test** - `tests/world-private-gate.test.js`: non-holder blocked with a 402 on
private create; Silver holder allowed; private-world load forbidden to a stranger; public
worlds unaffected.

**6. UI** - a visibility toggle in the world builder, defaulting to public.

**7. Changelog** - a `feature` entry in `data/changelog.json`.

---

## Verifying the claims without buying anything

Every public statement about this system is checkable from outside, and none of the
checks require holding a token. Run them after any deploy that touches the gate:

```bash
npm run verify:three-gate                 # against https://three.ws
npm run verify:three-gate -- --no-forge   # skip the two free-lane generations
```

[`scripts/verify-three-gate.mjs`](../scripts/verify-three-gate.mjs) asserts five things
against the live site:

1. **The ladder matches what we publish.** The thresholds, discounts, and quota
   multipliers in `TIERS` are compared to the numbers used in public copy. A silent
   threshold change fails here before a holder discovers it.
2. **The deny path.** An anonymous `POST /api/forge {"tier":"high"}` and an anonymous
   Game-Ready export must return `402 three_hold_required` carrying the required tier,
   the `min_usd`, the acquire block, and the pay-per-use alternative.
3. **The allow path, read-only.** The script reads the mint's largest token accounts,
   resolves their owner wallets, and asks `GET /api/three/access?wallet=...` what each
   one is entitled to. Real wallets holding real $THREE must come back eligible. A
   balance read moves nothing and costs nothing, so the unlock side is provable
   without a purchase.
4. **The free floor.** Draft and standard generation must still be accepted with no
   account, no wallet, and no hold.
5. **Planned stays planned.** Every feature that is not wired must report
   `enforced: false`, which is exactly what draws the "Planned" flag on `/three`.
   A perk promoted to "Live" without a gate behind it fails this check.

What the script deliberately does not cover is a holder completing a High generation
end to end, because that needs an authenticated session. Use a
[comped account](../api/_lib/comp-access.js), which clears every gate with no hold, to
exercise that path; the gate treats a comp and a holder through the same
`requireFeatureAccess` branch.

Unit coverage for the same behavior lives in `tests/forge-high-gate.test.js`,
`tests/forge-gameready-gate.test.js`, `tests/three-require.test.js`, and
`tests/comp-access.test.js`.

---

## Configuration

| Env var | Required | Purpose |
|---------|----------|---------|
| `HOLDER_PASS_SECRET` | prod | HMAC key for signing/verifying tier passes |
| `FORGE_PAY_TO_KEEP` | no | `on` enables the pay-to-keep gate in `api/forge-keep.js` (default off) |
| `THREE_COMP_ACCOUNTS` | no | extra comped handles / emails / user ids, comma-separated (merged with the built-in allowlist) |
| `THREE_TOKEN_MINT` | - | $THREE mint (defaults to the canonical CA) |
| `THREE_TOKEN_DECIMALS` | - | token decimals (default 6) |
| `THREE_CREDIT_BONUS_BPS` | no | bonus credits for paying credits in $THREE, in basis points of the deposit's USD value (default 0: no bonus). Read live by `creditBonusBps()` in `api/_lib/token/config.js`; surfaced as `credit_bonus_bps` and in `/api/credits` `deposit.assets[].bonus_bps` |
| `SOLANA_RPC_URL` (+ provider keys) | - | RPC for on-chain balance reads (see `solana/connection.js`) |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | - | caches balance/tier lookups (optional, fail-safe) |

---

## Related

- [Validation](./validation.md) - the quality gate every model passes before publish.
- [Pricing catalog](../api/_lib/pricing/catalog.js) - fixed-price actions the discount applies to.
- [`/three`](../pages/three.html) - the holder-facing tier page that surfaces this ladder.
~~~~

### `marketing/three-utility-season/01-access-tiers.md` (whole file)

~~~~markdown
# Edition 01: What $THREE does this week, hold-to-access tiers

| Field | Value |
|---|---|
| Campaign id | `MKT-2026-09-THREE-ACCESS` |
| Publish date | 2026-09-18 |
| Chapter | Access |
| Audience | community and holders |
| Campaign anchor (campaigns.csv) | https://three.ws/three-token |
| Surface used in this pack | /three |
| Verified status (2026-09-16) | **Live** |

## Verification

**Substitute:** None. The copy links `/three` (the tier page) instead of the campaign anchor `/three-token` (the token overview), because the tier check happens on `/three`.

- Route: `vercel.json` maps `/three/?` to `pages/three.html`; the page is driven by `src/three-tier-page.js`.
- API: `GET https://three.ws/api/three/tier` (handler `api/three/[action].js`, ladder in `api/_lib/three-tier.js`) answered 200 on 2026-09-16 with the five-level ladder. Passing `?wallet=<address>` returned a resolved tier for a real holder wallet.
- Perk registry: `GET https://three.ws/api/three/access` (from `api/_lib/three-access.js`) reports `forge.high` and `forge.gameready` with `enforced: true`; the other five perks are `enforced: false` and the page labels them PLANNED.

## The three questions

- **What can a holder do now?** Open `/three`, connect a Solana wallet, read the tier shown, then open one LIVE perk (Forge Max at `/forge-max`).
- **Where does $THREE enter?** Nowhere is $THREE spent. The platform reads the USD value of $THREE held in the connected wallet and maps it to a tier (Member $0, Bronze $25, Silver $100, Gold $500, Genesis $2,500).
- **What verifiable result comes out?** The page shows the wallet's tier, the USD still needed for the next one, and which perks are LIVE versus PLANNED. The same resolution is readable as JSON at `/api/three/tier?wallet=`.

## Numbers and their sources

| Stable fact | Source and capture date |
|---|---|
| Tier thresholds: $25 / $100 / $500 / $2,500 held | `/api/three/tier` ladder, captured 2026-09-16 |
| Bronze perks marked LIVE: High-quality generation, Game-Ready export | `/api/three/access`, captured 2026-09-16 |
| 2 of 7 registered perks enforced | `/api/three/access` (`enforced: true` count), captured 2026-09-16 |

## Media

- File: [`images/01-access-tiers.png`](./images/01-access-tiers.png), 1600x900, captured 2026-09-16 from `/three` by `node marketing/three-utility-season/capture.mjs --only 01`.
- Alt text (required on every post):

> The three.ws $THREE Tiers page: a Connect wallet button above the tier ladder. Bronze requires $25 held and lists 5% off compute, 2x free quota, and two perks marked LIVE: high-quality generation and Game-Ready export. Silver's private worlds are marked PLANNED.

## X post

Weighted length: **174 characters** (URL counted as 23, as `scripts/post-tweet.mjs` does).

```text
Your $THREE tier on three.ws is read live from your wallet. Bronze starts at $25 held and opens High-quality Forge and Game-Ready export. Check yours: https://three.ws/three?utm_source=x&utm_medium=social&utm_campaign=mkt-2026-09-three-access&utm_content=utility-post
```

## Telegram

```text
What $THREE does this week: hold-to-access tiers.
Open three.ws/three and connect a Solana wallet. The page reads the $THREE you hold (nothing is spent) and shows your tier.
Live at Bronze ($25 held): High-quality Forge generation and Game-Ready export.
Silver and above list perks marked Planned. Those are not switched on yet, and the page says so.
https://three.ws/three?utm_source=telegram&utm_medium=community&utm_campaign=mkt-2026-09-three-access&utm_content=utility-telegram
```

## User action

Open `/three`, connect a Solana wallet, read the tier shown, then open one LIVE perk (Forge Max at `/forge-max`).

## KPI and where to read it

Tier checks and benefit uses. Read UTM sessions for `utm_campaign=mkt-2026-09-three-access` in web analytics; read tier resolutions from Cloud Run request logs for `/api/three/tier` and `/api/three/tier-pass` (`gcloud logging read 'resource.type="cloud_run_revision" resource.labels.service_name="three-ws-api" httpRequest.requestUrl:"/api/three/tier"' --freshness=7d`).

Record the 24-hour and seven-day rows in the format in [measurement.md](../growth/measurement.md).

## Posting-day checklist

- [ ] Re-open the linked surface in a clean browser and confirm it loads without errors.
- [ ] `curl -s https://three.ws/api/three/access` still shows `forge.high` and `forge.gameready` with `enforced: true`.
- [ ] The ladder thresholds in `/api/three/tier` still match the post ($25 Bronze).
- [ ] Re-run `node marketing/three-utility-season/capture.mjs --only 01` and confirm the frame shows LIVE and PLANNED badges.
- [ ] Attach the image and paste the alt text.
- [ ] Owner presses publish. Nothing in this pack posts automatically.

## Do not

- Do not list Silver, Gold, or Genesis perks as available. Five of seven are Planned.
- Do not mention the token price or what $25 of $THREE is worth in tokens.
- No price, return, urgency, or "moon" language. No hashtags, no emoji.
~~~~

