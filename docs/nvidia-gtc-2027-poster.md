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
| Avaturn | 0 | 0 | 0 | 59 |
| Forge (text to 3D props) | 0 | 0 | 0 | 59 |

Say plainly in the poster: forge outputs are mostly props and have no face, and the Avaturn
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
