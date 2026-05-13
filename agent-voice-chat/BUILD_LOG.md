# Build Log — autonomous X Spaces voice agent

Complete narrative of how this system was built on 2026-05-13. Includes every dead-end, every patch, and every recovery so anyone can pick up the work cold. Read alongside [`README.md`](./README.md), [`docs/architecture.md`](./docs/architecture.md), and [`docs/troubleshooting.md`](./docs/troubleshooting.md).

The goal across all phases: have one or more AI agents join an X (Twitter) Space as speakers, hold a real-time voice conversation with each other and with humans in the room, and run entirely in the cloud with no operator audio routing required.

---

## Phase 1 — exploring the existing xspace-agent SDK

The repo already contained an in-progress TypeScript SDK (`packages/core` — `xspace-agent` on npm) that automates X Spaces via Puppeteer. The plan: get its `xspace-agent join <url>` CLI working.

What broke:
- `pnpm turbo run build --filter=xspace-agent` failed in `packages/core`. Ten dynamic-import statements were missing `.js` extensions, an error blocked by `moduleResolution: nodenext`. Files: `src/auth/saml.ts:213`, `src/auth/service.ts:287,299,321`, `src/gateway/api-key-service.ts:136,137,185,186`, `src/queue/processors/usage-processor.ts:19`. Each fixed with the corresponding `.js` extension.
- A second build failure surfaced: drizzle-orm dual-module type conflict (TS2741 / "Types have separate declarations of a private property 'shouldInlineParams'"). This was unfixable without restructuring the ORM imports, so we abandoned the full build and used the already-built `packages/core/dist/` (5.1 MB, from a prior build) plus a standalone tsx runner script (`run-join.ts`) that imports `XSpaceAgent` from the dist.
- Puppeteer needed Chromium system libs the Codespace didn't have. Install: `sudo apt install libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libxkbcommon0 libatspi2.0-0t64 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libnss3 libpangocairo-1.0-0 libpango-1.0-0 libgtk-3-0t64 libdrm2 libasound2t64 libdbus-1-3 fonts-liberation`. Note the `t64` suffix — Ubuntu 24.04 renamed several libs in the time_t transition; the old names (`libasound2`, `libgtk-3-0`) fail with "no installation candidate".

The agent did successfully run end-to-end against a live Space at this point:
- Cookie auth (`X_AUTH_TOKEN` + `X_CT0`) worked via `[X-Spaces] Login successful via auth_token`.
- Audio hooks injected post-join.
- Speaker request sent.

But:
- The post-join UI controls didn't appear within 20s. The page showed a "Start listening" button the SDK never clicked — it tried to find "Request to speak" before joining the audio room. The SDK's `space-ui.ts` selector engine matched a different button as "join" and force-clicked it; the page state never advanced.
- "Aggressive unmute" fallback ran but couldn't find a mic button either.

That dead-end is what triggered the next pivot.

## Phase 2 — pivot to `ai-agents-x-space` (OpenAI Realtime API)

The user pointed at https://github.com/devaiacc/ai-agents-x-space and https://github.com/devaiacc/MoltyTalky. The first one uses **OpenAI Realtime API** over WebRTC — a single continuous voice connection that does STT + LLM + TTS server-side, with ~600ms turn latency. Their X Spaces "integration" is hand-wavy ("create a Space and connect the agents as speakers") — they assume the operator manually routes audio through BlackHole on a Mac. No automation of X's UI.

Decision: combine the two. Use Realtime for the voice loop, write our own X-UI automation, do everything on a Linux VM with PulseAudio virtual cables (cleaner than single-channel BlackHole on macOS).

## Phase 3 — GCP VM provisioning

Authed `gcloud` in the Codespace via the no-launch-browser flow, picked the user's existing project `aerial-vehicle-466722-p5`, enabled the Compute Engine API.

Created the VM:

```bash
gcloud compute instances create swarm-agent \
  --zone=us-central1-a --machine-type=e2-standard-2 \
  --image-family=ubuntu-2204-lts --image-project=ubuntu-os-cloud \
  --boot-disk-size=30GB \
  --no-service-account --no-scopes \
  --tags=swarm-agent
```

`--no-service-account` was forced because the default Compute Engine SA didn't exist on this fresh project. The agent doesn't need GCP APIs from inside the VM, so this is fine.

External IP came back: `104.155.161.226`.

## Phase 4 — VM startup script and its breakage

Wrote `vm-setup.sh` to bootstrap the VM in one shot. The initial version tried to install Chrome Remote Desktop too (so the operator could see the desktop), but the CRD package failed to set up its `chrome-remote-desktop` Unix group, then `usermod -aG chrome-remote-desktop agent` failed with "group does not exist" and `set -e` aborted the whole script.

Recovery:
1. Dropped the CRD dependency entirely (we don't need a viewable desktop — Puppeteer/CDP drives Chrome over the network).
2. Finished setup manually via SSH: created `agent` user without CRD group, installed remaining apt packages (xvfb, xdotool, pulseaudio, ffmpeg, all the Chromium runtime libs).
3. Wrote a clean rewrite of `setup.sh` for the repo (the one in `vm/setup.sh` today) that doesn't include CRD and is fully idempotent.

The clean PulseAudio config (per-user at `~/.config/pulse/default.pa`):

```pa
.include /etc/pulse/default.pa

# Cable A: agent_speakers -> x_mic (agent broadcasts here, X mic captures)
load-module module-null-sink sink_name=agent_speakers
# Cable B: x_speakers -> agent_mic (X's Space audio goes here, agent hears it)
load-module module-null-sink sink_name=x_speakers

# Expose monitors as virtual mics with friendly names
load-module module-remap-source source_name=x_mic master=agent_speakers.monitor
load-module module-remap-source source_name=agent_mic master=x_speakers.monitor
```

Chrome processes are launched with `PULSE_SINK` and `PULSE_SOURCE` env vars so each process is bound to a specific cable — no per-tab fiddling needed.

## Phase 5 — Realtime API migration (Beta → GA)

`ai-agents-x-space` was written against the **Beta** Realtime API which OpenAI retired around 2026-02. First call to `/session/0` returned:

> "The Realtime Beta API is no longer supported. Please use /v1/realtime for the GA API."

The migrations required:

| Layer | Before (Beta) | After (GA) |
|---|---|---|
| Ephemeral-key endpoint | `POST /v1/realtime/sessions` | `POST /v1/realtime/client_secrets` |
| Request body wrapper | top-level fields | `{ session: { type: "realtime", ... } }` |
| Voice location | `voice: "verse"` (top-level) | `audio: { output: { voice: "verse" } }` |
| SDP exchange endpoint | `POST /v1/realtime?model=...` | `POST /v1/realtime/calls?model=...` |
| Ephemeral-key field | `data.client_secret.value` | `data.value` |
| Model name | `gpt-4o-realtime-preview-2024-12-17` | `gpt-realtime` |

Each migration was discovered by hitting an error, testing a hypothesis via `curl https://api.openai.com/v1/realtime/client_secrets ...` from the Codespace, then patching. Scripts kept around for posterity: `automation/patch-realtime.py` and `automation/patch-greet.py`.

After the migrations, the Realtime SDP exchange worked end-to-end:

```
Connection established!
Audio track received
Data channel open
```

## Phase 6 — first audio path verified (TTS test)

To prove the audio routing worked without burning Realtime tokens, wrote `scripts/say.sh`:

```bash
# Synthesize text via OpenAI TTS and play through agent_speakers cable
curl -X POST https://api.openai.com/v1/audio/speech \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{"model":"gpt-4o-mini-tts","voice":"verse","input":"...","response_format":"wav"}' \
  --output /tmp/say.wav
PULSE_SINK=agent_speakers paplay /tmp/say.wav
```

First test: 172 KB of audio synthesized, played into the cable. The operator confirmed they heard it in the Space on their phone via @swarminged. **The audio path was proven working.**

## Phase 7 — X UI automation (the hard part)

Wrote `automation/vm-automation.js` (driver) and `automation/x-join-only.js` (X-tab-only re-attach). Both use puppeteer-core to connect to a real Chrome via `--remote-debugging-port`. Cookies are injected via Chrome DevTools Protocol's `Network.setCookies` so the agent's X account is logged in without any visible login flow.

The flow for joining a Space:
1. CDP-connect to the X Chrome at `http://127.0.0.1:9223`.
2. Set `auth_token` and `ct0` cookies for `.x.com`.
3. `page.goto(SPACE_URL)`.
4. Click any element whose label/text contains "start listening" (with bounding-box check to skip hidden elements).
5. Wait, then click "request to speak".

Quirks discovered:
- X redirects the tab to `/home` after the join click. The Space session keeps running via X's persistent mini-player at the bottom of the page. The mini-player has its own Mute/Unmute buttons.
- The peek URL form (`https://x.com/i/spaces/<id>/peek`) is what shows the "Start listening" interstitial. After the click X drops you on the full Space view, or sometimes on `/home`.
- A second account requesting speaker after the first one works the same way, in a separate Chrome instance.

## Phase 8 — accepting + unmuting

The operator (host = `@doi`) accepts speaker requests on their phone. This is the only non-automatable step — X's mobile app surface only.

Once accepted, the speaker is muted by default. `automation/unmute-only.js` polls every 1.5s for buttons matching `unmute`, `turn on microphone`, `start speaking`, `turn on mic`, or `speak now`, then clicks the first one. Works regardless of whether the X tab is showing the full Space view or just the mini-player (the mini-player's unmute button has the same `aria-label`).

## Phase 9 — transcript event renaming (silent banter)

Wired the two-agent loop: when agent A finishes a turn (emits `textComplete` over Socket.IO), the server forwards the transcript to agent B as a `textToAgent` event; agent B reads the message and generates a response.

Symptom: the messages array stayed empty. `/state` showed both agents connected and "idle" but no transcripts.

Cause: GA Realtime renamed `response.audio_transcript.delta`/`.done` → `response.output_audio_transcript.delta`/`.done`. The page only listened for the old name, so transcripts never accumulated, so `textComplete` never fired.

Fix in `automation/patch-transcript-events.py`:

```js
// before
else if (msg.type === "response.audio_transcript.done") { ... }
// after
else if (msg.type === "response.audio_transcript.done" ||
         msg.type === "response.output_audio_transcript.done") { ... }
```

Both delta and done events. Both `agent1.html` and `agent2.html`.

After this patch, banter worked. `/state` messages array filled up with alternating Swarm / Swarm2 entries.

## Phase 10 — agent2 textToAgent was a no-op

After the transcript fix, agent1 → agent2 forwarding fired but agent2 didn't actually generate a response. Cause: in the original `ai-agents-x-space` repo, only agent1.html's `textToAgent` handler dispatches a `conversation.item.create` + `response.create` to the data channel. agent2.html's handler was just a UI log (`log("User message: ..."); // (Sam will respond)`).

Fix in `automation/patch-agent2-respond.py`: copy agent1's handler verbatim into agent2.html (with `if (AGENT_ID !== 0) return` removed, since agent2 has `AGENT_ID = 1`).

## Phase 11 — turn-gating to prevent overlap

Even with both agents now triggering on `textToAgent`, occasionally one would start before the other finished. The server forwarder fired on a fixed 1.5s delay regardless of who was speaking.

Fix in `automation/patch-turn-gating.py`: replaced the forwarder with a `sendWhenIdle` poll. Server only emits `textToAgent` once both `state.agents[sender].status === "idle"` and `state.agents[other].status === "idle"`. Polls every 1.5s up to 10 times, drops the turn if the floor never clears.

Status comes from each agent page emitting `statusChange` events to the server based on Web Audio API analysis of the agent's audio output: above the level threshold for ≥1 sample = "speaking", below threshold for ≥500ms = "idle".

## Phase 12 — greet-on-connect

The agents had nothing to say after connecting (no message had been forwarded yet, and they don't auto-respond to silence). Added a greeting trigger via `automation/patch-greet.py`:

```js
dc.onopen = () => {
  log("Data channel open", "success")
  setTimeout(() => {
    dc.send(JSON.stringify({
      type: "response.create",
      response: { instructions: "Greet the room warmly..." }
    }))
  }, 1500)
}
```

The 1.5s delay gives the WebRTC stream time to stabilize before the model starts speaking. Different prompt content for each agent so they introduce themselves with different vibes.

## Phase 13 — voice swap to GA voices

Original `voices = { 0: "verse", 1: "sage" }`. Newer GA voices `marin` (warm female, conversational) and `cedar` (warm male, dry) are dramatically more natural-sounding. One-line swap in `server/index.js`, plus a server restart and page reloads.

## Phase 14 — live prompt updates via session.update

Wrote `automation/update-prompts.js`. For each agent's Chrome tab, sends a `session.update` event with new `instructions` over the data channel. This changes the agent's personality without disconnecting the Realtime session or losing conversation state. Used to switch between "casual three.ws co-host", "always-positive enforcer", and ad-hoc battle modes.

## Phase 15 — input audio transcription

The agents *understood* humans speaking in the Space (the model is multimodal — audio in → text reasoning → audio out), but the operator couldn't see what was being said. Enabled `input_audio_transcription` via session.update:

```js
session.update {
  audio: {
    input: { transcription: { model: "gpt-4o-mini-transcribe" } }
  }
}
```

After this, `conversation.item.created` events with `role: user` arrive with populated `content[].transcript`. The agent pages log them as `User said: ...`.

## Phase 16 — dual-account broadcast

Up to this point, both agents shared the same X account (@swarminged) — they both spoke through the same Chrome → cable A → X tab → broadcast. From listeners' POV it sounded like one account with two voices.

Restructure to make each agent broadcast through its own X account:

**New cable topology (4 null-sinks, isolation per agent — no feedback loop):**
- `agent1_speakers` — Swarm's audio output, fed to @swarminged's mic
- `agent2_speakers` — Swarm2's audio output, fed to @eplus's mic
- `swarming_playback` — what @swarminged's X tab plays (Space audio minus @swarminged's own voice; agent1 listens to its monitor)
- `eplus_playback` — what @eplus's X tab plays (Space audio minus @eplus's own voice; agent2 listens)

This means agents hear each other through the Space itself (each X tab's playback contains the OTHER agent's voice). No feedback because each agent's playback excludes its own voice (X strips that on the client side).

**Four Chrome processes:**

```bash
# Agent 1
PULSE_SINK=agent1_speakers PULSE_SOURCE=agent1_mic \
  google-chrome --user-data-dir=/tmp/chrome-agent1 \
                --remote-debugging-port=9222 http://localhost:3000/agent1 &

# Agent 2
PULSE_SINK=agent2_speakers PULSE_SOURCE=agent2_mic \
  google-chrome --user-data-dir=/tmp/chrome-agent2 \
                --remote-debugging-port=9224 http://localhost:3000/agent2 &

# X tab for @swarminged
PULSE_SINK=swarming_playback PULSE_SOURCE=x_swarming_mic \
  google-chrome --user-data-dir=/tmp/chrome-x-swarming \
                --remote-debugging-port=9223 about:blank &

# X tab for @eplus
PULSE_SINK=eplus_playback PULSE_SOURCE=x_eplus_mic \
  google-chrome --user-data-dir=/tmp/chrome-x-eplus \
                --remote-debugging-port=9225 about:blank &
```

Files: `vm-launch-dual.sh`, `automation/vm-automation-dual.js`, `automation/unmute-dual.js`. Second account's cookies in `automation/.env-eplus`.

## Phase 17 — the dual-account overlap problem

After dual-account went live, the two agents started talking *over* each other. Because each agent now hears the other through the Space (not just text relay), OpenAI Realtime's server-side VAD on each independent session triggered `response.create` simultaneously when both heard the same human or each other.

Three considered fixes:

1. **Disable auto-VAD-response.** Set `turn_detection.create_response: false` on both sessions. They only banter via the `textComplete` forwarder. Drawback: agents don't auto-reply to humans either.
2. **Designate one human-responder.** Auto-VAD on for agent1 only; agent2 is text-only. Simple but asymmetric.
3. **Claim-token coordination.** When one agent starts speaking (statusChange("speaking")), broadcast a `cancelResponse` to all other agents, who immediately send `response.cancel` to OpenAI.

Implemented option 3 in `automation/patch-claim-token.py`. Server-side:

```js
socket.on("statusChange", ({ agentId, status }) => {
  // ... existing handler ...
  if (status === "speaking") {
    Object.values(state.agents).forEach((other) => {
      if (other.id !== agentId && other.connected && other.socketId) {
        io.to(other.socketId).emit("cancelResponse", { reason: `agent ${agentId} took the floor` })
      }
    })
  }
})
```

Agent pages:

```js
socket.on("cancelResponse", ({ reason }) => {
  if (dc?.readyState === "open") {
    dc.send(JSON.stringify({ type: "response.cancel" }))
  }
})
```

This still has a ~100-300 ms overlap window (whoever triggered statusChange first wins; the loser's first audio buffer might already be on the wire), but eliminates persistent over-talking.

## Phase 18 — Git operations

The user maintained three repos that mirror each other: `nirholas/three.ws`, `nirholas/3D-Agent`, `nirholas/xspace-agent`. The dual-remote setup pushes the same code to all three.

Pushed everything in this phase as a single branch first (`add-x-spaces-voice-agent` with the curated `x-spaces/` subdirectory), then merged to `main`, then re-pushed under `agent-voice-chat/` per the operator's preference. The full workspace (excluding `.git`, `node_modules`, `dist`, `.env`, `.cookies.json`, debug screenshots, logs) lives at `agent-voice-chat/` on `nirholas/three.ws` and `nirholas/3D-Agent`. Companion follow-up specs in the same folder: `dashboard-prompt.md` and `elevenlabs-prompt.md`.

## Operational quick reference

```bash
# Re-bootstrap the VM after a fresh wipe
gcloud compute instances create swarm-agent --zone=us-central1-a \
  --machine-type=e2-standard-2 --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud --boot-disk-size=30GB \
  --no-service-account --no-scopes --tags=swarm-agent
gcloud compute ssh swarm-agent --zone=us-central1-a -- \
  'sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/nirholas/three.ws/main/agent-voice-chat/vm/setup.sh)"'

# Single-account (one X account broadcasts both agents):
sudo -u agent /home/agent/launch.sh https://x.com/i/spaces/<id>
sudo -u agent bash -c "cd /home/agent/automation && node unmute-only.js"

# Dual-account (each agent broadcasts via its own account):
sudo -u agent /home/agent/launch-dual.sh https://x.com/i/spaces/<id>
# (host accepts BOTH requests on phone)
sudo -u agent bash -c "cd /home/agent/automation && node unmute-dual.js"

# One-off broadcast (no Realtime, just TTS):
sudo -u agent /home/agent/say.sh "anything you want spoken"

# Live prompt change without restart
sudo -u agent bash -c "cd /home/agent/automation && node update-prompts.js"

# Re-trigger the banter loop after silence
sudo -u agent bash -c "cd /home/agent/automation && node kick-loop.js"

# Inspect what people in the Space are saying
sudo -u agent bash -c "cd /home/agent/automation && node -e '...'"  # see troubleshooting.md
```

## Secrets handling

All credentials live in `.env` files with `chmod 600`, never committed. Two files:

- `/home/agent/ai-agents-x-space/.env` — `OPENAI_API_KEY`, `PORT`, optionally `ELEVENLABS_API_KEY` if you've done the EL swap.
- `/home/agent/automation/.env` — `X_AUTH_TOKEN` and `X_CT0` for the primary X account.
- `/home/agent/automation/.env-eplus` — `X_AUTH_TOKEN_EPLUS` and `X_CT0_EPLUS` for the second X account (used by dual-launch only).

To get fresh X cookies: log into x.com as the target account in any browser → DevTools → Application → Cookies → x.com → copy `auth_token` and `ct0`. They expire when you "log out of all other sessions" on X.

## Known limitations

- **X UI changes break the automation.** When X renames a button (e.g. "Start listening" → "Listen now"), update the `NEEDLES` arrays in `automation/*.js`.
- **Same-account collision.** The VM's X account must be different from the Space host account. X redirects to `/home` when it detects you trying to join your own Space as a listener.
- **Realtime session expiration.** Ephemeral keys expire after ~60s. WebRTC connections persist past that, but if you let an agent sit disconnected for >60s and then click Connect, you need a fresh key — the page handles this automatically.
- **The `add-x-spaces-voice-agent` branch was the original PR branch.** It's now merged but still present on the remotes. Safe to delete with `git push origin :add-x-spaces-voice-agent`.

## Things that didn't work and why

| Attempt | Why it failed | What we did instead |
|---|---|---|
| `xspace-agent` SDK + Puppeteer (Phase 1) | `space-ui.ts` selectors misidentified the join button; agent stalled at "Start listening" | Wrote our own thinner CDP automation in `vm-automation.js` |
| Building `packages/core` cleanly | drizzle-orm type conflict, no clean fix | Used existing `dist/` + tsx runner |
| Single BlackHole cable on a Mac | Echo loop (agent hears its own voice) | Two PulseAudio null-sinks with monitor sources — no shared cable |
| Single-account dual-agent (both agents through @swarminged) | One account, one voice in the Space — listeners can't tell the agents apart | Dual-account: four Chromes, two cables per side |
| Server-side `setTimeout(..., 1500)` forwarder | Two agents triggered on simultaneous human input | Server-side claim-token + agent-side `response.cancel` |
| Beta Realtime API | OpenAI retired Beta around 2026-02 | Migrated all endpoints + payload shapes to GA |
| Chrome Remote Desktop on the VM | CRD apt package didn't create its Unix group on Ubuntu 22.04 | Dropped CRD; use Xvfb + Puppeteer/CDP only (no human-viewable desktop needed) |
