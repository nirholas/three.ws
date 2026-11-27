# Forge caches: what each one holds and the rules it follows

Forge remembers work in five places so a repeated request is answered without
running the GPU pipeline again. Each cache follows three rules:

1. It never hands out a wrong model.
2. It never hands out a failed model.
3. It never hands out a removed model.

This page lists every cache, its key, its lifetime, who writes it, who reads it
and what invalidates it. It also records the decisions behind the rules and
names the tests that hold each one.

Related: [docs/forge.md](../forge.md) (the endpoint),
[forge-protected-lanes.md](forge-protected-lanes.md) (lanes that must not move),
[forge-error-triage.md](forge-error-triage.md) (error codes).

## The caches

### 1. Completed-result cache

- **Module:** `api/_lib/forge-cache.js`
- **Stores:** a finished text-to-3D model for days, so the next identical
  request gets the same mesh back at once. The entry holds `glb_url`,
  `creation_id`, `backend`, `tier`, `path`, `quality` and `cached_at`.
- **Key:** `fr:result:<first 40 hex chars of sha256>`, built by
  `forgeResultCacheKey`. The hash covers:
  - lane path, tier and backend;
  - the normalized prompt (see "Prompt normalization" below);
  - seed, output format, texture size, target polycount and resolution;
  - every result-affecting option from `extraIdentityInputs`: bbox, pose,
    derive_pbr, lods, view labels, fill-other-sides, part count, the sampler
    overrides, aspect ratio and the art-director switch;
  - the requester scope (see "Privacy" below).
- **Lifetime:** 7 days. Override with `FORGE_RESULT_CACHE_TTL_S`. Turn the
  cache off without a deploy with `FORGE_RESULT_CACHE=0`.
- **Writers:** `api/forge.js` and `api/gpt-forge.js`, through
  `putCachedForgeResult`:
  - after a synchronous NVIDIA or Hugging Face lane finishes;
  - on the poll that first sees a job done, after the quality gate has scored
    the model.
- **Readers:** the same two handlers, through `getCachedForgeResult`:
  - before anything is generated;
  - when a stampede waiter is released (see cache 5).
- **Not cached at all:** photo-to-3D (the photo is private to its uploader),
  the High tier (paid and gated per caller) and BYOK lanes (they spend the
  caller's own account). `force_regenerate: true` skips the read but still
  writes a fresh result.
- **Invalidation:**
  - The 7-day lifetime.
  - Every read checks the `forge_creations` row behind the entry (see
    "Removal" below). An entry whose model was deleted, blocked or held is
    dropped on that read.
- **Job binding:** a companion key `fr:job:<job handle>` (1 hour) maps an
  asynchronous job to the result key it should fill when it finishes.

### 2. Done-frame cache

- **Module:** `api/_lib/forge-done-cache.js`
- **Stores:** the exact frame a poll answered when a job finished, so a repeat
  poll is answered without asking the GPU worker again.
- **Key:** `forge:done:<first 40 hex chars of sha256(job id)>`
- **Lifetime:** 6 hours.
- **Store:** `api/_lib/cache.js`, which is Upstash when it is configured. It
  falls back to process memory.
- **Writer:** `api/gpt-forge.js` on a done poll, through `rememberDoneFrame`.
  Only a frame that has all of the following is stored:
  - status `done`;
  - a durable http(s) `glb_url`;
  - the `creation_id` it belongs to.
- **Reader:** the same poll handler, through `recallDoneFrame`.
- **Invalidation:**
  - The 6-hour lifetime.
  - Every recall checks the creation row. If the model has been removed, the
    poll answers the `model_removed` frame instead of the old one:
    `status: 'failed'`, `code: 'model_removed'`, with a message telling the
    user to generate again.
  - If the row cannot be read (database outage), the remembered frame keeps
    answering. That frame belongs to the job's own poller.

### 3. In-flight coalescing record

- **Module:** `api/_lib/forge-scale.js`
- **Stores:** a request fingerprint mapped to the live job that is already
  making it, so identical requests made while that job runs poll the same job.
- **Key:** `fc:inflight:<forgeRequestHash>`. The hash uses the same identity as
  the result key, plus a digest of any input images.
- **Lifetime:** 360 seconds, about the longest a generation stays pollable.
- **Writers:** both handlers, as soon as an asynchronous lane returns a job
  handle (`registerInFlight`).
- **Readers:** both handlers, before generating (`coalesceInFlight`).
  `force_regenerate` skips the read in both.
- **Invalidation:**
  - The lifetime.
  - `clearInFlight` when the job turns out dead, so later requests are not
    pinned to a failed job.

### 4. Page-side catalog snapshot

- **Module:** `src/forge-catalog-cache.js`
- **Stores:** the last `/api/forge?catalog` answer, in browser localStorage
  under `forge.catalog.v1`. It lets the engine picker draw on the first frame
  of a repeat visit.
- **Holds no models.** It contains lane ids, paths, tiers, defaults and output
  formats, and no model URL or creation id. A removed model therefore cannot be
  served from it. Checked in a browser on 2026-11-27: the stored snapshot
  matched none of `.glb`, `glb_url`, `creation_id` or `/creations/`.
- **Lifetime:** 7 days.
- **Rejected on read:**
  - a stamp in the future;
  - a snapshot with no backends or no tiers.
- **Invalidation:** every page load fetches the live catalog and overwrites the
  snapshot when it changed. Checked in a browser: a lane planted into the
  snapshot was gone after the next load.

### 5. Stampede claim

- **Module:** `api/_lib/forge-stampede.js`
- **Stores:** who is generating a request fingerprint right now. It covers the
  minute or more before a job handle exists (prompt direction plus the
  throttled reference image), which is the window the in-flight record cannot
  cover.
- **Key:** `fc:claim:<forgeRequestHash>`. The value is either
  `pending:<uuid>` or `job:<handle>`.
- **Lifetime:** 180 seconds. A waiter gives up after 150 seconds and generates
  on its own.
- **Flow:**
  - The first request takes the claim (SET NX) and generates.
  - It publishes the job handle as soon as one exists.
  - Identical requests that arrive meanwhile wait, then poll that same job.
  - If the owner ends without a handle (a synchronous lane, or a failure), it
    releases the claim. Waiters then re-check the result cache and the
    in-flight record before generating.
  - Release only removes the owner's own pending claim, never a newer one.

## Decisions

### Prompt normalization

`normalizePrompt` in `api/_lib/forge-request-identity.js` folds:

- letter case;
- leading and trailing whitespace;
- runs of inner whitespace;
- the Unicode composition form.

These are differences a person never means as a different object.

It keeps:

- punctuation, including trailing punctuation;
- digits;
- word order.

"A red cat" and "a red cat." are different requests. A period can end a
sentence the prompt director rewrites differently, and the cost of keeping it
is one extra miss, never a wrong hit. The result key and the in-flight hash use
the same function, so they can never disagree.

### What may be cached

`cacheableOutcome` is checked on write, and again on read for entries older
builds wrote. An entry must have all of the following:

- an http(s) `glb_url`. An inline data URI from a storage outage is refused;
- a `creation_id`;
- status `done` or none;
- no `partial` flag;
- no failed geometry check (`quality.valid === false`, or a flag of
  `invalid`, `degenerate` or `low`);
- no failing vision verdict, when the judge was available.

Failures, throttles (429, `retry_after`) and jobs still running never reach the
writer, because only a finished model has a `glb_url` and a `creation_id`.

### Privacy

A request that asked for `visibility: 'public'` shares entries with every
other public request. Any other request is keyed to its requester (`u:<user
id>`, else `c:<client key>`), so one account's unlisted or private model is
never another account's hit.

Platform showcase seed jobs that name no visibility are born public, and they
key as public. Every read also checks the row against the viewer
(`creationServableTo`), so even a key collision could not leak a private model.

### Removal

Every result-cache read and every done-frame recall looks up the creation row
(`api/_lib/forge-cache-guard.js`):

- **Deleted, failed, blocked or held:** the model is not live. The result entry
  is dropped and the read is a miss. The done poll answers `model_removed`.
- **Live but not visible to this viewer:** for example, a public request whose
  model is still waiting for the content-safety sweep. The read is a miss and
  the entry is kept, so the sweep's promotion makes it servable without
  regenerating.
- **Row cannot be read:** the result read is a miss. Nothing is guessed.

### Store outage

When Upstash is unset, misconfigured (`getRedis()` throws) or failing on a
command, every cache function answers a miss or does nothing:

- the request generates uncached;
- the stampede claim answers `off`;
- the user sees no error.

## Tests

- `tests/forge-cache-correctness.test.js` covers:
  - a table of request pairs that differ in exactly one input and never share
    a key;
  - prompt normalization;
  - every refused outcome;
  - privacy across accounts;
  - removal and store outage.
- `tests/forge-stampede.test.js` covers:
  - two (and ten) simultaneous identical requests making one job;
  - release and timeout;
  - a newer owner's claim surviving;
  - store outage.
- `tests/forge-cache.test.js`, `tests/forge-cache-cdn-urls.test.js`,
  `tests/forge-done-cache.test.js` and `tests/forge-catalog-cache.test.js`
  cover each module's own contract.
