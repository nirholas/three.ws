# Task 14 — Slides flow (mode = 'slides')

## Goal
When `$mode === 'slides'`, augment the empty-state landing with:
1. The composer placeholder text becomes "Describe your presentation topic".
2. Inside the composer footer, render an inline pill row: a blue "Slides" pill (selected mode), a white "Professional" tone selector, and an image-model selector that shows two icons (OpenAI + Banana). Clicking either selector opens its dropdown.
3. Below the composer, render two sections:
   - **Sample prompts** — 4 cards with example topics. Clicking inserts the text into the composer and submits.
   - **Choose a template** — a horizontal grid of 8–12 template thumbnails with a slide-count selector ("8 - 12 ▾") on the right.

## Codebase context
- Source root: `/workspaces/3D-Agent/chat/`.
- `mode` writable in `chat/src/stores.js`.
- Composer (task 05) renders `<EmptyState>`'s `composer` slot. The empty state wrapper (task 04) lets you swap content underneath the composer based on `$mode`.
- Wrap any new flow UI in a route-agnostic component:
  - `chat/src/manus/flows/SlidesFlow.svelte` — renders the cards/templates section.
  - The composer gets two new optional props: `placeholderOverride`, `extraInlinePills` (array of `{ icon, label, kind }`). Pass them in from `App.svelte` only when `$mode === 'slides'`.

## Design tokens
- "Slides" mode pill: `manus-chip-selected` with `feLayout` icon.
- "Professional" tone pill: `manus-chip` (white, ink text) with `feFeather` (or the existing `feZap`) icon. Clicking opens a dropdown of tones: Professional, Casual, Academic, Playful, Minimal.
- Image-model pill: rounded-full bg-white border, padding `px-2`, content is two 18px favicon-style icons + a chevron-down. Use simple `<img>` with these data URIs or feather circles (placeholder OK):
  - OpenAI: `feCircle` filled black.
  - Banana: a tiny SVG emoji 🍌 OR `feFeather` icon. Acceptable to use `<span class="text-base">🍌</span>` if emoji rendering is fine.
- Sample prompt card: `bg-white border border-[#E5E3DC] rounded-xl p-4 text-left h-[112px] flex flex-col justify-between hover:bg-[#F5F4EF]`.
  - Title: `text-sm text-[#1A1A1A]` (2-line clamp, `line-clamp-2`).
  - Trailing arrow icon `feArrowUpLeft` (or `feCornerLeftDown`) in bottom-right, 14px, `text-[#9C9A93]`.
- Section heading: `text-sm font-semibold text-[#1A1A1A] mb-3 mt-10`.
- Templates grid: `grid grid-cols-4 gap-4`. Each tile is a 4:3 ratio card with an image placeholder; first tile is "Import template" (icon `feUpload`).
- Slide-count dropdown: `bg-white border border-[#E5E3DC] rounded-full h-9 px-3 text-sm flex items-center gap-2`, icon `feLayout` left, chevron right.

## Sample prompt content
- "Automate weekly team status reporting"
- "Build quarterly sales performance dashboard"
- "Create strategic business review presentation"
- "Design investor pitch deck with projections"

## Templates
Generate 8 placeholder cards. For each, render an empty card with a faint serif title centered ("Sample template 1" through "8") on a tan/off-white tile (`bg-[#EFECE3]`), so the visual rhythm matches the reference even before real assets exist.

## What to ship

### 1. Component: `chat/src/manus/flows/SlidesFlow.svelte`
- Renders the "Sample prompts" grid and the "Choose a template" grid.
- Emits `select` events for sample prompts (fills composer + submits) and template selection (sets a `slidesTemplate` writable in `stores.js`, optional).

### 2. Composer wiring
- In `App.svelte`, when `$mode === 'slides'`, pass:
  - `placeholderOverride = 'Describe your presentation topic'`
  - `extraInlinePills = [{ id:'tone', label:'Professional', icon:feZap }, { id:'imgModel', label:null, render:'imgModelPair' }]`
- In `Composer.svelte` (task 05), accept these props; if `extraInlinePills[i].render === 'imgModelPair'`, render the OpenAI + Banana pair.
- The "Slides" mode pill itself is already rendered by the composer when `$mode === 'slides'` (task 05 handles the inline mode pill display).

### 3. Mounting
- In `EmptyState`, after the chips slot, render `<SlidesFlow />` only when `$mode === 'slides'`.

## Acceptance criteria
- Clicking "Create slides" chip switches the composer placeholder, shows the Professional + image-model inline pills, and renders the Sample prompts and Templates sections under the composer.
- Clicking a sample prompt fills the textarea and triggers send.
- Clicking the "8 - 12 ▾" pill opens a dropdown allowing 4-8, 8-12, 12-16, 16-20.
- Switching mode away (clicking the chip again or picking a different one) reverts the composer placeholder and hides the SlidesFlow section.

## Out of scope
- Real slide generation backend; only UI plumbing.
- Other modes (tasks 15–18).
