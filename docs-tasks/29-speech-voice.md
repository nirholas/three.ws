# Agent Task: Write "Speech & Voice" Documentation

## Output file
`public/docs/speech.md`

## Target audience
Developers adding voice capabilities to their agents — both text-to-speech (agent speaks) and speech-to-text (user speaks). Covers browser-native and API-based options.

## Word count
1200–1800 words

## What this document must cover

### 1. Overview
three.ws supports bidirectional voice:
- **Text-to-Speech (TTS)** — the agent speaks responses aloud
- **Speech-to-Text (STT)** — users speak instead of typing

Both default to browser-native APIs (free, no key required). Enhanced quality is available with ElevenLabs for TTS.

### 2. Text-to-Speech (TTS)

**Browser Web Speech API (default):**
Uses `SpeechSynthesis` — available in all modern browsers, free, no API key.
- Quality: decent, robotic on some OS/browser combos
- Voices: varies by OS (typically 5-30 voices)
- Languages: system-dependent
- Offline: yes (no network required)

**ElevenLabs (enhanced quality):**
High-quality, expressive, natural-sounding voices.
- Quality: excellent, human-like
- Voices: 30+ premium voices + cloned voices
- Languages: 30+ languages
- Offline: no (API call required)
- Cost: ElevenLabs pricing (free tier: 10,000 chars/month)

**Configuration:**
In the agent manifest:
```json
{
  "personality": {
    "voice": "female",
    "language": "en-US"
  }
}
```

To use ElevenLabs:
```env
# .env
ELEVENLABS_API_KEY=your-key
```

And in the manifest:
```json
{
  "personality": {
    "voice": "rachel",
    "tts_provider": "elevenlabs",
    "elevenlabs_model": "eleven_monolingual_v1"
  }
}
```

### 3. Speech-to-Text (STT)

Uses the browser's `SpeechRecognition` API (Chrome/Edge):
- Available in Chrome 25+, Edge 79+
- Not available in Firefox (use polyfill or fall back to text input)
- Requires microphone permission
- Transcribes in near-real-time
- Language set from browser language or `language` config

**Enabling the mic button:**
The `<agent-3d>` element shows a mic button automatically when:
- STT is supported in the browser
- `voice` attribute is not `false`

```html
<!-- Voice enabled (default) -->
<agent-three.ws-id="my-agent"></agent-3d>

<!-- Voice disabled -->
<agent-three.ws-id="my-agent" voice="false"></agent-3d>
```

**Programmatic control:**
```js
const el = document.querySelector('agent-3d');

// Start listening
el.startListening();

// Stop listening
el.stopListening();

// Check if currently listening
console.log(el.isListening);
```

**Events:**
```js
el.addEventListener('speech-start', () => console.log('Listening...'));
el.addEventListener('speech-result', e => console.log('Heard:', e.detail.transcript));
el.addEventListener('speech-end', () => console.log('Done listening'));
el.addEventListener('speech-error', e => console.error('Error:', e.detail.error));
```

### 4. How TTS and agent speak interact
When the LLM runtime calls the `speak` tool:
1. Text dispatched as `speak` event on the protocol bus
2. `speech.js` receives the event
3. If ElevenLabs configured: POST to `/api/tts/eleven` → play MP3 response
4. Else: `speechSynthesis.speak(new SpeechSynthesisUtterance(text))`
5. Avatar emotion system also reacts to the `speak` event (adjusts emotion based on text valence)

### 5. Voice selection

**Browser voices:**
```js
const voices = speechSynthesis.getVoices();
voices.forEach(v => console.log(v.name, v.lang));
// "Samantha" "en-US"
// "Google UK English Female" "en-GB"
// etc.
```

Configure in manifest `voice` field — the runtime selects the best match.

**ElevenLabs voices:**
Notable voices (IDs for API):
- `rachel` — calm, professional female
- `adam` — deep, authoritative male
- `bella` — friendly, warm female
- `clyde` — rugged male
- `elli` — young female
- Full list at elevenlabs.io/voice-library

**Voice cloning:**
ElevenLabs supports cloning your own voice from ~30 seconds of audio. Useful for truly personal AI agents. Configure using the cloned voice ID.

### 6. Language support

For multilingual agents, set language in the manifest:
```json
{
  "personality": {
    "language": "es-ES"  // Spanish (Spain)
  }
}
```

Supported BCP 47 tags: `en-US`, `en-GB`, `es-ES`, `fr-FR`, `de-DE`, `ja-JP`, `zh-CN`, `pt-BR`, etc.

The STT SpeechRecognition also uses this language setting.

### 7. Lip sync (optional)
If your GLB avatar has a `mouthOpen` morph target, the avatar's mouth moves while speaking:
- Simple amplitude-based animation (not phoneme-based)
- The `mouthOpen` morph target is driven by a rough speech waveform envelope
- For true phoneme-based lip sync, use Oculus Lipsync SDK or similar (advanced, not built-in)

### 8. Audio playback in iframes
For embedded agents in iframes, audio autoplay restrictions may apply:
- Most browsers block autoplay without prior user gesture
- The agent will speak after the first user interaction
- Use the `speak` method with a user-triggered button to bypass this:
```js
button.addEventListener('click', () => {
  agent.speak('Hello! How can I help you today?');
});
```

### 9. Disabling audio
To run the agent silently (text only):
```html
<agent-three.ws-id="my-agent" muted></agent-3d>
```

Or programmatically:
```js
el.muted = true;
```

The agent still shows text responses — audio is just not played.

### 10. Privacy considerations
- STT: audio is processed by the browser's native API (Google for Chrome, Microsoft for Edge)
- Do not use STT for sensitive information if using cloud-based browser STT
- ElevenLabs: text is sent to ElevenLabs API — review their privacy policy
- Consider showing users a clear indicator when the mic is active

## Tone
Developer reference. Brief overview, clear code examples for all configuration options. Privacy note is important. Keep it concise.

## Files to read for accuracy
- `/src/runtime/speech.js` (11136 bytes — read fully)
- `/api/tts/eleven.js`
- `/src/element.js` — `voice` attribute handling
- `/src/agent-protocol.js` — speak event
- `/src/agent-avatar.js` — how speak event affects emotion
