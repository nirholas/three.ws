# experiments/

Sandbox clones for evaluating integrations into three.ws. None of these are wired into the build — each lives in its own subdir with its own deps.

## What's here

| Dir | Upstream | Purpose |
|---|---|---|
| `talking-head/` | [met4citizen/TalkingHead](https://github.com/met4citizen/TalkingHead) | RPM avatar + viseme lipsync + TTS pipeline. Reference for the "embody" layer — viseme tables and morph-target driving in `modules/talkinghead.mjs`. |
| `livekit-voice/` | [livekit-examples/agent-starter-react](https://github.com/livekit-examples/agent-starter-react) | Production realtime voice agent (Next.js). Drop-in voice backbone — pair with our viewer for embodied voice. |
| `visage/` | [readyplayerme/visage](https://github.com/readyplayerme/visage) | RPM's official R3F avatar component. Source of truth for RPM avatar handling if we go R3F. |

## Notes

- **ERC-8004 reference** — the `ChaosChain/erc-8004-reference` repo I tried to clone returned 404. The standard's canonical home appears to be the EIPs repo or live drafts; we already have our own contracts in [contracts/](../contracts/).
- **`eips-ercs/` at repo root** — accidental clone, please `rm -rf` it (delete was permission-denied during the session).

## Suggested next steps

1. **TalkingHead** — open `experiments/talking-head/index.html` to see it run standalone. The integration target is `modules/talkinghead.mjs` — its `speakAudio()` + viseme map could replace whatever lipsync code we have in [src/](../src/).
2. **livekit-voice** — `cd experiments/livekit-voice && pnpm install && pnpm dev` after setting LiveKit env vars. The integration target is `components/` — we'd embed our `<agent-3d>` web component into the agent UI.
3. **visage** — only useful if we adopt R3F. Otherwise it's a reference for RPM avatar bone names and morph targets.
