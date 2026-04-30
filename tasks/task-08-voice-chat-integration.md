# Task: Wire Voice Chat into the Main Agent Widget

## Context

This is the `three.ws` 3D agent platform. The main `<agent-3d>` web component (`src/element.js`) currently uses the Web Speech API for voice via `src/runtime/speech.js`. There is a separate, more capable voice system in `agent-voice-chat/` (Express + Socket.io, with Claude/Groq/OpenAI providers, conversation memory, and encryption). The floating widget UI already has a TTS toggle button but it just toggles Web Speech API on/off.

The goal is to upgrade the floating widget's voice button so it opens a proper voice session backed by the `agent-voice-chat` server, with clear visual feedback.

## Files to Read First

- `src/runtime/speech.js` (406 lines) — current Web Speech API wrapper
- `src/element.js` — `<agent-3d>` custom element; find where the TTS button is wired up
- `agent-voice-chat/server.js` — Socket.io server entry point; understand the event protocol
- `agent-voice-chat/room-manager.js` — how voice rooms/sessions are created
- `agent-voice-chat/providers/` — stt.js, tts.js, claude.js; understand the pipeline

## What to Build

### 1. Voice session client (`src/runtime/voice-client.js`, new file)

A thin Socket.io client that:
- Connects to the `agent-voice-chat` server URL (configurable, defaults to same origin + `/voice`)
- `start(agentId, config)` — joins a room for the given agent
- `stop()` — leaves the room, disconnects socket
- Captures microphone audio and sends chunks to the server via `audio:chunk` event
- Receives `agent:speak` events from the server (text + TTS audio) and plays them
- Fires a `voiceStateChange` CustomEvent on the element with `{ state: 'listening' | 'thinking' | 'speaking' | 'idle' }`

Keep it under 150 lines. Do not re-implement TTS/STT — the server handles all of that.

### 2. Wire it into `src/element.js`

In the `<agent-3d>` element:
- When the TTS button is clicked and `agent-voice-chat` server is available: use `VoiceClient` instead of `Speech`
- When `agent-voice-chat` is not configured (no `voice-server` attribute): fall back to the existing Web Speech API behavior (no regression)
- Add `voice-server` attribute to the element: `<agent-3d voice-server="https://..." ...>`
- Show a visual indicator: button ring color changes based on `voiceStateChange` state (`listening` = green, `thinking` = yellow, `speaking` = blue, `idle` = gray)

### 3. Update the floating widget HTML

The TTS button currently has this title: `"TTS off — click to enable voice"`. Update it so when voice is active it reads `"Voice active — click to stop"`. Wire the visual state ring to the button's CSS.

## Constraints

- Do not modify `agent-voice-chat/` server code
- Do not remove or break the existing Web Speech API fallback
- Do not add Socket.io to the main bundle if `voice-server` attribute is absent — lazy-import it
- Keep `voice-client.js` focused: connect, stream audio, receive speech. No UI logic in it.

## Success Criteria

- `<agent-3d voice-server="/voice" ...>` uses the voice chat server for voice
- `<agent-3d ...>` (no attribute) falls back to Web Speech API as before
- Visual states (idle/listening/thinking/speaking) are reflected on the TTS button
- No new bundle size cost when the `voice-server` attribute is absent
