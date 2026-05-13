> **Internal Planning Document** — Not part of the public documentation.

# Prompt: Admin Panel Redesign — Modern Dashboard

## Problem
The current admin panel is a single HTML file with inline styles and basic Socket.IO controls. It works but doesn't look professional. For an open-source SDK, the admin panel IS the demo — it's what people see in screenshots and videos.

## Goal
A modern, polished admin dashboard that:
- Looks professional in screenshots (this sells the project)
- Provides real-time visibility into the agent
- Is responsive (works on mobile for monitoring)
- Ships as part of the server package (no separate build step)

## Design Approach
**No React, no build step.** The admin panel should be static HTML/CSS/JS that ships with the npm package. Use modern CSS (grid, custom properties, animations) and vanilla JS with Web Components if needed.

Why no React: keeps the server package dependency-free and the admin panel loads instantly with zero bundling.

## Visual Design

### Design Language
- Dark theme (dark gray background, not pure black)
- Accent color: electric blue (#3b82f6) or emerald (#10b981)
- Monospace font for data, sans-serif for UI labels
- Card-based layout
- Subtle animations (status indicators pulse, charts animate)
- Glassmorphism cards (subtle blur, border, shadow)

### Layout
```
┌─ HEADER ─────────────────────────────────────────────┐
│ [Logo] X Space Agent          ● Connected    [@user] │
├──────────────────────────────────────────────────────┤
│ ┌─ SIDEBAR ─┐ ┌─ MAIN CONTENT ────────────────────┐ │
│ │            │ │                                    │ │
│ │ Dashboard  │ │  ┌─ Status Card ──┐ ┌─ Audio ──┐  │ │
│ │ Agents     │ │  │ ● Speaking     │ │ ████░░░  │  │ │
│ │ Knowledge  │ │  │ Space: crypto..│ │ In: 24/s │  │ │
│ │ History    │ │  │ Uptime: 2h 14m │ │ Out: 0/s │  │ │
│ │ Schedule   │ │  └────────────────┘ └──────────┘  │ │
│ │ Plugins    │ │                                    │ │
│ │ Settings   │ │  ┌─ Live Transcript ─────────────┐ │ │
│ │            │ │  │ @user1: What about ETH?       │ │ │
│ │            │ │  │ Bob: ETH is showing strong...  │ │ │
│ │            │ │  │ @user2: And what about SOL?    │ │ │
│ │            │ │  │ Alice: SOL has been...          │ │ │
│ │            │ │  │                                │ │ │
│ │            │ │  │ [Send message...]              │ │ │
│ │            │ │  └────────────────────────────────┘ │ │
│ │            │ │                                    │ │
│ │            │ │  ┌─ Agent Cards ──────────────────┐ │ │
│ │            │ │  │ ┌─ Bob ──────┐ ┌─ Alice ────┐  │ │ │
│ │            │ │  │ │ [avatar]   │ │ [avatar]   │  │ │ │
│ │            │ │  │ │ Claude     │ │ Groq       │  │ │ │
│ │            │ │  │ │ Msgs: 42  │ │ Msgs: 38  │  │ │ │
│ │            │ │  │ │ ● Active  │ │ ● Active  │  │ │ │
│ │            │ │  │ └────────────┘ └────────────┘  │ │ │
│ │            │ │  └────────────────────────────────┘ │ │
│ │            │ │                                    │ │
│ └────────────┘ └────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

### Pages

#### 1. Dashboard (home)
- Connection status with pulse animation
- Space info (URL, duration, listener count)
- Audio pipeline visualization (input/output levels, VAD state)
- Live transcript (scrolling, color-coded by speaker)
- Agent status cards
- Quick actions: Join/Leave/Mute/Unmute

#### 2. Agents
- Per-agent configuration
- Personality selector
- System prompt editor (textarea with character count)
- Voice settings (provider, voice ID, speed)
- Conversation history viewer
- "Say something" text input

#### 3. Knowledge (if RAG is implemented)
- Document list with upload
- Chunk count, index status
- Memory browser
- User profiles list

#### 4. History (if persistence is implemented)
- Past conversations list
- Transcript viewer
- Export/replay controls

#### 5. Settings
- Auth token configuration
- Provider API keys
- Behavior settings
- Server settings

## CSS Architecture

Use CSS custom properties for theming:

```css
:root {
  /* Colors */
  --bg-primary: #0f1117;
  --bg-secondary: #1a1d27;
  --bg-card: #232733;
  --bg-card-hover: #2a2e3b;
  --border: #2e3345;

  --text-primary: #e4e6ef;
  --text-secondary: #8b8fa3;
  --text-muted: #5a5e72;

  --accent: #3b82f6;
  --accent-glow: rgba(59, 130, 246, 0.15);
  --success: #10b981;
  --warning: #f59e0b;
  --error: #ef4444;

  /* Spacing */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;

  /* Typography */
  --font-sans: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;

  /* Effects */
  --card-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3);
  --card-blur: blur(10px);
}

/* Card component */
.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: var(--space-lg);
  box-shadow: var(--card-shadow);
}

/* Status indicator with pulse */
.status-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
.status-indicator.active {
  background: var(--success);
  animation: pulse 2s infinite;
}
@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); }
  70% { box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
  100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
}

/* Audio level meter */
.audio-meter {
  height: 4px;
  background: var(--bg-secondary);
  border-radius: 2px;
  overflow: hidden;
}
.audio-meter-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--success), var(--warning), var(--error));
  transition: width 100ms;
}
```

## JavaScript Architecture

Single-page app with hash routing:

```javascript
// admin.js
class AdminApp {
  constructor() {
    this.socket = io('/space', { auth: { token: this.getToken() } })
    this.router = new Router({
      '#/': DashboardPage,
      '#/agents': AgentsPage,
      '#/knowledge': KnowledgePage,
      '#/history': HistoryPage,
      '#/settings': SettingsPage
    })
  }
}

// Simple hash-based router (no library needed)
class Router {
  constructor(routes) {
    this.routes = routes
    window.addEventListener('hashchange', () => this.route())
    this.route()
  }
  route() {
    const hash = location.hash || '#/'
    const Page = this.routes[hash]
    if (Page) {
      document.getElementById('main').innerHTML = ''
      new Page(document.getElementById('main'))
    }
  }
}
```

## Responsive Design
- Desktop: sidebar + main content
- Tablet: collapsible sidebar
- Mobile: bottom navigation tabs, stacked cards

```css
@media (max-width: 768px) {
  .sidebar { display: none; }
  .bottom-nav { display: flex; }
  .card-grid { grid-template-columns: 1fr; }
}
```

## File Structure
```
public/
├── admin.html            ← Single HTML entry point
├── css/
│   ├── admin.css         ← Main styles
│   ├── components.css    ← Card, button, input styles
│   └── responsive.css    ← Mobile/tablet breakpoints
├── js/
│   ├── admin.js          ← App init, router, socket
│   ├── pages/
│   │   ├── dashboard.js
│   │   ├── agents.js
│   │   ├── knowledge.js
│   │   ├── history.js
│   │   └── settings.js
│   └── components/
│       ├── transcript.js  ← Live transcript with auto-scroll
│       ├── audio-meter.js ← Real-time audio level
│       ├── status-bar.js  ← Connection status header
│       └── agent-card.js  ← Agent info card
└── assets/
    ├── logo.svg
    └── default-avatar.svg
```

## Implementation Steps
1. Design CSS theme (custom properties, card styles, typography)
2. Build HTML shell (sidebar, header, main content area)
3. Build hash router
4. Build Dashboard page (status, audio, transcript)
5. Build Agents page (config, history, controls)
6. Build Settings page
7. Add real-time Socket.IO updates
8. Add responsive design
9. Polish animations and transitions
10. Screenshot for README

## Validation
- [ ] Admin panel loads in < 500ms (no build step, no framework)
- [ ] Real-time status updates work via Socket.IO
- [ ] Live transcript scrolls and color-codes speakers
- [ ] Audio meter shows real-time levels
- [ ] All pages navigable via sidebar
- [ ] Works on mobile (responsive)
- [ ] Looks good in screenshots (dark theme, polished)
- [ ] No external CSS/JS dependencies (self-contained)


