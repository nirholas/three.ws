# Refresh the GTC 2027 poster evidence and ship a form-ready submission pack

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/967-plan-nvidia-gtc-poster-submission-pack-refresh.md`.

**Priority:** Gated, the last step needs an owner action or outside party (score 85 of 100 inside the tier). **Area:** nvidia. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

## Operating clause (binding)

- Read `CLAUDE.md` at the repo root before anything else. It overrides this file wherever they disagree.
- Finish 100% in this session. Do not end the turn with a question, an option list, a plan, or "let me know". Make reasonable judgment calls, act on them, and note each in one line in the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: signing or sending a transaction, spending or moving funds, paying an x402 endpoint, minting or launching a coin; `git push`, production deploys, publishing or posting externally; committing content that references a crypto project other than $THREE; destroying data that cannot be regenerated. Do every other part of the work around a gate, and batch every such ask into one message at the end.
- Enterprise grade, no shortcuts. No mocks, no fake data, no placeholders, no sample arrays, no fake loading or progress, no unfinished-work markers, no stub functions, no commented-out code. Real APIs, real endpoints, real data. Errors are handled at the boundaries (network, user input) with a real recovery path.
- Bug fixes are test-first: write the test that reproduces the bug, watch it fail for the reported reason, fix the code, watch it pass, and commit the test with the fix.
- UI work meets the bar a senior design review would pass: hover, focus and active states on every interactive element, designed empty, error and loading (skeleton) states, keyboard accessible, works at phone width, and verified in a real browser.
- Solana is the home chain and leads every design. Robinhood means Robinhood Crypto only. $THREE (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) is the only promoted coin; tests and fixtures use it or a clearly synthetic placeholder, never a real third-party mint.
- Never write the em-dash or en-dash characters anywhere (code, docs, UI copy, commit messages). Use a period, comma, colon, parentheses, or a plain hyphen.
- Before writing any non-trivial feature or UI, load `.claude/skills/engineering-standards/SKILL.md`. Before claiming done, load `.claude/skills/changelog-and-docs/SKILL.md`.

## Running alongside other sessions

Many sessions may be working in this same worktree at once. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Start dev servers on a free port (`npx vite --port <free port> --strictPort`), not the default 3000, so you do not collide with another session.

## Why this matters

The GTC 2027 poster call closes Tuesday 2026-11-10, 5 p.m. PT, a week from the date of this review. Two abstracts are drafted (A: driving Audio2Face-3D onto avatars nobody authored for it, B: serving image-to-3D on NVIDIA L4 and RTX PRO 6000 Blackwell), and the doc insists that every number be re-measured on the submission date. The measured figures are from 2026-10-08 (rig coverage and A2F latency) and a proof brief whose window ended 2026-09-30. Submitting stale numbers to a technical review that "weighs proven technical outcomes" costs credibility; submitting nothing wastes the strongest NVIDIA-visible item in the plan. Only the owner can submit (the form is tied to the presenting author's identity), so the agent job is to make the submission one paste per field with fresh, reproducible evidence.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `docs/nvidia-gtc-2027-poster.md`: deadline 2026-11-10 5 p.m. PT; abstracts at up to three lengths; evidence tables; poster panel outlines for A and B; guidelines page renders client-side so the field limits were never read.
- Evidence reproduces from: `npm run partners:proof -- --from <start> --to <end>` (`scripts/partner-proof-brief.mjs`; add `--json` and `--mcp-logs`), `POST https://three.ws/api/a2f` (latency), a coverage census of avatar files classified by `A2FPlayer.attach()` on real morph target names.
- Numbers on file: rig coverage 98.0 percent (200 of 204 morphed rigs, 42.8 percent of 467 files), median A2F latency 2.96 s text-in (six of six succeeded), 1.29 to 2.19 s audio-in, 30 fps and 55 blendshapes. The proof brief covers 2026-08-31 to 2026-09-30 with 12,373 maker requests and 7,111 finished models.
- The doc's own rules: no product pitch, no token, no pricing; forge outputs and photo-avatar exports must be labeled as having no morph targets; L4 TRELLIS latency caveat must be stated.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
date -u
sed -n 1,20p docs/nvidia-gtc-2027-poster.md
ls scripts/partner-proof-brief.mjs && npm run partners:proof -- --help 2>&1 | head -15
curl -s -o /dev/null -w "%{http_code}\n" https://three.ws/api/a2f
git log --oneline -5 -- docs/nvidia-gtc-2027-poster.md docs/partners/proof-brief-2026-10.md
```

If the date is past 2026-11-10 5 p.m. PT, stop and report that the window closed; do not edit.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Regenerate the proof brief for a fresh 30-day window ending on the run date: `npm run partners:proof -- --from <start> --to <end> --json` and the human form. Save as `docs/partners/proof-brief-2026-11.md` keeping the structure and caveats of the 2026-10 issue (read-only database queries only).
2. Re-measure the A2F latency table with six consecutive text-in calls of the same 20-word line against `POST https://three.ws/api/a2f` (the free lane the doc uses), record median and range with the date and the exact command. Do the same for the audio-in path with a short WAV, three calls.
3. Re-run the rig-coverage census with the method in the doc's evidence table (same caps: at most 60 per source, 469 distinct files from human accounts, classified by the shipping `A2FPlayer.attach()` on each file's morph target names). If the script that did this is not in `scripts/`, write it as `scripts/a2f-rig-coverage-census.mjs` so the number is reproducible by the next person, reading production storage and the database read-only.
4. Update the abstracts, evidence tables and poster panels in `docs/nvidia-gtc-2027-poster.md` for every number that moved. Keep the stated caveats (no-face props, photo-avatar exports with no morph targets, TRELLIS maker-latency stamping from 2026-09-24).
5. Try to read the form's field limits: fetch `https://register.nvidia.com/flow/nvidia/gtc27/cfsresources/page/posters` with a headless browser (Playwright is in the repo; render the client-side page and read the text). If limits are found, trim the three abstract lengths to fit and record the limits; if the page needs a login, keep the three lengths and say so.
6. Produce `docs/nvidia-gtc-2027-poster-submission-pack.md`: for each of A and B, one block per form field with the exact text to paste, the word count, and the evidence command beside each number; plus a final checklist (author identity, affiliation, attendance obligation of one author at the Poster Reception between 2027-03-14 and 03-18, notification rolling from mid-December).
7. Add a short note to `docs/nvidia-gtc-2027-poster.md` pointing at the pack and the refresh date. Add a `data/changelog.json` entry only if a user-visible page changed (docs pages count when listed in `data/pages.json`); run `npm run build:pages` if so.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `docs/partners/proof-brief-2026-11.md` exists with a window ending within 2 days of the run date and a source key.
- [ ] Every number in the abstracts of `docs/nvidia-gtc-2027-poster.md` matches a command output captured in the pack, with the date.
- [ ] `docs/nvidia-gtc-2027-poster-submission-pack.md` contains one paste block per field for A and B, each with word count.
- [ ] `grep -niE 'pricing|\$THREE|coin' docs/nvidia-gtc-2027-poster-submission-pack.md` returns nothing (the submission is research, not a pitch).
- [ ] The final report states the submit URL, the deadline and who must submit.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Production database read access is not available | Use the read-only `DATABASE_URL` from Secret Manager or the Cloud Run env per the self-unblock playbook; the proof script only issues SELECTs |
| The guidelines page needs a login | Keep the three abstract lengths, record that limits were not readable, and tell the owner to use the longest length the form accepts |
| A number got worse since October | Publish the new number honestly with the date; do not keep the old one |
| Window closed | Report it plainly and leave the docs as they are |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

Submitting the form is an external posting and needs the owner's identity. This order stops after the pack is complete and the owner pastes it. All such asks are batched into one message at the end.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/967-plan-nvidia-gtc-poster-submission-pack-refresh.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `967-plan-nvidia-gtc-poster-submission-pack-refresh.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/nvidia-gtc-2027-poster.md` (whole file)

~~~~markdown
# NVIDIA GTC 2027 poster submissions

Paste-ready submissions for the [GTC 2027 Poster Call for Submissions](https://www.nvidia.com/en-us/gtc/present/call-for-submissions/)
(San Jose, 2027-03-15 to 03-18). This is the abstract work that
[nvidia-visibility-map.md](./nvidia-visibility-map.md) asked to have written before the form
opened. The form is now open.

| | |
|---|---|
| **Deadline** | **Tuesday 2026-11-10, 5 p.m. PT** |
| **Submit at** | `https://register.nvidia.com/flow/nvidia/gtc27/cfsposters/form/submittername/login` |
| **Notification** | Rolling, from mid-December 2026 |
| **Obligation if accepted** | One author attends the Poster Reception (between 2027-03-14 and 03-18) and answers questions in person |
| **Who submits** | Owner. The form is tied to the presenting author's identity |

Checked 2026-10-08. The call states the bar plainly: posters "must present original technical
or research-based work", and anything "promotional, business use cases, conceptual, or lack
technical depth will not be considered". Selection weighs proven technical outcomes, innovation
enabled by accelerated computing, and a research framework (problem, NVIDIA technology,
benchmarking method, results). Both submissions below are written to that frame: no product
pitch, no token, no pricing, every number measured on production and reproducible from a
command in this repo.

The guidelines page (`register.nvidia.com/flow/nvidia/gtc27/cfsresources/page/posters`) renders
client-side, so its field limits could not be read in advance. Each abstract is therefore given
at up to three lengths. Use the longest one the form accepts.

Submit **A** first. It is the stronger fit: original method, NVIDIA ACE technology at its center,
and a coverage result nobody else has published. **B** is a valid second submission if the form
allows more than one per author.

---

## A. Driving Audio2Face-3D onto avatars nobody authored for it

**Title (95 characters)**

> Audio2Face-3D on Arbitrary User Rigs: Direct and Derived Blendshape Mapping for Browser Avatars

**Topic:** Content Creation / Rendering (secondary: Agentic AI). **Industry:** Media and Entertainment.
**Technologies:** NVIDIA ACE Audio2Face-3D, Riva ASR, Magpie TTS, Nemotron (NIM), NVCF gRPC.

**Abstract, short (about 500 characters)**

> Audio2Face-3D emits ARKit blendshape tracks, but avatars on the open web use ARKit, VRM vowels, Oculus visemes, or no face morphs at all. We present a browser runtime that maps one A2F-3D track onto any of them: direct canonicalization of ARKit spellings, plus a derived path that reconstructs vowel and viseme expressions from ARKit weights. On 467 real user avatars, 98.0% of rigs with any morph targets were face-driven by A2F. Text to speech to 30 fps animation completes in a median 2.96 s for 6 s of speech.

**Abstract, standard (about 1,250 characters)**

> NVIDIA Audio2Face-3D produces high-quality facial animation as an ARKit-52 blendshape track, and is usually demonstrated on characters authored for it in a game engine. Web avatars are different: they arrive from text-to-3D generators, photo reconstruction, avatar creators, and arbitrary uploads, and expose ARKit morphs, VRM vowel expressions, Oculus visemes, or nothing usable. We built a browser runtime that drives any of these from one A2F-3D track. A direct path canonicalizes the many spellings of ARKit shapes; a derived path inverts a VRM/Oculus-to-ARKit component map so an expression's activation is reconstructed from the ARKit frame, and is suppressed on meshes that already have direct mouth coverage to prevent lip overshoot. Speech comes from Magpie TTS at 44.1 kHz; A2F-3D consumes a 16 kHz resample while the browser plays the original audio and samples the 30 fps track by the audio clock. Measured on production: across 467 distinct user avatar files, 98.0% of rigs carrying any morph targets were face-driven (194 direct, 6 derived), and text in to speech plus animation out completed in a median 2.96 s (2.29 to 3.90 s) for 5.9 to 7.0 s of speech. We report the mapping tables, failure modes, and coverage by avatar source.

**Abstract, long (about 300 words)**

> **Problem.** NVIDIA Audio2Face-3D (A2F-3D) converts speech into an ARKit-52 blendshape track and is typically shown driving characters authored for it in Unreal or Omniverse. On the open web the character is not authored for it: avatars are generated from a text prompt, reconstructed from a selfie, exported from third-party creators, or uploaded from anywhere. Their faces expose ARKit morphs under inconsistent names, VRM vowel expressions, Oculus visemes, or no morph targets at all.
>
> **Method.** We present a zero-install browser runtime that drives any such rig from one A2F-3D track. The voice loop is Riva ASR in, Nemotron (NIM) reasoning, Magpie TTS out, and A2F-3D animation, all over NVCF gRPC. Magpie's 44.1 kHz output is downmixed and resampled to the 16 kHz A2F-3D contract, while the browser plays the original audio and samples the 30 fps, 55-shape track against the audio clock with inter-frame interpolation. Per mesh, a direct path canonicalizes ARKit spellings; a derived path inverts a VRM/Oculus-to-ARKit component map, reconstructing each expression's activation as the normalized sum of its ARKit components. The derived path is suppressed when a mesh already has direct jaw or mouth coverage, which removes double-driven lip overshoot. Unmappable rigs degrade to amplitude lipsync rather than a frozen face.
>
> **Benchmark.** We classified 469 distinct avatar files made by real users (stratified by source, at most 60 per source; 467 readable) with the production player, and measured end-to-end latency on the production endpoint.
>
> **Results.** 98.0% of rigs that carry any morph targets are face-driven by A2F-3D (194 direct, 6 derived, 4 unmapped). Source matters: 57 of 60 selfie reconstructions and 53 of 60 studio avatars are driven directly, while third-party creator exports often ship without morphs. Text in to synchronized speech and animation out completes in a median 2.96 s for about 6 s of speech, faster than real time.

### Evidence behind every number

| Claim | Value | How it was measured | Reproduce |
|---|---|---|---|
| Rig coverage | 98.0% of morphed rigs driven (200 of 204); 42.8% of all files (200 of 467) | 469 distinct avatar files from human accounts, at most 60 per source, classified by the shipping `A2FPlayer.attach()` on each file's real morph target names, 2026-10-08 | `node scripts/a2f-rig-coverage.mjs` |
| Direct vs derived | 194 direct ARKit mouth, 6 derived from VRM/Oculus expressions | same run | same |
| End-to-end latency, text in | median 2.96 s, range 2.29 to 3.90 s, for 5.9 to 7.0 s of speech; 6 of 6 succeeded | six consecutive `POST https://three.ws/api/a2f` with a 20-word line, 2026-10-08 | `curl -X POST https://three.ws/api/a2f -H 'content-type: application/json' -d '{"text":"..."}'` |
| End-to-end latency, audio in | 1.29 to 2.19 s for 5.5 s of audio | three consecutive calls with a WAV body, 2026-09-22 | [forum post](./nvidia-forum-browser-digital-human.md#measured-against-production-2026-09-22) |
| Track shape | 30 fps, 55 blendshapes (ARKit-52 plus three tongue shapes) | every response above | response `animation.fps`, `animation.blendShapeNames` |

Coverage by source, from the same run (counts of distinct files):

| Source | Direct | Derived | Unmapped | No morphs |
|---|---|---|---|---|
| Selfie reconstruction | 57 | 0 | 0 | 3 |
| Studio | 53 | 0 | 0 | 7 |
| Direct upload | 27 | 0 | 2 | 0 |
| Fork | 26 | 2 | 0 | 32 |
| Auto-rig | 19 | 0 | 0 | 0 |
| Import | 8 | 4 | 1 | 47 |
| Upload | 4 | 0 | 1 | 55 |
| Photo-avatar exports | 0 | 0 | 0 | 59 |
| Forge (text to 3D props) | 0 | 0 | 0 | 59 |

Say plainly in the poster: forge outputs are mostly props and have no face, and the photo-avatar
exports stored on three.ws carry no morph targets at all (verified on the raw files), so those
avatars use the amplitude fallback. The 98.0% figure is coverage of rigs that have a face to
drive, and the poster must label it that way.

### Poster panels

1. Problem: one A2F-3D track, five face conventions (a grid of the same line of dialogue on an ARKit, VRM, and Oculus rig).
2. Pipeline: Riva, Nemotron, Magpie, A2F-3D over NVCF gRPC; the 44.1 kHz playback versus 16 kHz inference split.
3. Mapping: the direct canonicalizer and the inverted derived map, with the overshoot suppression rule.
4. Results: the coverage table above and the latency series.
5. Lessons: function ids that rotate and fail closed; interpolating a 30 fps track for 60 and 120 Hz displays.

Source files to cite: `src/voice/a2f-player.js`, `src/voice/arkit-blendshapes.js`,
`api/_lib/a2f-nvidia.js`, `api/_lib/tts-nvidia.js`, `api/_lib/asr-nvidia.js`. Live demo for
reviewers: `https://three.ws/demos/audio2face`.

---

## B. Serving image-to-3D on NVIDIA L4 and RTX PRO 6000 Blackwell

**Title (93 characters)**

> Cost and Latency per Successful Mesh: Serving Image-to-3D on Serverless L4 and Blackwell GPUs

**Topic:** AI Infrastructure (secondary: Content Creation / Rendering). **Industry:** Media and Entertainment.
**Technologies:** NVIDIA L4, NVIDIA RTX PRO 6000 Blackwell, CUDA 12, NVIDIA Kaolin, nvdiffrast, NIM.

**Abstract, short (about 500 characters)**

> We serve open image-to-3D models (TRELLIS on L4, Hunyuan3D 2.1 on RTX PRO 6000 Blackwell) as serverless GPU workers for a public text-to-3D product. Over 31 days the fleet produced 19,270 successful meshes. We report the metric that matters to an operator: list-price GPU cost per successful output ($0.18 on L4 TRELLIS, $0.44 on Blackwell Hunyuan3D), p50/p95 job latency (124/325 s and 135/304 s), and how cross-lane failover recovered 810 failed attempts before a user saw an error.

**Abstract, standard (about 1,100 characters)**

> Open image-to-3D models are now good enough for production, but published results report quality, not what it costs to serve them to real users. We operated a fleet of serverless GPU workers on Cloud Run behind a public text-to-3D product for 31 days: Microsoft TRELLIS on NVIDIA L4 across two regions, Hunyuan3D 2.1 on NVIDIA RTX PRO 6000 Blackwell, and an auto-rigging worker on L4, with NVIDIA NIM-hosted models for reasoning and vision QA. The fleet produced 19,270 successful meshes. We define cost per successful output as list-price GPU, vCPU, and memory time from Cloud Monitoring billable instance time, divided by successful meshes on that lane, and measure $0.18 for L4 TRELLIS, $0.44 for Blackwell Hunyuan3D, and $0.30 for rigging. Job latency was p50 124 s / p95 325 s on L4 TRELLIS and p50 135 s / p95 304 s on Blackwell Hunyuan3D. Warm minimum instances dominate cost at this volume, so throughput per billable hour (7.8 and 7.3 meshes) is the lever. We also report two worker incidents, their root causes, and a cross-lane failover that recovered 810 failed attempts before a user saw a failure.

### Evidence behind every number

Every figure comes from [the 30-day proof brief](./partners/proof-brief-2026-10.md) (window
2026-08-31 to 2026-09-30), which lists the query behind each one. Regenerate it on the submission
date with `npm run partners:proof -- --from <start> --to <end>` and update any number that moved.
The latency figures for L4 TRELLIS are from the catalog seeder driving the same workers (maker
latency was only stamped from 2026-09-24); the brief's caveats section says so, and the poster
must too.

---

## Content Interest Survey: closes 2026-10-09, 5 p.m. PT

A separate, lighter form that signals topic fit before sessions are planned:
`https://forms.gle/iwGUwc5YQfw6f7X27`. Its questions are not published in advance; these answers
cover what it asks for (topics you want, and novel work you are doing with NVIDIA technology).

- **Themes:** Agentic AI; Content Creation / Rendering; AI Infrastructure.
- **Industry:** Media and Entertainment.
- **Novel work (paste):** "Driving NVIDIA Audio2Face-3D onto arbitrary user-generated avatars in a browser tab, with no install: Riva ASR, Nemotron, Magpie TTS, and A2F-3D over NVCF gRPC, with a direct-plus-derived blendshape mapping that face-drives 98% of real user rigs that carry morph targets. Also: serving TRELLIS and Hunyuan3D image-to-3D on serverless L4 and RTX PRO 6000 Blackwell, measured as cost and latency per successful mesh."
- **Sessions we want to see:** ACE and Audio2Face on the web and on non-authored rigs; serverless GPU inference economics; 3D generative model serving.

---

## Related

- [NVIDIA visibility map](./nvidia-visibility-map.md): every NVIDIA surface, and why GTC is the largest
- [Browser digital-human forum post](./nvidia-forum-browser-digital-human.md): the published technical basis for poster A
- [30-day proof brief](./partners/proof-brief-2026-10.md): the evidence behind poster B
- [Partnership pipeline](./partners/opportunities.md): where this sits among the other partner actions
~~~~

### `docs/partners/proof-brief-2026-10.md` (whole file)

~~~~markdown
# three.ws 30-day proof brief: October 2026 issue

**Window:** 2026-08-31 to 2026-09-30 (31 days). **Data pulled:** 2026-09-30 08:24 UTC, so the
last day is partial. **Regenerate:** `npm run partners:proof -- --from 2026-08-31 --to 2026-09-30`
(add `--json` for the raw report, `--mcp-logs` for the Cloud Logging census).

This is the evidence sheet the [distribution and co-marketing plan](./openai-ibm-nvidia-growth-plan.md)
scheduled for October 14. Every number below was read from production (Neon, Cloud Run,
Cloud Monitoring, the Cloud Billing catalog, npm, GitHub) by
[`scripts/partner-proof-brief.mjs`](../../scripts/partner-proof-brief.mjs), and the query behind
each one is listed in the [source key](#source-key). Nothing is projected, sampled, or rounded
up. Where a number is weak or was not measurable, the brief says so instead of leaving it out.

---

## Headline metrics

| # | Metric | Value | Source |
|---|---|---|---|
| 1 | 3D generation and rigging requests from real makers | **12,373** requests, **7,111** finished models | Q1 |
| 2 | Completion rate, normal operation (19 of 31 days) | **90.2%** (5,486 of 6,085) | Q1 daily |
| 3 | Completion rate, last 5 days after recovery (Sep 26 to 30) | **87.0%** (1,357 of 1,560) | Q1 daily |
| 4 | Completion rate, whole window including two incident windows | **57.5%** (7,111 of 12,367 terminal) | Q1 |
| 5 | Distinct makers | **7,613** browsers from **1,988** network origins; **215** signed-in | Q1 |
| 6 | Successful meshes produced by the GPU fleet (all origins) | **19,270** on self-hosted GPUs (11,247 L4 TRELLIS, 5,355 RTX PRO 6000 Hunyuan3D, 2,578 rigs, 90 TripoSG) | Q3 |
| 7 | GPU services live on Cloud Run | **12** GPU services; **6** carried the month: 5 on NVIDIA L4, 1 on NVIDIA RTX PRO 6000 Blackwell; **3,893** billable GPU instance hours | G1, G2 |
| 8 | Median job latency, RTX PRO 6000 lane (maker requests, Sep 24 to 30) | **p50 135 s, p95 304 s** (n = 572) | Q2 |
| 9 | Median job latency, L4 TRELLIS lane (fleet, full window) | **p50 124 s, p95 325 s** (n = 9,552) | Q4 |
| 10 | GPU cost per successful output at Cloud Run list price | **$0.18** L4 TRELLIS, **$0.44** RTX PRO 6000 Hunyuan3D, **$0.30** rigging | G1 to G3, Q3 |
| 11 | MCP tool calls | **13,898** at **99.4%** handler success; handler p50 **143 ms** | Q5 |
| 12 | MCP client names that registered over OAuth | **13**, including our own CLI (Antigravity, Claude, ChatGPT, Codex, Cursor, Claude Code, Glama, ZCode, and others) | Q6 |
| 13 | NVIDIA NIM inference calls | **88,431** calls, **138.4M** tokens (Nemotron 3 Super p50 **1.7 s**) | Q7 |
| 14 | Agents created by people | **727** agents by **415** owners (**323** published, **725** with a 3D body) | Q8 |
| 15 | Avatars created by people | **703** (322 studio, 154 selfie reconstruction, 72 forge, 69 import, 86 other) | Q9 |
| 16 | Signups and active accounts (people only) | **412** signups, **453** active | Q10 |
| 17 | npm downloads, `@three-ws` scope | **25,312** across **106** packages | P1 |
| 18 | GitHub | **219** stars, **52** forks (**26** forks created in the window) | P2 |

Every people-count excludes the platform's own seed crons (43,376 seeded avatars and their
machine accounts), QA logins, and synthetic test registrations. Every forge count excludes
catalog-seeder and internal benchmark rows, and folds a failed-over attempt into the successor
row that finished the request. Those rules are the same ones the owner dashboards use
(`api/_lib/forge-funnel.js`).

---

## What the month actually looked like

The completion rate is the number every partner will ask about, so here is the whole shape.

| Period | Days | Requests | Finished | Completion |
|---|---|---|---|---|
| Normal operation | 19 | 6,085 | 5,486 | **90.2%** |
| Rigging incident, Sep 11 to 15 | 5 | 3,936 | 1,297 | 33.0% |
| Generation incident, Sep 19 to 25 | 7 | 2,352 | 328 | 13.9% |
| Recovered, Sep 26 to 30 | 5 | 1,560 | 1,357 | **87.0%** |

(The recovered rows are a subset of normal operation; the three windows above them partition
the month.)

Two failures account for most of the lost requests, and both are worker-side, not model-side:

1. **Rigging, Sep 11 to 15:** 2,346 rig jobs failed with `task not found on gcp service`: the
   rig worker's task records stopped resolving when polled, during a burst of about 500 rig
   requests a day (3,176 rig requests from Sep 10 to 15, from 138 network origins). Rigging
   completed 98.6% of requests on Sep 16 to 18.
2. **Generation, Sep 19 to 25:** the TRELLIS worker served an image built before its system
   library fix (`35d798585`) and its jobs were orphaned (1,251 failures, `no progress within 30
   minutes`), while the Hunyuan3D worker returned `pipeline unavailable` (899 failures). TRELLIS
   traffic was rolled back to the last good revision on Sep 29 (recorded in the
   [ChatGPT resubmission checklist](../../prompts/store-submissions/_generated/openai-submission.md)),
   and it finished 58 of 66 jobs on Sep 30. From Sep 26, once Hunyuan3D recovered, the router
   sent most generation to the RTX PRO 6000 lane, which finished 544 of 621 requests on Sep 26
   to 29 while TRELLIS was still down. The last full day, Sep 29, finished 91.6%.

Automatic failover recovered **810** failed attempts on another lane before the maker saw a
failure (478 from TRELLIS, 332 from Hunyuan3D); those are already folded into the numbers above.

**How to quote it:** "90% completion in normal operation, 87% over the last five days, with two
worker incidents in September that we root-caused and fixed." Do not quote 90% as a monthly
figure; the monthly figure is 57.5%.

---

## OpenAI: interactive 3D creation inside ChatGPT

**Lead story:** turn a plain-language request into a textured, downloadable 3D asset and inspect
it in an interactive viewer without leaving ChatGPT.

**Verified proof:**

- **1,723 tool calls** reached the two ChatGPT-facing MCP servers with **zero errors**:
  `mcp-studio` 1,534 (the Apps SDK connector) and `mcp-chatgpt` 189. Top tools: `forge_free`
  467, `check_job` 450, `forge_avatar` 242, `look_at_model` 200, `mesh_forge` 188. Other MCP
  clients can also connect to `mcp-studio`, so this is an upper bound on ChatGPT-originated
  calls. (Q5)
- **ChatGPT completed OAuth against three.ws:** 1 client registration, 7 token grants, 2
  accounts. Codex added 26 grants for 2 accounts. (Q6)
- **Generated GLB examples from inside ChatGPT:** the telescope and robot mascot in the
  [gallery](#example-gallery) were made through the ChatGPT connector on Sep 28 and load
  publicly today.
- **Viewer UX:** every finished model opens in the three.ws viewer at `https://three.ws/m/<id>`,
  and ships a web-optimized GLB (meshopt, 270 to 880 KB for the gallery models) beside the full
  file.

**Say plainly:** the ChatGPT app is still in review, so this is developer-mode and review
traffic, not directory installs. The installs number OpenAI will want arrives after listing.
The honest ask today is the Developer Showcase, with this brief as the evidence.

---

## IBM: governed enterprise agents gaining 3D capabilities through Remote MCP

**Lead story:** add production 3D generation and digital-human capabilities to governed
enterprise agent workflows through a Remote MCP server with standard OAuth.

**Verified proof:**

- **The Remote MCP surface is production-grade by the numbers:** 13,898 tool calls across the
  three.ws MCP servers at **99.4%** handler success, p50 **143 ms** for the non-generative tools.
  Of the 89 errors, 85 are the Granite tools described below. (Q5)
- **Auth works with the clients enterprise developers already use:** 13 client names
  registered through OAuth dynamic client registration in the window (12 besides our own
  CLI), including Antigravity (149 registrations), Claude (19), Glama (5), Cursor, Codex, and
  ChatGPT. Claude, Codex, ChatGPT, Grok, and Claude Code were issued tokens for signed-in
  accounts (Claude alone: 50 grants to 4 accounts). (Q6)
- **Deployment:** one Cloud Run service (`three-ws-api`, us-central1) serves every MCP endpoint;
  the IBM listing endpoint is `https://three.ws/api/mcp-3d`.
- **Workflow value is real volume:** 7,111 finished 3D models and 727 agents created by people in
  the window are the capabilities an Orchestrate agent would call.

**Blocker to fix before the IBM pitch:** the Granite and watsonx tools are down. All 17 Granite
health checks in the window failed, the last watsonx response was **2026-08-07**, and all 85
Granite tool calls failed with `WATSONX_API_KEY is not set`. `WATSONX_API_KEY` and
`WATSONX_PROJECT_ID` are absent from the `three-ws-api` service, `.env`, and `.env.local`. Until
the owner restores them, do not claim a working Granite or watsonx integration in any IBM
material; lead with Remote MCP, OAuth, and deployment. (Q11)

Also say plainly: `/api/mcp-3d` itself served only 7 authenticated tool calls in the window
(its traffic is discovery from directories and crawlers). The listing is ready; enterprise
usage starts with the Agent Connect listing.

Framing rules from [`docs/ibm.md`](../ibm.md) apply: "three.ws is an IBM Business Partner," no
implied endorsement, and the Granite tools are three.ws-built integrations.

---

## NVIDIA: GPU-accelerated 3D and browser digital humans

**Lead story:** a browser-native digital-human and 3D generation stack running across NVIDIA
L4 and RTX PRO 6000 Blackwell on Cloud Run, with NIM-hosted models.

**Verified proof:**

| GPU lane | Accelerator | Billable hours | Successful outputs | p50 / p95 | List cost per success |
|---|---|---|---|---|---|
| Hunyuan3D 2.1 (`model-hunyuan3d-21-rtx`) | RTX PRO 6000 Blackwell | 733 | 5,355 | 135 s / 304 s (makers, Sep 24 to 30) | **$0.44** |
| TRELLIS (`model-trellis`, 2 regions) | L4 | 1,446 | 11,247 | 124 s / 325 s (fleet, full window) | **$0.18** |
| Auto-rig (`model-rig`) | L4 | 728 | 2,578 | 62 s / 75 s (makers, Sep 24 to 30) | **$0.30** (upper bound) |
| TripoSG sketch (`model-triposg`) | L4 | 458 | 90 | 108 s / 337 s (makers, Sep 24 to 30) | $7.22 (idle-dominated) |
| Text to motion (`model-text2motion`, us-east4) | L4 | 525 | not in forge ledger | not measured | not measured |

- **NIM-hosted inference at volume:** 88,431 calls and 138.4M tokens through NVIDIA's hosted
  API. Nemotron 3 Super 120B served 73,571 reasoning calls at p50 1.7 s, p95 4.7 s; Llama 3.2
  11B Vision on NIM served 14,346 model-QA calls at p50 5.2 s, p95 16.3 s. (Q7)
- **NIM-hosted 3D:** the free NVIDIA NIM TRELLIS lane took 502 attempts and finished 398
  (79.3%). (Q2)
- **Warm capacity is the honest lever:** four of the six working services are pinned warm
  (minimum one instance), so each bills about 730 hours a month whether it is busy or not.
  Most of the $6,356 list-price month is that warm time, so cost per output falls as volume
  grows. The RTX PRO 6000 service averaged 7.3 successful meshes per billable hour; the two L4
  TRELLIS services together averaged 7.8. (G1, G2, Q3)

**Not measured this month:** Riva speech and Audio2Face facial animation have no per-call
ledger, so only request counts from Cloud Logging are available (see caveats). Record a
Riva/Audio2Face latency and completion series before the Startup Showcase pitch.

Use "three.ws is a member of NVIDIA Inception." Never "NVIDIA partner."

---

## Example gallery

All five were generated by real makers inside the window, are public, and were verified live
on 2026-09-30: each viewer page returns 200 and each GLB starts with the `glTF` magic bytes and
parses cleanly.

| Model | Made through | Lane and GPU | Geometry | Viewer | GLB |
|---|---|---|---|---|---|
| Vintage brass telescope on a walnut tripod | ChatGPT connector, Sep 28 | Hunyuan3D 2.1, RTX PRO 6000; finished in 66 s | 30,000 triangles, 4 textures | [open](https://three.ws/m/e3521803-4188-49e3-a4ce-30c57cc3e28a) | [web.glb](https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/forge/anon/e3521803-4188-49e3-a4ce-30c57cc3e28a.web.glb) |
| Friendly round robot mascot | ChatGPT connector, Sep 28 | Hunyuan3D 2.1, RTX PRO 6000; finished in 34 s | 30,000 triangles, 4 textures | [open](https://three.ws/m/a73fc6e6-9213-42f9-80e4-7a73f1225c4a) | [web.glb](https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/forge/anon/a73fc6e6-9213-42f9-80e4-7a73f1225c4a.web.glb) |
| Smoky quartz crystals on raw rock | three.ws Forge, Sep 4 | TRELLIS, L4 | 15,812 triangles | [open](https://three.ws/m/fe7f4f97-4839-4e00-92a5-48675055fca7) | [web.glb](https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/forge/7bd4a885f026/fe7f4f97-4839-4e00-92a5-48675055fca7.web.glb) |
| Weathered leather-bound book (kept and downloaded by its maker) | three.ws Forge, Sep 3 | TRELLIS, L4 | 16,452 triangles | [open](https://three.ws/m/324c1a62-9cb8-45d9-ac80-60152eb56ea7) | [web.glb](https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/forge/06b7f9884f2c/324c1a62-9cb8-45d9-ac80-60152eb56ea7.web.glb) |
| Chibi anime character, full body | three.ws Forge, Sep 25 | NVIDIA NIM-hosted TRELLIS | 6,111 triangles, 3 textures | [open](https://three.ws/m/c30f9cc9-28a4-49be-a9cb-81920d6a7983) | [web.glb](https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/forge/44778bb376d3/c30f9cc9-28a4-49be-a9cb-81920d6a7983.web.glb) |

Per partner: lead OpenAI with the telescope and robot (made inside ChatGPT), NVIDIA with the
telescope (Blackwell) and quartz (L4), IBM with any of them as the "what your agent gets back"
slide. Screenshot the viewer page, not the raw GLB. For the next issue,
`npm run partners:proof` lists fresh candidates with their files checked live.

---

## Caveats

- **Completion rate:** 57.5% for the month; 90.2% in normal operation. Both incidents are
  described above. The rigging burst on Sep 10 to 15 used 3,109 browser keys from only 138
  network origins, so the rig failure count overstates how many people were affected.
- **Latency coverage:** maker-request latency is stamped only since Sep 24 (the
  `completed_at` column landed then), so full-window latency for the self-hosted lanes comes
  from the catalog seeder, which drives the same GPU workers and includes a quality-gate render
  after the mesh. The NIM lane's recorded time excludes the synchronous NIM call, so no NIM 3D
  latency is quoted.
- **Cost:** cost per output is Cloud Run **list price** (Cloud Billing catalog SKUs for L4 and
  RTX PRO 6000 without zonal redundancy, plus instance-based vCPU and memory) multiplied by
  Cloud Monitoring `billable_instance_time`, divided by every successful mesh on that lane
  including seeder output. The invoice is covered by Google for Startups credits and was not
  read: BigQuery billing export is not finished (see `docs/ops/gcp-credits-plan.md`). The
  rigging figure is an upper bound because seeder rigs share the worker and are not in the
  denominator. The us-east4 TRELLIS copy is a warm standby and is counted in the TRELLIS cost.
- **Makers:** 7,613 is distinct browser keys, which automated callers can rotate; 1,988
  distinct network origins is the conservative floor. Only 143 finished models were explicitly
  kept or downloaded, because feedback is optional; do not quote a satisfaction rate.
- **MCP distinct clients:** tool calls on the free MCP tools are anonymous, so "distinct
  clients" is measured as OAuth client names (13, one of them our own CLI), not as unique end
  users.
- **npm:** download counts include mirrors and automated installs. The flat distribution
  (median 223 per package across 106 packages) says most of it is registry-wide background
  traffic, so quote the total only next to the most-downloaded packages: `@three-ws/avatar` 715,
  `@three-ws/vision-mcp` 502, `@three-ws/avatar-mcp` 419, `@three-ws/mcp-server` 407,
  `@three-ws/ibm-watsonx-mcp` 372, `@three-ws/scene-mcp` 363.
- **GitHub stars in the window:** not measured. GitHub serves star timestamps only to
  authenticated callers and no token exists on this machine or the service. Run the script with
  `GITHUB_TOKEN` set to fill it in.
- **Embeds:** weak and not pitchable yet. 18 widgets were created and viewed 173 times, all but
  one view on three.ws itself.
- **Paid usage:** not a proof point this month. Of 62,188 x402 receipts in the window, 62,170
  were paid by the platform's own settlement wallets; 18 receipts from 4 outside payers remain.
- **Riva and Audio2Face:** no per-call ledger exists, so there is no completion or latency series
  for them yet.

---

## Before this goes to a partner

1. Restore `WATSONX_API_KEY` and `WATSONX_PROJECT_ID` on `three-ws-api` (owner-held IBM
   credentials), then confirm a green `granite_inference_health` check. Required for the IBM
   pitch.
2. ~~Rebuild `model-trellis` and send traffic to latest.~~ Done: revision `model-trellis-00029-697`
   (built 2026-09-30) carries 100% of traffic. Checked 2026-10-08 against `forge_creations`: the
   self-hosted TRELLIS lane finished 1,028 of 1,052 jobs on Oct 1 and 771 of 791 on Oct 7, and
   has not had a day below 94% since the rebuild. The next issue's completion rate should show it.
3. Re-run `npm run partners:proof` on the send date and update any number that moved.
4. Pick three metrics per partner from the tables above: OpenAI (rows 11, 12, gallery),
   IBM (rows 11, 12, 1), NVIDIA (rows 7, 8, 10).

---

## Source key

All database queries are read-only SELECTs against production Neon with
`$1 = '2026-08-31T00:00:00Z'` and `$2 = '2026-10-01T00:00:00Z'`. The script holds the exact
text; these are the definitions.

- **Q1 forge requests:** `forge_creations fc` where `created_at` in window, `internal = false`,
  no matching `forge_seed_jobs.creation_id`, and `superseded_by is null`. Completion is
  `done / (done + failed)`. Rig rows are `prompt = 'auto-rig'` with no backend.
- **Q2 lanes:** the same rows without the `superseded_by` filter, grouped by backend. Latency is
  `percentile_cont(completed_at - created_at)` over `status = 'done'`.
- **Q3 outputs, all origins:** `count(*) filter (where status = 'done')` from `forge_creations` in
  window, grouped by backend, internal and seeder rows included.
- **Q4 fleet latency:** `percentile_cont(finished_at - started_at)` from `forge_seed_jobs` in
  window, grouped by backend and status.
- **Q5 MCP:** `usage_events` where `kind = 'tool_call'`, grouped by `meta->>'server'`; success is
  `status is distinct from 'error'`; latency is `latency_ms`.
- **Q6 OAuth clients:** `oauth_clients.name` created in window, excluding names matching
  `probe|test|poc-|security|sec-`; grants are `oauth_refresh_tokens` joined on `client_id`.
- **Q7 NVIDIA inference:** `usage_events` where `provider = 'nvidia'`, grouped by `kind` and
  `model`, tokens are `input_tokens + output_tokens`.
- **Q8 agents, Q9 avatars, Q10 people:** `agent_identities`, `avatars`, `users` and `sessions`
  joined to `users u` with `not u.service_account` and QA/test email patterns excluded.
- **Q11 Granite:** `granite_inference_health` and `usage_events` where
  `meta->>'server' = 'mcpibm'`.
- **G1 fleet:** `gcloud run services list --format=json`, GPU from
  `spec.template.spec.nodeSelector['run.googleapis.com/accelerator']`.
- **G2 hours:** Cloud Monitoring `run.googleapis.com/container/billable_instance_time`, summed
  per service and region over the window.
- **G3 prices:** Cloud Billing Catalog API, Cloud Run SKUs `NVIDIA L4 GPU with no zonal
  redundancy`, `NVIDIA RTX Pro 6000 GPU with no zonal redundancy`, `Services CPU
  (Instance-based billing)`, `Services Memory (Instance-based billing)` for each region.
- **P1 npm:** `registry.npmjs.org/-/org/three-ws/package`, then
  `api.npmjs.org/downloads/point/2026-08-31:2026-09-30/<package>` for each `@three-ws/*` name.
- **P2 GitHub:** `api.github.com/repos/nirholas/three.ws` and its `/forks` list.
~~~~

### `docs/nvidia-forum-browser-digital-human.md` (section "Measured against production (2026-09-22)")

~~~~markdown
## Measured against production, 2026-09-22

One line of dialogue, 5.5 seconds of Magpie audio, three consecutive calls each to the public endpoint:

| Path | Round trip |
|---|---|
| Audio in, animation out (`POST /api/a2f` with a WAV) | 1.29 s, 2.09 s, 2.19 s |
| Text in, speech and animation out (Magpie then A2F, one call) | 1.94 s, 2.90 s, 3.17 s |

So A2F-3D animates a 5.5 second clip in well under half its duration, and Magpie adds roughly 0.7 to 1.0 seconds in front of it. The returned track is 166 frames at 30 fps carrying **55** blendshape weights: the ARKit-52 set plus three tongue shapes. Sixty seconds of audio is our hard ceiling per request, about 1.9 MB of PCM and 1800 frames, generous for a line of avatar dialogue and small enough that one request cannot pin a serverless instance.
~~~~

