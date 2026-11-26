# Forge live walkthrough

`npm run forge:walkthrough` proves Forge works end to end the way a signed-in visitor uses it: it opens `/forge` in a real Chromium, types a prompt or drops a photo, waits for the model, downloads the GLB and checks it, checks the viewer actually drew something, opens the share page and its preview image, and confirms the model is listed under the account's creations. One line per stage, each timed and marked PASS, FAIL or SKIP. Exit 0 only when every stage that ran passed.

Script: [`scripts/forge-live-walkthrough.mjs`](../../scripts/forge-live-walkthrough.mjs). Its verdict rules (GLB validation, the 429 rule, the blank-canvas test, argument parsing) are pinned by [`tests/forge-live-walkthrough.test.js`](../../tests/forge-live-walkthrough.test.js).

## What it proves, and what it does not

It proves the production path a person takes works right now: the session, the health endpoint, the page, the generation submit and job polling, the stored GLB, the viewer, the share card and the account listing. The page audit ([page-audit.md](page-audit.md)) only loads pages; this starts a real generation.

It does not click Download. Download runs the pay-to-keep check (`src/forge-keep.js`), which can open a $THREE payment dialog, and this script never pays for anything. It fetches the download link directly instead, which is the same file.

It treats a cached result (`cached: true` from `/api/forge`) as a failure, because a real visitor's fresh prompt is never served from the cache. The default prompt is built fresh each run from small word lists for that reason.

## How to run it

The session comes from `.auth/audit-state.json`, the same storage state the page audit uses. Nothing is hard-coded. If the file is missing or expired, the session stage fails and names the file; refresh it the way [page-audit.md](page-audit.md) describes.

```bash
npm run forge:walkthrough -- --skip-generate             # no generation: checks the newest public model instead
npm run forge:walkthrough                                # one text generation with a fresh prompt
npm run forge:walkthrough -- --text "a brass desk lamp"  # your own prompt
npm run forge:walkthrough -- --photo path/or/url.jpg     # one photo generation
npm run forge:walkthrough -- --text "..." --photo p.jpg  # both, one after the other, never at once
npm run forge:walkthrough -- --out report.json           # full JSON report, plus viewer screenshots beside it
npm run forge:walkthrough -- --base http://localhost:4105 --headed   # a local dev server, visible browser
```

Every generation spends real GPU time. Run a generating walkthrough when you need proof, not on a loop. `--skip-generate` costs nothing and is safe to run any time.

## How long it takes

- `--skip-generate`: about 70 seconds (measured 71 s on 2026-11-26; most of it is the viewer loading the public model in software WebGL).
- A text generation: about 2 to 3 minutes when the engines are warm. The text path paints a reference image first, then builds the mesh.
- A photo generation: about 4 minutes warm (measured 2026-11-26: the model was ready in 179 s on trellis_selfhost, about 229 s including the on-device photo check). It skips the image step.
- The viewer stage adds 30 s to 4 minutes: the browser renders in software WebGL, and a 7 MB textured result takes 45 to 90 s to load there.
- Cold engines (scaled to zero) add several minutes. A generation that has not finished after 12 minutes fails the stage. A heartbeat line prints every 30 seconds so a long wait never looks hung.

## The stages, what a failure means, and who fixes it

- **Signed in as the QA user** (`session`): `/api/auth/me` with the saved cookie. A failure means the storage state is missing or expired. Whoever runs the check refreshes `.auth/audit-state.json`.
- **Health and engine stats respond** (`health`): `/api/forge?health=1` and `/api/nvidia/stats` parse, and the 7-day lane counts are printed. The LLM chain status is added as a note because it decides whether prompts get rewritten. A failure means the API itself is down or returned something unparseable: production on-call (gcp-triage skill).
- **Forge page loads cleanly** (`page`): `/forge` loads with no console error, no page error, no failed request and no 4xx or 5xx response. A failure lists each one. The owner of the failing asset or endpoint fixes it, usually a frontend regression.
- **Text prompt makes a model** / **Photo makes a model** (`text.generate`, `photo.generate`): the page reaches its result state with a creation id. A failure quotes the page's error title and message and the last `/api/forge` responses. A 429 that persists after the one stated wait means the engine or the image step is throttled (see below). An `unconfigured` state means a backend credential is missing on Cloud Run. A timeout means a GPU worker is cold, stuck or down: check the lane in `npm run forge:lanes` and the worker logs.
- **Model downloads as a valid 3D file** (`*.file`): the GLB header and JSON chunk are checked (magic bytes, version 2, the declared length matches, at least one mesh, between 100 and 5,000,000 triangles, buffer views inside the binary chunk). This reads only the header and accessors, so Draco and meshopt compression do not matter. A failure means storage served an error page, a truncated upload, or an engine produced an empty or broken mesh: the Forge backend owner.
- **Model shows in the viewer** (`*.viewer`): the model-viewer reports loaded, and its canvas has enough changed pixels and distinct colours to be a shaded model rather than a blank frame. With `--out`, a screenshot is saved. The script records the viewer's own load, progress and error events, so a failure says which happened: "reported an error loading <url>" (with the viewer's detail) is a real fault in the file or the viewer for the frontend owner; "was never given a model" is a page wiring fault; "still loading after 240s" on a valid GLB is the software renderer being too slow for that file, so rerun with `--headed` on a machine with a GPU before calling it broken.
- **Share page and preview image work** (`*.share`): `/forge/share/<id>` answers 200 with an `og:image`, that image loads, and `/api/forge-og?id=` resolves to an image. A failure is the share or OG card code.
- **Model is listed under the account's creations** (`*.creations`): `/api/forge/mine` lists the new id (retried once after 10 s for write lag). A failure means the creation was not recorded against the user, which breaks "My creations".

With `--skip-generate` the same file, viewer and share checks run against the newest public community model (`existing.*`), plus a check that the creations list responds.

## The 429 rule

On a 429 or a `rate_limited` body, the script waits the stated time once (the body's `retry_after`, then the `Retry-After` header, then `RateLimit-Reset`, else 15 s), retries once, and fails the stage if it is throttled again, quoting both responses. It never loops and never waits longer than 300 s. A wait the server states but that cannot succeed (for example a 10 s hint in front of a provider that allows one request every 45 s) shows up as two identical 429s: that is a production finding, not a flaky run.

## One generation at a time

A lock file at `$TMPDIR/three-ws-forge-walkthrough.lock` holds the running process id. A second copy started while one is generating skips its generation stages and says why. A lock left by a dead process is taken over.

## Verified runs

- 2026-11-26, `--skip-generate` against production (commit f0eed584f): 8 of 8 passed in 71 s.
- 2026-11-26, text generation against production (f0eed584f): the page and health passed; the generation failed with two `rate_limited` responses stating `retry_after: 10`. Production predates the fix that passes the image provider's real wait through (b41786cd6); the deploy carries it.
- 2026-11-26, photo generation against production (f0eed584f): 7 of 8 passed. The model was ready in 179 s on trellis_selfhost (6.94 MB GLB, 68,094 triangles), and the share page and creations listing passed. The viewer stage hit the then 120 s limit. Reopening the same creation showed the viewer loads it with no error (the full GLB in about 47 s in software WebGL), so the limit went to 4 minutes and the stage now reports the viewer's own events.
- 2026-11-26, `--skip-generate` again after that change: 8 of 8 passed in 121 s.
