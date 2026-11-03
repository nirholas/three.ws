# 3D Drops mint on Solana: one Metaplex Core collection per drop, each revealed item minted into it

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/978-plan-drops-onchain-core-collection-mint.md`.

**Priority:** Gated, the last step needs an owner action or outside party (score 40 of 100 inside the tier). **Area:** drops. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

3D Drops (`/drops`) rolls a supply-capped, provably fair collection and forges each item's rigged GLB on reveal, but the collection never reaches the chain: `drops.collection_address` and `drop_items.mint_address` / `owner_wallet` / `minted_at` exist in the schema and nothing writes them. Creators have to mint each revealed item one at a time through the unrelated `mint_3d_asset` path, so a "collection" is not a collection on-chain and the product's "minted on Solana" promise (the `/drops` meta description) is not true yet. This order wires the drop-native mint on Solana. Real mainnet minting spends SOL rent and is an owner gate; everything up to that point runs on devnet.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Schema ready: `api/_lib/migrations/20260901120000_generative_drops.sql` defines `drops.collection_address` (line 43), `drop_items.mint_address`, `owner_wallet`, `minted_at` (lines 89-91) and an index on `mint_address`. No schema change is needed.
- `api/_lib/drop-store.js` only reads those columns (`mintedCountExpr` line 143, `publicDrop` line 333, `publicItem` line 354). There are no write functions for them.
- `api/drops/[action].js` routes: `list`, `get`, `items`, `verify`, `create`, `publish`, `reveal`. No mint route.
- The single-asset Core mint already exists and is production code: `mintTokenized3dAsset` and the private `mintCoreAsset` in `api/_lib/tokenize-3d.js` (umi + `@metaplex-foundation/mpl-core`, enforced Royalties plugin, authority from `api/_lib/solana-collection.js` `collectionAuthoritySigner`, durable media promotion, IPFS pin, idempotency row, signed provenance record). `docs/minted.md` documents it. It mints standalone assets, not assets inside a collection.
- Pages: `pages/drops.html`, `pages/drop-collection.html`, `pages/drop.html`; client code `src/drops.js`, `src/drop-collection.js`. Tests that exist: `tests/drops-engine.test.js` (pure engine only).
- `docs/drops.md` section "Not yet wired: minting a drop on-chain" is the stated next step.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
grep -n "collection_address\|mint_address\|owner_wallet\|minted_at" api/_lib/drop-store.js api/drops/\[action\].js
grep -n "case '" api/drops/\[action\].js
grep -n "^export" api/_lib/tokenize-3d.js api/_lib/solana-collection.js
grep -n "createCollection\|CollectionV1\|collection:" api/_lib/tokenize-3d.js api/nft/mint-scene.js api/_lib/solana-collection.js | head
ls tests | grep -i drop
npm run db:status
```

If a mint route or write functions already exist, cover only what is missing.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Test first (`tests/drops-mint.test.js`, vitest, dependency-injected like `tokenize-3d`'s `deps` pattern so no chain or R2 is touched): cases for collection creation idempotency (two calls create one collection), mint of an unrevealed item refused, mint of a revealed item records `mint_address`, `owner_wallet`, `minted_at` exactly once, a double-submit returns the same mint, a chain failure leaves the row retryable, a non-owner of the drop is refused. Write them failing first.
2. In `api/_lib/drop-store.js` add the writes: `claimCollectionCreate(dropId)`, `setCollectionAddress(dropId, address, network)`, `claimItemForMint(dropId, idx)` (atomic `update ... where mint_address is null and status='revealed'` so concurrent calls cannot double mint), `markItemMinted(dropId, idx, { mint, ownerWallet, signature, network })`, `releaseItemMintClaim`. If a `network` column or mint signature column is needed, add one migration under `api/_lib/migrations/` (run `npm run db:status` first; `npm run db:migrate` applies immediately with no dry run).
3. In `api/_lib/tokenize-3d.js` (or a new `api/_lib/drop-mint.js` that imports its helpers rather than duplicating them; `promoteToDurableStorage`, `uploadMetadataJson` and `mintCoreAsset` are module-private today, so export them) add: `createDropCollection({ drop, network })` using `createCollection` from `@metaplex-foundation/mpl-core` with the collection's name, symbol, a metadata JSON built from the drop (name, symbol, description, seed commitment and `provenance_hash` from `api/_lib/drops.js`, count) pinned the same way `uploadMetadataJson` does it; and `mintDropItem({ drop, item, ownerWallet, network })` which reuses `promoteToDurableStorage`, metadata building and the Royalties plugin, passes `collection` to `create(...)`, and puts the item's traits (from `item.traits`) and rarity tier/rank in the metadata `attributes`. The collection authority stays the three.ws collection authority (same model as `mint_3d_asset`: holder owns the asset, platform pays rent and is update authority).
4. Routes in `api/drops/[action].js`: `POST /api/drops/mint-collection` (`{slug, network}`, drop owner only, drop must be `live`, devnet default) and `POST /api/drops/mint` (`{slug, index, owner_wallet?, network}`, drop owner or the item's recipient as designed in task 5), plus `GET /api/drops/mint?slug=&index=` for state. Same auth and rate-limit conventions as the existing routes (session cookie or bearer with `avatars:write`). Mainnet requests are gated by the same payment and confirmation mechanism `mint_3d_asset` uses (credits or x402, whichever that tool uses today: read `api/_mcp/tools/solana.js` / the 3D Studio MCP tool and reuse it, do not invent a second price). The response states plainly that mainnet is a real on-chain write.
5. Recipient model: the creator mints revealed items to a wallet they choose (default: their linked Solana wallet). A batch action "Mint all revealed" processes items in bounded chunks via the claim functions in task 2 so a timeout can resume; surface per-item state `sealed | revealed | minting | minted | failed`.
6. UI: on `pages/drop-collection.html` / `src/drop-collection.js` add a "Put on Solana" panel for the owner (create collection, then mint item / mint all revealed), with a devnet/mainnet toggle defaulting to devnet, the cost shown before any mainnet action, skeleton loading, an empty state ("Reveal items first"), actionable error text, and hover/focus/active states. Minted items show a Solscan link and a "minted" badge on cards in `pages/drop.html`. Add the new strings as `data-i18n` keys the same way `drops.cta_minted` is used in `pages/drops.html`; the dictionaries live in `public/locales/*.json` (find the English source with `grep -n cta_minted public/locales/en.json`) and `src/i18n.js` loads them.
7. Surface minted drop items in `/minted` (`GET /api/v1/tokenized/launches`) by recording each drop mint as a launch row the same way `mintTokenized3dAsset` does, with the collection address attached, so the gallery needs no special case.
8. Verification against devnet only: with the devnet collection authority funded from the devnet faucet (`solana airdrop` / RPC `requestAirdrop`), run a real end-to-end on devnet: create a drop with supply 3, reveal two items, create the collection, mint both, read them back through a Solana RPC (`getAsset`/DAS or `fetchAsset`) and confirm collection membership and owner. Record the transaction signatures in the report.
9. Docs: rewrite the "Not yet wired" section of `docs/drops.md` into a "Minting on Solana" section with the new routes in the API table; `docs/minted.md` cross-link; `data/changelog.json` entry; `npm run build:pages` if `data/pages.json` text changes.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/drops-mint.test.js tests/drops-engine.test.js` passes.
- [ ] Devnet end-to-end transcript in the report: collection address, two item mint addresses, and a chain read confirming each asset's `collection` field equals the drop's `collection_address`.
- [ ] `curl -s 'https://three.ws/api/drops/get?slug=<devnet drop>'` (after deploy by the owner) or the local equivalent shows `collection_address` populated and a nonzero minted count.
- [ ] Re-running the mint call for an already minted item returns the same `mint_address` and sends no transaction (assert in the test and observe once on devnet).
- [ ] `docs/drops.md` no longer contains "Not yet wired".
- [ ] Browser check of the panel on `/drop-collection` with devnet: skeleton, empty, error (kill the RPC URL env to see it), success.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Collection authority key not loadable locally (`loadCollectionAuthorityKeypair`) | Generate a throwaway devnet keypair file, point the env var the module reads at it, airdrop devnet SOL. Never use the production key for tests. |
| Devnet faucet rate-limited | Use the alternative RPC faucets or the project's existing devnet funding script (`grep -rn requestAirdrop scripts/`), or retry later in the same session while doing the UI work. |
| `mpl-core` `create` with `collection` needs the collection authority as signer | The collection is created by the same authority signer, so pass it as `collection` plus the authority as the update-authority signer; see the mpl-core docs `create({ collection })`. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

The only gate is real mainnet minting: creating the production Core collection and minting any item on mainnet spends SOL rent and is irreversible. All code, tests, UI and devnet verification complete without it. At the end, batch one message to the owner showing network, collection name, expected rent cost, and the exact one-line command or UI action to run the mainnet collection creation, and stop for an explicit yes.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/978-plan-drops-onchain-core-collection-mint.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `978-plan-drops-onchain-core-collection-mint.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/drops.md` (whole file)

~~~~markdown
# 3D Drops: generative collections of rigged characters

[three.ws/drops](https://three.ws/drops) is the collection launcher. You give it
a base style and a set of weighted trait layers; it rolls a supply-capped
collection where every item is a real, rigged, animation-ready 3D character, its
rarity is recomputable by anyone holding the spec, and its art is forged on
reveal instead of bulk-rendered up front.

The reference points are the 3D PFP collections: a studio hand-models a base
mesh plus dozens of trait meshes, a compositor assembles ten thousand
combinations, and the whole thing takes a year and a half. This is that product
without the studio. The part that was expensive (making the art) is a generation
job; the part that was hand-waved (proving the roll was fair) is a published
commitment anyone can check.

Related surfaces: [Minted 3D Assets](minted.md) for one-off Metaplex Core mints,
[the Forge](forge.md) for the text-to-3D pipeline every reveal runs on, and
[the avatar gallery](../public/gallery/index.html) at `/gallery` for individual
avatars.

## The idea in one paragraph

A drop stores its **spec**, not its art. Every item's traits come from three
inputs and nothing else: the drop's `seed`, the item's `index`, and the trait
layers. That makes the whole supply a pure function, which buys two things. A
holder can recompute the entire collection from the published spec and check it
against what the site served them, so "we did not re-roll the rares into our own
wallet" becomes a checkable claim rather than a promise. And the platform can
re-forge a lost model years later without ever having stored a per-item random
state.

## Launching a collection

Open [/drops](https://three.ws/drops), sign in, and press **Launch a
collection**. You supply:

- **Name and symbol.** The symbol is 2 to 10 letters or digits, shown on cards.
- **Supply.** 1 to 10,000. The roll is instant and free at any size, because no
  art is generated at this step.
- **Base style.** The look every item shares, for example
  `stylized matte-clay guardian creature, soft rim light, chunky proportions`.
- **Trait layers.** Each layer (Species, Outfit, Aura) has options with relative
  weights. The builder shows each option's resulting share as you type. An
  option can carry its own prompt fragment when the trait's display name is not
  what you want fed to the generator: the value `Bomber jacket` can generate
  from `wearing a worn leather bomber jacket`. A drop takes at most 12 layers
  and 64 options per layer.

Submitting rolls the supply and lands you on the collection page. The drop
starts as a **draft**: its seed is withheld, so the provenance hash it publishes
is a commitment rather than a description. Pressing **Publish** freezes the spec
and reveals the seed. That is one-way, on purpose: after the seed is out,
editing the spec would invalidate every rarity claim the collection has already
made.

### From an agent or a script

```bash
curl -X POST https://three.ws/api/drops/create \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <token with avatars:write>' \
  -d '{
    "name": "Clay Wardens",
    "symbol": "WARDEN",
    "style": "stylized matte-clay guardian creature, soft rim light",
    "supply": 250,
    "layers": [
      {"name": "Species", "options": [
        {"value": "Fox", "weight": 60},
        {"value": "Wolf", "weight": 30},
        {"value": "Dragon", "weight": 10}
      ]},
      {"name": "Outfit", "options": [
        {"value": "Bomber jacket", "weight": 50, "prompt": "wearing a worn leather bomber jacket"},
        {"value": "Lab coat", "weight": 50}
      ]},
      {"name": "Aura", "options": ["None", "Ember", "Frost"]}
    ]
  }'
```

A layer's options may be bare strings, in which case each weighs 1 and its value
doubles as its prompt fragment. Optional body fields are `description`,
`visibility` (`public` by default, or `unlisted` / `private`) and `seed`. The
`201` response wraps the collection in `drop`, which carries the `slug`, the
`provenance_hash`, and (for the creator) the `seed`.

## How rarity is computed

Rarity is scored from the **actual rolled distribution**, not from the declared
weights. Those two always diverge on a finite supply, and the honest number is
the one a holder can recount from the published items.

Each item's score is the sum over its traits of `supply / (how many items share
that trait value)`. A value held by 1 item in 1000 contributes 1000; one held by
half the supply contributes 2. Summing rather than multiplying keeps a single
ultra-rare trait from swamping every other signal in the collection.

Items are then ranked (ties broken by index, so the ordering is total and
reproducible) and bucketed into the same four tiers the rest of the platform
uses for cosmetics:

| Tier | Top percentile of the ranking |
|---|---|
| `legendary` | 1% |
| `epic` | 10% |
| `rare` | 35% |
| `common` | the rest |

## Reveal: art is forged per item

A freshly rolled item is **sealed**. Its traits are already public and its rank
is already fixed; only the art is unforged. Pressing **Reveal this item** on the
collection page (a draft must be published first, otherwise `409 not_published`)
composes the item's prompt (the base style, then each rolled trait's prompt
fragment in layer order, then the hints that keep the output riggable) and
submits it to [the Forge](forge.md). The page then polls until the GLB lands.

Ordering the fragments by layer is what holds a collection together visually: a
given trait always occupies the same position in the prompt, so the generator's
output stays coherent across the supply instead of drifting item to item.

Reveal states are `sealed`, `revealing`, `revealed`, and `failed`. A failed
reveal keeps its error and is retryable from the same button. Claiming an item
for reveal is a conditional database update, so a double-clicked button cannot
start two paid generation jobs for the same token, and a claim that never comes
back is released to `sealed` by the next poll once it is fifteen minutes old,
rather than needing a sweeper cron. The button reads **Retry reveal** after a
failure.

Because every item is generated as a full-body character in a neutral A-pose, it
inherits the platform's universal animation retarget: any revealed item drives
the pre-baked clip library through
[`src/glb-canonicalize.js`](../src/glb-canonicalize.js), and can be exported as
GLB, VRM 1.0, or USDZ through [`src/avatar-export.js`](../src/avatar-export.js).

## Verifying a roll

The **Verify this roll** button on every collection page calls:

<!-- runnable: 404 clay-wardens is an example slug; a live collection answers 200 -->
```bash
curl "https://three.ws/api/drops/verify?slug=clay-wardens&index=7"
```

The response re-derives the provenance hash from the stored spec and, when an
`index` is given, re-rolls that item through the same pure function a third
party would:

```json
{
  "slug": "clay-wardens",
  "seed": "ff65b26d-d3c5-4a1b-90ed-82c132b7bd7d",
  "supply": 120,
  "published_hash": "94c97a50...",
  "recomputed_hash": "94c97a50...",
  "hash_matches": true,
  "item": {
    "index": 7,
    "served_traits": [{"layer": "species", "value": "Dragon"}],
    "recomputed_traits": [{"layer": "species", "value": "Dragon"}],
    "traits_match": true
  }
}
```

You do not have to trust the endpoint. The hash is a sha256 over the canonical
JSON of `{version, seed, supply, style, layers}` with keys sorted recursively,
and each trait is a weighted pick against `draw(seed + "#" + index, layerKey)`
from [`api/_lib/genome.js`](../api/_lib/genome.js). Both are reimplementable in
any language from [`api/_lib/drops.js`](../api/_lib/drops.js).

One consequence worth knowing: because each layer draws from its own stream
keyed by the layer's slug, adding a layer to a draft does not perturb the values
already rolled on the layers beside it, and reordering the layer array changes
nothing at all.

## Not yet wired: minting a drop on-chain

The schema carries `drops.collection_address` and the per-item `mint_address` /
`owner_wallet` / `minted_at` columns, but nothing writes them yet: there is no
endpoint that anchors a collection as a Metaplex Core collection or mints an
item into it. Revealed items are real, exportable GLBs that a creator can mint
one at a time through the existing [Minted 3D Assets](minted.md) path today.
Wiring a drop-native mint (one Core collection per drop, each revealed item
minted into it) is the next step, and the columns are there so it does not need
a schema change.

## API reference

All routes live under `/api/drops/`. Reads are public and rate-limited by IP;
writes need a session cookie or a bearer token with `avatars:write`.

| Method | Route | What it does |
|---|---|---|
| `GET` | `/api/drops/list?limit=&before=&mine=1` | Public collections, newest first. `mine=1` lists your own, drafts included. |
| `GET` | `/api/drops/get?slug=` | One collection with its stats, trait distribution, and first page of items. |
| `GET` | `/api/drops/items?slug=&limit=&offset=&tier=&status=&sort=` | Paginated items. `sort` is `rank` (default) or `index`. |
| `GET` | `/api/drops/verify?slug=&index=` | Recompute the provenance hash, and optionally one item's traits. |
| `POST` | `/api/drops/create` | Roll a new collection. Body as shown above. |
| `POST` | `/api/drops/publish` | Freeze a draft and publish its seed. Body `{slug}`. |
| `POST` | `/api/drops/reveal` | Start one item's generation. Body `{slug, index}`. |
| `GET` | `/api/drops/reveal?slug=&index=` | Poll an in-flight reveal. One upstream check per call. |

A deployment with no database answers `503 not_configured` on every route; the
rest of the platform is unaffected.

## Where the code lives

| Piece | File |
|---|---|
| Trait, rarity, and provenance engine (pure) | [api/_lib/drops.js](../api/_lib/drops.js) |
| Persistence and the reveal state machine | [api/_lib/drop-store.js](../api/_lib/drop-store.js) |
| HTTP routes | [api/drops/[action].js](../api/drops/%5Baction%5D.js) |
| Schema | [api/_lib/migrations/20260901120000_generative_drops.sql](../api/_lib/migrations/20260901120000_generative_drops.sql) |
| Index page and launcher | [pages/drops.html](../pages/drops.html), [src/drops.js](../src/drops.js) |
| Collection page | [pages/drop-collection.html](../pages/drop-collection.html), [src/drop-collection.js](../src/drop-collection.js) |
| Shared styles | [src/drops.css](../src/drops.css) |
| Engine tests | [tests/drops-engine.test.js](../tests/drops-engine.test.js) |

Note that `/drops/:slug` (a collection) and `/drop/:id` (the unrelated sealed
wallet gift claim page) are different surfaces. The routes are declared so they
can never shadow each other.
~~~~

### `docs/minted.md` (whole file)

~~~~markdown
# Minted 3D Assets: the public gallery of on-chain avatars

[three.ws/minted](https://three.ws/minted) is the live, public gallery of every generated or owned avatar that a creator chose to mint as a **Metaplex Core NFT** through three.ws. It is the NFT counterpart of the `/launches` coin directory: real on-chain property, listed the moment it mints. Every card renders the actual model in a live, auto-rotating 3D viewer (not a flat thumbnail), and every asset carries baked provenance and an enforced, capped creator royalty. Minting is always opt-in: the free text-to-3D lane never mints anything on its own.

This doc covers the gallery surface and the mint flow as a user-facing feature. The provenance internals live in their own docs: [content credentials for AI-generated models](provenance.md) (signed credentials, Solana anchoring, the free verify endpoint) and [the three.ws mint mark](mint-mark.md) (the `3ws` address branding on coin launches).

## The gallery

Open [/minted](https://three.ws/minted) with no account and no wallet. What you get:

- **A live 3D card per mint.** Each card is a `<model-viewer>` streaming the asset's GLB, slowly rotating, with the rendered thumbnail as its loading poster. Clicking the model opens it in the full interactive viewer.
- **Royalty chip.** The enforced on-chain creator royalty, as a percentage, on every card.
- **Remix badges.** An asset that names a `parent_mint` (a derivative of another creator's mint) is tagged `remix`; if the parent creator's royalty was actually paid out of the mint fee, the badge upgrades to `remix · royalty paid`.
- **Prompt line.** When the mint carries a generation prompt in its provenance, the card quotes it.
- **Mint link.** Every card links its mint address to Solscan (devnet assets link to the devnet cluster view).
- **Network toggle.** Mainnet is the default feed; a tab switches to devnet, where free test mints land.
- **Counters.** Assets on the page, average royalty, remixes with a paid-out royalty, and the selected network.
- **Continuous feed.** The grid paginates automatically as you scroll, and the top of the feed refreshes every 30 seconds while the tab is visible, so fresh mints appear without a reload.

An empty network shows an honest empty state pointing you at `/forge` to generate a model and at Agent Identity Studio to mint one. There are no synthetic entries.

### The feed API

The gallery reads a free, public, paginated endpoint that anyone (or any agent) can use:

```bash
curl "https://three.ws/api/v1/tokenized/launches?network=mainnet&offset=0&limit=24"
```

- Optional `agent_id=<uuid>` filters to one agent's mints.
- `limit` caps at 100; responses carry `has_more` for pagination.
- Rate-limited to 60 requests/min per IP, with a 15-second CDN cache so polling agents stay current without hammering the database.
- Like every `/api/v1` endpoint, the payload is wrapped in `{ "data": ... }` and the endpoint is discoverable via `GET /api/v1`.

## How a mint works

Minting runs through the `mint_3d_asset` tool on the [3D Studio MCP server](mcp.md). It is priced per call via x402 (USDC); an OAuth bearer token bypasses payment. A creator supplies:

- **The model:** an owned `avatar_id`, or any absolute `glb_url`.
- **The recipient:** an explicit `owner_wallet` (base58), or the OAuth-linked Solana wallet by default.
- **Royalty terms:** `seller_fee_basis_points`, hard-capped at 10% (1000 bps; a higher request is clamped and the response says so), and an optional `royalty_recipient` (defaults to the owner).
- **The network:** `devnet` by default for free testing; `mainnet` is explicit and is a real, disclosed on-chain write.
- **Optional lineage and provenance:** `parent_mint` (this is a remix), plus `prompt`, `generation_model`, and `generation_provider` overrides.

The server then:

1. **Claims an idempotency row before touching the chain.** Repeating a call for the same asset returns the same mint instead of minting twice; a failed attempt can be retried under the same key.
2. **Promotes the media to durable storage.** The GLB and a freshly rendered thumbnail are copied to a permanent first-party key (the NFT media never moves, even if the source avatar is later deleted), and pinned to IPFS when a pinning provider is configured (best-effort; a pin failure never fails the mint).
3. **Builds Metaplex-compliant metadata** with the GLB under `animation_url`, so wallets and marketplaces that render glTF show the live model, and everything else falls back to the rendered image.
4. **Mints the Core asset with an enforced Royalties plugin.** The recipient wallet owns the asset outright; the three.ws collection authority pays the rent and holds update authority (so the platform can curate on-chain metadata, but never move or take the asset).
5. **Records the launch** so the asset appears on `/minted` and in the feed API, with explorer and viewer links in the response.

### Baked provenance

Every mint carries its provenance twice:

- **In the NFT metadata itself:** creator, prompt, generation model and provider, parent lineage, and timestamp travel with the asset wherever it goes.
- **As a signed record on the platform's append-only agent-actions ledger** (when the source avatar has a provisioned agent to sign as): an independently verifiable entry, referenced in the mint response and queryable via the MCP action tools. This write is best-effort and never blocks a mint that already succeeded on-chain.

For how signed credentials, canonical hashing, and on-chain anchoring work under the hood, read [provenance.md](provenance.md). For the `3ws` address mark that brands coin launches, read [mint-mark.md](mint-mark.md).

### Remix royalties: paid the moment a remix mints

Naming another creator's mint as `parent_mint` makes your mint a remix, and that lineage is durable in both the metadata and the launch record. On mainnet, when a real per-call x402 fee was collected for the mint, the parent creator's royalty slice is routed out of that fee as a **real on-chain USDC transfer the moment the mint confirms**, and the settlement (amount, recipient, transaction) comes back in the mint response and shows on the gallery card.

Every non-paying outcome is reported with an honest reason rather than a fake "pending": devnet mints record lineage but settle nothing (the payout wallet holds real mainnet funds only), an OAuth-bypassed call collected no fee to split, a split can fall below the dust floor, or the parent may have no royalty wallet.

## Reading a mint back

The companion MCP tool `get_3d_asset_onchain` resolves any Core mint address to its live state: the current holder and enforced royalty terms read from the chain (authoritative over the platform record), the baked provenance, the GLB and viewer link with a liveness check, and, for assets minted through three.ws, the platform launch record and any remix settlement. It works on any Metaplex Core mint, not just ours.

## Related

- [Verifiable 3D provenance](provenance.md): signed content credentials and free verification for generated models
- [The three.ws mint mark](mint-mark.md): the `3ws` address brand on coin launches
- [MCP servers](mcp.md): the `mint_3d_asset` and `get_3d_asset_onchain` tools
- [Custody you can verify](custody.md): the wallet rails behind agent-held assets
~~~~

