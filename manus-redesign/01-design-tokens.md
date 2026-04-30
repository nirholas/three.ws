# Task 01 — Design tokens, fonts, and global styles

## Goal
Install the visual foundation that every other Manus-style task will rely on: warm off-white page background, serif headline font, refined gray scale, accent blue, and base typography. After this task, the rest of the chat keeps working but the page background, body font, and base color tokens already feel like Manus.

## Codebase context
- Stack: Svelte 4 + Vite + Tailwind. Source root: `/workspaces/3D-Agent/chat/`.
- Tailwind config: `chat/tailwind.config.cjs`.
- Global CSS: `chat/src/app.pcss`.
- HTML entry: `chat/index.html` (already preloads KaTeX).

## What to ship

### 1. Add Google Fonts to `chat/index.html`
Insert in `<head>`, before the title:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Lora:ital,wght@0,500;0,600;0,700;1,500&display=swap" rel="stylesheet">
```
Lora 600 stands in for Tiempos Headline; Inter is the body sans.

### 2. Extend `chat/tailwind.config.cjs` `theme.extend`
```js
fontFamily: {
  sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
  serif: ['Lora', 'ui-serif', 'Georgia', 'serif'],
},
colors: {
  paper: '#F5F4EF',          // page background
  'paper-deep': '#EBE8E0',   // banner / muted surface
  ink: '#1A1A1A',            // primary text
  'ink-soft': '#6B6B6B',     // secondary text
  rule: '#E5E3DC',           // borders & hairlines
  manus: {
    blue: '#3B82F6',
    'blue-soft': '#EFF6FF',
    'blue-border': '#BFDBFE',
  },
},
boxShadow: {
  pop: '0 8px 24px -8px rgba(20,20,20,0.12), 0 2px 6px -2px rgba(20,20,20,0.06)',
  composer: '0 1px 2px rgba(20,20,20,0.04), 0 8px 32px -16px rgba(20,20,20,0.10)',
},
borderRadius: {
  composer: '20px',
},
```

### 3. Replace `chat/src/app.pcss` with
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html, body {
    @apply bg-paper text-ink font-sans antialiased;
    font-feature-settings: 'ss01', 'cv11';
  }
  .font-display {
    @apply font-serif;
    font-feature-settings: 'liga', 'dlig';
    letter-spacing: -0.01em;
  }
}

@layer components {
  .manus-card {
    @apply bg-white border border-rule rounded-2xl;
  }
  .manus-chip {
    @apply inline-flex items-center gap-2 h-9 px-4 rounded-full
           border border-rule bg-white text-ink text-sm font-medium
           hover:bg-paper-deep transition-colors;
  }
  .manus-chip-selected {
    @apply bg-manus-blue-soft border-manus-blue-border text-manus-blue;
  }
  .manus-btn-primary {
    @apply inline-flex items-center justify-center h-9 px-4
           rounded-full bg-black text-white text-sm font-medium
           hover:bg-ink transition-colors;
  }
  .manus-btn-ghost {
    @apply inline-flex items-center justify-center h-9 px-4
           rounded-full bg-transparent text-ink text-sm font-medium
           hover:bg-paper-deep transition-colors;
  }
}
```

### 4. Hero text utility
Add to `app.pcss` `@layer components`:
```css
.manus-hero {
  @apply font-serif text-ink text-[44px] md:text-[56px] leading-[1.05] tracking-tight font-medium;
}
.manus-display {
  @apply font-serif text-ink text-[56px] md:text-[80px] leading-[1.02] tracking-tight font-semibold;
}
```

## Acceptance criteria
- App still builds and runs (`npm run dev` inside `chat/`).
- Page background renders as warm off-white `#F5F4EF`.
- Body text uses Inter; an element with class `font-display` uses Lora.
- The classes `manus-card`, `manus-chip`, `manus-chip-selected`, `manus-btn-primary`, `manus-btn-ghost`, `manus-hero`, `manus-display` are usable from any `.svelte` file.
- No existing chat behavior is broken; only colors/fonts changed.

## Out of scope
- Do not redesign the composer, sidebar, or message bubbles in this task.
- Do not add navigation or new pages.
