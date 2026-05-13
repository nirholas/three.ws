# Troubleshooting

Common issues and how to fix them.

## No Audio / Can't Hear Agent

**Symptom:** You can see text responses in the chat but no audio plays.

**Causes:**

1. **TTS provider not configured.** Check that `TTS_PROVIDER` is set and the corresponding API key exists.
   ```bash
   # Check your .env
   TTS_PROVIDER=openai
   OPENAI_API_KEY=sk-...  # Must be set for openai TTS
   ```

2. **Browser blocked autoplay.** Most browsers block audio playback until the user interacts with the page. Click anywhere on the page before starting the conversation.

3. **Browser TTS fallback.** If you see `ttsBrowser` in the console instead of `ttsAudio`, server-side TTS failed and the browser's built-in speech synthesis is being used. Check server logs for TTS errors.

**Fix:** Check the server console for errors like `[TTS] Error:`. Verify your API key and provider setting.

## Microphone Not Working

**Symptom:** The mic button doesn't respond, or the agent never hears you.

**Causes:**

1. **HTTPS required.** Browsers require HTTPS for microphone access (except `localhost`). If you're accessing the server by IP or non-localhost hostname, you need SSL.

2. **Permission denied.** The browser may have blocked mic access. Check the address bar for a blocked microphone icon. Click it to allow access.

3. **Wrong input device.** Your system may be using a different mic than expected. Check your OS audio settings.

**Fix:**
- Use `https://` or `localhost`
- Click the mic permission icon in the browser address bar
- Check browser console for `getUserMedia` errors

## "OPENAI_API_KEY not set" (or similar)

**Symptom:** Server starts but logs a warning about missing API keys.

**Fix:** Ensure your `.env` file exists and has the correct keys for your chosen provider:

| Provider | Required Keys |
|----------|--------------|
| `openai` | `OPENAI_API_KEY` |
| `openai-chat` | `OPENAI_API_KEY` + STT key |
| `claude` | `ANTHROPIC_API_KEY` + STT key + TTS key |
| `groq` | `GROQ_API_KEY` + TTS key |

See [Configuration](configuration.md) for the full matrix.

## Agent Not Responding

**Symptom:** You speak or type but the agent doesn't respond.

**Causes:**

1. **STT failed.** If using a socket provider, check server logs for `[STT]` errors. The transcription step may have failed.

2. **LLM API error.** The provider API may be down or rate-limited. Check server logs for HTTP error codes (429 = rate limit, 500 = server error).

3. **Turn stuck.** If `isProcessing` is `true` in the state, a previous request may have errored without releasing the turn. Restart the server.

**Fix:** Check server console output. Look for `[STT]`, `[LLM]`, or `[TTS]` error messages.

## High Latency

**Symptom:** Long delay between speaking and hearing the response.

**Typical latencies:**
| Provider | Expected |
|----------|----------|
| OpenAI Realtime | ~200ms |
| Groq + TTS | ~400ms |
| OpenAI Chat + TTS | ~800ms |
| Claude + TTS | ~900ms |

**If latency is much higher than expected:**

1. **Network latency.** The server and APIs need good connectivity. Deploy close to your users and the API endpoints (US East for OpenAI/Anthropic).

2. **Long responses.** Agents generating long text take longer for TTS. Add "Keep responses under 2 sentences" to your `basePrompt`.

3. **ElevenLabs TTS.** ElevenLabs has higher latency than OpenAI TTS. Switch to `TTS_PROVIDER=openai` if speed matters more than voice quality.

4. **Browser TTS fallback.** If server TTS fails, browser TTS is used, which can have unpredictable latency. Fix the server TTS issue.

## WebRTC Connection Failed

**Symptom:** Using `AI_PROVIDER=openai` but no audio connection is established.

**Causes:**

1. **Invalid API key.** The `/session/:agentId` endpoint returns a token from OpenAI. If your key is invalid, this fails silently on the client. Check server logs.

2. **Firewall/NAT.** WebRTC needs UDP connectivity. Corporate firewalls may block it. Try a different network.

3. **STUN server unreachable.** The client uses Google's STUN servers by default. If blocked, WebRTC can't establish the connection.

**Fix:** Check the browser console for WebRTC errors. Try switching to `AI_PROVIDER=openai-chat` as a fallback (uses Socket.IO instead of WebRTC).

## Socket.IO Connection Issues

**Symptom:** "Connection failed" or frequent disconnects.

**Causes:**

1. **CORS.** If the widget is on a different domain than the server, you need proper CORS configuration on the server.

2. **Reverse proxy.** Nginx or other proxies need WebSocket upgrade support:
   ```nginx
   proxy_http_version 1.1;
   proxy_set_header Upgrade $http_upgrade;
   proxy_set_header Connection "upgrade";
   ```

3. **Load balancer.** If using multiple server instances, you need sticky sessions. Socket.IO connections are stateful.

**Fix:** Check that your reverse proxy supports WebSocket upgrades. See [Deployment](deployment.md) for Nginx configuration.

## Port Already in Use

**Symptom:** `Error: listen EADDRINUSE :::3000`

**Fix:**
```bash
# Find what's using port 3000
lsof -i :3000

# Kill it, or use a different port
PORT=3001 npm start
```

## Agent Echoing / Hearing Itself

**Symptom:** The agent responds to its own TTS audio output.

**Cause:** The mic is picking up the speaker output and sending it back as user input.

**Fix:**
- Use headphones
- Lower speaker volume
- The VAD threshold (0.04) should filter out quiet speaker bleed, but close proximity can overwhelm it

## Docker: Module Not Found

**Symptom:** `Error: Cannot find module 'express'`

**Fix:** Ensure `npm install` runs during the Docker build. Check your Dockerfile has:
```dockerfile
COPY package*.json ./
RUN npm ci --production
COPY . .
```

## Still Stuck?

1. **Check server logs.** The server logs key events with prefixes: `[STT]`, `[TTS]`, `[LLM]`, `[Socket]`, `[Room]`. These are your first debugging tool.
2. **Check browser console.** Open DevTools (F12) and look for errors in the Console tab.
3. **Try text input.** Set `INPUT_CHAT=true` and type messages to isolate whether the issue is with audio or the LLM pipeline.
4. **Try a different provider.** Switch `AI_PROVIDER` to rule out provider-specific issues.
5. **Open an issue.** File a bug at the project's GitHub Issues with your server logs and browser console output.


