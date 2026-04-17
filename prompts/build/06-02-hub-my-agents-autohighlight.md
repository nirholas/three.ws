---
mode: agent
description: "When opening RegisterUI from the hub Manage button, auto-highlight the specific registered agent in the My Agents tab"
---

# 06-02 · Hub Manage Button — Auto-Highlight Registered Agent in My Agents Tab

## Context

On `/agent/:id`, the owner sees a "Deploy on-chain" button that, when the agent is already registered, opens `RegisterUI` on the **My Agents** tab. The code is in `src/agent-hub-actions.js` (the registered-agent click handler starting around line 59):

```js
new RegisterUI(
    wrap,
    () => { wrap.remove(); location.reload(); },
    { initialTab: 'my' },
);
```

The problem: the My Agents tab loads all agents owned by the connected wallet, but doesn't know which specific agent to highlight. The owner has to scan the list manually to find and click "Edit on-chain ✏️" for the right one.

The backend already provides `erc8004_agent_id` and `chain_id` in the `rawAgent` object passed to `renderHubActions`. We can pass these as hints to `RegisterUI` so it auto-scrolls to and visually highlights the matching card.

## Files to modify

- `src/erc8004/register-ui.js` — constructor opts, `_renderMyAgents`, `_fillAgentCard`
- `src/agent-hub-actions.js` — pass `highlightAgentId` + `highlightChainId` in the `opts` object

## What to build

### 1. `RegisterUI` constructor — accept `highlightAgentId` and `highlightChainId`

In `src/erc8004/register-ui.js`, find the constructor (around line 230). After `this.activeTab = opts.initialTab || 'create';`, add:

```js
this._highlightAgentId = opts.highlightAgentId ? Number(opts.highlightAgentId) : null;
this._highlightChainId = opts.highlightChainId ? Number(opts.highlightChainId) : null;
```

### 2. `_renderMyAgents` — switch to the correct chain before listing

In `_renderMyAgents` (line ~1382), before the `listAgentsByOwner` call, if a highlight chain is set, switch `this.selectedChainId` to it and update the chain select element so the UI reflects the switch:

```js
if (this._highlightChainId && this._highlightChainId !== this.selectedChainId) {
    this.selectedChainId = this._highlightChainId;
    const sel = this.el.querySelector('.erc8004-chain-select');
    if (sel) sel.value = String(this._highlightChainId);
}
```

Place this block at the very top of `_renderMyAgents`, before any DOM writes.

### 3. `_fillAgentCard` — auto-scroll and highlight the matched agent

In `_fillAgentCard` (line ~1443), after the card's full `innerHTML` is set and the event listeners are wired (i.e., at the end of the `try` block, just before the closing `}`), add:

```js
if (this._highlightAgentId && Number(agentId) === this._highlightAgentId) {
    card.classList.add('erc8004-agent-card--highlight');
    // Scroll into view after a brief frame so layout is complete
    requestAnimationFrame(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
    // If this card has an edit button, click it automatically so the owner
    // lands directly in the edit flow without an extra click.
    if (opts.withEdit) {
        const editBtn = card.querySelector('[data-role="edit"]');
        if (editBtn) {
            // Small delay to let the scroll finish
            setTimeout(() => editBtn.click(), 400);
        }
    }
}
```

### 4. CSS — highlight class

The `erc8004-agent-card--highlight` class needs a visual distinction. Find where agent card styles live (they're inline in register-ui.js — search for `.erc8004-agent-card` in the `_buildStyles` or equivalent `<style>` injection). Add:

```css
.erc8004-agent-card--highlight {
    outline: 2px solid var(--erc8004-accent, #7c6fff);
    outline-offset: 2px;
}
```

To find where to inject it: in `register-ui.js`, search for `erc8004-agent-card {` — the styles are in a template literal injected into a `<style>` tag. Add the new rule directly after the existing `.erc8004-agent-card` block.

### 5. `src/agent-hub-actions.js` — pass the hint

In the registered-agent click handler (around line 59–79), find:

```js
new RegisterUI(
    wrap,
    () => {
        wrap.remove();
        location.reload();
    },
    { initialTab: 'my' },
);
```

Change to:

```js
new RegisterUI(
    wrap,
    () => {
        wrap.remove();
        location.reload();
    },
    {
        initialTab: 'my',
        highlightAgentId: erc8004AgentId || null,
        highlightChainId: chainId || null,
    },
);
```

The variables `erc8004AgentId` and `chainId` are already extracted at the top of `renderHubActions` (lines 18–20).

## Verification

```bash
node --check src/erc8004/register-ui.js
node --check src/agent-hub-actions.js
npm run build
```

Both should pass clean. No browser available — note inability to smoke-test in report.

## Behaviour when `erc8004AgentId` is null

If `rawAgent.erc8004_agent_id` is null (e.g., registered externally and not tracked by the backend), no auto-highlight occurs — the My Agents tab opens normally and the user selects manually. The guard `if (this._highlightAgentId && ...)` handles this safely.

## Out of scope

- Auto-connecting the wallet (wallet must already be connected for `_renderMyAgents` to load the list).
- Changing what "Edit on-chain" does — that modal is separate.
- Showing a loading skeleton while the card fills in (it already shows "Loading #ID…" text).
