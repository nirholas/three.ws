# 439. CAD Forge files and forge-lineage reads leak the raw R2 public-domain URL, ORB-blocking the browser

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate, no owner action required.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan.
- This is a bug fix: follow the test-first rule (CLAUDE.md, "Bug fixes are test-first"). Write the failing test first, confirm it fails for the stated reason, then fix the code, then confirm it passes. Commit the test with the fix.
- The only permitted stops are the CLAUDE.md stop-and-ask gates (spend/on-chain writes, push/deploy, posting externally, committing content referencing a crypto project other than `$THREE`, destroying unrecoverable data). This order touches none of them.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- The em-dash and en-dash characters are banned in everything you write.

## Why this matters (measured 2026-10-25)

The already-completed full-site sweep (`reports/page-audit-2026-10-24T20-43-27-109Z.json`, `npm run audit:web`) logged many `request-failed` findings where the browser fetched `https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/...` directly and got `net::ERR_BLOCKED_BY_ORB` or a CORS error, for example:

    Access to fetch at 'https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/forge/10f44ba35b7e/99d30155-...' (blocked by CORS)
    Access to fetch at 'https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/u/67011f62-9054-47c0-8c2e-4d53d471269e/craft-868...' (ORB)

This is a known, already-named failure shape: `api/_lib/r2.js` has carried a fix for exactly this since the comment at line 416 ("That domain trips Chrome's Opaque Response Blocking on an `<img>`/model-viewer load") and a prior work order already closed most of it in `forge-store.js` (`tests/forge-store-listing-orb-safe.test.js`'s header comment cites "prompt-402 'console errors' work order"). The rule that order established: **every browser-facing read of a stored `*_url` column must route it through `cdnUrl()`/`normalizeStoredUrl()`, never return the raw `publicUrl()`/bucket-domain value.** Two call sites still break that rule. Neither is the R2-outage tracked at `RUN-ORDER.md` OWNER-ACTIONS row 36 or fixed by orders 437/438; this is a URL-shape bug that exists independent of whether R2 is currently up or down.

**Gap 1, systemic, every new CAD design:** `api/_lib/cad/store.js:19,97` (`uploadArtifacts()`) writes `urls[key] = publicUrl(objectKey)` for every artifact (glb, step, stl, thumb_svg, drawing_svg), using the raw bucket-domain helper instead of `cdnUrl()`. That return value is persisted verbatim into `cad_designs.files` (`saveDesign()`, store.js line 137) and handed back unchanged by `getDesign()`'s `toDesign()` (`files: row.files`, line 118), `getLineage()` (`thumb: r.thumb || null`, line 183, reading `files->>'thumb_svg'` straight from the DB, line 174/177), and `listDesigns()` (same pattern, lines 211/215/223). `src/cad/main.js` passes `files.glb` straight into `src/cad/viewer.js:242` (`loader.loadAsync(glbUrl)`, a real cross-origin GLTFLoader fetch) and sets `files.thumb_svg`/`drawing_svg` as `<img src>` (`src/cad/main.js:217,486`). Every CAD design built today, not just legacy rows, gets a raw `pub-<hash>.r2.dev` URL that ORB/CORS-blocks in the browser.

**Gap 2, a missed sibling, legacy forge rows:** `api/_lib/forge-store.js`'s `getLineage()` (lines 1259-1270) returns `glb_url: r.glb_url, preview_image_url: r.preview_image_url` straight from the DB column, the one function in this file that skips `normalizeStoredUrl()`. Every other listing export in the same file already wraps these columns (`listCreations` line 1106, `listShowcase`, `getPublicCreation` line 1182, `listRecentCreations` lines 1352-1354, `listRelated`), proven by `tests/forge-store-listing-orb-safe.test.js`, which covers eight functions and conspicuously does not cover `getLineage`. This leaks through `api/remix-feed.js:103-104` (`action=lineage`): `glbUrl: r.glb_url, viewerUrl: r.glb_url ? \`https://three.ws/viewer?src=${encodeURIComponent(r.glb_url)}\` : null`, straight into the lineage/remix-feed JSON API response, for any row written before `normalizeStoredUrl()` existed.

Live confirmation that the normalization helper and its contract already exist and are the established fix pattern (not a new design decision):

    grep -n "export function normalizeStoredUrl" -A3 api/_lib/r2.js
    grep -n "normalizeStoredUrl" api/_lib/forge-store.js | wc -l
    # 8+ call sites already use it; getLineage is the one that doesn't

This is distinct from and not already covered by any open order: `401` (vitest), `403` (docs freshness), `433` (account_link_codes migration), `435` (sentiment-pulse LKG), `436` (forge-finalize TTL reap), `437` (image CDN placeholder), `438` (agent-3d/avatar-page/marketplace GLB load fallback) touch none of `api/_lib/cad/store.js`, `api/_lib/forge-store.js`'s `getLineage`, or `api/remix-feed.js`. A grep of every file in `prompts/finish/` for `cad/store`, `cad_designs`, `normalizeStoredUrl`, and `getLineage` found no existing order naming this gap.

## Task

1. Re-derive the current state before changing anything:
   - `grep -n "publicUrl(objectKey)" api/_lib/cad/store.js` to confirm line 97 still uses the raw helper.
   - `grep -n "glb_url: r.glb_url" api/_lib/forge-store.js` to confirm `getLineage` still skips normalization.
   - `curl -s "https://three.ws/api/remix-feed?action=lineage&root=<any-existing-root-creation-id>"` (use any id from `curl -s https://three.ws/api/forge-gallery | python3 -c "import json,sys; print(json.load(sys.stdin)['creations'][0]['id'])"` or similar) and check whether `glbUrl` in the response contains `r2.dev`; if production rows have all already been written post-fix, the live symptom may not reproduce today, but the code gap is real for any future legacy row and for every CAD design right now (CAD gap 1 is not row-age-dependent). Proceed with both fixes regardless and say what you observed in the report.
2. Fix gap 2 first (forge-store.js, smaller and already has a test file to extend):
   - In `api/_lib/forge-store.js`'s `getLineage()` (lines 1259-1270), change `glb_url: r.glb_url,` to `glb_url: normalizeStoredUrl(r.glb_url),` and `preview_image_url: r.preview_image_url,` to `preview_image_url: normalizeStoredUrl(r.preview_image_url),`. `normalizeStoredUrl` is already imported in this file (confirm with `grep -n "^import" api/_lib/forge-store.js | grep normalizeStoredUrl`).
   - In `tests/forge-store-listing-orb-safe.test.js`: add `getLineage` to the destructured import on line 48-51. Add a new `it('getLineage: glb_url, preview_image_url', ...)` block in the `describe` block (model it on the `getPublicCreation` test, lines 138-155), with `rows` shaped to match the CTE's selected columns (`id, parent_creation_id, prompt, refine_instruction, lineage_index, glb_url, preview_image_url, status, backend, created_at`), using `LEGACY_GLB`/`LEGACY_PREVIEW` (already defined at lines 54-55) as the row's `glb_url`/`preview_image_url`, calling `getLineage({ rootCreationId: 'c9', clientKey: null })`, and asserting `rows[0].glb_url === cdnUrl('forge/client-1/legacy.glb')` and `rows[0].glb_url` does not match `/r2\.dev/`. Run `npx vitest run tests/forge-store-listing-orb-safe.test.js` now, before the fix, and confirm only the new test fails (the other eight must still pass unchanged).
3. Fix gap 1 (cad/store.js), the larger one:
   - Change the import at line 19 from `publicUrl` to also include `cdnUrl` and `normalizeStoredUrl` (`import { objectStorageConfigured, putObject, cdnUrl, normalizeStoredUrl } from '../r2.js';`, dropping `publicUrl` if nothing else in the file uses it, confirm with `grep -n "publicUrl" api/_lib/cad/store.js` after the edit).
   - In `uploadArtifacts()` (line 97), change `urls[key] = publicUrl(objectKey);` to `urls[key] = cdnUrl(objectKey);`. This fixes every new design going forward (the return value is what gets persisted into `cad_designs.files`).
   - Add a small helper near the top of the file (module scope, after the imports) to normalize a persisted `files` map at read time, so an already-existing row (written before this fix, or written by a worker that still returns a raw public URL in its artifact map) self-heals:

         function normalizeFiles(files) {
             if (!files || typeof files !== 'object') return files;
             const out = {};
             for (const [key, url] of Object.entries(files)) {
                 out[key] = typeof url === 'string' ? (normalizeStoredUrl(url) ?? url) : url;
             }
             return out;
         }

   - In `toDesign()` (line 118), change `files: row.files,` to `files: normalizeFiles(row.files),`.
   - In `getLineage()` (store.js line 183, the `card` helper) and `listDesigns()` (line 223), change `thumb: r.thumb || null,` in both places to `thumb: r.thumb ? (normalizeStoredUrl(r.thumb) ?? r.thumb) : null,`.
4. Write the failing tests first, in a new file `tests/cad-store-orb-safe.test.js`, modeled directly on `tests/forge-store-listing-orb-safe.test.js`'s mocking setup (same `process.env` block, same `vi.mock('../api/_lib/db.js', ...)` pattern with a mutable `rows` array fed to a `sql` mock, same `vi.mock('../api/_lib/r2.js', ...)` passing through the real `publicUrl`/`cdnUrl`/`normalizeStoredUrl`/`keyFromPublicUrl`, plus mocking `putObject` and `objectStorageConfigured`). Cover:
   - `uploadArtifacts()` returns `cdnUrl()`-shaped URLs, not raw `publicUrl()` ones, for every artifact key present in a sample `artifacts` object (glb, thumb_svg at minimum).
   - `getDesign()` normalizes a legacy row whose `files.thumb_svg`/`files.glb` were stored as the raw `publicUrl()` form (construct the mocked row's `files` jsonb value using the real `publicUrl('cad/d1/thumb.svg')` so the test fixture matches a real legacy write, matching `LEGACY_GLB`/`LEGACY_PREVIEW`'s style in the forge-store test).
   - `getLineage()` and `listDesigns()` normalize a legacy `thumb` value the same way.
   - Run `npx vitest run tests/cad-store-orb-safe.test.js` now, before the fix, and confirm every new test fails for the stated reason (raw `r2.dev` URL present where a `cdnUrl()` one is expected).
5. Apply the fixes from tasks 2-3, then re-run both test files and confirm every test passes: `npx vitest run tests/forge-store-listing-orb-safe.test.js tests/cad-store-orb-safe.test.js`.
6. Run `npx vitest run tests/cad-forge.test.js tests/forge-store-delete.test.js tests/forge-store-list-engine-version.test.js tests/forge-store-materialize.test.js tests/r2-normalize-stored-url.test.js` to confirm nothing adjacent regressed.
7. Run `npm run check:rules -- --paths api/_lib/cad/store.js api/_lib/forge-store.js tests/forge-store-listing-orb-safe.test.js tests/cad-store-orb-safe.test.js` and fix anything it flags.
8. Read the full diff (`git diff api/_lib/cad/store.js api/_lib/forge-store.js tests/forge-store-listing-orb-safe.test.js`, plus `git diff --stat tests/cad-store-orb-safe.test.js`) and confirm every changed line traces to a task above.
9. This fix cannot be verified against production from this session (no deploy in an evolve lane). The report must say plainly that any already-persisted `cad_designs` rows (and any forge rows reached via `/api/remix-feed?action=lineage`) are only normalized at the next read after this ships; the fix is read-time self-healing (matching the existing `normalizeStoredUrl` convention), not a backfill migration, so no database write is needed and none should be added.

## Done when

- `api/_lib/cad/store.js`'s `uploadArtifacts()` writes `cdnUrl()`-shaped URLs into every new design's `files` map, not raw `publicUrl()`.
- `api/_lib/cad/store.js`'s `getDesign()`, `getLineage()`, and `listDesigns()` normalize any already-stored raw-domain URL at read time via `normalizeStoredUrl()`.
- `api/_lib/forge-store.js`'s `getLineage()` normalizes `glb_url`/`preview_image_url` the same way every sibling listing function already does.
- New tests in `tests/cad-store-orb-safe.test.js` and an added case in `tests/forge-store-listing-orb-safe.test.js` prove both fixes, each confirmed to fail against the pre-fix code first.
- `npx vitest run tests/forge-store-listing-orb-safe.test.js tests/cad-store-orb-safe.test.js tests/cad-forge.test.js tests/forge-store-delete.test.js tests/forge-store-list-engine-version.test.js tests/forge-store-materialize.test.js tests/r2-normalize-stored-url.test.js` passes in full.
- `npm run check:rules -- --paths api/_lib/cad/store.js api/_lib/forge-store.js tests/forge-store-listing-orb-safe.test.js tests/cad-store-orb-safe.test.js` passes.
- `git diff` reviewed; every changed line traces to a task above.
- The fix is committed on `evolve` with explicit paths and a commit message naming the bug and the fix.
- The report states plainly that this is a read-time self-healing fix (no migration, no backfill) and that the live-site resolution is unverified until this ships.
- This file is removed, with a dated entry added to `prompts/finish/_context/production-100-PROGRESS.md` citing the fix commit SHA and what was verified.

## Never blocked

| Looks like a blocker | It is not | Do this |
|---|---|---|
| "Legacy rows in `cad_designs`/`forge_creations` need a database backfill to actually fix this" | `normalizeStoredUrl()` is a read-time, zero-cost string rewrite (checks whether the URL matches the bucket domain and swaps it for the `/cdn/` form); every sibling read path in `forge-store.js` already relies on exactly this instead of a backfill, per the file's own comment at `r2.js:414-420` | Apply the read-time normalization at every read path named above. Do not write or propose a migration |
| "This duplicates orders 437/438" | 437 only touches `api/cdn-object.js` (image placeholder for a storage-wide outage); 438 only touches `src/element.js`/`src/avatar-page.js`/`src/marketplace.js` (client-side GLB-load fallback). Neither touches `api/_lib/cad/store.js` or `api/_lib/forge-store.js`'s `getLineage`, and this bug is a URL-shape defect independent of whether R2 is currently up or down | Proceed; this order's files do not overlap 437 or 438's files |
| "`uploadArtifacts()`'s caller might expect a `publicUrl()`-shaped value for some other reason (e.g. a worker callback signing against it)" | `cdnUrl()` returns a same-origin `/cdn/<key>` URL that proxies to the same object via `api/cdn-object.js`, which already streams the signed read or falls back to the public domain itself; nothing downstream needs the raw bucket domain specifically, and `forge-store.js`'s equivalent write paths already route through `cdnUrl()` for the same artifact classes (glb/preview) without issue | Ship the `cdnUrl()` swap in `uploadArtifacts()`. If a genuine non-browser consumer is found during the diff review that needs the raw domain, say so explicitly in the report with the exact call site; do not assume it exists without checking |
| "The CAD worker itself (not `store.js`) might also return raw URLs somewhere, so this fix is incomplete" | Scope check: `uploadArtifacts()` is the one function that converts a worker's base64 artifact payload into a stored URL (`api/_lib/cad/store.js:85-101`); nothing else in the CAD path assigns a `files` map. If the worker's own response ever contains a URL field directly (not just base64 artifacts), that is a different code path and out of scope here unless found during task 1's re-derivation | Verify with `grep -n "artifacts\[" api/_lib/cad/*.js` during task 1; if another assignment site exists, say so in the report, but do not expand this order's fix beyond `uploadArtifacts()` without re-deriving why |

## Report format

State: the measured re-derivation from task 1, the failing tests' first (red) run output for both test files, the fix, the passing test run output (all seven test files from "Done when"), the `check:rules` result, the diff, and the commit SHA. End with one explicit line: "Live production symptom: unverified, pending deploy (fix is read-time self-healing, no migration)."
