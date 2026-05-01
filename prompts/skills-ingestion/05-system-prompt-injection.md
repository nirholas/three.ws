# Step 5 — Inject installed knowledge skills into the system prompt

Working directory: `/workspaces/3D-Agent`. Read `/workspaces/3D-Agent/CLAUDE.md` first.

## Prerequisites

Steps 1-4 applied. Verify:

- `localStorage.knowledgeSkills` contains at least one installed content skill (install one via the modal first).

## Files to modify

- `chat/src/convo.js` — system prompt assembly happens around lines 26-36 and 462-484.
- (Possibly) `chat/src/App.svelte:887-1026` — agent system prompt setup. Read this section before editing to confirm where the canonical system message is built.

The primary integration point is `convo.js` lines 26-36, which currently looks roughly like:

```js
const sysIdx = messages.findIndex((m) => m.role === 'system');
// ... retrievalContext injection ...
let system = undefined;
if (model.provider === 'Anthropic' && messages[0].role === 'system') {
  system = messages.shift().content;
}
```

## Task

When a chat request is being prepared, append every installed knowledge skill's markdown content to the system message, under a clear delimiter so the model can use them as authoritative context.

### A. Build a knowledge-skills block

Helper in `convo.js` (or a new sibling file `chat/src/skillPrompt.js` if cleaner — your call, keep it simple):

```js
import { get } from 'svelte/store';
import { knowledgeSkills } from './stores.js';

function buildKnowledgeBlock() {
  const skills = get(knowledgeSkills);
  if (!skills.length) return '';
  const blocks = skills.map(s => `## Skill: ${s.name}\n${s.content.trim()}`).join('\n\n---\n\n');
  return `\n\n# Installed knowledge skills\n\nThe user has activated the following skills. Apply them when relevant.\n\n${blocks}`;
}
```

### B. Append to the system message

Find the spot in `convo.js` where the outbound `system` (Anthropic) or system role message (OpenAI/others) is finalized. Append `buildKnowledgeBlock()`:

- For Anthropic (`system` is a string): `system = (system || '') + buildKnowledgeBlock();`
- For OpenAI-style (system is `messages[0]`): if a system message exists, append to its content. If not and the block is non-empty, prepend a new `{ role: 'system', content: buildKnowledgeBlock().trimStart() }`.

Apply this **after** existing `retrievalContext` handling so all context is present.

### C. Don't double-inject

Do not write the knowledge block into the persisted `convo.messages` array. It should only appear in the outbound request payload — otherwise it gets re-included on every turn AND saved to chat history, both wrong.

### D. Token budget guardrail

Skills can be long. Add a soft cap: if total knowledge content exceeds 60_000 chars, log `console.warn` once per send with the count, but still include all of it. (Real RAG/selection is out of scope for this step. Just make the cap visible.)

## Hard rules

- No mocks, no fakes. Use the real `knowledgeSkills` store wired up in step 4.
- Don't change the request transport, model selection, or non-skill parts of `convo.js`.
- Don't persist the skill block into chat history.
- Works for both Anthropic and OpenAI/OpenRouter request shapes already handled in this file.

## Verification

End-to-end against a real model:

1. Install one content skill via the modal — pick `ethereum-gas-optimization` (small and unambiguous).
2. Open browser DevTools → Network tab.
3. Send a message: "When is gas cheapest on Ethereum mainnet?"
4. Inspect the outbound request to the LLM provider. The `system` field (Anthropic) or first system message (OpenAI) MUST contain the markdown from the skill, under the `# Installed knowledge skills` delimiter.
5. The model's response should reference the skill's specifics (weekend / early UTC mornings, etc.).
6. Uninstall the skill. Send the same message. The system field MUST NOT contain the block anymore. Model response is generic.
7. Install 2-3 skills. Confirm all appear in the system prompt, separated by `---`.
8. Reload the page. Knowledge skills persist (from `localStorage`). System prompt still includes them.

## Done means

- Outbound system prompt contains installed skills' markdown verbatim.
- Persisted `convo.messages` does not contain the block (check `localStorage` and the visible chat history).
- Toggle (install/uninstall) reflects immediately on next send.
- Both Anthropic and OpenAI request paths covered.
