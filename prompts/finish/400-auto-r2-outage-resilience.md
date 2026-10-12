# 400. Object storage (Cloudflare R2) has been down for 35+ hours straight: fix the parts an agent can fix without Cloudflare dashboard access

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate. Written by the evolve scout lane on 2026-10-12 from the measurements below.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write, git push or a production deploy, posting to an external channel, committing content that names a crypto project other than $THREE, and destroying unrecoverable data. This order touches none of them.
- This order does NOT include enabling R2 in the Cloudflare dashboard. That is owner-only (no dashboard credential on this machine) and is already tracked as OWNER-ACTIONS row 36. Do not wait on it: everything in this order is agent-doable and independently valuable whether the outage is still live or has cleared by the time you run this.
- No mocks of the thing under test, no fake data, no unfinished-work markers, no commented-out code, no `it.skip`/`.todo` to make a failure disappear.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before each commit, commit promptly, one topical commit per task below.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.

## Why this matters (measured 2026-10-12, 18:10-18:30 UTC)

**This is a live, sustained, site-wide production defect, not a flap.** `prompts/finish/_context/production-100-OWNER-ACTIONS.md` row 36 currently describes this as something that "flaps between healthy and unreachable" with "many RESOLVED events minutes apart." That description is now stale and understates the severity:

    node --env-file=.env --env-file-if-exists=.env.local -e "
    const { sql } = await import('./api/_lib/db.js');
    console.log(JSON.stringify(await sql\`select title, count(*) n, min(first_seen) earliest, max(last_seen) latest from ops_alerts where title ilike '%object storage%' group by title order by latest desc\`, null, 2));
    "

returns the last `RESOLVED: Object storage (Cloudflare R2)` row at **2026-10-11T06:55:05Z**. Every hourly sensor tick since then, through **2026-10-12T18:10:20Z** (35+ consecutive hours, still ongoing as this order is written), is `DOWN`. Zero resolves in that window. `curl -s https://three.ws/api/healthz` confirms it is down right now: `subsystems.subsystems` carries

    {"name":"object_storage","status":"down","detail":"bucket unreachable: Please enable R2 through the Cloudflare Dashboard.","hint":"...reads fail over to the public bucket domain meanwhile, writes do not fail over at all.","metrics":{"latencyMs":95,"credentialFault":false}}

**The documented mitigation in that hint text is false right now, and the code's own resilient fallback path is also broken:**

1. Direct public-domain read is down too, not just the signed path. Pulled a real asset URL from a live, unauthenticated API response:

       curl -s https://three.ws/api/marketplace/agents?limit=3
       # thumbnail_url: https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/forge/9b86c6f92389/3c37961e-d733-42b6-9ca4-f0b0d574ed90_og.png

       curl -s -o /dev/null -w "%{http_code}\n" "https://pub-...r2.dev/forge/9b86c6f92389/..._og.png"
       # 403, Cloudflare-branded "Forbidden" HTML page (not a bucket-level 404/403, an edge-level block)

   The whole R2 product is blocked at the account edge right now, not just the signed S3 endpoint. The "reads fail over to the public bucket domain" hint in `api/_lib/ops/object-storage-health.js` is actively misleading while this persists.

2. The code's own resilient proxy, which is supposed to absorb exactly this by streaming the signed read and falling back to the public domain, is also returning errors, because both of its layers are down simultaneously:

       curl -s -o /dev/null -w "%{http_code}\n" --max-time 20 "https://three.ws/cdn/forge/9b86c6f92389/3c37961e-d733-42b6-9ca4-f0b0d574ed90_og.png"
       # 502 {"error":"upstream_error","error_description":"failed to fetch object"}

   See `api/cdn-object.js:168-254`: it already streams the signed read, and on `isStorageInfrastructureError` falls back to `publicUrlOrNull(key)` via `fetchUpstream`. Both legs are currently dead, so every `/cdn/<key>` request 502s.

3. **Most API responses never route through that resilient proxy at all.** `thumbnailUrl()`/`publicUrl()` (`api/_lib/r2.js:330-361`) emit raw `*.r2.dev` URLs directly, and every caller returns them verbatim: `api/_lib/avatars.js:516,677`, `api/marketplace/[action].js:286,1514`, `api/marketplace/animations.js:197`, `api/_lib/agent-earnings.js:489`, `api/_lib/pump-agent-launches.js:163,213`, `api/_lib/agent-economy.js:36,552,561`, `api/_lib/drop-store.js:285,351`, `api/_lib/persona-store.js` (several). None of these get the benefit of `/cdn/`'s fallback logic, rate-limit avoidance, or the short edge cache it describes in its own header comment. Today that is moot (both legs are down), but on a normal day when only the signed path or only the public domain is degraded (the historical "flap" pattern row 36 described), raw `*.r2.dev` URLs have zero protection while `/cdn/` already has working, tested failover.

4. **The frontend has no broken-asset state.** `src/marketplace-detail.js:81-83,497-498,530-531` sets `background-image: url('${a.thumbnail_url}')` directly; a CSS background-image load failure fires no error event and renders as a blank box, with no retry, no placeholder, and no indication to the user that anything is wrong. `src/marketplace-detail.js:64-67` sets `<model-viewer src="...">` directly to `a.avatar_glb_url` with the same no-fallback treatment. During this outage (and any future recurrence of the historical flap), every marketplace listing on the site is rendering silently blank thumbnails and empty avatar viewports. This violates CLAUDE.md's definition of done ("Error state is designed and actionable... tells user what went wrong and how to recover").

**Ranking:** this is a live production defect (RUN-ORDER's top tier), affecting every avatar, thumbnail, forge output and GLB view across the entire platform (marketplace, gallery, profiles, forge, animations), for every user, right now, for 35+ hours. It outranks any unshipped fix or new feature currently in the queue. The owner-only piece (enable R2 in the Cloudflare dashboard, OWNER-ACTIONS row 36) is one line; everything else below is fully agent-doable and ships value independent of when that happens.

## Step 0: re-derive the current state

    curl -s https://three.ws/api/healthz | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const j=JSON.parse(d);console.log(JSON.stringify(j.subsystems.subsystems.find(s=>s.name==="object_storage"),null,2))})'
    node --env-file=.env --env-file-if-exists=.env.local -e "
    const { sql } = await import('./api/_lib/db.js');
    const rows = await sql\`select title, first_seen, last_seen from ops_alerts where title ilike '%object storage%' and last_seen > now() - interval '72 hours' order by first_seen asc\`;
    console.log('rows:', rows.length); console.log(JSON.stringify(rows.slice(-3)));
    "
    curl -s https://three.ws/api/marketplace/agents?limit=1 | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const j=JSON.parse(d);console.log(j.data.items[0].thumbnail_url, j.data.items[0].avatar_glb_url)})'
    # then curl -I the two URLs it prints, and curl -I the /cdn/<same key> equivalent

If `object_storage` now reads `ok` or `degraded` (not `down`), the outage has cleared since this order was written; proceed with tasks 2-4 anyway (they are permanent resilience improvements, not outage response), and note in the report that task 1's doc escalation should be softened to past tense. If the live numbers disagree with this file's narrative in any other way, trust what you measure and say so in the report.

## Tasks

1. **Escalate the documentation.** Update `prompts/finish/_context/production-100-OWNER-ACTIONS.md` row 36: append a dated note (2026-10-12) correcting the "flaps... many RESOLVED events minutes apart" framing to the measured reality (35+ hour unbroken `DOWN` streak since the last resolve at 2026-10-11T06:55:05Z, public r2.dev domain also edge-blocked with a Cloudflare-branded 403, the `/cdn/` proxy's own fallback also down, hint text in `object-storage-health.js` temporarily false). Make clear enabling R2 in the Cloudflare dashboard is now urgent, not routine. Also update the "flaps" framing in `docs/ops/production-log-triage.md`'s `r2-downstream-5xx` section (around the lines documenting this signature) to match. Do not touch row 36's "owner" classification; the root cause is still Cloudflare-dashboard-only.

2. **Add one retry to the health probe before it classifies `down`**, exactly as row 36's own text proposed. In `api/_lib/ops/object-storage-health.js`, `gatherObjectStorageHealth()` (the `ListObjectsV2Command` call, lines ~76-92 per row 36's citation): on a failed probe, wait a short backoff (200-500ms) and try once more before calling `classifyObjectStorageProbe` with the failure. This does not mask a real sustained outage (one retry inside a single invocation cannot turn 35 hours of down into up), it only stops a single transient network blip from paging as `DOWN`/alerting `ops_alerts`. Add a test in `tests/object-storage-health.test.js` proving: a synthetic first-call failure followed by a synthetic second-call success classifies `ok`/`degraded`, not `down` (mock the probe function, not the thing under test's public contract); two consecutive failures still classify `down`. Keep the existing `classifyObjectStorageProbe` pure-function tests passing unchanged.

3. **Give the frontend a broken-asset state.** In `src/marketplace-detail.js`, wherever `thumbnail_url` is set as a CSS `background-image` (lines ~81-83, ~497-498, ~530-531) or `avatar_glb_url` is set as `<model-viewer src>` (lines ~64-67, poster at ~138): detect load failure (for the background-image case, preload with an `Image()` and `.onerror`; for `<model-viewer>`, listen for its `error` event) and swap in a designed empty/error state (a placeholder silhouette or icon plus short text, matching the project's existing empty-state visual language elsewhere in `src/`) instead of a blank box or an indefinitely-loading viewer. Check `src/marketplace-gallery-data.js:97` and `src/marketplace-gallery.js` for the same `image: a.thumbnail_url` pattern feeding gallery cards and apply the same fallback there. Do not add a spinner that never resolves; the fallback must render within a bounded time (a few seconds) once the load has genuinely failed.

4. **Route generated thumbnail/GLB URLs through the resilient `/cdn/` proxy instead of raw `*.r2.dev` by default**, so the existing signed-read-then-public-fallback logic in `api/cdn-object.js` actually protects every caller, not just the ones that happen to use it today. Change `thumbnailUrl()` in `api/_lib/avatars.js` (and the equivalent helpers in `api/_lib/agent-earnings.js` (`safeR2Url`), `api/_lib/pump-agent-launches.js`, `api/_lib/drop-store.js`, `api/_lib/persona-store.js`, `api/_lib/agent-economy.js` (`avatarThumb`)) to build `${origin}/cdn/${encodeR2Key(key)}` instead of calling `publicUrl()`/`publicUrlOrNull()` directly, reusing `encodeR2Key` from `api/_lib/r2.js`. Keep `publicUrl()`/`publicUrlOrNull()` as the low-level primitive `/cdn/` itself still needs internally; only change what gets handed to API consumers. Update or add tests next to the existing `tests/r2-public-url-or-null.test.js` / `tests/cdn-object-storage-failover.test.js` proving the new URLs point at `/cdn/...` and that `api/cdn-object.js` still serves them correctly (it already does, by key). Grep `grep -rln "publicUrl\|thumbnailUrl\|safeR2Url\|avatarThumb" api/_lib/*.js api/**/*.js` for any caller this task's description missed and apply the same change there.

## Definition of done

- [ ] `prompts/finish/_context/production-100-OWNER-ACTIONS.md` row 36 and `docs/ops/production-log-triage.md`'s `r2-downstream-5xx` section both reflect the sustained-outage measurement, dated 2026-10-12.
- [ ] `npx vitest run tests/object-storage-health.test.js` passes, including the two new retry-classification cases.
- [ ] `npx vitest run tests/r2-public-url-or-null.test.js tests/cdn-object-storage-failover.test.js tests/r2-public-object-fallback.test.js tests/r2-key-from-public-url.test.js` passes.
- [ ] A fresh `curl -s https://three.ws/api/marketplace/agents?limit=1` (after this ships and deploys) would return `thumbnail_url`/`avatar_glb_url` values starting with the site's own `/cdn/` path, not `*.r2.dev` (verify locally against a dev server with `E2E_PORT` since this agent cannot deploy).
- [ ] Opening a marketplace listing page in a browser with R2 reachability forced to fail (stub the fetch/Image load in a quick manual check, or rely on the still-live outage if it has not cleared) shows a designed placeholder, not a blank box or a stuck spinner.
- [ ] `npm run test:core` has no new failures versus the Step 0 baseline.
- [ ] `npm run check:rules -- --paths <files you touched>` exits 0.
- [ ] One commit per task (doc escalation, retry, frontend fallback, `/cdn/` routing), each subject naming what it changed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| The outage has cleared by the time you run this | Tasks 2-4 still ship as permanent resilience improvements. Soften task 1's doc wording to past tense and note the clear-by timestamp. |
| You cannot reach the Cloudflare dashboard to confirm the account-level cause | Not needed. Everything here is derived from `ops_alerts`, `/api/healthz`, and direct `curl`/`cdn-object.js` behavior, all reachable from this machine. |
| Changing `thumbnailUrl()` call sites risks missing a caller | Run the grep in task 4 after your edit and confirm it returns nothing new; also run `npm run test:core` for regressions in any route that snapshots a `*.r2.dev` URL literally. |
| A test fixture hardcodes a `*.r2.dev` URL literal | Update the fixture to the new `/cdn/` form in the same commit; that is the intended behavior change, not drift. |
| `/cdn/` itself is down right now so you cannot manually verify a 200 | Verify the retry/fallback logic with `npx vitest run`, which exercises the code paths without needing R2 to be reachable; do not block on a live round-trip. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths, one topical commit per task, each subject describing that diff.
3. If every line passes, delete this file in the final commit (`git rm prompts/finish/400-auto-r2-outage-resilience.md`) and append a dated entry to `prompts/finish/_context/production-100-PROGRESS.md` with the commit SHAs. If a line cannot pass, leave the file, log which line remains and why.
4. Final report, in this order: the step 0 measurement; what task 1-4 each changed and its commit SHA; final test counts; one-line judgment calls. No trailing questions.
