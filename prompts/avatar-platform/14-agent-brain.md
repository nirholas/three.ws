# Task: Pluggable agent brain — local (WebLLM) and cloud (Claude/OpenAI)

## Context

Repo: `/workspaces/3D`. After task 01, the agent panel uses a rule-based `_generateResponse`. This task replaces it with a proper LLM-backed brain. Two backends, one interface:

- **Local (default for privacy / offline)** — [mlc-ai/web-llm](https://github.com/mlc-ai/web-llm) (Apache-2.0) runs Llama 3.2 / Qwen / etc. via WebGPU.
- **Cloud** — Claude (`claude-sonnet-4-6` or `claude-opus-4-6`) or OpenAI, via a minimal backend proxy that holds the API key.

The brain is invoked by the agent panel and its output is piped to TalkingHead (task 09) for speech.

Depends on tasks 09, 10, 11.

## Goal

1. A `Brain` interface that any backend implements.
2. Two adapters: `WebLLMBrain`, `CloudBrain`.
3. The agent panel asks the brain for replies; the reply streams to TalkingHead via task 10's TTS.
4. A setting toggle lets the user pick `local` / `cloud` / `auto` (capability-detected).
5. System prompt gives the agent awareness of the viewer state (current model loaded, animations, validation findings).

## Deliverable

1. **Interface** `src/agent/brain.js` — `class Brain { async respond(history, { signal, onToken }): Promise<string> }` where `history` is `[{role, content}]` and `onToken` streams partials.
2. **WebLLM adapter** `src/agent/brain-webllm.js`:
   - npm install `@mlc-ai/web-llm`.
   - Loads a small model (e.g., `Llama-3.2-3B-Instruct-q4f16_1-MLC`); document model choice with size + VRAM.
   - First call triggers model download with a visible progress UI.
   - Subsequent calls are instant-ish.
3. **Cloud adapter** `src/agent/brain-cloud.js`:
   - POSTs to `/api/agent/complete`; streams SSE back.
   - Supports Claude and OpenAI via the same backend endpoint (server decides based on env).
4. **Backend proxy** `services/agent/`:
   - Accepts `{ history, model? }`.
   - Uses server-side API key (`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`).
   - Streams SSE.
   - Rate-limit per IP.
   - **Never** logs request/response content.
   - If no API key is configured, endpoint returns 501 and the frontend auto-degrades to local.
5. **Capability selector** `src/agent/brain.js` → `async createBrain({ prefer: 'local'|'cloud'|'auto' })`:
   - `local`: requires WebGPU + `navigator.deviceMemory >= 4` (or unknown on Safari — try).
   - `cloud`: requires backend reachable.
   - `auto`: prefer local if capable, else cloud, else rule-based fallback from task 01.
6. **System prompt** — templated from viewer state. Include: current model file name, animation list, any validation warnings, whether a VRM is loaded, user's name if known (task 20).
7. **Agent panel wiring** — replace `_generateResponse` with `brain.respond(history, { onToken })`. As tokens stream, push to TalkingHead via `speak` (task 09 + 10) in sentence-sized chunks so lipsync catches up.
8. **Abort handling** — user presses "stop" → `AbortController` cancels both the LLM stream and the TTS synthesis.

## Audit checklist

- [ ] Offline with WebGPU: local brain works after one-time model download.
- [ ] No API key configured: backend returns 501; frontend shows "cloud unavailable, using local" or falls to rule-based.
- [ ] Cloud path with key: streams reply, lipsync keeps up.
- [ ] System prompt correctly reflects current viewer state (test by loading a model mid-session and asking "what am I looking at?").
- [ ] Cancel mid-reply: LLM stream stops, TTS stops, partial reply stays in the chat log.
- [ ] No content logged on the backend (grep logs for the test message).
- [ ] Rate limit enforced (e.g., 10 requests per IP per minute on cloud).
- [ ] `node --check` new files.
- [ ] `npx vite build` passes; web-llm is code-split (lazy chunk) so the default bundle doesn't balloon.

## Constraints

- Do not default to cloud. Privacy-first: local if possible, cloud opt-in.
- Do not ship an API key in the frontend under any circumstance.
- Do not store conversation history server-side in this task (task 15 handles client-local memory).
- The backend proxy is a thin passthrough — no persistence, no analytics.
- Do not use paid embedding or search APIs in this task.

## Verification

1. Capability detection picks the right adapter on Chrome (local) and Safari (cloud or rule-based).
2. Conversation with state-aware prompt: load a GLB, ask "how many animations does this model have?" → correct answer from viewer context.
3. Abort a long reply; chat stays consistent.
4. Network tab while using local brain: zero request to the agent endpoint.
5. Cloud path with Claude key: streams smoothly.

## Scope boundaries — do NOT do these

- No tool-use / function-calling yet. Task 15 sets that up.
- No memory beyond the current browser session.
- No multi-turn personality switching — one persona per deploy via system prompt.
- No user accounts.

## Reporting

- WebLLM model chosen + size + VRAM target.
- Model download size + cold-start time.
- Cloud latency (first token, full reply) for a reference prompt.
- Capability-detection decisions on your test browser matrix.
- Any prompt injection concerns introduced by the viewer-state system prompt (user-controlled file names, validation strings) and how you sanitized them.
