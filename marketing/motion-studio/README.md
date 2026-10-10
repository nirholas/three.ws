# Motion studio

A code-rendered film pipeline built around one rule: a frame is a pure function of time. `frame = render(time, shot list, assets, style tokens, seed)`. Nothing reads the wall clock, so any frame can be rendered alone, in any order, and a fix to one shot re-renders only that shot.

The first film is **Give your AI a body** (17 s, 16:9 and 9:16). Every product pixel in it is a screenshot of production, the 3D body is the real `public/avatars/michelle.glb` rendered live with three.js, and the sound is synthesized from the same timeline module as the picture.

## Layout

| Path | What it is |
| --- | --- |
| `brief.md` | The director's brief: facts versus choices, approved assets, the claims every word must satisfy. |
| `style-guide.md` | Keep and avoid rules, type, color, motion rules per object class. |
| `shotlist.md` | Six beats with start and end times and what changes in each. |
| `src/timeline.js` | The single source of beat times. Picture and sound both import it. |
| `src/composition.html`, `src/composition.js` | The stage. Exposes `window.__seek(t)`; `?format=landscape` or `?format=portrait` selects a separate composition, never a crop. |
| `src/render.mjs` | Static server, Playwright frame capture, ffmpeg encode. Modes: default full render, `--stills=1.0,5.5 --format=portrait --dir=reviews/x`, `--determinism`. |
| `src/audio.mjs` | Deterministic procedural WAV (seeded noise) written to `out/audio.wav`. |
| `src/contact-sheet.mjs` | Labelled contact sheets for the critique pass. |
| `assets/screens/` | Live captures from `scripts/capture-motion-studio-assets.mjs`, with a manifest. |
| `reviews/` | Contact sheets from each critique round. |
| `out/` | Final MP4s, poster frames and the audio track. |

## Re-render

```bash
node scripts/capture-motion-studio-assets.mjs     # optional: recapture the live screens
node marketing/motion-studio/src/audio.mjs        # sound
node marketing/motion-studio/src/render.mjs       # both formats, about 3 minutes
node marketing/motion-studio/src/render.mjs --determinism
```

WebGL runs on SwiftShader with the same browser flags as the proof reels (`api/_lib/x-content/reel.js`), so it renders on a server with no GPU.

## The critique loop

Render stills at the beat edges, build a contact sheet, and write the three largest defects with timestamp, evidence and a local fix. Fix those, re-render only those frames, repeat. Round 1 found illegible panels and a hollow ring rendered as a filled block. Round 2 found portrait clipping and overlap, fixed with a separate portrait layout and tighter crops.

## Posting

The 16:9 cut goes to X through the autonomous content queue as `give-your-ai-a-body` (`data/x-content/queue.json`, transcoded by `npm run x:content -- prepare-video`). The 9:16 cut is for Reels and Shorts.

## Resources

What the research found, with licences, for the next film. Verify a licence before you add a dependency.

| Tool | Licence | Notes |
| --- | --- | --- |
| [HyperFrames](https://github.com/heygen-com/hyperframes) | Apache-2.0 | HTML-and-GSAP compositions rendered deterministically, with a Claude Code plugin and skills. The best fit if we outgrow this renderer. |
| [Remotion](https://www.remotion.dev) | Source-available | Free only for individuals and companies of up to 3 people. Check the terms before commercial use. |
| [Remocn](https://github.com/remocn) and remotion-superpowers | MIT | Remotion component and skill collections. |
| Revideo, Motion Canvas, Manim | MIT | Strong for diagrams and code animation, weaker for product films. |
| GSAP | No-charge proprietary | Timeline library, seekable. |
| Anime.js, lottie-web | MIT | Seekable 2D animation. |
| Tone.js | MIT | `Tone.Offline` renders audio deterministically. |
| jsfxr | Public domain | Retro sound effects. |
| whisper.cpp, stable-ts, WhisperX | MIT, MIT, BSD | Word-level caption timing. |
| Mediabunny | MPL-2.0 | Browser-side muxing. |

There is no credible `awesome-` list for this; the closest is the [Remotion resources page](https://www.remotion.dev/docs/resources). `timecut` is unmaintained.
