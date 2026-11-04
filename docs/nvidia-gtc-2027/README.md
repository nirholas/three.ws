# GTC 2027 poster: one blendshape track, any avatar rig

The print-ready poster for the NVIDIA GTC 2027 Call for Posters (deadline Tuesday
2026-11-10, 5 p.m. PT), the form copy to paste beside it, and the scripts that build the
whole thing from measured data. Nothing on the sheet is typed in by hand: every number,
chart and avatar frame is produced from the JSON under `data/` and from the shipping
`A2FPlayer` applied to real avatar files in `public/avatars`.

| File | What it is |
|---|---|
| [`poster.pdf`](./poster.pdf) | The upload. 43 x 24 in landscape, 1 in white margin, vector text and charts, 300 dpi raster figures, 8.3 MB (limit 100 MB). No NVIDIA branding, per the poster guidelines. |
| [`poster-preview.png`](./poster-preview.png) | Half-resolution raster of the same sheet for review and for the X post. |
| [`poster.html`](./poster.html) | The rendered page the PDF is printed from. Open it in a browser to proofread. |
| [`poster.template.html`](./poster.template.html) | The layout and copy, with `{{slot}}` markers the build fills. Edit this, never `poster.html`. |
| `data/coverage-2026-11-04.json` | Rig coverage run: 470 distinct user avatar files classified by the shipping player (`node scripts/a2f-rig-coverage.mjs`). |
| `data/latency-2026-11-04.json` | Ten consecutive production `POST /api/a2f` calls, wall clock and speech length. |
| `data/a2f-track-sample.json` | One real 228-frame Audio2Face-3D track (30 fps, 55 shapes) used for the frames and the overshoot replay. |
| `data/derived-figures.json` | Every derived number on the sheet, written by the build, so a reviewer can trace each one. |
| `figures/` | The avatar frames (`rig-<rig>-<variant>.png`) and `manifest.json` with the morph counts each frame carries. |

## Rebuild

```bash
npm run poster:gtc:rigs   # render the avatar frames (headless Chromium, software WebGL, about 1 minute)
npm run poster:gtc        # fill the template, check the layout, print poster.pdf and the preview
```

The build exits non-zero and prints `WARNING: n column(s) overflow` when any of the four
columns is taller than the 22 in design area, so a silent cut-off cannot ship. It also prints
the fonts the page loaded; the sheet must report both `Inter` and `JetBrains Mono` (self-hosted
in `public/fonts`).

Both scripts use the Playwright Chromium that `npm test` already uses. On a machine where
that Chromium is missing `libxkbcommon.so.0` (the stock Debian and Ubuntu container images),
extract the library from the distribution's `.deb` into a directory on `LD_LIBRARY_PATH`
before running; the scripts need nothing else from the system.

## Poster spec the sheet follows

Read from the GTC 2027 poster guidelines on 2026-11-04: landscape 43 x 24 in, a 1 in white
margin on every side, PDF, 100 MB maximum, no NVIDIA logos or branding, and the research
frame the reviewers score on: problem, application of NVIDIA technology, benchmarking
method, results with graphs, references. The sheet uses the pattern of recent award
winners: white ground, four columns, numbered section headers, a headline-metric subtitle,
and an author box top right.

## Form copy (paste into the submission portal)

**Poster title** (82 characters, 12 words, no company or product name)

```
One Blendshape Track, Any Avatar Rig: Real-Time Speech-Driven Faces in the Browser
```

**Key takeaways** (five, each under 260 characters)

1. ```
   Audio2Face-3D emits ARKit-52 weights, but real user avatars expose ARKit names, VRM vowels, Oculus visemes, or no face morphs. One direct-plus-derived mapping drove 98.1% of 211 morphed rigs out of 468 real user files, with no per-rig code or allowlist.
   ```
2. ```
   The derived path inverts the hand-authored viseme-to-ARKit compositions, so a VRM or Oculus rig gets a usable mouth from the same track. It is suppressed on any mesh with a direct jaw or mouth shape; otherwise the mouth saturates in 23% of voiced frames.
   ```
3. ```
   Riva ASR, Nemotron, Magpie TTS and Audio2Face-3D over NVCF gRPC turn text into synchronized speech and 30 fps animation in a median 3.8 s for 7.3 s of speech, measured on production: 8 of 10 consecutive calls finished faster than the speech they produced.
   ```
4. ```
   Clock the face from the audio element, not the frame loop. Magpie's 44.1 kHz output plays unchanged while a 16 kHz resample feeds Audio2Face-3D; the player samples the track by the audio clock with interpolation, so 60 and 120 Hz displays stay in sync.
   ```
5. ```
   Name canonicalization beats rig lists: one normalization covered vendor spellings an explicit allowlist would have missed. The remaining limit is files with no facial morphs at all (55% of uploads), which fall back to amplitude lipsync, so no face is frozen.
   ```

**Intended audience:** Developers and technical artists building real-time digital humans,
avatars and conversational agents for the web; engineers integrating ACE Audio2Face-3D with
glTF content they did not author.

**Audience level:** Intermediate.

**Key theme:** Content Creation / Rendering (secondary: Agentic AI).

**Industry segment:** Media and Entertainment.

**NVIDIA technologies:** ACE Audio2Face-3D, Riva ASR, Magpie TTS, Nemotron (NIM), NVIDIA
Cloud Functions (NVCF).

**Abstract** (if the form asks for one, the standard abstract in
[`../nvidia-gtc-2027-poster.md`](../nvidia-gtc-2027-poster.md#a-driving-audio2face-3d-onto-avatars-nobody-authored-for-it)
matches the sheet; its numbers are the same run.)

## Where each number comes from

| Figure on the sheet | Source |
|---|---|
| 98.1% of morphed rigs driven, 207 of 211; 200 direct, 7 derived, 4 unmapped; 257 files with no morphs | `data/coverage-2026-11-04.json` |
| Median 3.8 s latency for 7.3 s of speech; 8 of 10 calls under speech length; tails at 11.0 and 13.7 s | `data/latency-2026-11-04.json` |
| Frame 160, t = 5.333 s, JawOpen 0.684 | `data/a2f-track-sample.json`, peak jaw frame |
| Mouth saturates in 23% of voiced frames, peak 6.1x, with the suppression rule off | Replay of the sample track through `OCULUS_TO_ARKIT` in `src/voice/arkit-blendshapes.js`, computed in `scripts/gtc-poster-build.mjs` and written to `data/derived-figures.json` |
| Morph counts per rig frame | `figures/manifest.json` |

Code the sheet cites: `src/voice/a2f-player.js`, `src/voice/arkit-blendshapes.js`,
`api/_lib/a2f-nvidia.js`, `api/_lib/tts-nvidia.js`, `api/_lib/asr-nvidia.js`. Live demo for
reviewers: `https://three.ws/demos/audio2face`.
