---
mode: agent
description: 'Phase 2 — Persona extraction: 5-question Claude interview → signed system prompt saved to agent manifest'
---

# Phase 2 · Persona Extraction from Interview

**Branch:** `feat/persona-extraction`
**Standalone.** No other prompt must ship first.

## Why it matters

Right now every agent on three.ws speaks with the same generic Claude voice. Phase 2 goal: the agent *acts like the person who created it*. This prompt implements the onboarding interview that extracts tone, vocabulary, interests, and communication style from a 5-question conversation and writes a signed system prompt into the agent's manifest.

## What to build

### 1. Backend — `POST /api/agents/:id/persona/extract`

File: `api/agents/[id]/persona.js`

Flow:
1. Auth: session or bearer required; must own the agent.
2. Accept `{ answers: string[] }` — exactly 5 non-empty answers, each ≤ 1000 chars.
3. Call **Claude** (`claude-sonnet-4-6`) with a persona-extraction prompt (see below). Use `ANTHROPIC_API_KEY` from `api/_lib/env.js`. Import from `@anthropic-ai/sdk`.
4. The Claude response is a JSON object: `{ system_prompt: string, tone_tags: string[], vocabulary_samples: string[] }`. Use JSON mode / tool use so it's guaranteed structured.
5. Hash `system_prompt` with SHA-256, sign with `JWT_SECRET` (HMAC-SHA256 over the hash) so the prompt is tamper-evident. Store:
   ```sql
   UPDATE agent_identities
   SET
     persona_prompt        = $system_prompt,
     persona_prompt_hash   = $sha256_hex,
     persona_prompt_sig    = $hmac_hex,
     persona_extracted_at  = now(),
     updated_at            = now()
   WHERE id = $agent_id;
   ```
   Add those columns to `api/_lib/schema.sql` with `ALTER TABLE agent_identities ADD COLUMN IF NOT EXISTS ...`.
6. Return `{ system_prompt, tone_tags, vocabulary_samples, hash, extracted_at }`.

**Claude persona-extraction tool definition:**
```js
const tool = {
  name: 'extract_persona',
  description: 'Extract a persona system prompt from interview answers',
  input_schema: {
    type: 'object',
    required: ['system_prompt', 'tone_tags', 'vocabulary_samples'],
    properties: {
      system_prompt: { type: 'string', description: 'A 150-300 word first-person system prompt that captures the persona. Start with "You are ...".' },
      tone_tags: { type: 'array', items: { type: 'string' }, description: 'Up to 8 single-word tone descriptors (e.g. witty, direct, empathetic).' },
      vocabulary_samples: { type: 'array', items: { type: 'string' }, description: 'Up to 10 short phrases or expressions characteristic of this persona.' },
    },
  },
};
```

**System message to Claude:**
```
You are a persona architect. Given a person's interview answers, extract their communication style, tone, and voice. Produce a concise first-person system prompt that an LLM can use to impersonate this person faithfully. Be specific. Avoid clichés.
```

**User message to Claude:**
```
Interview answers:
1. {answers[0]}
2. {answers[1]}
3. {answers[2]}
4. {answers[3]}
5. {answers[4]}
```

### 2. Backend — `GET /api/agents/:id/persona`

Same file. Returns `{ has_persona: bool, tone_tags, extracted_at }`. Never returns the raw `system_prompt` to the client (it's injected server-side).

### 3. Include persona in chat / manifest

In `api/chat.js`, when building the system prompt for an agent, if `agent.persona_prompt` is set, prepend it before the agent's user-defined instructions. Read it from the DB the same way the agent's other fields are fetched.

In `api/agents/[id]/manifest.js` (or wherever `GET /api/agents/:id` returns agent data), include:
```json
{ "persona": { "has_persona": true, "tone_tags": ["direct","witty"], "extracted_at": "..." } }
```
Never include the raw prompt in the public manifest.

### 4. Frontend — Interview UI in agent editor

File: `src/editor/persona-interview.js`

A standalone class that renders a step-through interview into a container element. No dependencies beyond vanilla JS + native fetch.

```js
export class PersonaInterview {
  constructor(containerEl, { agentId, onComplete }) { ... }
  mount()   // renders step 1 of 5
  destroy() // removes listeners + DOM
}
```

Questions (hard-coded):
1. "How would your closest friend describe the way you communicate?"
2. "What topic could you talk about for hours without getting bored?"
3. "When someone misunderstands you, what do you usually say to clarify?"
4. "Describe your sense of humor in two sentences."
5. "What's something people always get wrong about you?"

Each step: full-width `<textarea>` (min 2 lines, max 1000 chars), a char counter, and a Next / Finish button. On Finish, POST to `/api/agents/:id/persona/extract`. Show a loading state ("Extracting persona…"). On success, call `onComplete({ tone_tags, extracted_at })` and show "Persona extracted ✓" with the `tone_tags` as chips.

Mount this inside the existing agent editor. The entry point for the editor is `src/editor/manifest-builder.js` — add a "Persona" section after the existing sections following the same pattern used for the Voice section.

### 5. Route

Add to `vercel.json` rewrites (follow the existing pattern for `agents/[id]` subpaths):
```json
{ "src": "/api/agents/([^/]+)/persona(/.*)?", "dest": "/api/agents/[id]/persona.js" }
```

### 6. Rate limit

Add to `api/_lib/rate-limit.js` (or inline in the endpoint):
```js
// 5 persona extractions per user per day
limits.personaExtract(userId)
```

## Out of scope

- Do not store or expose the raw `system_prompt` to the frontend — server-side injection only.
- Do not fine-tune a model.
- Do not build a conversation-style interview (just 5 static questions + one POST).
- Do not add UI to *view* or *edit* the extracted prompt text — tone_tags only.

## Environment variables required

- `ANTHROPIC_API_KEY` — already in `api/_lib/env.js`
- `JWT_SECRET` — already in env, use with `createHmac('sha256', JWT_SECRET).update(hash).digest('hex')`

## Acceptance

- [ ] POST `/api/agents/:id/persona/extract` with 5 valid answers returns `{ system_prompt, tone_tags, hash, extracted_at }`.
- [ ] `api/chat.js` injects the persona prompt when the agent has one.
- [ ] GET `/api/agents/:id/persona` returns `has_persona: true` after extraction.
- [ ] The interview UI renders all 5 steps and POSTs on Finish.
- [ ] Short answers (<5 chars) or missing answers return 400.
- [ ] `node --check api/agents/[id]/persona.js` passes.
- [ ] `npx vite build` passes.

## Reporting

- Shipped: …
- Skipped: …
- Broke / regressions: …
- Unrelated bugs noticed: …
