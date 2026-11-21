# grok-startups 05: Grok Imagine Video hero clips made from real renders of a user's own model

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `grok-startups-` order, so it can run in parallel with all of them. Dev port: 3275.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/grok-startups-00-CONTEXT.md](_context/grok-startups-00-CONTEXT.md) (facts, wording rules, parallel-run rules, the no-key rule). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, deploy, posting) into ONE message at the end. Never contact xAI or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building and `changelog-and-docs` before close-out. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

A GLB in a viewer does not travel on X; a six-second cinematic clip of the same model does. Grok Imagine Video 1.5 accepts up to 14 reference images, so we can feed it real renders of a user's model from several angles and get a clip that is faithful to that model rather than a lookalike. That turns every generated model into a shareable asset, gives creators a reason to post, and gives xAI a native showcase of reference-to-video on real 3D content, which is the kind of build their developer accounts reshare.

## Step 0: re-derive the current state

    sed -n 1,80p api/render/glb.js
    curl -s -o /tmp/render-probe.png -w "%{http_code} %{content_type} %{size_download}\n" "https://three.ws/api/render/glb?glbUrl=https://three.ws/avatars/cz.glb"
    grep -rn "video" api/_lib/*.js | grep -iv "test" | cut -c1-140 | head -30
    grep -rln "mp4\|webm" api src | head -20
    grep -n "GROK_MODELS" -A 30 api/_lib/chat-models.js | head -50
    gcloud run services describe three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 --format=json | grep -c GROK_API_KEY

Pick a real public GLB the render endpoint accepts if the probe above fails (step 0 decides; record which). Then read docs.x.ai for video generation (`.md` suffix): the create endpoint, reference-image fields and limits, duration and resolution options, the async job pattern (create, poll, fetch), output format, pricing per second for the full and lite models, and content policy. Record each with its URL. Check whether `/api/render/glb` accepts camera parameters (azimuth, elevation, framing, background); read the handler, not the docs.

## Tasks

1. **Model ids in one place.** Add `grok-imagine-video-1.5` and `grok-imagine-video-1.5-lite` (verify the slugs in the docs) next to `GROK_MODELS` in `api/_lib/chat-models.js` (hot file).
2. **Multi-angle renders.** If `/api/render/glb` lacks camera control, add it test-first (azimuth, elevation, field of view, transparent or solid background) without changing the default output. Write `api/_lib/glb-turntable-refs.js`, which renders N angles of one GLB (default 6, max 14) and returns the PNGs with their angles.
3. **xAI video client.** `api/_lib/xai-video.js`: create a job with reference images and a prompt, poll with backoff to a hard timeout, download the result to our storage (read how the repo stores generated media; reuse it), return the stored URL, duration and model. Typed errors for 401, 429, refusal and timeout. Usage recorded via `api/_lib/usage.js` with `client_id` `xai-video`. Unit tests use docs.x.ai examples verbatim with source URLs.
4. **Endpoint and job model.** `POST /api/v1/models/hero-clip` (register the route in `vercel.json`, hot file): signed-in users only, takes a model id the caller owns or a public GLB URL, a style preset (turntable, hero push-in, dramatic light sweep, product reveal; each a prompt you write and test) and a duration. It enqueues using the repo's existing job pattern (find it: how forge jobs are queued and polled), returns a job id, and `GET` returns status and the clip URL. Rate limit per account; lite model by default; a daily per-account cap read from env with a sane default.
5. **UI.** On the model viewer page and the forge result card (find both through `data/pages.json` and `src/`), add "Make a hero clip": preset picker, a real progress state driven by job status (skeleton plus status text, never a fake bar), the playable result, download, and Share to X with the clip page as the link. Empty, error (with the reason and a retry) and signed-out states designed. Hover, active and focus states on every control.
6. **No-key behavior.** Without `GROK_API_KEY` the button explains that clips are not available yet and offers the existing turntable (the multi-angle renders as a GIF or WebM built locally with the repo's encoder if one exists; otherwise a looping image strip in the viewer). Honest copy, never a fake clip.
7. **Docs.** `docs/hero-clips.md`, a `docs/grok.md` section (hot file, small anchored edit), a `data/pages.json` entry if a new page lands, and a changelog entry.

## Definition of done

- [ ] `npx vitest run tests/xai-video.test.js tests/glb-turntable-refs.test.js tests/hero-clip*.test.js` passes.
- [ ] On your dev server, a real generated or public model produces 6 real renders from distinct angles (committed as a test artifact under `docs/img/hero-clips/`), and the button walks through the job states.
- [ ] With no key: the live create call returns xAI's documented 401 (output in the report) and the UI shows the honest no-key state. With a key: one real lite clip under 10 seconds is stored and plays in the viewer (URL in the report).
- [ ] Playwright screenshots of the idle, in-progress and result (or no-key) states, no console errors.
- [ ] `npm test` and `npm run audit:docs` pass (unrelated reds named in one line).

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No xAI key | Context file, no-key rule. Renders, endpoint, job model and UI all land now. |
| The render endpoint cannot run locally (headless GL) | Use production `/api/render/glb` for the refs while developing, and run the unit tests against recorded real PNG headers. If you added camera params, they reach production only after a deploy: put that in the owner message. |
| No existing job queue fits | Use the forge job pattern even if it is heavier than needed; do not invent a second queue. |
| The video API caps references below 6 | Use the documented cap and pick angles that maximize coverage; record it. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last (deploy, then a live clip after order 927): leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/grok-startups-PROGRESS.md](_context/grok-startups-PROGRESS.md), including the measured number (seconds from click to playable clip, or render time per angle when no key exists).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message; one-line judgment calls. No trailing questions.
