# Task: Add Tools tab to the agent marketplace page

## Context

The project has an agent marketplace page at `/workspaces/3D-Agent/marketplace.html` with a sidebar nav. The nav currently has: Home, Agent, Skills, Model. "Skills" links to `/features` and "Model" links to `/dashboard` — these are placeholders. The marketplace page is a vanilla HTML/JS/CSS page (not Svelte).

The goal is to add a **Tools** tab to the marketplace sidebar that lists curated tool packs users can install into the chat. This page is a discovery surface — it links to the chat with a query param that auto-installs the pack.

## What to build

### 1. Add a Tools tab to the marketplace sidebar

In `marketplace.html`, the sidebar nav looks like:
```html
<a href="/" data-nav="home">…Home</a>
<a href="/marketplace" data-nav="agent" class="active">…Agent</a>
<a href="/features" data-nav="skills">…Skills</a>
<a href="/dashboard" data-nav="model">…Model</a>
```

Add a new entry:
```html
<a href="/marketplace?tab=tools" data-nav="tools">…Tools</a>
```

Use a wrench or plugin icon consistent with the existing icon style in the sidebar.

### 2. Create a marketplace CSS file or extend the existing one

Find the existing `marketplace.css` (referenced in `marketplace.html`). Add styles for the tools grid if needed, or reuse agent card styles.

### 3. Add tool pack cards to the page content

When `?tab=tools` is in the URL (or the Tools nav item is active), show a grid of tool pack cards. Each card shows:
- Pack name
- Description
- Number of tools
- An "Add to chat" button that links to `/chat#tools?install=PACK_ID` (or similar — the exact install mechanism can be a TODO note, since the client-side install logic lives in the Svelte app)

The tool packs to display are the same ones defined in `chat/src/tools.js` (`curatedToolPacks` — see prompt `06-tool-pack-marketplace.md`). Since this is a static HTML page, hardcode the pack definitions here too (they're small).

Start with these packs:
- **TradingView Charts** — `id: tradingview`, description: "Live candlestick charts for any crypto or stock symbol", tools: 1
- **Web Search** — `id: web-search`, description: "Search the web and return top results inline", tools: 1  
- **Date & Time** — `id: datetime`, description: "Get current time and timezone in any conversation", tools: 2

### 4. Tab switching

The marketplace page uses `data-nav` attributes and likely has JS to handle tab state. Read the existing JS in `marketplace.html` (or a linked script) to understand how the agent tab is activated, then apply the same pattern for the tools tab.

If the page uses URL params to determine the active tab, handle `?tab=tools` at page load to activate the tools view.

### 5. Active state

When on the tools tab, the Tools nav item should have `class="active"` and the agent content should be hidden (follow the existing show/hide pattern).

## Success criteria

1. `/marketplace?tab=tools` shows the tools tab with pack cards
2. The Tools sidebar item is highlighted when on the tools tab
3. Each pack card shows name, description, tool count, and an "Add to chat" button
4. The Agent tab still works correctly with no regression
5. `node --check` passes on any JS files touched (or no JS files touched)

## House rules

- Edit `marketplace.html` and `marketplace.css` (or whatever CSS file styles the marketplace)
- Do not create a backend API — this is a static discovery page
- Match the visual style of the existing agent cards
- The "Add to chat" button can link to `/chat` with a query param — a TODO comment for the Svelte install side is acceptable
- Report: what shipped, what was skipped, what broke, unrelated bugs noticed
