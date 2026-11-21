# grok-startups 06: Grok Voice realtime speech-to-speech driving a lip-synced 3D avatar

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `grok-startups-` order, so it can run in parallel with all of them. Dev port: 3276.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/grok-startups-00-CONTEXT.md](_context/grok-startups-00-CONTEXT.md) (facts, wording rules, parallel-run rules, the no-key rule). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, deploy, publishing a package) into ONE message at the end. Never contact xAI or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building and `changelog-and-docs` before close-out. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Talking 3D agents are the core of three.ws, and today a voice turn is a chain: speech to text, a model, text to speech, then lip sync. Grok Voice is speech-to-speech over a realtime connection, which removes two hops and most of the latency. A browser demo where you speak to a 3D avatar and it answers with matched lips in well under a second is the single most demo-able thing we can build on xAI's stack, and it maps directly onto LiveKit and Pipecat, where we already ship plugins.

## Step 0: re-derive the current state

    ls src/voice/ api/_lib/a2f-nvidia.js api/_lib/tts-*.js
    sed -n 1,80p src/voice/lipsync-driver.js
    sed -n 1,60p src/voice/stream-speech-player.js
    grep -n "provider\|voice" src/element.js | head -40
    ls integrations/livekit/livekit-plugins-threews integrations/pipecat/pipecat-threews
    grep -n "GROK_MODELS" -A 30 api/_lib/chat-models.js | head -50
    gcloud run services describe three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 --format=json | grep -c GROK_API_KEY

Then read docs.x.ai for the Voice Agent / realtime API (`.md` suffix): the WebSocket URL, how a browser authenticates (ephemeral client secret minted server-side, its endpoint and TTL), session config (voice, instructions, tools, turn detection), the audio formats in and out (sample rate, encoding), the event names for audio deltas and transcripts, and pricing per minute. Record each with its URL. If the realtime API is compatible with an existing realtime client protocol, say which and cite where xAI states it.

## Tasks

1. **Ids in one place.** Add the voice model slug (`grok-voice-latest` or the documented id) to `api/_lib/chat-models.js` (hot file).
2. **Ephemeral token endpoint.** `POST /api/voice/grok/session` (route in `vercel.json`, hot file): signed-in users only, rate limited, mints a short-lived client secret from xAI with our server key and returns only that secret, its expiry and the session config (agent persona as instructions, chosen voice). The server key never reaches the browser. Usage recorded with `client_id` `xai-voice`. Tests use the documented response shape.
3. **Browser realtime client.** `src/voice/grok-realtime.js`: opens the WebSocket with the ephemeral secret, streams microphone audio through the existing [src/voice/mic-capture.js](../../src/voice/mic-capture.js) (resample to the documented input rate in an AudioWorklet), plays response audio through the existing streaming player, and exposes transcript and state events. Handles barge-in (user speech interrupts playback), reconnect on a dropped socket within the token TTL, and clean teardown.
4. **Lip sync from the response audio.** Drive the avatar's visemes from the incoming audio with the existing [src/voice/lipsync-driver.js](../../src/voice/lipsync-driver.js) path that works on raw PCM (read it to find the entry point; do not write a second lip-sync engine). Measure and correct the audio-to-mouth offset.
5. **`<agent-3d>` voice provider.** Add `voice-provider="grok-realtime"` to the web component (find where voice providers are chosen in `src/`), documented as an attribute, with the other providers untouched and the default unchanged.
6. **Demo page.** `/voice/grok` (`pages/voice-grok.html`, a `vercel.json` route, a `data/pages.json` entry): pick an avatar, press to talk or open mic, live transcript, a latency readout computed from real timestamps (end of user speech to first response audio frame, and first audio frame to first viseme), mic permission states, signed-out state, and an error state with the reason. Hover, active and focus states on every control. Link it from `/grok` (hot file, small anchored edit).
7. **LiveKit and Pipecat.** Read both plugin packages. If either framework ships an xAI realtime integration upstream, add a documented example that pairs it with our avatar plugin; otherwise add a Grok realtime option to our plugin following the package's existing provider pattern, with tests in the package's own suite. Update each package README.
8. **No-key behavior.** Without `GROK_API_KEY` the session endpoint answers 503 with a clear code, and the demo page explains that Grok voice is not enabled yet and offers the existing voice chain on the same avatar. Never a fake session.
9. **Docs.** `docs/voice-grok.md` (architecture, latency numbers you measured, the token flow, the attribute), a `docs/grok.md` section (hot file), STRUCTURE.md row, changelog entry.

## Definition of done

- [ ] `npx vitest run tests/grok-voice*.test.js` passes; LiveKit and Pipecat package tests pass where you changed them.
- [ ] With no key: the token endpoint's live call to xAI returns the documented 401 (output in the report), the endpoint returns its 503 code, and the demo page shows the fallback with the existing voice chain working end to end on your dev server.
- [ ] With a key (if order 927 has landed): a real spoken round trip on `/voice/grok` with the measured median latency over 10 turns in the report.
- [ ] Playwright screenshots of idle, listening, speaking (or fallback) and error states, no console errors.
- [ ] `npm test` and `npm run audit:docs` pass (unrelated reds named in one line).

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No xAI key | Context file, no-key rule. Token endpoint, client, provider, page and plugins all land now. |
| No microphone in headless Chromium | Use Chromium's fake audio capture flags with a committed short WAV of real speech you record with a TTS lane the repo already has, so the pipeline is exercised end to end. |
| The realtime protocol differs from what the docs suggested | Follow the observed protocol from a live handshake (the 401 body and headers tell you a lot), cite it, and adapt. |
| Python packages need a venv | Create one in your scratchpad; never install into the system Python. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last (deploy, a live latency run after order 927, publishing plugin packages): leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/grok-startups-PROGRESS.md](_context/grok-startups-PROGRESS.md), including the measured number (median voice-to-voice latency, or the existing chain's latency as baseline when no key exists).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message; one-line judgment calls. No trailing questions.
