# Avatar Platform

Self-contained prompt files for replacing the hosted Avaturn integration with a fully self-owned, open-source avatar platform: photo-to-avatar, QR-based mobile handoff, customization editor, realtime talking head, live mirroring, and a pluggable brain.

**Strategic decision already made** (see chat history leading up to this series): adopt **VRM** as the format contract (superset of GLB, standardized humanoid + expressions) and **@pixiv/three-vrm** as the runtime. Every downstream task assumes this. If the first foundation task changes that call, the rest need to be revisited.

## Reference repos (all MIT / Apache / MPL)

| Layer | Repo | Used in tasks |
|---|---|---|
| VRM runtime | [pixiv/three-vrm](https://github.com/pixiv/three-vrm) | 02, 09, 12 |
| Editor | [M3-org/CharacterStudio](https://github.com/M3-org/CharacterStudio) | 03, 16, 17 |
| Photo → 3D (HD) | [abdallahdib/NextFace](https://github.com/abdallahdib/NextFace) | 08 |
| Photo → landmarks | [MediaPipe Face Landmarker](https://developers.google.com/mediapipe/solutions/vision/face_landmarker/web_js) | 07, 12 |
| Talking head + lipsync | [met4citizen/TalkingHead](https://github.com/met4citizen/TalkingHead) | 09 |
| TTS w/ visemes | [HeadTTS (Kokoro)](https://github.com/met4citizen/TalkingHead) + [rhasspy/Piper](https://github.com/rhasspy/piper) | 10 |
| STT | [xenova/whisper-web](https://github.com/xenova/whisper-web) | 11 |
| Mirror mode | [yeemachine/kalidokit](https://github.com/yeemachine/kalidokit) | 12 |
| Full-body mocap | [ButzYung/SystemAnimatorOnline](https://github.com/ButzYung/SystemAnimatorOnline) | 13 |
| Local LLM | [mlc-ai/web-llm](https://github.com/mlc-ai/web-llm) | 14 |

## Recommended execution order

### Foundation — do these in order, no parallelism
1. [01-strip-avaturn.md](./01-strip-avaturn.md) — Remove `@avaturn/sdk`, `@avaturn-live/web-sdk`, rename `AvaturnAgent`. **Blocks everything.**
2. [02-vrm-runtime.md](./02-vrm-runtime.md) — Add `@pixiv/three-vrm`, load VRM into the viewer. **Blocks 03, 09–13, 16.**
3. [03-vendor-character-studio.md](./03-vendor-character-studio.md) — Vendor CharacterStudio's `CharacterManager` into `src/character/`. **Blocks 16, 17.**

### Photo capture pipeline — parallelizable after 02
4. [04-desktop-photo-capture.md](./04-desktop-photo-capture.md) — Three-shot webcam capture UI (left/center/right).
5. [05-session-bridge.md](./05-session-bridge.md) — Session store + SSE/WebSocket relay. **Blocks 06.**
6. [06-mobile-capture-route.md](./06-mobile-capture-route.md) — `/m/:sessionId` phone route with QR flow on desktop. **Depends on 05.**
7. [07-photo-to-avatar-fast.md](./07-photo-to-avatar-fast.md) — Browser path: MediaPipe landmarks → morph template head.
8. [08-photo-to-avatar-hd.md](./08-photo-to-avatar-hd.md) — Backend path: NextFace GPU service → high-fidelity rebake.

### Animation stack — parallelizable after 02
9. [09-talking-head.md](./09-talking-head.md) — Vendor `TalkingHead`, wire to the active VRM.
10. [10-tts-visemes.md](./10-tts-visemes.md) — Browser TTS with phoneme/viseme timestamps. **Depends on 09.**
11. [11-speech-to-text.md](./11-speech-to-text.md) — Replace Web Speech API with whisper-web.
12. [12-mirror-mode.md](./12-mirror-mode.md) — Kalidokit-driven webcam mirroring.
13. [13-full-body-mocap.md](./13-full-body-mocap.md) — Optional XR Animator-style full-body capture.

### Brain — after 10, 11
14. [14-agent-brain.md](./14-agent-brain.md) — Pluggable LLM interface: local (WebLLM) and cloud (Claude/OpenAI).
15. [15-conversation-state.md](./15-conversation-state.md) — Session memory, tool invocations, viewer context.

### Editor + UX — after 03
16. [16-character-editor-ui.md](./16-character-editor-ui.md) — Branded side-panel editor driving `CharacterManager`.
17. [17-asset-library.md](./17-asset-library.md) — Browsable VRM asset registry (from CC0 sources).

### Polish
18. [18-branding-pass.md](./18-branding-pass.md) — Scrub `avaturn-` everywhere, rename to project brand.
19. [19-performance-dispose.md](./19-performance-dispose.md) — Render-on-demand, GPU disposal, idle throttling.
20. [20-onboarding-flow.md](./20-onboarding-flow.md) — First-run journey: QR → photo → preview → name → ready.

## Rules that apply to all tasks

- **Vendor, don't npm, whenever feasible.** Copy source into `src/vendor/<name>/` with a `NOTICE` file carrying the upstream license + attribution. Only use npm for deps that are truly infrastructural (`@pixiv/three-vrm`, `three`, `vite`).
- Respect `prefers-reduced-motion` — any motion-heavy feature (mirror, talking head idles) must pause.
- No changes to [src/viewer.js](../../src/viewer.js) foundation beyond what task 02 explicitly does. Feature work lives under `src/character/`, `src/capture/`, `src/agent/`, `src/features/`.
- Feature-flag everything ambitious (`?mirror=1`, `?brain=local`, etc.) until task 20 stitches the flows together.
- `node --check` each JS file. `npx vite build` must continue to pass.
- If an upstream repo's license is anything other than MIT / Apache-2.0 / MPL-2.0 / BSD, stop and ask before vendoring.
- If you discover unrelated bugs, note them in reporting. Do not fix in the same change.
- No new docs files beyond what each task explicitly requires.
