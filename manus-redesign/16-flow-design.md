# Task 16 — Design flow (mode = 'design')

## Goal
When `$mode === 'design'`, the empty-state landing changes to:
1. Composer placeholder: keep the existing one OR set to "Describe what you want to design".
2. Inside the composer footer, render an inline **blue "Design" mode pill** (selected) plus an image-model selector pill that says "GPT Image 2 ▾" with a small OpenAI dot icon left, and chevron right. Clicking opens a model dropdown (GPT Image 2, Stable Diffusion XL, Flux 1, Banana 🍌). Persist selection in `designModel` writable.
3. Below the composer, render the "Get started with" section: a 2-column grid (3 columns on `xl`) of large preview cards. Each card has a title, a 2-line description, a chevron arrow on the title row, and a thumbnail image on the right.

## Codebase context
- Source root: `/workspaces/3D-Agent/chat/`.
- `mode` store in `stores.js`. Add:
  ```js
  export const designModel = writable('gpt-image-2');
  ```
- Composer (task 05) supports `extraInlinePills`.

## Design tokens
- Mode pill: `manus-chip-selected` with `feZap` icon and label "Design".
- Model pill: `inline-flex items-center gap-2 h-8 px-2 pr-1 rounded-full border border-[#E5E3DC] bg-white text-sm`. Inside: 16px circle dot for the model, label, then `feChevronDown` size 14.
- "Get started with" header: `text-[#1A1A1A] font-medium mb-4 mt-10`.
- Cards: `bg-white border border-[#E5E3DC] rounded-2xl p-5 flex gap-4 hover:bg-[#F5F4EF]`.
  - Left column: `flex-1 min-w-0`. Title row: `flex items-center justify-between text-[#1A1A1A] font-semibold text-sm` (truncate with `text-ellipsis overflow-hidden whitespace-nowrap`). Description: `text-xs text-[#6B6B6B] mt-1.5 line-clamp-2`.
  - Right column: 96px square image with `rounded-lg bg-[#EFECE3]`. If no image, render a placeholder using a feather icon + soft tan bg.
- Grid: `grid md:grid-cols-2 xl:grid-cols-3 gap-4 max-w-[1100px] mx-auto px-6`.

## Card content (use these 6)
| Title | Description | Thumb hint |
|---|---|---|
| Create data infographic on coffee trends | Convert the key data from an article on "Global Coffee Consumption…" into a visual infographic. | infographic |
| Design Japanese restaurant menu | Design a menu for my high-end Japanese restaurant, "Sakura House." | menu |
| Design smart bracelet and packaging | Design the product concept and packaging for my health-monitoring smart bracelet. | bracelet |
| Design SaaS product launch posters | Design a set of product launch promotional posters for my project management SaaS. | poster |
| Design interactive tech expo booth | Design a 36-square-meter tech expo booth for my AI company's product showcase. | booth |
| Design modern coffee brand identity | Design a modern, minimalist logo and full VI for my specialty coffee brand. | brand |

## What to ship

### 1. Component: `chat/src/manus/flows/DesignFlow.svelte`
Renders the header + 6-card grid. Clicking a card fills the composer with the card's description and submits.

### 2. Model picker: `chat/src/manus/DesignModelPicker.svelte`
A small dropdown attached to the model pill in the composer. Models:
```js
const models = [
  { id: 'gpt-image-2', label: 'GPT Image 2',    badge: '⊕' },
  { id: 'sdxl',        label: 'Stable Diffusion XL' },
  { id: 'flux-1',      label: 'Flux 1' },
  { id: 'banana',      label: 'Banana',          badge: '🍌' },
];
```
Bind to `designModel` store. Match the popover style of task 07 (white card, rounded, shadow-pop, items hover bg-paper).

### 3. Composer wiring
When `$mode === 'design'`, inject:
- inline pill 1: blue Design mode pill (the composer already shows the selected mode pill — no extra work needed).
- inline pill 2: model selector that opens `DesignModelPicker` and shows the current `$designModel`'s label.

### 4. Mounting
In `EmptyState`, when `$mode === 'design'`, render `<DesignFlow />` below the composer.

## Acceptance criteria
- Clicking the "Design" suggestion chip activates the flow.
- Composer shows the Design mode pill + the GPT Image 2 model pill; clicking the model pill opens the picker; selecting persists.
- Below the composer, the 6-card "Get started with" grid renders with titles, descriptions, and thumbnail tiles.
- Clicking a card fills the composer with that card's description and submits.

## Out of scope
- Real image generation backend.
- Other modes.
