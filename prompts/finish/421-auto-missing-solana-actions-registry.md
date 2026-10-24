# 421. Create the missing `/.well-known/solana/actions.json` Solana Actions registry

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate, no owner action required.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan.
- The only permitted stops are the CLAUDE.md stop-and-ask gates (spend/on-chain writes, push/deploy, posting externally, committing content referencing a crypto project other than `$THREE`, destroying unrecoverable data). This order touches none of them: it adds one static JSON file, no wallet ever signs anything as part of this fix.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- The em-dash and en-dash characters are banned in everything you write.

## Step 0: re-derive the current state

    curl -s -o /dev/null -w "%{http_code}\n" https://three.ws/.well-known/solana/actions.json

As measured 2026-10-24, this returns `404`. Confirm the route exists in `vercel.json` expecting a static file that is not in the repo:

    grep -n "solana/actions" vercel.json
    find public/.well-known -iname "*solana*"
    git log --oneline --all -- "public/.well-known/solana/actions.json"

Expect: `vercel.json` (around line 6211) has a dedicated route `"src": "/\\.well-known/solana/actions\\.json"` with `"dest": "/.well-known/solana/actions.json"` and 5-minute cache headers; `find` returns nothing (no `solana/` subdirectory exists under `public/.well-known/`); `git log` for that exact path returns nothing (the file has never existed in this repo's history, on any branch). If any of these three no longer hold (another agent already shipped the file and the live route now returns 200), retire this order without a code change per the table below.

Confirm three.ws's own documentation already describes this file as live, which is what makes its absence a defect rather than an unbuilt feature:

    grep -n "solana/actions.json" docs/api-reference.md docs/ux-flows/12-home-and-content.md ARCHITECTURE.md

Expect three hits: `docs/api-reference.md` (~line 8376) says three.ws "publishes a Solana Action" and that this exact path "maps `/api/actions/**` for Action clients"; `docs/ux-flows/12-home-and-content.md` (~line 237) lists it as a "static" well-known response described as the "Solana Actions registry"; `ARCHITECTURE.md` (~line 3111) lists it among the `.well-known` family. The feature these docs describe was never actually shipped.

Confirm which Blinks exist today and therefore need registering:

    find api/actions -type f

Expect `api/actions/avatar.js` (the "Claim Your 3D Avatar" Blink: GET card, POST memo-claim transaction) and `api/actions/avatar-icon.js` (its icon renderer, not itself an Action). As of this order, `avatar.js` is the only shipped Action.

## Root cause and impact

The Solana Actions spec (the standard that `api/actions/avatar.js`'s own header comment implements, and that `src/agent-skills-blinks.js` consumes as a client) expects a domain that hosts Actions to publish a registry at `/.well-known/solana/actions.json` (a small object with a `rules` array mapping URL path patterns on this domain to the API paths that actually implement them). Action-aware clients and interstitial renderers (wallet extensions, X's Blink unfurling, dial.to-style action browsers) use this file to decide whether a `solana-action:` or blink URL on `three.ws` is one the domain actually vouches for. `vercel.json` was wired for this (a dedicated static-file route was added, with its own cache headers, which is deliberate authoring, not an accident) but the actual file was never written to `public/.well-known/`. The route therefore falls through to Vercel's/Cloud Run's default 404 page.

Net effect: the existing "Claim Your 3D Avatar" Blink (`api/actions/avatar.js`, already in production, already linked from avatar pages) is unverifiable by any client that checks this registry before trusting an Action link, and the two commits in `git log` that superficially match `*actions.json` in history are unrelated (confirmed in step 0: this exact path has zero history). This is a live, reproducible, user-facing gap in a shipped feature, not a new feature request.

## Task

1. Read `api/actions/avatar.js`'s header comment (lines 1-11) to confirm the one API path family that exists today: `/api/actions/avatar` (GET and POST). `api/actions/avatar-icon.js` is not an Action endpoint itself (it is the icon image the card references), so it does not get its own rule.
2. Create `public/.well-known/solana/actions.json` with the Solana Actions spec's standard `rules` shape, mapping the one path family that is actually implemented:

   ```json
   {
     "rules": [
       { "pathPattern": "/api/actions/avatar", "apiPath": "/api/actions/avatar" },
       { "pathPattern": "/api/actions/avatar?*", "apiPath": "/api/actions/avatar?*" }
     ]
   }
   ```

   Do not add a blanket `/api/actions/**` rule yet: only `avatar.js` exists, and a rule naming a path that returns 404 is itself a defect of the same shape this order fixes. If a later order (see `prompts/finish/422-auto-agent-blinks-tip-and-buy.md`, filed alongside this one) ships new Actions under `api/actions/`, that order is responsible for widening this file's `rules` array to cover them: do not pre-empt that work here with speculative entries.
3. Confirm the live route now serves this file once deployed is not something this session can force (deploy is a separate, already-tracked cadence per `prompts/finish/_context/production-100-OWNER-ACTIONS.md` row 1); instead confirm the file is well-formed and matches what the route in `vercel.json` expects to serve byte-for-byte as JSON:

       node -e "JSON.parse(require('fs').readFileSync('public/.well-known/solana/actions.json','utf8')); console.log('valid json')"

4. Grep for any existing test that already covers `.well-known` static manifests (`tests/*.test.js` with "well-known" or "wk" in the name) to see whether this new file should be added to an existing coverage list rather than getting a bespoke new test file:

       grep -rl "well-known" tests/*.test.js

   If such a test enumerates the static manifests under `public/.well-known/` (for example checking each one parses as valid JSON, or that `vercel.json` routes to a file that exists on disk), add this new file to that enumeration. If no such test exists, add a small new test, `tests/solana-actions-registry.test.js`, asserting: the file exists at `public/.well-known/solana/actions.json`, parses as JSON, has a `rules` array with at least one entry, and every entry's `pathPattern`/`apiPath` pair corresponds to a real file under `api/actions/` (derive this from `fs.existsSync` against the `api/actions/<name>.js` the path implies, so the test itself would have caught this exact defect and will catch the next one).
5. Run `npx vitest run tests/solana-actions-registry.test.js` (or the existing test you extended) and confirm it passes.
6. Run `npm run check:rules -- --paths public/.well-known/solana/actions.json tests/solana-actions-registry.test.js` and fix anything it flags.
7. Run `npm run audit:links` to confirm the new file does not introduce a broken link finding.

## Done when

- `public/.well-known/solana/actions.json` exists, is valid JSON, and declares a `rules` entry for `/api/actions/avatar`.
- A test (new or extended) asserts the file exists, parses, and every rule's `apiPath` names a real file under `api/actions/`.
- `npx vitest run` on the relevant test file passes.
- `npm run audit:links` shows no new broken/dangling entries caused by this change.
- `git diff` shows only the new JSON file plus the test (and whatever `check:rules` required).
- The fix is committed on `evolve` with an explicit-path commit.
- This file is removed, with a dated entry added to `prompts/finish/_context/production-100-PROGRESS.md` (create it with a one-line header if it does not exist) citing the fix commit SHA, and a note that the live 404 clearing is confirmed only after the next deploy (owner-gated deploy cadence already tracked elsewhere; do not add a new row for it).

## Never blocked

| Looks like a blocker | It is not | Do this |
|---|---|---|
| Another agent already shipped this file | Routine for a shared worktree | Re-run step 0's curl and `find` first; if the file already exists and is well-formed, retire this order without a code change |
| Unsure of the exact Actions spec JSON shape | The shape is simple and stable (`{"rules":[{"pathPattern":...,"apiPath":...}]}`); `api/actions/avatar.js`'s own header comment and the Action response shapes it already returns (`ActionGetResponse`/`ActionPostResponse`) confirm the vocabulary this registry speaks | Use the shape given in the task; do not invent new fields |
| Tempted to add a wildcard rule covering Actions that do not exist yet | A rule naming a 404 path is the same defect this order fixes, just moved | Register only `api/actions/avatar`; leave widening the file to whichever order ships the next Action |
| Can't verify the live route returns 200 without deploying | Deploys are a separate, already-tracked, owner-paced cadence | Verify locally (file exists, parses, matches the route's expected static path) and let the existing deploy cadence carry it to production; do not treat "not yet deployed" as incomplete work |

## Report format

State: the step-0 curl/grep/find/git-log output, the exact JSON file written, the test added or extended and its passing output, `npm run audit:links` output, and the commit SHA.
