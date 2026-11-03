# The agent resolver verifies ENS and DNS name claims in both directions and reports a trust state

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/779-plan-agent-ens-dns-claim-verification.md`.

**Priority:** P3, polish, developer experience, or exploratory (score 24 of 100 inside the tier). **Area:** agent. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

`specs/ENS_AGENT_CLAIM.md` defines a bidirectional name binding (the name's `agent` text record or `_agent.<domain>` TXT record points at the agent, and the agent card's `claims` array points back) so that "this is the official agent for example.com" is verifiable rather than an assertion in a card. The spec says the resolver "does not yet verify" claims. Today `GET /api/v1/agents/:caip` returns the card verbatim with only `modelSha256` and `cardSchema` verification, so a card can claim any name and consumers (badge component, indexers) have nothing to show.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `api/v1/agents/[...caip].js` resolves the on-chain record via `resolveOnChainAgent`, then `verifyCard(card)` returns `{ modelSha256, cardSchema }`. `grep -c claims` on the file is 0.
- `public/.well-known/3d-agent-card.schema.json` (v1.0) has no `claims` property.
- `api/_lib/env.js` already exposes `MAINNET_RPC_URL` ("for ENS resolution"); `viem` 2.57.13 is a root dependency; `api/_lib/ssrf-guard.js` exports the SSRF-safe fetch helpers needed for DNS-over-HTTPS.
- No tests cover claims. Existing nearby tests: `tests/agent-cards-service.test.js`.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
grep -n "claims" "api/v1/agents/[...caip].js" public/.well-known/3d-agent-card.schema.json
grep -n "MAINNET_RPC_URL" api/_lib/env.js
curl -s "https://three.ws/api/v1/agents/eip155:8453:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432/1" | head -c 600
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Write `api/_lib/agent-name-claims.js`: `verifyClaims(card, { chainId, registry, agentId })` returning per-claim `{ type, name, verified, state, reason?, boundAtBlock? }` where `state` is `verified` (both directions), `half_from_name` (name points at the agent, card does not list it), `half_from_agent` (card lists the name, name does not point back) or `unverified`. ENS: viem `getEnsText({ name, key: 'agent' })` on mainnet through `MAINNET_RPC_URL`, parse a comma-separated list of CAIP refs (first is canonical, compare case-insensitively on the address). DNS: TXT at `_agent.<domain>` through DNS-over-HTTPS (Cloudflare or Google JSON API) via the SSRF-safe fetch with a hard timeout; first valid `v=agent1; ref=...` record wins.
2. Time-bound and best-effort: a 3 second budget per claim, at most 4 claims verified, failures reported as `{ verified: false, reason }`, never thrown. Cache by `(name, ref)` for the same 5 minute window as the endpoint's `CACHE_HEADERS`.
3. Test-first: `tests/agent-name-claims.test.js` with an injectable resolver (the function takes `{ ensText, dnsTxt }` dependencies defaulting to the real ones) and real ref strings: both-directions match, each half-claim, mixed-case address, multi-agent comma list with the agent not first, malformed TXT, resolver timeout, and more than 4 claims. Confirm each fails before the implementation exists.
4. Wire `claims` into the response of `api/v1/agents/[...caip].js` as a new `claims` array next to `verified` (additive; existing fields unchanged), only when the card has claims.
5. Add `claims` to `public/.well-known/3d-agent-card.schema.json` as an optional property (items `{ type: enum ens|dns, name: string }`) and bump the schema to v1.1 as the spec says only once a validator runs claim verification (this order is that validator); update `specs/ENS_AGENT_CLAIM.md` (replace "does not yet verify" and "future extension" language with the shipped behavior and response example) and `specs/3D_AGENT_CARD.md` if it enumerates fields.
6. Show the state where agents are displayed: find the badge/profile renderer that consumes this endpoint (`grep -rn "api/v1/agents/" src public packages --include=*.js`) and render the trust state distinctly (verified, half-claim) with an accessible label; empty state when the card has no claims renders nothing.
7. `data/changelog.json` entry; `npm run build:pages` if the changelog page is generated.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/agent-name-claims.test.js` passes.
- [ ] `curl` of a real agent whose card has a `claims` array returns a `claims` array with a `state` per entry (use a local dev server if no production agent has claims yet, with a real ENS name that sets the record on a test name you control; otherwise cover with the unit tests and say so).
- [ ] `grep -n "does not yet verify" specs/ENS_AGENT_CLAIM.md` returns nothing.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No mainnet RPC configured locally | Use the public RPC fallback in `viem` for tests that need one, or the injectable resolver for unit tests; production already has `MAINNET_RPC_URL` |
| No real agent card claims a name | Unit tests with the injectable resolvers are the proof; do not seed fake agents in production |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/779-plan-agent-ens-dns-claim-verification.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `779-plan-agent-ens-dns-claim-verification.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `specs/ENS_AGENT_CLAIM.md` (whole file)

~~~~markdown
# ENS / DNS Agent Claim - v1

A convention for letting a domain prove it owns a three.ws (and vice versa). Bidirectional binding between human-readable names and on-chain agent identities.

## Why

ERC-8004 gives an agent a CAIP-10 reference. Humans don't memorize `eip155:8453:0x8004A169…/42`. Without a name binding, every "this is the official three.ws for example.com" claim is just an unverifiable assertion in a card.

This spec defines two records that are cheap to set, easy to verify, and require no new on-chain infrastructure.

## Forward record (name → agent)

### ENS

Set the text record `agent` on the ENS name:

```
agent = eip155:<chainId>:<registry>/<tokenId>
```

Example for `coachleo.eth`:

```
agent = eip155:8453:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432/42
```

Multiple agents: comma-separated list, first entry is canonical.

### DNS (TXT)

For domains without ENS, publish a TXT record at `_agent.<domain>`:

```
_agent.example.com.  IN  TXT  "v=agent1; ref=eip155:8453:0x8004A169.../42"
```

Resolvers MUST treat the first valid `v=agent1` record as canonical and ignore others.

## Reverse record (agent → name)

The agent card SHOULD include a `claims` array pointing at the names that claim it:

```json
"claims": [
	{ "type": "ens",  "name": "coachleo.eth" },
	{ "type": "dns",  "name": "coachleo.com" }
]
```

A claim is **verified** only when both directions match:

- forward: the name's `agent` record contains the agent's CAIP ref.
- reverse: the agent card lists the name in `claims`.

Either direction alone is **unverified**. A consumer (resolver, badge, indexer) MUST display the trust state - verified, half-claim from name, half-claim from agent - distinctly. A half-claim is a useful discovery signal but not a trust signal.

## Resolver behavior

The HTTP resolver at [`/api/v1/agents/:caip`](../api/v1/agents/[...caip].js) currently returns the on-chain agent record plus card-level verification:

```json
{
	"ref": "eip155:8453:0x…/42",
	"chainId": 8453,
	"agentId": "42",
	"registry": "0x…",
	"owner": "0x…",
	"tokenURI": "ipfs://…",
	"card": { "…": "the fetched agent card" },
	"verified": { "modelSha256": true, "cardSchema": "3d-agent-card-v1" },
	"fetchedAt": "2026-07-11T00:00:00.000Z"
}
```

Any `claims` array appears only inside `card` (verbatim from the agent card); the resolver does not yet verify it. As a future extension, the resolver SHOULD resolve the card's `claims` array and annotate each entry with a per-name `verified` flag (and a `reason` on failure), e.g. `{ "type": "ens", "name": "coachleo.eth", "verified": true }`. When implemented, verification is best-effort and time-bounded; failures are reported, not thrown.

## Adding `claims` to the v1 schema

Treat `claims` as an optional extension block (not yet in [3d-agent-card.schema.json](../public/.well-known/3d-agent-card.schema.json) v1.0). It will be promoted to v1.1 once at least one validator runs claim verification as part of the suite.

## Security notes

- A name binding is only as strong as the name's own custody. Compromise the ENS owner key → spoofed claims. Consumers SHOULD show the chain age of the binding (block of last `setText`) so a freshly-set `agent` record is treated with more skepticism.
- DNS bindings are weaker (DNS hijack vector). Treat ENS-verified above DNS-verified above unverified.
- Never auto-trust a one-sided claim. The bidirectional requirement defeats the easy attack of "I'll just put your domain in my card."

## Out of scope (v1)

- On-chain reverse resolver contract. The card-level `claims` array is sufficient until indexers want O(1) reverse lookup.
- Wildcard / subdomain claims (e.g. `*.example.com → agent`). Easy to add later.
~~~~

### `specs/3D_AGENT_CARD.md` (whole file)

~~~~markdown
# three.ws Card v1

A strict superset of the [ERC-8004 registration card](https://eips.ethereum.org/EIPS/eip-8004#registration-v1) for agents whose primary embodiment is a 3D model. This is the JSON document the ERC-721 `tokenURI` resolves to on the Identity Registry.

- **Type URI:** `https://three.ws/specs/3d-agent-card-v1`
- **JSON Schema:** [/.well-known/3d-agent-card.schema.json](../public/.well-known/3d-agent-card.schema.json)
- **Base spec:** ERC-8004 registration v1
- **Companion specs:** [AGENT_MANIFEST.md](AGENT_MANIFEST.md) (rich off-chain bundle), [REPORT_FORMAT.md](../public/validation/REPORT_FORMAT.md) (validation reports)

## Why

ERC-8004 is format-agnostic - the agent card can describe anything. That works for text/LLM agents but says nothing about 3D. Without a shared schema, every three.ws registry and viewer reinvents the same fields (model URI, hash, bounding box, license) incompatibly. v1 pins those fields so any 3D-aware consumer can:

1. Render the agent without parsing vendor-specific JSON.
2. Verify the model bytes match the card (`sha256`).
3. Surface a trust badge from a signed validation report.
4. Walk a provenance chain across versions.

## Required fields beyond ERC-8004

Only `model` is new and required. The block is intentionally small:

```json
"model": {
	"uri": "ipfs://bafy.../body.glb",
	"format": "gltf-binary",
	"sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
}
```

| Field          | Required | Notes                                                                  |
| -------------- | -------- | ---------------------------------------------------------------------- |
| `uri`          | ✓        | SHOULD be `ipfs://` - mutable URIs disqualify "trustless" claims.      |
| `format`       | ✓        | `gltf-binary` \| `gltf` \| `vrm`.                                      |
| `sha256`       | ✓        | Lowercase hex of the model bytes. Lets consumers verify independently. |
| `sizeBytes`    | -        | For load-time budgeting.                                               |
| `polygonCount` | -        | For perf/quality discovery.                                            |
| `boundingBox`  | -        | `{min:[x,y,z], max:[x,y,z]}` in meters. Lets viewers normalize scale.  |
| `license`      | -        | SPDX identifier or URL.                                                |

## Optional extension blocks

- **`manifest`** - pointer to a full [AGENT_MANIFEST](AGENT_MANIFEST.md) bundle when the agent has a brain/voice/skills.
- **`validation`** - pointer to a signed [validation report](../public/validation/REPORT_FORMAT.md).
- **`previousVersion`** - URI of the prior card. Forms a provenance chain across model updates.

## Conformance

A document conforms to three.ws Card v1 if:

1. It validates against the JSON Schema linked above.
2. Its `type` field includes both:
    - `https://eips.ethereum.org/EIPS/eip-8004#registration-v1`
    - `https://three.ws/specs/3d-agent-card-v1`
3. The bytes at `model.uri` hash to `model.sha256`.

Consumers MUST treat any document missing point 3 as unverified, regardless of validation reports.

## Minimal example

```json
{
	"type": [
		"https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
		"https://three.ws/specs/3d-agent-card-v1"
	],
	"name": "Coach Leo",
	"description": "A football coach who reviews your form.",
	"image": "ipfs://bafy.../poster.webp",
	"model": {
		"uri": "ipfs://bafy.../body.glb",
		"format": "gltf-binary",
		"sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
		"polygonCount": 48211,
		"boundingBox": { "min": [-0.4, 0, -0.3], "max": [0.4, 1.78, 0.3] },
		"license": "CC-BY-4.0"
	},
	"registrations": [
		{ "agentId": 1, "agentRegistry": "eip155:8453:0x8004A818BFB912233c491871b3d84c89A494BD9e" }
	],
	"supportedTrust": ["reputation", "validation"]
}
```
~~~~

