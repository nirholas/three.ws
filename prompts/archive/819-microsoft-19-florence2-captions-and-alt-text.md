# microsoft 19: Florence-2 captions, tags and alt text for every 3D creation

Status 2026-11-11: built and verified locally; 6,441 of 54,177 finished creations described on GCP (p50 about 1.5 s, about $0.57 per 1,000). See the 819 entry in [microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md). Waits on the owner: push, deploy the model-florence2 service, set MODEL_FLORENCE2_URL on three-ws-api, deploy the API and sync crons.

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3119.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Thousands of creations carry only the prompt that made them (or nothing, for photo-to-3D). Search misses them, model pages have thin descriptions for search engines, and images have weak alt text, which hurts accessibility. Microsoft's Florence-2 is an MIT-licensed vision model that captions, tags and describes images well and runs cheaply on one GPU. Running it on every creation's poster improves search, SEO and accessibility at once, and adds Microsoft Research open source to the production pipeline.

## Step 0: re-derive the current state

    grep -rn -i "caption\|alt=\|tags" api/forge* api/_lib/forge* 2>/dev/null | head -20
    grep -rln -i "forge_creations" api/_lib/migrations | head -5
    grep -rn -i "search" api/marketplace/*.js api/assets* 2>/dev/null | head -10
    sed -n 1,80p docs/ops/gcp-model-workers.md
    curl -s https://three.ws/api/version

Find where creations and their posters are stored, how search works today (Postgres full-text, trigram or vectors), and where model pages render alt text and meta descriptions. Read the Florence-2 model card and LICENSE (confirm MIT) and its task prompts (`<CAPTION>`, `<DETAILED_CAPTION>`, `<MORE_DETAILED_CAPTION>`, `<OD>`).

## Tasks

1. **Worker.** `workers/model-florence2/` on the existing GPU worker conventions: `POST /describe` takes a poster URL or image bytes and returns `{ caption, detailed, tags[], objects[] }` (tags derived from detection and caption nouns, normalized and deduplicated). Verify on GCP through Cloud Build or a Cloud Run job with real posters; record latency and cost per 1,000 images.
2. **Pipeline hook.** When a creation finishes, enqueue a describe job (fits whatever queue or cron pattern the forge uses); store results in new columns or a side table with the model version. Never block the creation on it.
3. **Backfill.** A resumable script or cron that walks existing creations newest first, rate limited, with progress and a dry-run count. Run it on a real sample of 200 creations and keep running it if cost is trivial (GCP pre-approved).
4. **Use the data.** Search indexes caption and tags (extend the existing search; test-first); model pages use the detailed caption for meta description and alt text, falling back to the prompt; tags show as chips that link to search. The user can edit or remove generated tags on their own creations.
5. **Docs.** Worker README, `docs/creation-descriptions.md` (model, license, what is generated, how to edit), link from docs/microsoft.md, STRUCTURE.md row, changelog entry, migration for new columns (fresh timestamp; `npm run db:status` first).

## Definition of done

- [ ] Test-first tests for tag normalization, the search change, and the meta and alt fallback order.
- [ ] A real GCP run describes real posters; 10 sample outputs and the cost numbers in the report.
- [ ] The backfill processed at least 200 real creations; search finds a model by a tag that only Florence-2 produced (query and result in the report).
- [ ] Model page shows the new alt text and meta in a browser on port 3119; no console errors; `npm test` passes; docs and changelog landed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Deploying a new long-lived service | Verify by job; put the deploy command in the owner message; run the 200-creation backfill from the job itself. |
| Poster missing for old creations | Render one with the existing poster or thumbnail path, or skip and count them. |
| Caption is wrong or unsafe | Keep the user edit path, and filter tags through the existing moderation or blocklist if one exists. |
| GCP 403 | Check memory `gcp-vertex-billing-403` first. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git rm` this file in the closing commit. An owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
