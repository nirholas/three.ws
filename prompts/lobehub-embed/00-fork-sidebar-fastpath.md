# Task 00 — FAST PATH: mount the avatar in your LobeHub fork's right sidebar

## Why this exists

Tasks 01–08 build a **first-class LobeHub plugin** for the marketplace — iframes-in-chat-bubbles, handshake, auth handoff, bidirectional action relay, SDK, mention autocomplete, marketplace submission. That's the long game and it's weeks of work.

This task is the short game: **your own LobeHub fork, one iframe, persistent right sidebar, ship today.** No marketplace. No autocomplete. No mention parser. Just "when I open the app, my avatar is in the sidebar, and when chat messages come in, it reacts."

Run this **before** touching 01–08. It unblocks the experience now; the rest polishes it into a public product.

## Context

- Repo: this repo (`nirholas/3D-Agent`). The user has a **LobeHub fork** checked out separately.
- We do NOT edit this repo in most of the task — we edit the fork. The one edit here is optional: an opt-in URL parameter on our embed to dim/brighten when chat is idle vs. streaming.
- Our embed URL already works: `https://three.ws/agent/:id/embed?bg=transparent`. See [public/agent/embed.html](../../public/agent/embed.html).
- LobeHub is Next.js 14+ / React 18 / Zustand / Ant Design. Layout lives in `src/app/(main)/` (or `packages/web/src/` in some forks — read the fork's `package.json` and `next.config.js` before assuming).

## Goal

After this task ships, the user opens their LobeHub fork in the browser and sees:

- A **right-hand sidebar panel** (fixed width, collapsible) that renders their three.ws inside an iframe for the whole session.
- The avatar reacts to the currently active chat: when the LLM streams a token, the avatar mouths / sways; when the user sends, the avatar does a subtle acknowledgment.
- The panel has a header with the agent's name + a chevron to collapse/expand + a gear icon that opens the full agent page in a new tab.
- Closing/reopening the app remembers collapsed state (localStorage).

This is not a plugin. It's a fork modification. Power users can paste their `agentId` into a settings field; defaults to a demo agent if unset.

## Deliverable

### 1. Side-panel component in the LobeHub fork

File: depends on the fork layout. Identify it by running (in the fork, not this repo):

```bash
grep -rE '(Sidebar|RightPanel|Aside|ChatLayout)' src/ app/ packages/ --include='*.tsx' | head -20
```

Create `src/features/AgentDock/index.tsx` (or wherever the fork groups feature components). Target ~120 LOC.

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { useAgentDockStore } from './store';

const ORIGIN = process.env.NEXT_PUBLIC_AGENT_ORIGIN ?? 'https://three.ws/';

export function AgentDock() {
	const { agentId, collapsed, toggleCollapsed } = useAgentDockStore();
	const iframeRef = useRef<HTMLIFrameElement>(null);

	// Forward chat state → avatar via postMessage.
	useChatStreamBridge(iframeRef, ORIGIN);

	if (!agentId) return null;

	return (
		<aside className={`agent-dock ${collapsed ? 'agent-dock--collapsed' : ''}`}>
			<header className="agent-dock__header">
				<button onClick={toggleCollapsed} aria-label={collapsed ? 'Expand' : 'Collapse'}>
					{collapsed ? '‹' : '›'}
				</button>
				<span className="agent-dock__name">{/* populated from ready event */}</span>
				<a href={`${ORIGIN}/agent/${agentId}`} target="_blank" rel="noopener">
					⚙
				</a>
			</header>
			{!collapsed && (
				<iframe
					ref={iframeRef}
					src={`${ORIGIN}/agent/${agentId}/embed?bg=transparent&host=lobehub`}
					title="three.ws"
					allow="autoplay; microphone"
					style={{ border: 0, width: '100%', height: '100%', background: 'transparent' }}
				/>
			)}
		</aside>
	);
}
```

### 2. Zustand store for dock state

File: `src/features/AgentDock/store.ts`

```ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AgentDockState {
	agentId: string | null;
	collapsed: boolean;
	setAgentId: (id: string | null) => void;
	toggleCollapsed: () => void;
}

export const useAgentDockStore = create<AgentDockState>()(
	persist(
		(set) => ({
			agentId: null,
			collapsed: false,
			setAgentId: (id) => set({ agentId: id }),
			toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),
		}),
		{ name: 'agent-dock' },
	),
);
```

### 3. Chat → avatar bridge

File: `src/features/AgentDock/useChatStreamBridge.ts`

Purpose: listen to LobeHub's chat-stream state (find it via the fork's Zustand store — commonly `useChatStore`) and post minimal events to the iframe so the avatar reacts.

```ts
import { RefObject, useEffect } from 'react';
import { useChatStore } from '@/store/chat'; // path depends on fork — confirm first

export function useChatStreamBridge(iframeRef: RefObject<HTMLIFrameElement>, origin: string) {
	useEffect(() => {
		const post = (type: string, payload: Record<string, unknown> = {}) => {
			iframeRef.current?.contentWindow?.postMessage(
				{ __agent: true, v: 1, ns: '3d-agent', type, payload },
				origin,
			);
		};

		const unsubSend = useChatStore.subscribe(
			(s) => s.lastUserMessageId,
			() => post('gesture', { name: 'nod', duration: 800 }),
		);

		const unsubStream = useChatStore.subscribe(
			(s) => s.isStreaming,
			(isStreaming) => post(isStreaming ? 'thinking' : 'idle'),
		);

		// Optional: when the assistant finishes, forward the final text.
		const unsubDone = useChatStore.subscribe(
			(s) => s.lastAssistantMessage,
			(msg) =>
				msg &&
				post('speak', { text: msg.content, sentiment: detectSentiment(msg.content) }),
		);

		return () => {
			unsubSend();
			unsubStream();
			unsubDone();
		};
	}, [iframeRef, origin]);
}

function detectSentiment(text: string): number {
	// Cheap heuristic; Empathy Layer does the real work. -1..1.
	const positive = /\b(great|awesome|yes|thanks|good|nice|love|perfect)\b/gi;
	const negative = /\b(error|fail|sorry|broken|bad|no|wrong)\b/gi;
	const p = (text.match(positive) || []).length;
	const n = (text.match(negative) || []).length;
	return Math.max(-1, Math.min(1, (p - n) * 0.3));
}
```

The exact store path/names depend on the fork's version. **Read the fork's chat store first** — grep for `isStreaming`, `lastMessage`, `sendMessage` — and adjust. Do not invent store keys.

### 4. Layout integration

Mount `<AgentDock />` inside the main chat layout component. In most LobeHub forks this is `src/app/(main)/layout.tsx` or `src/layouts/ChatLayout.tsx`. Place it as a fixed-position sibling of the main chat area.

CSS (in `src/features/AgentDock/dock.module.css` or a global stylesheet — match the fork's convention):

```css
.agent-dock {
	position: fixed;
	right: 0;
	top: 0;
	bottom: 0;
	width: 360px;
	background: rgba(10, 10, 10, 0.6);
	backdrop-filter: blur(10px);
	border-left: 1px solid rgba(255, 255, 255, 0.08);
	display: flex;
	flex-direction: column;
	transition: transform 0.25s ease;
	z-index: 40;
}
.agent-dock--collapsed {
	transform: translateX(calc(100% - 32px));
}
.agent-dock__header {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 10px 12px;
	border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.agent-dock__name {
	font-size: 13px;
	opacity: 0.7;
	flex: 1;
}
.agent-dock iframe {
	flex: 1;
	min-height: 0;
}
@media (max-width: 900px) {
	.agent-dock {
		display: none;
	}
} /* hide on mobile for now */
```

Push the main content left by `360px` when the dock is expanded (search the fork's main layout for `margin-right` / CSS variable control — follow the existing pattern).

### 5. Settings entry point

Add an input in the fork's settings page for the user to set their `agentId`. Persisting via the Zustand store above. One-line addition in the existing Settings form — do not build a whole settings panel.

```tsx
<SettingsField label="three.ws ID">
	<input
		type="text"
		placeholder="agt_xxxxx"
		defaultValue={agentId ?? ''}
		onBlur={(e) => setAgentId(e.target.value || null)}
	/>
</SettingsField>
```

### 6. Demo agent fallback

Hard-code a `DEFAULT_DEMO_AGENT_ID` constant (e.g. `agt_demo`) in `src/features/AgentDock/index.tsx`. If `agentId` is unset, render with that id so first-run users see the avatar without configuring anything. Put a small "← set your own agent" link under the avatar.

### 7. (Optional, this repo) — dim on idle

In [public/agent/embed.html](../../public/agent/embed.html), accept an optional `?host=lobehub` param. When set, listen for `{ type: 'idle' }` and `{ type: 'thinking' }` messages and reduce/boost the exposure by ~10% so the host can signal stream state without changing the avatar's actual emotion state. Graceful no-op on unknown hosts.

Keep the change to under 25 lines. Do **not** change the `AgentAvatar` decay rates.

## Audit checklist

- **Fork path discovery.** Before writing a single line, grep the fork for chat-store and layout files. Paste your findings in the reporting block so whoever reviews this can trace your decisions.
- **Empathy Layer untouched.** You do not edit [src/agent-avatar.js](../../src/agent-avatar.js). The dim-on-idle is a viewer-exposure tweak, not an emotion change.
- **Origin discipline on postMessage.** Target origin is always `ORIGIN`, never `'*'`. Inbound listeners (if you add any) check `event.origin`.
- **Mobile hidden, not broken.** The `@media (max-width: 900px)` rule hides the dock entirely so the LobeHub chat stays usable on phones. Flag a follow-up for a proper mobile treatment — don't build it here.
- **CSP compatibility.** LobeHub likely sets a strict CSP. Verify `three.ws` is allowed in `frame-src` and `connect-src`. If not, add it in the fork's `next.config.js` CSP headers. Paste the CSP you saw before editing.
- **Dark-mode first.** Match the fork's dark theme. If the fork has light mode, the dock's background should inherit via CSS variables — don't hard-code `rgba(10,10,10,0.6)` if a theme variable exists.
- **Collapsed affordance.** The collapsed state must still show a visible grab tab (the `‹` button remains visible) — otherwise users lose the dock forever.

## Constraints

- **This task lives in the FORK, not this repo** — with the single optional exception of step 7.
- No new dependencies in the fork beyond what it already ships. Zustand is already there. If `zustand/middleware` isn't imported anywhere else, use the fork's existing persistence pattern instead.
- No runtime fetch to our API other than the iframe load. This is session-boot lightweight.
- Match the fork's code style (ESLint/Prettier configs in the fork). Run the fork's lint before committing.
- No changes to the LobeHub chat pipeline or message model. We read chat state; we do not write to it.

## Verification

1. Start the fork locally (`pnpm dev` or `npm run dev` depending on the fork).
2. Open the app → dock is visible on the right with the demo agent.
3. Open browser devtools → Network tab → filter by `three.ws` → iframe loaded, `/agent/:id/embed` returns 200.
4. Click the collapse chevron → dock slides right, grab tab remains visible.
5. Reload → collapsed state persists (localStorage).
6. Send a chat message → avatar does a small nod (inbound `gesture` event).
7. While assistant streams → avatar in "thinking" subtle motion.
8. Open settings → set a different agent id → dock re-mounts with the new agent.
9. Mobile breakpoint (DevTools responsive mode) → dock hidden, chat fully usable.
10. `pnpm lint && pnpm build` in the fork passes (whatever the fork's verify command is).

## Scope boundaries — do NOT do these

- Do **not** build the LobeHub plugin manifest — that's task [01](./01-plugin-manifest.md).
- Do **not** build a message-level mention renderer — that's task [07](./07-message-renderer.md).
- Do **not** build mention autocomplete — that's task [08](./08-mention-autocomplete.md).
- Do **not** package `@3dagent/embed` here — that's task [06](./06-host-sdk-package.md). For this fast-path, you iframe directly.
- Do **not** implement wallet auth handoff — that's task [03](./03-host-auth-handoff.md). Anon viewer is fine for sidebar.
- Do **not** submit to any marketplace.

## Files you own

In the fork:

- `src/features/AgentDock/index.tsx` (create)
- `src/features/AgentDock/store.ts` (create)
- `src/features/AgentDock/useChatStreamBridge.ts` (create)
- `src/features/AgentDock/dock.module.css` (create, or inline per fork convention)
- The main layout file (minimal edit: mount the dock)
- The settings form (minimal edit: add one field)
- `next.config.js` CSP (if edits required — flag if so)

In this repo (optional, step 7 only):

- [public/agent/embed.html](../../public/agent/embed.html) — tiny `?host=lobehub` branch. No other edits.

## Files off-limits

- Anything under [src/](../../src/) in this repo except the one optional embed.html tweak.
- [src/agent-avatar.js](../../src/agent-avatar.js) — Empathy Layer never touched.
- LobeHub chat pipeline, message store shape, server actions — read only.
- Tasks 01–08 deliverables — this fast-path explicitly short-circuits them.

## Reporting

Use the reporting template from [../drop-edit-embed/00-README.md](../drop-edit-embed/00-README.md). Additionally:

- Exact fork path + commit SHA you built against.
- Grep output identifying the chat store and layout file (paste the first few matches).
- CSP rules before + after (if you edited `next.config.js`).
- Screen recording or 3-frame screenshot strip: dock visible / collapsed / mobile-hidden.
- Any `TODO(lobehub-fork)` flags for things that didn't match the expected shape.
