# Guard wiring: which checks actually run, and which never did

An unwired guard is not a guard.

`scripts/check-gcloudignore.mjs` was written to catch exactly one failure: `.gcloudignore`
is an allowlist and never re-included `services/`, so two modules `server/index.mjs` imports
at load time were absent from the image. The guard's own commit message said it "fails before
a build instead of in production". It was referenced by no npm script, nothing ran it, and on
2026-09-04 production answered `/api/healthz`, `/api/wk`, `/api/x402-pay` and every
`/api/home/*` route with a 500 for roughly thirteen hours. Nothing was red, because a missing
re-include is not a build error, it is a runtime one.

That guard is now wired into `gate` and `deploy:gcp:submit`, pinned by
[tests/gcloudignore-wiring.test.js](../../tests/gcloudignore-wiring.test.js). Auditing the
rest of the repo found the same shape 42 more times. This file is the classification of every
one of them: what it checks, what it measured, and where it belongs.

## How to re-derive the list

```bash
node -e "
const s=require('./package.json').scripts, all=Object.keys(s);
const bodies=all.map(k=>s[k]).join(' && ');
const guards=all.filter(k=>/^(check|audit):/.test(k));
const unwired=guards.filter(k=>!new RegExp('npm run '+k.replace(/[:.]/g,'\\\\\$&')+'(\\\\s|\$|&)').test(bodies));
console.log(guards.length+' guards, '+unwired.length+' unwired'); unwired.forEach(u=>console.log('  '+u));
"
```

Measured 2026-09-04: 73 guards, 39 unwired. Measured 2026-09-08 after this pass: 80 guards,
35 unwired, and every one of the 35 has a row below.
[tests/guard-wiring.test.js](../../tests/guard-wiring.test.js) fails if a guard drops off
`gate` or off the deploy path, and fails if a newly unwired guard has no row here.

## The rule for `gate`

`npm run gate` is on the deploy path for every agent in this worktree. A guard earns a place
in it only when all four hold:

1. **Green.** A red guard in `gate` blocks everyone's work, including concurrent sessions.
2. **Repo-only.** No network, no browser, no credential, no live database. A guard that reads
   production measures production, and production drifts for reasons a diff cannot fix.
3. **Fast.** Roughly 15 seconds or less, measured solo on this machine.
4. **Deterministic.** The same worktree gives the same answer. A guard that compares against a
   gitignored artifact, or against live infrastructure, does not.

Anything failing (2), (3) or (4) is not a lesser guard, it is a different kind of guard: it
belongs on the deploy path, in `npm test`, or in an operator's hands.

## Wired in this pass

| Guard | What it checks | Exit | Runtime | Wired into |
|---|---|---|---|---|
| `check:announce` | Every announcement pack clears the media, length and shape rules before it is published | 0 | 3.5s | `gate` |
| `check:skills-seed` | `data/skills/seed.json` still matches the SKILL.md files it mirrors | 0 | 3.7s | `gate` |
| `audit:motion` | `public/animations/signatures.json` still matches the baked clips it indexes | 0 | 2.4s | `gate` |
| `audit:tour-global` | The committed `public/tour-builder/tour.global.js` matches a fresh build of the SDK in this repo | 0 | 4.4s | `gate` |
| `check:doc-media` | Every doc figure exists, matches its manifest hash, has alt text, and is actually embedded by the doc that claims it | 0 | 6.3s | `gate` |
| `check:images` | Every JS-rendered `<img>` in `src/` declares a `loading` attribute | 0 | 10.6s | `gate` |
| `audit:route-shadowing` | No `api/**` handler is unreachable behind a broader route rule | 0 | 9.3s | `gate` |
| `audit:deploy` | Committed symlinks, unsatisfied peers, undeclared api imports, and the Draco/KTX2 decoder assets in `dist/` | 0 | 5.2s | `deploy:gcp:submit` |

`audit:deploy` is the one that is not a `gate` guard despite being green, repo-only and fast.
Three of its four checks are already covered by
[tests/deploy-artifacts.test.js](../../tests/deploy-artifacts.test.js), which imports the same
functions, so `npm test` runs them. The fourth, `findMissingDistAssets()`, returns
`{ skipped: true }` whenever `dist/` is absent, which is always true in vitest and always true
in `gate`. It only means anything after a build, so it is wired into `deploy:gcp:submit` ahead
of the upload, where a missing decoder asset (the /scene Draco outage) is still cheap to fix.

## Reds fixed in this pass

| Guard | Finding | Fix |
|---|---|---|
| `audit:tour-global` | The CDN bundle served at `/tour-builder` was built against an older walk-sdk than the repo | Rebuilt and committed |
| `check:images` | 3 `<img>` tags with no `loading` attribute (certificate poster, companion fallback face, print-insert QR) | All three are the primary visible content, so `loading="eager" decoding="async"` |
| `audit:route-shadowing` | `GET /api/agents/vitals`, documented in `docs/agent-vitals.md` and announced in the changelog, resolved to `api/agents/[id].js` instead of its own handler | Explicit `vercel.json` rule above the `/api/agents/([^/]+)` catch-all |
| `check:doc-media` | 30 problems: `scene-studio` never captured, and 29 `usedBy` claims naming docs that embedded no figure at all | Captured `scene-studio`; embedded all 20 figures with their alt text and captions in the 27 docs that claimed them |
| `check:runnable-docs` | 8 documented curl samples no longer answered as documented | 7 declared their real contract (`<!-- runnable: 401 ... -->` for the two session-gated calls, `404`/`400` for the five illustrative ids and placeholders). The eighth is a deploy lag, below. |

## Still unwired, with the reason

Every row below was measured, not inferred from the script's name. Runtimes are wall clock on
this machine; the browser sweeps were capped where noted.

### Measures live production, not the repo

These fail whenever work has landed but not yet deployed, so they can never gate a commit.
They belong to an operator, or to a post-deploy check.

| Guard | What it checks | Exit | Runtime | Verdict |
|---|---|---|---|---|
| `check:runnable-docs` | Executes every runnable sample in `docs/` against the live API | 1 | 15s | **manual (post-deploy).** One finding left: `/api/v1/hood-portfolios/universe` 404s because `api/v1/hood-portfolios/universe.js` landed 2026-09-07 and production runs the 2026-09-05 image. Declaring `404` would be wrong the moment it deploys. Re-run after the next deploy. |
| `audit:seo` | Titles, descriptions, canonicals and sitemap agreement, fetched as Googlebot | 0 | 17.2s | **manual (post-deploy).** Fetches `https://three.ws`. |
| `audit:ibm-hosted` | The IBM-hosted page against a local publisher plus live three.ws | 1 | 15.7s | **manual.** Its 6 findings are all CORS refusals of `https://three.ws/*.js` from a `127.0.0.1` publisher origin, which is the harness's origin, not a page defect. Needs the real IBM origin to mean anything. |
| `audit:mcp-reviewer` | Drives the published stdio MCP server the way a Connectors reviewer's host does | 0 | 11.7s | **manual (pre-submission).** Spawns the published server and hits live x402 endpoints; run before a directory submission. |
| `check:cron-drift` | vercel.json `crons` against what Cloud Scheduler is really running | 0 | 3.5s | **manual (needs live gcloud).** Owned by [905-fix-queue-03](../../prompts/finish/905-fix-queue-03-cron-drift-garment-sweep.md). |
| `audit:cron-liveness` | Every cron handler resolves through the real route table, loads, and runs | 0 | 19.6s | **manual.** Boots a server and probes each job. |
| `audit:cron-liveness:static` | The same, static resolution only, no server and no probe | 0 | 23.5s | **manual.** Repo-only and green, but 23.5s is too slow for `gate` and it imports every cron handler at module scope. |
| `audit:llm-metering` | Whether any lane that spends money reports exactly $0 | 0 | 1.7s | **manual (ops).** Reads `usage_events` from the live database; its answer is about production spend, not about the diff. |
| `check:erc7710` | Every `DELEGATION_MANAGER_DEPLOYMENTS` address is a deployed contract | 0 | 3.0s | **manual.** `eth_getCode` against public RPCs; a third-party RPC outage would read as a red gate. |
| `check:evm-rpc` | Every EVM RPC endpoint answers a keyless server-side POST, in priority order | 0 | 8.6s | **manual (ops).** Network by definition. |
| `audit:deps` | The Python workers' pinned deps against the OSV vulnerability database | 1 | 16.6s | **manual (security sweep).** 285 advisories across 17 pinned versions, mostly `transformers` (two are RCE, fixed in 5.0.0 and 5.3.0). Each fix is a pin bump plus a worker image rebuild, which is its own piece of work, not a gate. |
| `audit:upstreams:map` | Not a guard: `--map` regenerates `docs/resilience.md` | 0 | 38.6s | **manual (generator).** The guard half, `audit:upstreams`, is already in `gate`. |

### Needs a credential this box does not hold

| Guard | What it checks | Exit | Runtime | Verdict |
|---|---|---|---|---|
| `audit:custodial-keys` | How much SOL sits behind a secret we can no longer decrypt | 3 | 1.1s | **manual.** Aborts without `WALLET_ENCRYPTION_KEY`, deliberately: without it every wallet would report undecryptable and the run would prove nothing. Read it with `node scripts/read-service-env.mjs '^WALLET_ENCRYPTION_KEY$' --raw`. |
| `audit:home-credentials` | Whether connected homes are still reachable, or sealed by a key rotation | 3 | 1.1s | **manual.** Same key, same deliberate abort. |
| `audit:wallet-flows` | Where the platform's SOL is and where it has been going | 1 | 1.7s | **manual.** Exits on no Solana RPC configured; needs `SOLANA_RPC_FALLBACK_URLS` or `QUICKNODE_RPC_URL`. |
| `audit:service-wallets` | Every service wallet's pubkey, balance, SOL floor, and advertised fee-payer | 0 | 2.3s | **manual.** Runs, but a local `.env` carries a subset of the signer secrets, so most rows read UNCONFIGURED. Green here does not mean green in production. |
| `check:relayer-balances` | Every decodable relayer signer against its documented minimum | 0 | 1.4s | **manual.** Same subset problem. |
| `audit:rig-coverage` | Which real stored avatars the bone-name canonicalizer actually maps | 1 | 0.8s | **manual.** Requires `S3_PUBLIC_DOMAIN`; reads the live avatar library. |
| `audit:web:provision` | Creates the QA account the authed sweeps need, through the real `/register` page | not run | n/a | **manual, deliberately not measured.** It registers a real production account. Running it to measure it would create one. Documented in [page-audit.md](page-audit.md). |

### Needs a browser, and minutes

None of these can gate a commit: they drive real Chromium/WebKit across many routes and
viewports. They are pre-event, pre-release and incident tools.

| Guard | What it checks | Exit | Runtime | Verdict |
|---|---|---|---|---|
| `audit:console` | Console errors, page errors and failed requests on every route in `data/pages.json`, desktop and mobile | capped | >600s (796 route-viewport pairs) | **manual (pre-release).** |
| `audit:web` / `audit:web:login` | The full authed page sweep: console, network, layout | capped | >600s | **manual.** See [page-audit.md](page-audit.md). |
| `audit:a11y` | Playwright accessibility pass over the top pages | capped | >600s | **manual.** A second `playwright test` run also fights the shared dev server on :3000. |
| `audit:overlays` | That no floating widget covers another, across routes and viewports | capped | >240s | **manual.** |
| `audit:mobile-touch` | Live computed touch-target sizes and spacing in a Pixel 5 context | capped | >240s | **manual.** |
| `audit:play-failures` | /play under deliberate failure injection (dead GLB, 500 on nonce, hostile query strings) | capped | >240s | **manual.** |
| `audit:meetup` | The /play live-event layer end to end | capped | >240s | **manual (pre-event).** Needs `npm run dev` **and** `npm run dev:walk-all`, per its header. |
| `audit:csp` | Every CSP violation in a real browser | 2 | 6.0s | **manual (post-build).** Defaults to `127.0.0.1:8099`; it reported "25 of 25 pages never loaded, so this run proves nothing", which is the honest answer with nothing serving a built `dist/` there. Run it as `npm run audit:csp -- --base https://three.ws`. |
| `check:home-voice` | The hands-free voice loop: wake word, barge-in, self-trigger, confirmation guards | 2 | 11.2s | **manual.** Starts its own server and drives real speech lanes. |
| `audit:garments` | Every wardrobe garment: manifest validation, GLB hash, attach, walk-gait deviation | 1 | 133s | **manual.** Real finding: 1 hard failure and 4 review flags out of 59. Owned by [905-fix-queue-03](../../prompts/finish/905-fix-queue-03-cron-drift-garment-sweep.md). |
| `check:glb:payload` | The mobile payload budget for a high-resolution GLB, loaded under WebKit and Android Chrome | 1 | 17.4s | **manual.** Its script is currently untracked working-tree work belonging to another session; the run dies on `ENOENT` writing `public/_payload-check/`, which that session owns. |

### Deterministic problems, deliberately not gated

| Guard | What it checks | Exit | Runtime | Verdict |
|---|---|---|---|---|
| `check:docs-search` | The docs search index against `docs/**/*.md` | 1 | 11.6s | **manual (local convenience).** `public/docs-search-index.json` is gitignored on purpose (~2 MB, rewritten by every docs edit) and regenerated by `prebuild` and `postinstall`, so the shipped copy is never stale and there is nothing to commit. Its error message used to say "commit the result", which was impossible; that message is fixed. In this shared worktree it also flips red within seconds of a peer editing a doc. |
| `check:docs-freshness` | Whether a doc's prose still matches the code it names | 1 | 10.2s | **not wired: red, and the fix is large.** Over the `data/docs-freshness-budget.json` budget by 70 docs. Wiring it would block every agent on someone else's stale doc. Refresh with `npm run docs:freshness -- --doc <path>`, or raise `maxStale` with a stated reason. |

### Wired, but not through another npm script

| Guard | Where it runs |
|---|---|
| `check:rules` | The pre-push hook, as `--base <remote sha> --head <local sha>` per pushed ref (`scripts/setup-git-hooks.mjs:66`). Push-scoped is the point: it judges the commits leaving the machine, never the shared working tree, and it also lints each pushed commit subject. The bare npm script (17.5s) scans the whole worktree and would fail on other agents' in-flight work. |
| `check:secrets` | The same hook, the same push-scoped mode, one line later, so no credential material leaves the machine. |

## Nothing was deleted

Every guard measured here does something no other check does. `audit:deploy` was the one
candidate for deletion, since `npm test` already imports three of its four functions, but its
fourth check only fires after a build, so it moved to the deploy path instead of going away.
`check:docs-search` looked like a decoy (its message told you to commit a gitignored file) and
would have been a delete, except three open work orders under `prompts/finish/` invoke it as a
local check; its message was corrected instead.
