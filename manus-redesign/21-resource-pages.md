# Task 21 — Resource subpages

## Goal
Render the 5 resource pages reachable from the Resources dropdown:
- `resources/blog`
- `resources/docs`
- `resources/updates`
- `resources/use-cases`
- `resources/trust-center`

Each is content-shaped (lists/grids), not a marketing page. One shared `ResourcePage.svelte` selects the right inner template based on slug.

## Codebase context
- Source root: `/workspaces/3D-Agent/chat/`.
- `route` store from task 02; route switch in `App.svelte` (see task 12 for the pattern).

## Design tokens
- Page bg: `bg-paper`.
- Page header: `font-serif text-4xl font-semibold mb-2`. Sub: `text-[#6B6B6B] text-base mb-12`.
- Page wrapper: `max-w-[1100px] mx-auto px-6 pt-16 pb-24`.
- Card (used by Blog, Use cases): `bg-white border border-[#E5E3DC] rounded-2xl p-6 hover:bg-[#FAF9F4]`.
- Doc nav: 240px left rail + content column.
- Update entry: timeline-style with date on the left, content card on the right.
- Trust center: stat cards + compliance badge grid.

## Per-page spec

### `blog`
- Header: "Blog", sub: "Ideas, guides, and stories from the Manus team".
- 3-col grid of 9 article cards. Each card:
  - Tan thumbnail (`aspect-[16/9] rounded-xl bg-[#EFECE3]`)
  - Tag badge: `inline-block text-xs uppercase tracking-wide text-[#6B6B6B] mt-4`
  - Title: `font-serif text-xl mt-2`
  - 2-line excerpt: `text-sm text-[#6B6B6B] mt-2`
  - Date + read time: `text-xs text-[#9C9A93] mt-4`
- Use placeholder titles: "How we think about agent reliability", "Designing chat for non-engineers", "Inside the Manus runtime", etc.

### `docs`
- 240px left rail with section nav: Getting started, Concepts, API, SDKs, Tools, Skills, Deployments, FAQs.
- Right pane: a static "Welcome" article. Render plain prose with `prose prose-neutral max-w-none`.
- A "Search docs" input pinned to the top of the rail (`bg-white border border-[#E5E3DC] rounded-full h-9 px-3 text-sm`).

### `updates`
- Vertical timeline: each entry shows `<time class="text-xs text-[#9C9A93] uppercase tracking-wide">` and a card with title, body, optional image placeholder.
- Seed with 6 entries spanning the past 6 months (use absolute dates relative to today, e.g. "April 2026", "March 2026", …).

### `use-cases`
- 2-col grid of 8 case-study cards. Each card has an industry tag, a result headline ("Cut SDR onboarding from 4 weeks to 3 days"), a 2-line summary, and a logo placeholder strip.

### `trust-center`
- 3-column "stats" row at the top: SOC 2 Type II, GDPR ready, 99.95% SLA — each in a stat card.
- Below: 4 sections with headings "Data handling", "Access controls", "Subprocessors", "Vulnerability disclosure". Each is a card with a paragraph of copy.
- Bottom: a 6-tile compliance badge grid (placeholder gray boxes labeled SOC 2, ISO 27001, HIPAA, GDPR, CCPA, PCI).

## What to ship

### 1. Component: `chat/src/manus/pages/ResourcePage.svelte`
Props: `slug`. Switches on slug and renders one of:
- `BlogIndex.svelte`
- `DocsIndex.svelte`
- `UpdatesTimeline.svelte`
- `UseCasesIndex.svelte`
- `TrustCenter.svelte`

### 2. Five sub-components in `chat/src/manus/pages/resources/`
Each implements the layout above with seed content embedded inline (so the task is self-contained, no fetching).

### 3. Wire into `App.svelte` route switch
```svelte
{:else if $route.startsWith('resources/')}
  <ResourcePage slug={$route.slice('resources/'.length)} />
```

## Acceptance criteria
- All 5 resource URLs render their dedicated layout with seed content.
- Page widths and typography match Manus' general aesthetic from tasks 01 and 12.
- Top nav + announcement banner visible above each page.

## Out of scope
- Fetching real content from a CMS.
- Fully styled markdown rendering inside Docs (a single hard-coded article is fine).
