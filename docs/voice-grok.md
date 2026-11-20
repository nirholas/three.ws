# Grok Voice realtime: speech to speech on a lip-synced avatar

Every other voice path on three.ws is a chain: speech recognition turns the
visitor's words into text, a chat model writes a reply, speech synthesis turns
that into audio, and the avatar's mouth follows the audio. Each hop adds its
own wait. Grok Voice realtime replaces the whole chain with one socket: the
visitor's microphone streams up to xAI's speech-to-speech model and its spoken
reply streams straight back, while the avatar's mouth follows that reply audio
as it plays. Visitors can talk over the avatar, and it stops to listen.

Try it at [/voice/grok](/voice/grok). Put it on your own avatar with one
attribute on the embed (see [the web component](#on-your-own-embed)).

three.ws is a member of xAI's Grok for Startups program.

## How a session works

```
browser                         three.ws                        xAI
───────                         ────────                        ───
GET  /api/voice/grok/session ─▶ configured? model, voices
POST /api/voice/grok/session ─▶ signed in + rate limited
                                POST /v1/realtime/client_secrets ─▶ short-lived secret
                     ◀─ { client_secret, expires_at, ws_url, session }
open wss://api.x.ai/v1/realtime?model=grok-voice-latest
  subprotocol xai-client-secret.<secret>  ──────────────────────────▶
mic PCM16 16 kHz  ──────────────────────────────────────────────────▶
                  ◀──────────────────────────── reply PCM16 24 kHz + transcript
StreamSpeechPlayer ─▶ delayed analyser tap ─▶ avatar visemes
```

- **The xAI key never reaches the browser.** The broker,
  [api/voice/grok/session.js](../api/voice/grok/session.js), mints a
  short-lived client secret with the server key (`GROK_API_KEY`, or
  `XAI_API_KEY`) and returns only that. The browser opens the realtime socket
  with the secret as its `xai-client-secret.<secret>` subprotocol.
- **Signed-in visitors only.** `POST` needs a three.ws session and is rate
  limited per user, since every session minute is billed to the platform
  ($0.08 per minute at xAI's published price). `GET` is public and holds
  nothing secret, so a page can decide which engine to offer before it ever
  asks for the microphone.
- **The agent's persona carries over.** Pass `agent_id` and the broker builds
  the session instructions from that agent: its private persona prompt when the
  caller owns the agent, only its public name and description otherwise. It
  uses the agent's Grok voice if one is set. `voice` in the body picks one of the
  live voices `GET` lists.
- **Usage is recorded** in `usage_events` under the client id `xai-voice` on
  every mint attempt.

The client, [src/voice/grok-realtime.js](../src/voice/grok-realtime.js)
(`GrokRealtime`), owns the socket: microphone capture at 16 kHz, server-side
voice activity detection, barge-in (a visitor who starts speaking cancels the
reply and flushes queued audio), a resumable reconnect, and the latency marks.

## Lip sync: the mouth follows what you hear

Reply audio plays through
[src/voice/stream-speech-player.js](../src/voice/stream-speech-player.js).
Web Audio renders each sample `outputLatency + baseLatency` before it leaves
the speaker (40 to 150 ms on wired output, around 300 ms on Bluetooth), so an
analyser on the output bus opened the mouth early. The audible path now goes
straight to the speakers, and the mouth reads a muted copy through a delay
kept equal to the latency the browser reports, re-read every frame because
browsers report it late. The residual offset is reported with every turn as
`av_offset_ms` (below), so drift is measured, not guessed.

## Latency, measured

Two numbers per turn, from real timestamps on both engines so they compare:

| Mark | From | To |
|------|------|----|
| `response` | end of the visitor's speech | first reply audio frame |
| `mouth` | first reply audio frame | first mouth movement |

The page shows both live and keeps every turn on `window.__voiceGrokTurns`.

**Baseline, the standard chain (what Grok replaces):** median 4,636 ms from
end of speech to the first reply audio (three runs: 5,653, 4,636 and 3,837
ms), measured server side through the production speech recognition, chat and
speech synthesis endpoints with a recorded question
([tests/fixtures/voice/tallest-mountain-question.wav](../tests/fixtures/voice/tallest-mountain-question.wav)).

The Grok figure is measured with the same fixture as soon as the production
key is set:

```bash
node scripts/verify-voice-grok.mjs --base https://three.ws --turns 3
```

The script drives [/voice/grok](/voice/grok) in headless Chromium with the
fixture as the microphone, saves screenshots of every state, and prints each
turn's `response` and `mouth` marks with their medians.

## Without a key: an honest fallback

A server without `GROK_API_KEY` never pretends:

| Call | Answer |
|------|--------|
| `GET /api/voice/grok/session` | `200 { "configured": false, ... }` |
| `POST /api/voice/grok/session` | `503 { "error": "grok_voice_not_configured" }` |
| xAI's own socket with no credentials | `401` |

[/voice/grok](/voice/grok) reads that answer and runs the standard voice chain
on the same avatar, with the same latency readout, and says which engine is
live. A signed-out visitor on a configured server gets a sign-in prompt, with
the standard chain available meanwhile. A broker that answers `503` when a
session opens switches the page to the chain right there, with no reload.

## On your own embed

```html
<script type="module" src="https://three.ws/agent-3d/1.5.2/agent-3d.js"></script>
<agent-3d agent-id="YOUR_AGENT_ID" voice-provider="grok-realtime"></agent-3d>
```

The mic button then opens a Grok session instead of the chain. The visitor
must be signed in to three.ws. Final transcripts land in the chat, and two
events report what happened:

| Event | Detail |
|-------|--------|
| `voice:latency` | `{ kind: 'response' \| 'mouth', ms, av_offset_ms?, output_latency_ms? }` |
| `voice:error` | `{ code, message, fatal }`; `fatal: true` means the session ended |

A server without Grok voice falls through to the standard chain on the same
click. To drive the avatar's mouth from a voice stream your page already owns,
use `lipSyncFrom(analyser)`. The full attribute and event reference is in
[docs/web-component.md](web-component.md).

## From a LiveKit or Pipecat voice agent

Both framework plugins run with Grok Voice realtime as the agent's only model,
and the avatar animates from the same session:

- **LiveKit Agents:** [grok_realtime_agent.py](../integrations/livekit/livekit-plugins-threews/examples/grok_realtime_agent.py)
  hands `livekit-plugins-xai`'s `xai.realtime.RealtimeModel` to an
  `AgentSession` and starts `threews.AvatarSession` on it
  (`pip install "livekit-plugins-threews[grok]"`).
- **Pipecat:** [grok_realtime_bot.py](../integrations/pipecat/pipecat-threews/examples/grok_realtime_bot.py)
  places `ThreeWsAvatarProcessor` right after Pipecat's `GrokRealtimeLLMService`
  (`pip install "pipecat-threews[grok]"`).

Speech-to-speech models emit events in a different order than a chain, and
both plugins were fixed for it: Pipecat streams a reply's opening words before
its audio starts, which used to clip them from the avatar's transcript, and
LiveKit only marks the caller's transcript final after they stop speaking,
which used to leave the avatar's `speech_ended` empty or one turn behind.
Each package's `tests/test_grok_realtime.py` replays recorded Grok event
sequences through the real upstream code to keep it that way. Wiring both
frameworks to an avatar in general is covered in
[docs/voice-framework-integrations.md](voice-framework-integrations.md).

## Configuration

| Variable | Where | Effect |
|----------|-------|--------|
| `GROK_API_KEY` (or `XAI_API_KEY`) | Cloud Run service | Enables the broker. Unset: `503 grok_voice_not_configured` and the chain fallback. |
| `XAI_API_KEY` | your LiveKit or Pipecat worker | Required by both examples; they exit with a message naming it when missing. |
| `GROK_VOICE` | your LiveKit or Pipecat worker | Optional voice for the examples. |

## Tests

```bash
npx vitest run tests/grok-voice*.test.js tests/stream-speech-player-lipsync-offset.test.js
```

covers the broker (no key, signed out, rate limit, persona, mint errors), the
realtime client (barge-in, reconnect, latency marks), the embed attribute and
the lip-sync delay. The Python plugins run `pytest` in their own directories.
