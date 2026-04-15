# Task 04 — `@` autocomplete for agents

## Why

Mentions are only useful if they're easy to type. Typing `@` should surface the user's agent roster + recent agents they've interacted with.

## Depends on

Task 03 shipped.

## Read first

- LobeHub input component (ProChat / ChatInput)
- `GET /api/agents/resolve` (from task 02)
- A new `GET /api/agents/suggest` (build here)

## Build this

### 1. `GET /api/agents/suggest`

- Query: `?q=<prefix>&limit=8`.
- Public endpoint. CORS open.
- Returns:
  ```json
  { agents: [ { id, name, avatar_thumb, address, ens?: string }, … ] }
  ```
- Ranking:
  1. Prefix match on ENS / Basename
  2. Prefix match on agent name
  3. Recent usage (stretch — MVP can skip this)
- Cache 60 seconds.

### 2. Input plugin in LobeHub

Hook into the input's `@`-trigger menu:

```tsx
export const agentMentionRule = {
	trigger: '@',
	async suggest(query: string) {
		const res = await fetch(`${ORIGIN}/api/agents/suggest?q=${query}`);
		const { agents } = await res.json();
		return agents.map(a => ({
			id:    a.id,
			label: a.ens ?? a.name,
			avatar: a.avatar_thumb,
			insert: a.ens ? `@${a.ens}` : `@${a.id}`,
		}));
	}
};
```

Attach to whichever mention plugin LobeHub already ships (tiptap / slate / quill — depends on the fork).

### 3. Preview in the suggest menu

Each row shows:
- Avatar thumbnail (24×24)
- Name / ENS (bold if exact match)
- Short description (muted, truncated)

### 4. Keyboard UX

- `Esc` closes the menu.
- `Up/Down` navigates.
- `Tab` or `Enter` selects.
- `@` alone shows "recent" (empty for now).

### 5. Offline fallback

If `/suggest` fails, still let the user finish typing the mention as text — don't block the keystroke.

## Don't do this

- Do not debounce below 150ms — feels laggy.
- Do not require auth for suggest — the chat UX must work before signing in.
- Do not leak private agents; only public ones appear in suggest.

## Acceptance

- [ ] Type `@vit` → suggest menu shows Vitalik's agent (if registered) + ENS-prefix matches.
- [ ] Type `@0xabc` → suggest returns by-address matches.
- [ ] Select → token inserted into the input; send → renders via task 03.
- [ ] Network offline → typing still works, just no menu.

## Reporting

- Suggest endpoint's first-query latency
- Screenshot of the menu
