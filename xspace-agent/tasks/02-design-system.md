# Task 02: Shared Design System

## Context
The project has 6+ HTML files (landing, index, admin, agent1, agent2, builder) each with their own inline CSS. Colors, fonts, spacing, and component styles are duplicated and slightly inconsistent. We need a shared design system.

## Requirements

### Design Tokens (`public/css/tokens.css`)
Create a CSS custom properties file that all pages import:

```css
:root {
  /* Colors */
  --color-bg: #060606;
  --color-surface-1: #111118;
  --color-surface-2: #1a1a24;
  --color-fg: #F7F7F7;
  --color-fg-muted: #a1a1aa;
  --color-fg-dim: #71717a;
  --color-primary: #6366f1;
  --color-primary-hover: #4f46e5;
  --color-accent-cyan: #38bdf8;
  --color-accent-purple: #c084fc;
  --color-accent-green: #22c55e;
  --color-accent-amber: #fbbf24;
  --color-accent-warm: #FFC880;
  --color-accent-lavender: #B4BFF4;
  --color-error: #ef4444;
  --color-warning: #f59e0b;

  /* Typography */
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
  --font-size-xs: 0.7rem;
  --font-size-sm: 0.8rem;
  --font-size-base: 0.95rem;
  --font-size-lg: 1.125rem;
  --font-size-xl: 1.35rem;
  --font-size-2xl: 1.75rem;
  --font-size-3xl: 2.5rem;
  --font-size-4xl: 3.5rem;
  --font-size-5xl: 4rem;

  /* Spacing */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-12: 3rem;
  --space-16: 4rem;

  /* Borders */
  --border-subtle: rgba(255, 255, 255, 0.06);
  --border-hover: rgba(255, 255, 255, 0.12);
  --radius: 0.5rem;
  --radius-md: 0.75rem;
  --radius-lg: 1rem;
  --radius-xl: 1.25rem;
  --radius-full: 9999px;

  /* Effects */
  --glass-bg: rgba(204, 204, 204, 0.08);
  --glass-border: rgba(204, 204, 204, 0.12);
  --glass-blur: blur(20px);
  --shadow-glow-primary: 0 0 60px rgba(99, 102, 241, 0.15);
}
```

### Shared Components (`public/css/shared.css`)
Extract common component styles used across multiple pages:
- `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-sm`, `.btn-lg`
- `.badge` with variants (ai, web, success, error, warning)
- `.card` with glassmorphic variant
- `.input`, `.input-search`
- `.status-dot` (online/offline/speaking)
- `.avatar` sizes
- `.header` base styles
- `.scrollbar` custom scrollbar styles
- `.fade-in` animation utility

### Migration
- Update `landing.html` to import `tokens.css` and `shared.css` instead of inline duplicates
- Update `index.html` (live chat) to use shared tokens
- Update `admin.html` to use shared tokens
- Update `agent1.html` and `agent2.html` to use shared tokens
- Update `builder.html` to use shared tokens
- Each page keeps only its page-specific styles inline

### Do NOT
- Don't introduce a build tool (Sass, PostCSS, Tailwind) — keep it plain CSS
- Don't change any visual appearance — this is a refactor, not a redesign
- Don't remove page-specific styles that are unique to one page

## Files to Create
- `public/css/tokens.css`
- `public/css/shared.css`

## Files to Modify
- `public/landing.html`
- `public/index.html`
- `public/admin.html`
- `public/agent1.html`
- `public/agent2.html`
- `public/builder.html`

## Acceptance Criteria
- [ ] All pages render identically before and after migration (visual regression check)
- [ ] `tokens.css` is the single source of truth for all colors, fonts, spacing
- [ ] No color hex values remain inline except in page-specific overrides with a comment explaining why
- [ ] Adding a new page only requires importing 2 CSS files + page-specific styles


