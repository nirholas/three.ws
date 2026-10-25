# Adding an open source credit

`/open-source` lists every third-party dependency, model, and asset source three.ws runs on: license, upstream link, and what it powers on the platform. The dataset is generated, not hand-maintained, and a guard test fails the build if a new direct dependency lands without a credit.

## How it works

- `scripts/lib/open-source-credits.mjs` builds the dataset from three sources: every direct dependency in `package.json` (resolved against its own installed `package.json` for version, license, repository, and funding link), the hand-curated `WORKER_MODELS` list (GPU worker models whose license lives in prose in each worker's README, not in machine-readable metadata), and `ASSET_SOURCES` (non-code assets like Poly Haven and the CC0 animation packs, plus vendored/forked source trees already recorded in `NOTICE` and `third_party/README.md`).
- `scripts/build-open-source-credits.mjs` calls `buildCredits()` and writes the result to `data/open-source-credits.json`, wired into `npm run prebuild`'s parallel block so the dataset regenerates on every build.
- `api/open-source-credits.js` serves that committed JSON at `GET /api/open-source-credits`. `src/open-source.js` renders it on `pages/open-source.html`.
- `tests/open-source-credits.test.js` runs `buildCredits()` fresh and deep-equals it against the committed `data/open-source-credits.json`. If they differ, either the dataset was edited by hand (don't; it is generated) or a dependency changed without regenerating it.

## Adding a credit

**A new npm dependency** needs nothing extra: `npmEntries()` in `scripts/lib/open-source-credits.mjs` picks up every direct dependency in `package.json` automatically, reading its license, repository, and funding link from its own installed package metadata. The repository field is passed through `normalizeRepoUrl()`, which turns `git+https`, `git://`, `github:` shorthand, bare `owner/repo`, `git@host:owner/repo`, `host:owner/repo`, and `ssh://git@host/owner/repo` into an `https://host/owner/repo` link (bare `owner/repo` and `github:` mean GitHub; so the page's Source link never resolves relative to `/open-source`). If a package declares no license in its metadata, add the verified license to `LICENSE_OVERRIDES`. If it is a major, recognizable project, add an entry to `CURATED_PACKAGES` in the same file with an `area` (one of the ids in `AREAS`) and a one-line `powers` string describing what it does on three.ws; otherwise it still gets a full entry, grouped by `fallbackArea(name)`, with no "what it powers" line.

**A worker model** (a GPU model a worker under `workers/*` loads): add an entry to `WORKER_MODELS` with the license copied verbatim from the worker's own README or the model's upstream license file, not guessed. If the upstream project declares no license, say so plainly in the `license` field (for example `livepeer`'s entry reads "not declared upstream") rather than defaulting to a permissive label.

**An asset source** (a free asset library, a vendored source tree): add an entry to `ASSET_SOURCES`. Vendored/forked trees use an id prefixed `vendor:`, which routes them into the `vendored` kind on the page.

After editing any of the three lists, regenerate the dataset and rerun the guard test:

```
node scripts/build-open-source-credits.mjs
npx vitest run tests/open-source-credits.test.js
```

Commit the regenerated `data/open-source-credits.json` alongside the source edit.

## In-surface credits

Beyond the `/open-source` page itself, a few product surfaces carry an inline credit next to the content it applies to:

- `/objects` and the object detail viewer (`src/app-next-overlay.js`) name Poly Haven, the CC0 asset library the catalog sources from.
- A Forge result names the engine that generated it (already wired through the existing Forge result metadata).
- The animation gallery (`src/animations-gallery.js`) shows each clip's source and license; studio-tier clips without an explicit manifest `source`/`license` field fall back to `studioClipCredit(name)`, a filename-prefix classifier validated against the real manifest.
- The Forge export dialog (`src/forge-export.js`) names meshoptimizer and glTF-Transform, the libraries that compress and optimize the exported file, and links to `/open-source#area-formats`.

A new surface that visibly depends on a credited dependency, model, or asset source should link to the relevant `/open-source#area-<id>` anchor rather than repeating the license text inline.
