# 05-02 — "Copy Claude Artifact" button on agent page

**Pillar 5 — Host embed.**

## Why it matters

We've built the artifact runtime (`05-01`). Now a user has to be able to paste the agent into a Claude chat in one step. Target: user clicks "Copy for Claude", pastes into Claude's chat box, Claude creates an Artifact with their agent inside — all without the user writing any HTML.

## What to build

Extend the SnippetPicker (`04-06`) for the `claude-artifact` target to generate a pastable **natural-language prompt** that Claude will respond to with an Artifact containing the agent.

Format (this goes in the clipboard):

```
Please create an artifact that embeds this 3D agent:

<iframe src="https://3dagent.vercel.app/api/agents/<id>/artifact.html?size=card&bg=transparent" style="width:100%;height:520px;border:0;background:transparent"></iframe>

Show it prominently. Let me interact with it by posting window messages to the iframe: `{ __agent: '<id>', type: 'emote', payload: { trigger: 'celebrate', weight: 0.7 } }` for example. Types are `speak`, `emote`, `gesture`, `look-at`.
```

Copying that into a fresh Claude chat reliably produces an artifact with the agent. The raw iframe on its own also works, but Claude often wraps it awkwardly — the prose framing steers it.

## Read these first

| File | Why |
|:---|:---|
| `src/components/snippet-picker.jsx` (from 04-06) | Where the snippet string lives. |
| `api/agents/[id]/artifact.js` (from 05-01) | Target URL. |
| [public/agent/index.html](../../public/agent/index.html) | Share panel mount. |

## Build this

### 1. Snippet generator update

In `src/components/snippet-picker.jsx`, `claude-artifact` target:

```js
case 'claude-artifact':
  return `Please create an artifact that embeds this 3D agent:\n\n<iframe src="${origin}/api/agents/${agent.id}/artifact.html?size=${size}&bg=${bg}" style="width:100%;height:520px;border:0;background:transparent"></iframe>\n\nShow it prominently. Let me interact with it by posting messages to the iframe — types are speak, emote, gesture, look-at.`;
```

Size/bg flow through from the picker controls.

### 2. Preview tab

Under the textarea, add a "Preview in a test harness" link: opens `/preview/claude-artifact?agent=<id>&size=<s>&bg=<bg>` — a tiny page mocking a Claude-ish chat UI with the iframe + a small controls panel for emit buttons. Lets the user sanity-check the artifact works end-to-end before they paste into Claude.

### 3. Hint text

Above the Copy button for `claude-artifact`:

> Paste into a new Claude chat. Claude will create an artifact with your agent inside.

Link: "How it works" → opens a modal with the postMessage contract documented.

### 4. postMessage cheat sheet

Modal contents:

```
Control your agent from Claude by running this in the artifact:

window.frames[0].postMessage({
  __agent: '<id>',
  type: 'emote',
  payload: { trigger: 'celebrate', weight: 0.8 }
}, '*');

Types: speak, emote, gesture, look-at.
```

Keep short — one screen, no tabs.

## Out of scope

- Do not publish this as a "Claude plugin" — this is a paste-prompt flow, not an integration.
- Do not try to auto-post into Claude (there's no API for that).
- Do not build a Claude-specific auth.
- Do not alter the artifact runtime (`05-01`) — just build the paste UX.

## Deliverables

**New:**
- `public/preview/claude-artifact.html` — 20-line test harness.

**Modified:**
- `src/components/snippet-picker.jsx` — generator + copy flow + hint text.
- `public/agent/index.html` (or wherever SnippetPicker mounts) — confirm the `claude-artifact` tab is no longer a placeholder.

## Acceptance

- [ ] Owner opens agent page → share → Claude Artifact tab → copies snippet.
- [ ] Pasting into a fresh Claude chat produces an artifact with the agent rendered.
- [ ] Preview harness at `/preview/claude-artifact?agent=<id>` renders and the "emote" test buttons react.
- [ ] Changing size preset updates both the snippet and the preview iframe URL.
- [ ] `npm run build` passes.

## Test plan

1. Sign-in owner, open their agent, copy the Claude Artifact snippet.
2. Paste into claude.ai new chat. Claude should create an artifact containing the iframe. Verify avatar renders.
3. In the artifact's devtools, run the postMessage snippet for each type → avatar reacts.
4. Repeat with size=bubble → claude renders smaller. size=banner → larger.
5. Test harness at `/preview/claude-artifact?agent=<id>` — emit buttons work.
