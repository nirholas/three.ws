# grok-startups 04: Grok Imagine as a reference-image lane for text-to-3D, promoted only where it measurably wins

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `grok-startups-` order, so it can run in parallel with all of them. Dev port: 3274.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/grok-startups-00-CONTEXT.md](_context/grok-startups-00-CONTEXT.md) (facts, wording rules, parallel-run rules, the no-key rule). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, deploy, setting a production flag) into ONE message at the end. Never contact xAI or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building and `changelog-and-docs` before close-out. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Text-to-3D quality on three.ws is bounded by the reference image the forge generates first: the mesh model can only lift what the image shows. Today that image comes from Vertex Gemini in [api/_lib/forge-reference-image.js](../../api/_lib/forge-reference-image.js), with fallbacks in [api/_mcp3d/text-to-image.js](../../api/_mcp3d/text-to-image.js). Grok Imagine Image 2.0 is now covered by our startups credits. If it produces cleaner, front-facing, single-object, evenly lit images, every free generation gets better and xAI gets a concrete "Imagine powers 3D" story. If it does not, we keep Gemini and say so. This order decides by measurement, not by enthusiasm.

## Step 0: re-derive the current state

    sed -n 1,140p api/_lib/forge-reference-image.js
    grep -n "export\|lane\|provider\|fallback" api/_mcp3d/text-to-image.js | head -60
    grep -n "image" api/_lib/ai-image-lanes.js | head -40
    grep -n "GROK_MODELS" -A 30 api/_lib/chat-models.js | head -50
    grep -rn "forge-reference-image" api src --include=*.js | grep -v test | head
    gcloud run services describe three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 --format=json | grep -c GROK_API_KEY
    grep -c "^GROK_API_KEY\|^XAI_API_KEY" .env .env.local 2>/dev/null

Then read the current image-generation docs at `https://docs.x.ai/developers/` (image generation and models pages, `.md` suffix): endpoint, model slug, request fields (prompt, count, aspect ratio or size, response format), response shape, pricing per image, rate limits and content policy. Record each with its URL.

## Tasks

1. **Model id in one place.** Add the Imagine image slug(s) next to `GROK_MODELS` in `api/_lib/chat-models.js` (hot file, rule 2 and rule 8 of the context file) as a named export, and extend `tests/grok-model-literals.test.js` only if its allowlist needs the new export name.
2. **Provider module.** `api/_lib/xai-image.js`: one function that takes a prompt and options, calls xAI image generation with `GROK_API_KEY` (fallback `XAI_API_KEY`, via `api/_lib/env.js`), returns bytes plus mime and the revised prompt if the API returns one, with a timeout, a typed error for 401, 429 and content-policy refusals, and a usage record through `api/_lib/usage.js` with `client_id` `xai-imagine`. Unit tests use the response example from docs.x.ai verbatim, with the source URL in the fixture header.
3. **Lane wiring behind a flag.** Make Grok Imagine selectable in the forge reference-image lane, controlled by `FORGE_REF_IMAGE_PROVIDER` (values from the existing code plus `xai`) and off by default. The prompt template must ask for the same composition the Gemini lane asks for (read it; do not invent a new one). On any xAI failure, fall through to the existing lane with a log line naming the reason; never fail the user's job because of the new lane. Tests cover flag off, flag on with success, and flag on with each typed error.
4. **The evaluation harness.** `scripts/grok-eval-ref-image.mjs`: a fixed prompt set of 40 committed prompts (mix of props, characters, vehicles, food, architecture, hard cases like thin structures and transparent objects; written by you, committed as `data/evals/ref-image-prompts.json`). For each prompt and each provider: generate the image, run the existing image-to-3D lane on it, render the GLB with `/api/render/glb`, and score with objective checks you can compute (background is clean and uniform, single connected subject, subject centered and fills a sane fraction, mesh watertightness and triangle count from the GLB, render success) plus a blind pairwise judgment by a vision model the repo already uses (read [api/_lib/llm.js](../../api/_lib/llm.js); the judge must not be Grok, to avoid self-preference). Write `docs/evals/grok-imagine-ref-image.md` with the method, per-category win rates, cost per image and median latency per provider, and 6 side-by-side renders committed under `docs/evals/img/`.
5. **Decide from the numbers.** If Grok Imagine wins overall or in a clear category, make it the default for that category behind the flag (a category router is fine if the data supports it) and write the recommendation in the eval doc; if it loses, leave the default, keep the lane available, and say so plainly. Either outcome is a complete result.
6. **Docs.** A section in `docs/grok.md` (hot file, small anchored edit) describing the lane, the flag and the eval link. Changelog entry only if a default changed in code.

## Definition of done

- [ ] `npx vitest run tests/xai-image.test.js tests/forge-reference-image*.test.js` passes, including fall-through on 401, 429 and refusal.
- [ ] With no key: a live call to the xAI image endpoint returns the documented 401 (output in the report), and a forge job with `FORGE_REF_IMAGE_PROVIDER=xai` on your dev server completes through the existing lane with the fall-through log line.
- [ ] With a key (if order 927 has landed): `node scripts/grok-eval-ref-image.mjs` completed all 80 generations and `docs/evals/grok-imagine-ref-image.md` reports real numbers. Without a key: the harness ran end to end on the existing provider (40 real results committed as the baseline), and the owner message holds the one command that adds the xAI column.
- [ ] `npm test` and `npm run audit:docs` pass (unrelated reds named in one line).

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No xAI key | Context file, no-key rule. The baseline half of the eval is real work and lands now. |
| Image-to-3D lane is slow or rate limited for 40 prompts | Run it in parallel batches within the lane's documented concurrency, resume from a results file on restart, and report wall time. |
| The vision judge is unavailable | Use the objective metrics alone, state that in the doc, and keep the judge step behind a flag the next run can enable. |
| Content policy refuses a prompt | Record it as a refusal for that provider; it counts against the provider in the doc. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last (the xAI column of the eval after order 927, or setting the flag in production): leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/grok-startups-PROGRESS.md](_context/grok-startups-PROGRESS.md), including the measured number (win rate, or the baseline score when no key exists).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message; one-line judgment calls. No trailing questions.
