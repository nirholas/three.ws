# Troubleshooting Guide

Common issues and solutions for xspace-agent. Each entry includes symptoms, cause, and a concrete fix.

---

## Authentication Issues

### AUTH_FAILED -- Cookie expired

**Symptoms:** Agent throws `AuthenticationError` with code `AUTH_FAILED` shortly after launch. Logs show "auth_token invalid" or a 401/403 from X.

**Cause:** The `X_AUTH_TOKEN` or `X_CT0` cookie has expired. X rotates these periodically (typically every 1--2 weeks, sometimes sooner).

**Solution:**

1. Open [x.com](https://x.com) in your browser and make sure you are logged in.
2. Open DevTools (F12) -> Application -> Cookies -> `https://x.com`.
3. Copy the values for `auth_token` and `ct0`.
4. Update your `.env` file:

```bash
X_AUTH_TOKEN=<new auth_token value>
X_CT0=<new ct0 value>
```

5. Restart the agent.

If you rotate tokens frequently, consider using `BROWSER_MODE=connect` instead so the agent piggybacks on your already-authenticated browser session:

```bash
# Terminal 1 -- launch Chrome with remote debugging
google-chrome --remote-debugging-port=9222

# Log into x.com manually in that Chrome window

# Terminal 2 -- start the agent in connect mode
BROWSER_MODE=connect npm run dev
```

### 2FA required

**Symptoms:** Agent hangs during the login flow or throws `AUTH_FAILED` with a message mentioning a verification code.

**Cause:** The X account has two-factor authentication enabled. Credential-based login (`X_USERNAME` / `X_PASSWORD`) cannot complete the 2FA challenge automatically.

**Solution:**

- **Preferred:** Switch to cookie-based auth. Copy `auth_token` and `ct0` from a browser where you have already completed 2FA. This bypasses the login form entirely.
- **Alternative:** Use `BROWSER_MODE=connect` and log in manually (including 2FA) in the Chrome window the agent connects to.
- **If you must use credential login:** Set `HEADLESS=false` so the browser is visible, then manually enter the 2FA code when prompted:

```bash
HEADLESS=false X_USERNAME=myuser X_PASSWORD=mypass npm run dev
```

### Rate limited by X

**Symptoms:** Repeated `AUTH_FAILED` or HTTP 429 responses. The agent successfully authenticates but gets blocked after many requests.

**Cause:** X applies rate limits to API calls and page loads. Rapidly restarting the agent or running multiple agents on the same account triggers these limits.

**Solution:**

1. Wait 15--30 minutes before retrying.
2. Avoid running more than one agent per X account simultaneously.
3. If you need multiple agents, use separate X accounts.
4. Reduce restart frequency -- let the agent's FSM handle reconnection instead of killing and restarting the process.

---

## Browser / Puppeteer Issues

### Chromium won't launch -- missing dependencies

**Symptoms:** `BrowserConnectionError` with code `BROWSER_CONNECTION` and a message like "Failed to launch the browser process" or errors about missing shared libraries (`libnss3.so`, `libatk-bridge-2.0.so`, etc.).

**Cause:** The system is missing native libraries that Chromium requires. This is common on minimal Linux distributions and CI environments.

**Solution (Debian/Ubuntu):**

```bash
sudo apt-get update && sudo apt-get install -y \
  chromium \
  fonts-liberation \
  fonts-noto-color-emoji \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libdrm2 \
  libgbm1 \
  libgtk-3-0 \
  libnss3 \
  libx11-xcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  xdg-utils
```

Then tell Puppeteer to use the system Chromium:

```bash
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
```

### Headless mode issues

**Symptoms:** Agent works with `HEADLESS=false` but fails or behaves differently with `HEADLESS=true`. Elements not found, audio not captured, or login flow breaks.

**Cause:** Some X UI behaviors differ between headless and headed mode. Headless Chrome may also lack GPU acceleration, causing rendering differences.

**Solution:**

1. Use the new headless mode (Puppeteer's default since v21), which behaves identically to headed mode:

```bash
HEADLESS=true npm run dev
```

2. If problems persist, run in headed mode for debugging:

```bash
HEADLESS=false npm run dev
```

3. In Docker or CI where there is no display, ensure you have a virtual framebuffer if running headed mode (though headless is strongly recommended for containers).

### Shared memory errors in Docker

**Symptoms:** Browser crashes with errors like "session deleted because of page crash", `SIGBUS`, or out-of-memory errors inside the container.

**Cause:** Docker's default shared memory (`/dev/shm`) is 64 MB, but Chromium needs significantly more.

**Solution:** Increase shared memory to at least 2 GB:

```bash
# docker run
docker run --shm-size=2gb your-image

# docker-compose.yml
services:
  agent:
    image: xspace-agent
    shm_size: '2gb'
```

Alternatively, disable `/dev/shm` usage entirely:

```bash
# Pass this Chromium flag via PUPPETEER_ARGS
PUPPETEER_ARGS=--disable-dev-shm-usage
```

### Selector broken -- X updated their UI

**Symptoms:** `SelectorBrokenError` with code `SELECTOR_BROKEN`. The error message names the element that could not be found (e.g., "Could not find UI element: join-button") and lists the strategies that were tried.

**Cause:** X/Twitter periodically updates their DOM structure, breaking CSS selectors. The `SelectorEngine` tries multiple strategies (CSS, text content, aria labels) before giving up.

**Solution:**

1. **Quick fix at runtime:** Use the admin panel to override the broken selector without restarting. Navigate to the selector overrides section and provide a working CSS selector for the named element.

2. **Permanent fix:** Update the selector definitions in `packages/core/src/browser/selectors.ts`. Each element has a `strategies` array. Add a new strategy rather than replacing existing ones -- this preserves fallbacks:

```typescript
// In packages/core/src/browser/selectors.ts
{
  name: 'join-button',
  description: 'Button to join the Space',
  strategies: [
    { name: 'testid', selector: '[data-testid="joinButton"]', priority: 1 },
    { name: 'aria', selector: '[aria-label="Join"]', priority: 2 },
    // Add your new fallback here:
    { name: 'css-new', selector: '.new-join-class button', priority: 3 },
  ],
},
```

3. **Debugging:** Open a headed browser (`HEADLESS=false`), navigate to the Space, and use DevTools to inspect the element. Identify a stable attribute (`data-testid`, `aria-label`, `role`) to build the new selector.

---

## Audio Issues

### No audio captured

**Symptoms:** The agent joins the Space and transitions to the `listening` state, but no transcriptions are produced. Logs show no audio chunks being processed.

**Cause:** The `AudioPipeline` hooks into WebRTC's `RTCPeerConnection` to capture incoming audio. If the hook fails or the Space has no active speakers, no audio arrives.

**Solution:**

1. Verify someone is actually speaking in the Space.
2. Check that the agent has speaker or listener access (check agent state -- it should be `listening` or `speaking`).
3. Restart the agent with verbose logging to see audio pipeline events:

```bash
LOG_LEVEL=debug npm run dev
```

4. Look for `audio:capture` events. If absent, the WebRTC hook may not have been injected. Try restarting the agent to force a fresh browser session.
5. If using `BROWSER_MODE=connect`, make sure the browser tab with the Space is in the foreground -- some browsers throttle background tabs.

### Poor transcription quality

**Symptoms:** Transcriptions are garbled, miss words, or attribute speech to the wrong speaker.

**Cause:** Low audio quality reaching the STT provider, or the STT provider itself may be underperforming for your use case.

**Solution:**

1. Switch STT providers and compare results:

```bash
# Try OpenAI Whisper
STT_PROVIDER=openai npm run dev

# Try Groq Whisper (faster, sometimes less accurate)
STT_PROVIDER=groq npm run dev
```

2. Adjust the Voice Activity Detection (VAD) sensitivity. If audio chunks are being cut off too early, increase the silence threshold:

```typescript
const agent = new XSpaceAgent({
  audio: {
    silenceThreshold: 2.0, // seconds (default: 1.5)
    vadSensitivity: 0.3,   // lower = more sensitive (default: 0.5)
  },
});
```

3. If speaker identification is wrong, the issue may be in the `SpeakerIdentifier` rather than STT. Check the `intelligence/speaker-id.ts` module for tuning options.

### TTS not playing -- no audio output

**Symptoms:** The agent generates text responses (visible in logs) but no audio is played back into the Space.

**Cause:** TTS synthesis failed, or audio injection into the WebRTC connection failed.

**Solution:**

1. Verify your TTS provider is configured and the API key is valid:

```bash
# Check which TTS provider is active
echo $TTS_PROVIDER

# Test with a different provider
TTS_PROVIDER=browser npm run dev   # Free, no API key needed
TTS_PROVIDER=openai npm run dev    # Requires OPENAI_API_KEY
```

2. Check that the agent has speaker access in the Space (state should be `speaking`, not just `listening`).
3. Look for `ProviderError` entries in logs related to TTS:

```bash
LOG_LEVEL=debug npm run dev 2>&1 | grep -i tts
```

4. If using ElevenLabs, verify your quota has not been exceeded at [elevenlabs.io/subscription](https://elevenlabs.io/subscription).

### Echo / feedback loop

**Symptoms:** The agent responds to its own speech, creating a feedback loop of increasingly nonsensical responses.

**Cause:** The audio pipeline is capturing the agent's own TTS output and sending it back through STT.

**Solution:**

1. The `EchoCanceller` module (`packages/core/src/audio/echo-canceller.ts`) should suppress this automatically. Ensure it is enabled in your config:

```typescript
const agent = new XSpaceAgent({
  audio: {
    echoCancellation: true, // default: true
  },
});
```

2. If echo persists, increase the echo suppression aggressiveness or add a middleware to mute capture during TTS playback:

```typescript
agent.use('before:stt', async (data) => {
  if (agent.isSpeaking()) {
    return null; // Drop audio captured while agent is speaking
  }
  return data;
});
```

3. Make sure only one instance of the agent is running per Space.

---

## Provider Issues

### PROVIDER_ERROR -- API key invalid or quota exceeded

**Symptoms:** `ProviderError` with a message like "openai streamResponse failed: 401 Unauthorized" or "429 Too Many Requests".

**Cause:** The API key is missing, invalid, or the account has exceeded its usage quota.

**Solution:**

1. Verify the API key is set and valid:

```bash
# Check that the key is loaded (shows first/last few chars)
node -e "const k = process.env.OPENAI_API_KEY; console.log(k ? k.slice(0,6)+'...'+k.slice(-4) : 'NOT SET')"
```

2. Test the key directly:

```bash
# OpenAI
curl -s https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY" | head -c 200

# Anthropic
curl -s https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-sonnet-4-20250514","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}'
```

3. Check your billing dashboard:
   - OpenAI: [platform.openai.com/usage](https://platform.openai.com/usage)
   - Anthropic: [console.anthropic.com](https://console.anthropic.com)
   - Groq: [console.groq.com](https://console.groq.com)
   - ElevenLabs: [elevenlabs.io/subscription](https://elevenlabs.io/subscription)

4. If one provider is down, switch to another:

```bash
AI_PROVIDER=groq GROQ_API_KEY=gsk_... npm run dev
```

### Provider timeout

**Symptoms:** Responses take excessively long or time out entirely. `ProviderError` mentioning "timeout" or "ETIMEDOUT".

**Cause:** Network issues, provider overload, or the model is too large for real-time use.

**Solution:**

1. Switch to a faster provider:

```bash
# Groq is typically the fastest (~400ms)
AI_PROVIDER=groq npm run dev

# OpenAI Realtime is optimized for low latency (~200ms)
AI_PROVIDER=openai npm run dev
```

2. Use a smaller model:

```bash
OPENAI_MODEL=gpt-4o-mini npm run dev
GROQ_MODEL=llama-3.1-8b-instant npm run dev
```

3. Check the provider's status page for outages.

4. If using the `ProviderRouter`, it will automatically route around unhealthy providers. Enable health monitoring:

```typescript
const agent = new XSpaceAgent({
  providers: {
    healthCheckInterval: 30000, // Check provider health every 30s
    fallbackOrder: ['groq', 'openai-chat', 'claude'],
  },
});
```

### Cost management

**Symptoms:** Unexpectedly high API bills.

**Cause:** Long-running agents in active Spaces can consume significant tokens, especially with verbose speakers and frequent responses.

**Solution:**

1. Use the `CostTracker` to monitor spend:

```typescript
const tracker = agent.getCostTracker();
tracker.on('cost:update', (entry) => {
  console.log(`${entry.provider}: $${entry.totalCost.toFixed(4)}`);
});

// Set a budget limit
tracker.setBudget(5.00); // $5 max
tracker.on('cost:budget-exceeded', () => {
  agent.leave();
});
```

2. Use cheaper providers for high-volume usage:

| Provider | Approximate cost |
|----------|-----------------|
| Groq (Llama) | ~$0.05 / 1M tokens |
| OpenAI (gpt-4o-mini) | ~$0.15 / 1M input tokens |
| Claude (Sonnet) | ~$3 / 1M input tokens |
| ElevenLabs TTS | ~$0.30 / 1K chars |
| OpenAI TTS | ~$0.015 / 1K chars |
| Browser TTS | Free |

3. Reduce response frequency by tuning the `DecisionEngine` thresholds so the agent responds less often.

---

## Space Issues

### SPACE_NOT_FOUND -- invalid URL

**Symptoms:** `SpaceNotFoundError` with code `SPACE_NOT_FOUND` immediately after calling `agent.join()`.

**Cause:** The Space URL is malformed, the Space has not started yet, or the Space has already ended.

**Solution:**

1. Verify the URL format. Valid formats:

```
https://x.com/i/spaces/1eaKbrPAqbwKX
https://twitter.com/i/spaces/1eaKbrPAqbwKX
```

2. Make sure the Space is **currently live**. Ended or scheduled Spaces cannot be joined.
3. Check that the URL is accessible by opening it in a regular browser.
4. If the Space just started, wait a few seconds and retry -- there can be a brief delay before the Space is joinable.

### SPEAKER_ACCESS_DENIED

**Symptoms:** `SpeakerAccessDeniedError` with code `SPEAKER_DENIED`. The agent joins the Space as a listener but never transitions to `speaking`.

**Cause:** The Space host has not accepted the agent's speaker request. Some hosts have auto-accept disabled or may not see the request.

**Solution:**

1. Ask the Space host to accept the speaker request manually.
2. The agent retries the speaker request automatically. Check the timeout setting:

```typescript
const agent = new XSpaceAgent({
  space: {
    speakerRequestTimeout: 120000, // Wait up to 2 minutes (default: 60000)
  },
});
```

3. If the agent only needs to listen (e.g., for transcription), you can skip the speaker request entirely:

```typescript
const agent = new XSpaceAgent({
  space: {
    requestSpeaker: false, // Stay as listener
  },
});
```

4. Handle the denial gracefully:

```typescript
agent.on('error', (err) => {
  if (err.code === 'SPEAKER_DENIED') {
    console.log('Speaker access denied -- continuing as listener');
  }
});
```

### Space ended mid-session

**Symptoms:** `SpaceEndedError` with code `SPACE_ENDED`. The agent was active and then abruptly disconnected.

**Cause:** The Space host ended the Space, or X terminated it.

**Solution:**

Handle this event gracefully in your code:

```typescript
agent.on('space-ended', () => {
  console.log('Space ended -- cleaning up');
  // Optionally rejoin a different Space or exit
});

// Or with try/catch
try {
  await agent.join(spaceUrl);
} catch (err) {
  if (err instanceof SpaceEndedError) {
    console.log('Space ended');
  }
}
```

If you want the agent to automatically join a new Space when the current one ends, implement a reconnection loop:

```typescript
agent.on('space-ended', async () => {
  const nextSpace = await findNextSpace(); // Your logic
  if (nextSpace) {
    await agent.join(nextSpace);
  }
});
```

---

## Docker Issues

### Container exits immediately

**Symptoms:** `docker run` exits with code 1 within seconds. No logs or very short logs showing a startup error.

**Cause:** Missing environment variables, failed health check during startup, or Chromium crash.

**Solution:**

1. Check the logs:

```bash
docker logs <container-id>
```

2. Make sure required environment variables are passed:

```bash
docker run --shm-size=2gb \
  -e OPENAI_API_KEY=sk-... \
  -e X_AUTH_TOKEN=... \
  -e X_CT0=... \
  -e ADMIN_API_KEY=... \
  xspace-agent
```

3. If Chromium is crashing, increase shared memory (see [Shared memory errors](#shared-memory-errors-in-docker) above).

4. Run interactively to debug:

```bash
docker run -it --shm-size=2gb --entrypoint /bin/bash xspace-agent
# Then manually: node packages/server/dist/index.js
```

### Health check failing

**Symptoms:** Container shows as "unhealthy" in `docker ps`. The container may restart repeatedly if `restart: always` is set.

**Cause:** The `/health` endpoint is not responding within 10 seconds, or the server has not finished starting within the 60-second grace period.

**Solution:**

1. Check if the server is actually running:

```bash
docker exec <container-id> node -e "fetch('http://localhost:3000/health').then(r=>r.text()).then(console.log).catch(console.error)"
```

2. Increase the start period if the server needs more time to initialize (especially on slower hardware):

```yaml
# docker-compose.yml
services:
  agent:
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"]
      interval: 30s
      timeout: 10s
      start_period: 120s  # Increase from default 60s
      retries: 3
```

3. Make sure port 3000 is not being overridden without also updating the health check:

```bash
docker run -e PORT=8080 ...  # Health check still hits :3000 -- will fail
```

### Volume permissions

**Symptoms:** Errors writing to `/app/cookies` or `/app/data`. "EACCES: permission denied" in logs.

**Cause:** The container runs as the non-root `xspace` user (UID varies). Host-mounted volumes may be owned by root or a different user.

**Solution:**

1. Let Docker manage the volumes (recommended):

```yaml
# docker-compose.yml
services:
  agent:
    volumes:
      - cookies:/app/cookies
      - data:/app/data

volumes:
  cookies:
  data:
```

2. If you must use bind mounts, fix ownership on the host:

```bash
# Find the xspace user's UID inside the container
docker run --rm xspace-agent id xspace
# Example output: uid=999(xspace) gid=999(xspace)

# Set ownership on host directories
sudo chown -R 999:999 ./cookies ./data

docker run -v ./cookies:/app/cookies -v ./data:/app/data ...
```

---

## Performance

### High memory usage

**Symptoms:** The agent process or container uses 1 GB+ of memory and keeps growing. Eventually OOM-killed.

**Cause:** Chromium is memory-hungry by nature. Long-running sessions accumulate conversation history and audio buffers.

**Solution:**

1. Limit Chromium's memory usage with launch flags:

```bash
PUPPETEER_ARGS="--disable-dev-shm-usage --disable-gpu --js-flags='--max-old-space-size=512'"
```

2. Enable conversation windowing to cap history size:

```typescript
const agent = new XSpaceAgent({
  conversation: {
    maxTokens: 4000,    // Keep only the most recent ~4K tokens of history
    maxMessages: 50,    // Or cap at 50 messages
  },
});
```

3. Set Node.js memory limits:

```bash
NODE_OPTIONS="--max-old-space-size=1024" npm run dev
```

4. In Docker, set a hard memory limit so the container is killed cleanly rather than swapping:

```yaml
services:
  agent:
    deploy:
      resources:
        limits:
          memory: 2g
```

5. If running multiple agents via `AgentTeam`, they share a single browser session, which is more memory-efficient than launching separate processes.

### Slow responses

**Symptoms:** The agent takes several seconds to respond after someone finishes speaking. The conversation feels unnatural.

**Cause:** The total latency is the sum of: silence detection + STT transcription + LLM generation + TTS synthesis + audio injection. Any slow link in this chain delays the response.

**Solution:**

1. Profile each stage by enabling debug logging:

```bash
LOG_LEVEL=debug npm run dev
```

Look for timestamps on `audio:vad-end`, `transcription`, `response:start`, `response:end`, and `audio:inject` events.

2. Optimize each stage:

| Stage | Slow fix | Fast alternative |
|-------|----------|-----------------|
| Silence detection | Reduce `silenceThreshold` to 1.0s | Use `AdaptiveSilenceDetector` |
| STT | OpenAI Whisper (~1s) | Groq Whisper (~0.3s) |
| LLM | Claude (~0.9s TTFB) | Groq Llama (~0.4s) or OpenAI Realtime (~0.2s) |
| TTS | ElevenLabs (~0.8s) | OpenAI TTS (~0.5s) or Browser TTS (~0.1s) |

3. Use the OpenAI Realtime provider for the lowest end-to-end latency. It handles STT, LLM, and TTS in a single round trip:

```bash
AI_PROVIDER=openai OPENAI_API_KEY=sk-... npm run dev
```

4. Enable response streaming so TTS begins before the full LLM response is generated. This is enabled by default with providers that support it.

5. Use the `ResponsePacer` to start speaking sooner:

```typescript
const agent = new XSpaceAgent({
  turns: {
    minResponseTokens: 10, // Start TTS after 10 tokens instead of waiting for full response
  },
});
```


