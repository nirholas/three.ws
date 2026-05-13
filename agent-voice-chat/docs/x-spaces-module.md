# X Spaces Module — Deep Dive

## Overview

The `x-spaces/` directory is a Puppeteer-based automation system that allows an AI agent to:
1. Launch a headless Chrome browser
2. Log into X/Twitter
3. Navigate to an X Space
4. Join as a listener, request speaker access
5. Capture incoming Space audio (from other speakers)
6. Transcribe that audio via STT
7. Generate AI responses via LLM
8. Convert responses to speech via TTS
9. Inject the TTS audio back into the Space as if the bot is speaking

---

## x-spaces/index.js — Orchestrator (231 lines)

### State Machine
```
disconnected → launching → logged-in → joining-space → in-space-as-listener
→ requesting-speaker → speaker-requested → speaking-in-space → space-ended
```

### Key Functions

**`start()`** (line 30-62)
- Launches Puppeteer browser via `browser.launch()`
- Injects audio hooks BEFORE navigating (critical — hooks override getUserMedia/RTCPeerConnection)
- Calls `auth.login()` to authenticate
- Auto-joins Space if `X_SPACE_URL` env var is set

**`joinSpace(spaceUrl)`** (line 67-107)
- Navigates to Space URL
- Calls `spaceUI.joinSpace()` to click Join button
- Calls `spaceUI.requestSpeaker()` to request mic access
- If "requested": waits for host approval via `waitForSpeakerAccess()` (up to 5 min)
- If "granted": already a speaker, just unmute
- Unmutes mic, sets state to "speaking-in-space"
- Starts periodic health check (every 10s)

**`speakInSpace(mp3Buffer)`** (line 129-146)
- Pauses audio capture to prevent echo (self-hearing loop)
- Calls `audioBridge.injectAudio()` to push TTS audio into the Space
- Resumes capture after 1.5s cooldown

**`onSpaceAudioChunk(pcmBase64, sampleRate)`** (line 152-183)
- Receives PCM audio chunks from the browser-injected capture hook
- Accumulates chunks with voice activity detection (VAD)
- On 1.5s silence: converts accumulated PCM to WAV, sends to STT
- If transcription has text: emits "transcription" event
- MIN_AUDIO_CHUNKS = 3 (skip tiny noise bursts)

**`startHealthCheck()`** (line 188-207)
- Polls every 10s to check if Space has ended
- Uses `spaceUI.getSpaceState()` to read DOM

---

## x-spaces/browser.js — Puppeteer Setup (92 lines)

**`createSilentWav()`** (line 12-38)
- Creates a 1-second silent 48kHz mono WAV file at `/tmp/agent-audio.wav`
- Used as `--use-file-for-fake-audio-capture` for Chromium's fake media device

**`launch()`** (line 40-77)
- Uses `puppeteer-extra` with Stealth plugin (anti-detection)
- Launches headless Chrome with specific flags:
  - `--use-fake-ui-for-media-stream` — auto-approve mic/camera prompts
  - `--use-fake-device-for-media-stream` — use fake devices
  - `--use-file-for-fake-audio-capture=/tmp/agent-audio.wav` — fake mic input
  - `--autoplay-policy=no-user-gesture-required` — allow audio autoplay
  - `--disable-features=WebRtcHideLocalIpsWithMdns` — prevent WebRTC IP obfuscation
- Sets user agent to Chrome 120 on Linux
- Restores cookies from `.cookies.json` if they exist

**`saveCookies(page)`** (line 79-83)
- Dumps all page cookies to `.cookies.json` for session persistence

---

## x-spaces/auth.js — X Authentication (142 lines)

Three login strategies, tried in order:

### 1. Cookie Login (line 21-25)
- Navigates to `x.com/home`
- If URL stays on `/home` (not redirected to `/login`), already logged in

### 2. Token Login (line 28-42)
- If `X_AUTH_TOKEN` env var is set
- Injects `auth_token` cookie (and optional `ct0` cookie)
- Verifies by navigating to `/home`
- Saves cookies on success

### 3. Form Login (line 44-119)
- Goes to `x.com/i/flow/login`
- Types username (with randomized typing delays 30-100ms for anti-detection)
- Clicks "Next"
- Handles optional email/phone verification step
- Types password
- Clicks "Log in"
- Handles 2FA if present:
  - Emits "2fa-required" event
  - Waits up to 120s for "2fa-code" event (user enters code in admin panel)
- Screenshots on failure for debugging

---

## x-spaces/selectors.js — CSS Selectors (29 lines)

Centralized DOM selectors for X's Space UI. Grouped by function:
- **Login flow:** username input, next button, password input, submit button, verify input
- **Space UI:** join button, request speak button, unmute/mute buttons, leave button, mic button, speaker list
- **State detection:** ended text, live indicator

Uses multiple fallback selectors per element (data-testid, aria-label, text content) because X changes their DOM frequently.

---

## x-spaces/space-ui.js — DOM Interactions (251 lines)

**`findElement(page, cssSelector, textOptions)`** (line 8-20)
- Try CSS selector first
- Fall back to `findButton()` which searches by text content and aria-label

**`joinSpace(page, spaceUrl, emitter)`** (line 22-77)
- Navigate to Space URL
- Check if Space has ended
- Find Join/Listen button using data-testid, then text fallback
- Force-click: removes `disabled` attribute and dispatches MouseEvent (X often disables join buttons even when Space is live)
- Last resort: scan ALL buttons for join-like text

**`requestSpeaker(page, emitter)`** (line 80-106)
- Check if already a speaker (mic button exists)
- Find "Request to speak" button, click it
- Returns "granted", "requested", or false

**`unmute(page, emitter)`** (line 108-151)
- Polls for up to 30s looking for Unmute button
- Searches by aria-label ("unmute", "turn on mic", "start speaking")
- Force-clicks when found (removes disabled, dispatches click event)
- On failure: dumps all button labels + screenshot for debugging

**`waitForSpeakerAccess(page, emitter, timeoutMs=300000)`** (line 189-220)
- Uses `page.waitForSelector('button[aria-label="Unmute"]')` to detect host acceptance
- 5-minute timeout (300000ms)
- Immediately clicks Unmute when it appears
- Checks if Space ended while waiting

**`leaveSpace(page, emitter)`** (line 153-173)
- Find Leave button, click it
- Handle confirmation dialog ("Leave", "Yes")

**`getSpaceState(page)`** (line 175-186)
- Reads DOM to determine: isLive, hasEnded, isSpeaker, speakerCount

---

## x-spaces/audio-bridge.js — Audio I/O (280 lines)

This is the most complex file. It handles bidirectional audio between the Node.js server and the X Space running in the browser.

### Audio OUT (Node → Space): Lines 19-108

**`injectAudioHooks(page, onSpaceAudio)`** (line 19-193)

Runs `page.evaluateOnNewDocument()` — code injected into the browser BEFORE any X JavaScript loads.

1. **Override `getUserMedia`** (line 33-82):
   - Creates a controlled AudioContext + MediaStreamDestination at 48kHz
   - When X requests mic audio, returns the controlled stream instead of real mic
   - Plays silent oscillator to keep stream alive
   - Force-overrides `track.enabled` getter to always return `true` (prevents X from muting the bot)
   - Exposes `window.__injectAudioChunk(pcmFloat32Base64)` for Node to push audio

2. **`__injectAudioChunk`** (line 85-108):
   - Receives base64-encoded Float32 PCM data
   - Creates AudioBuffer, plays it through the controlled MediaStreamDestination
   - This audio gets sent to X's WebRTC peer connection as if the bot is speaking

### Audio IN (Space → Node): Lines 110-192

3. **Hook `RTCPeerConnection`** (line 111-146):
   - Wraps `new RTCPeerConnection()` to intercept all WebRTC connections X creates
   - On "track" event: if audio track, calls `captureAudioTrack()`

4. **`captureAudioTrack(track)`** (line 147-191):
   - Creates a capture AudioContext at 16kHz
   - Uses `createScriptProcessor(4096, 1, 1)` to process incoming audio
   - VAD: skips chunks where max amplitude < 0.001 (silence)
   - Converts Float32Array to base64, sends to Node via `window.__onSpaceAudio()`

### Audio Processing: Lines 199-278

**`mp3ToPcmFloat32(mp3Buffer)`** (line 199-217):
- Uses ffmpeg to convert MP3 → raw PCM Float32LE, mono, 48kHz
- Writes to /tmp files, reads back, cleans up

**`injectAudio(page, mp3Buffer)`** (line 223-241):
- Converts MP3 to PCM Float32
- Chunks into 1-second segments (48000 samples * 4 bytes)
- Sends each chunk to browser via `page.evaluate()` → `__injectAudioChunk()`
- Paces playback by waiting ~90% of chunk duration between sends

**`pcmChunksToWav(pcmChunks, sampleRate=16000)`** (line 248-278):
- Concatenates captured PCM Float32 chunks
- Converts Float32 to Int16 (for STT compatibility)
- Prepends WAV header
- Returns complete WAV buffer ready for STT


