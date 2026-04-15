# Task 03 — In-chat message renderer

## Why

LobeHub's chat renders messages as React components. When a message contains an agent token (`@agt_abc` or `@vitalik.eth`), replace it inline with a live mounted avatar. The message-level integration is what makes this feel native, not plugin-y.

## Depends on

- Task 01 (SDK) shipped or pinned via git URL.
- LobeHub fork checked out on the user's side (we write *against* its conventions, not *in* its repo).

## Read first

- Task 01's `@3dagent/embed` API
- LobeHub fork's message renderer component — typically `packages/client/src/Conversation/Messages/...`; ask the user for the exact path
- LobeHub's plugin render contract (the `ui.url` iframe path)

## Build this

### 1. Token grammar

In a chat message, these are agent references:

```
@agt_abcdef123456         — explicit agent id
@0xabc…                   — wallet address
@vitalik.eth              — ENS name
@nick.base.eth            — Basename
```

Parse at render time (not at send time — keep the raw text canonical).

### 2. Renderer component

In the LobeHub fork, create `packages/client/src/Conversation/Components/AgentMention.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import { mountAgent } from '@3dagent/embed';

export function AgentMention({ query }: { query: string }) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!ref.current) return;
		const handle = mountAgent(ref.current, resolveQueryToOpts(query));
		return () => handle.destroy();
	}, [query]);
	return <div ref={ref} style={{ width: 320, height: 360 }} />;
}

function resolveQueryToOpts(q: string) {
	if (q.startsWith('agt_')) return { agentId: q };
	if (q.startsWith('0x'))   return { agentAddress: q };
	return { agentName: q };
}
```

### 3. Message parser

Wherever LobeHub renders Markdown → React, inject a pre-pass that splits on `/@(agt_\w+|0x[0-9a-fA-F]{40}|[\w-]+\.(?:eth|base\.eth))/g` and wraps matches in `<AgentMention />`.

### 4. Placement rules

- One `<AgentMention />` per message, maximum. Multiple mentions → first renders live, rest render as text chips linking to `/agent/:id`.
- Mobile: fixed size 240×280. Desktop: 320×360.
- Hover chip for address/ENS above the avatar for clarity.

### 5. Performance

- `IntersectionObserver` — mount only when the message scrolls into view.
- Unmount when out of view for > 60 s.
- Reuse iframes across message re-renders (React `key={query}` stable).

### 6. Interactivity

- Clicking the avatar expands it to a focused modal (the full embed, `kiosk=false`).
- An optional caption under the avatar shows the last speak event text.

## Don't do this

- Do not try to parse mentions server-side. Client-only.
- Do not auto-fetch for unmatched tokens (prevent DoS).
- Do not modify LobeHub's core message model. Extend at the renderer layer.

## Acceptance

- [ ] User types `@vitalik.eth` in the chat input → message renders with a live avatar if registered, or a plain `@vitalik.eth` text link if not.
- [ ] Scroll performance stays smooth with 20 mentions in the thread.
- [ ] Clicking the avatar opens the full viewer modal.
- [ ] The LobeHub fork still builds.

## Reporting

- The exact LobeHub fork path edited
- Screen recording of typing a mention and seeing it resolve
- Any LobeHub-specific patching required (e.g. config overrides for external iframe policy)
