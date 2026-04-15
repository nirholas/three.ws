# Task 01 — Persona editor

## Why

The agent's *personality* lives in `agent_identities.meta.persona` — a blob the runtime prompt builder inlines into the LLM system prompt. Without a UI, users can't shape it. Without shaping, every agent sounds identical.

## Read first

- [src/runtime/providers.js](../../src/runtime/providers.js) — how the system prompt is assembled
- [src/runtime/index.js](../../src/runtime/index.js) — tool loop, inspection of what the LLM sees
- [src/agent-identity.js](../../src/agent-identity.js) — `meta` field access on client
- [api/agents/[id].js](../../api/agents/[id].js) — existing PATCH
- [public/dashboard/](../../public/dashboard/) — native-DOM form patterns

## Build this

### 1. Persona shape

```ts
// stored at agent_identities.meta.persona
{
  name:          string,           // required, 1–40 chars
  bio:           string,           // ≤ 280 chars, rendered on /agent/:id
  systemPrompt:  string,           // ≤ 2000 chars, inlined into LLM system prompt
  catchphrases:  string[],         // ≤ 5 items, ≤ 80 chars each
  sentimentBias: number,           // -1..1, tilts Empathy Layer baseline
  voiceProvider: 'web' | 'eleven',
  voiceId:       string | null,
  doNotSay:      string[],         // forbidden tokens — prompt-level guard
  updatedAt:     ISO
}
```

### 2. Server patch

`PATCH /api/agents/:id` (owner-auth):
- Accept a `persona` key.
- Validate with zod (exact limits above).
- Merge into `meta.persona` (don't replace siblings like `edits`).
- Increment `meta.version`.
- Respond with the full updated row.

### 3. `/agent/:id/edit` page

New route `public/agent-edit/index.html` + `public/agent-edit/edit.js`:
- Auth-gated; redirect to `/login?return=/agent/:id/edit` if anon.
- Owner-only; 403 for non-owners.
- Left column: live avatar preview (iframe of the viewer with `#agent=<id>`).
- Right column: form.
  - Name (text, required)
  - Bio (textarea, char count)
  - System prompt (textarea, monospace, char count, "Reset to template" button)
  - Catchphrases (repeating text input, ≤ 5)
  - Sentiment bias (slider, -1 → +1, labels: "stoic" / "effusive")
  - Voice provider (radio)
  - Voice (select populated by provider list — stub for now if ElevenLabs not wired)
  - Do-not-say (chip input)
- Bottom: **Save** button. On save, `PATCH` → toast → reload iframe so the runtime picks up the new persona.

### 4. Runtime prompt assembly

In `src/runtime/providers.js`, when building the system prompt:
- Prepend `persona.systemPrompt` if present.
- Append `You are ${persona.name}. ${persona.bio}`.
- Append `Catchphrases you sometimes use: ${list}`.
- Append `Never say: ${doNotSay.join(', ')}`.
- Tilt Empathy Layer baseline by `sentimentBias` (see `src/agent-avatar.js` decay config — add a constant offset to `celebration` decay, subtract from `concern`).

### 5. Template picker

Three starter templates the user can click to fill the form (they can then edit):
- **Friend** — casual, supportive, high celebration bias
- **Coach** — directive, concise, neutral bias
- **Researcher** — careful, inquisitive, high curiosity bias

Ship templates as a static JSON in `public/agent-edit/templates.json`.

## Don't do this

- Do not add TypeScript. Zod runs at runtime, JSDoc annotations are enough.
- Do not rerender the viewer on every keystroke — debounce to 500ms or save-only.
- Do not store API keys for ElevenLabs client-side. Server proxy (task 04 extends).
- Do not expose other users' persona JSON.

## Acceptance

- [ ] Owner visits `/agent/:id/edit` → form prefilled with current persona.
- [ ] Edit name, save → `/agent/:id` reflects the new name immediately on refresh.
- [ ] System prompt edit → agent's next reply reflects it.
- [ ] Non-owner hitting the URL → 403 page.
- [ ] `npm run build` passes.

## Reporting

- Screenshot of the editor
- Example of before/after agent behavior given a system prompt change
- The zod schema used for validation
