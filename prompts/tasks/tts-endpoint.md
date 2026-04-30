# Task: Implement /api/tts/google endpoint in the Go chat server

## Context

The chat app at `/workspaces/3D-Agent/chat` has a 3D talking avatar powered by the `TalkingHead` library (met4citizen/TalkingHead). It is mounted in `/workspaces/3D-Agent/chat/src/App.svelte` and defined in `/workspaces/3D-Agent/chat/src/TalkingHead.svelte`.

`TalkingHead.svelte` line 21 hardcodes:
```js
export let ttsEndpoint = '/api/tts/google';
```

The Go server at `/workspaces/3D-Agent/chat/server/main.go` has no `/api/tts/google` route. The avatar can load visually but cannot speak because this endpoint doesn't exist — `speakText()` calls it internally.

## What to build

Add a `POST /api/tts/google` handler to `/workspaces/3D-Agent/chat/server/main.go` that proxies to the Google Cloud Text-to-Speech REST API.

### Request format (sent by TalkingHead library)
```json
{
  "input": { "text": "Hello world" },
  "voice": { "languageCode": "en-US", "ssmlGender": "FEMALE" },
  "audioConfig": { "audioEncoding": "MP3" }
}
```

### Response format (expected by TalkingHead)
Raw MP3 audio bytes with `Content-Type: audio/mpeg`.

The TalkingHead library sends this exact request shape to the endpoint and expects raw audio back. See upstream source: https://github.com/met4citizen/TalkingHead

### Implementation steps

1. Add a `GOOGLE_TTS_API_KEY` env var — read it with `os.Getenv("GOOGLE_TTS_API_KEY")` in `main.go`.

2. Register the route in `main()`:
```go
r.Post("/api/tts/google", TTSHandler)
```

3. Implement `TTSHandler`:
   - Read the request body (it's the JSON payload above)
   - Forward it via POST to `https://texttospeech.googleapis.com/v1/text:synthesize?key=<GOOGLE_TTS_API_KEY>`
   - The Google API returns `{ "audioContent": "<base64-encoded-mp3>" }`
   - Base64-decode `audioContent`
   - Write the raw bytes back with `Content-Type: audio/mpeg`

4. If `GOOGLE_TTS_API_KEY` is empty, return HTTP 503 with a JSON error: `{"error": "TTS not configured"}`.

### Go imports needed
```go
"encoding/base64"
```
(the rest like `encoding/json`, `net/http`, `io`, `os` are already imported)

## Files to edit
- `/workspaces/3D-Agent/chat/server/main.go` — add route + handler

## Verification
- Start the server: `cd /workspaces/3D-Agent/chat/server && go run .`
- `curl -X POST http://localhost:8081/api/tts/google -H 'Content-Type: application/json' -d '{"input":{"text":"hello"},"voice":{"languageCode":"en-US","ssmlGender":"FEMALE"},"audioConfig":{"audioEncoding":"MP3"}}' --output test.mp3`
- `file test.mp3` should report MPEG audio
- Without the env var set, curl should return `{"error": "TTS not configured"}`
