# Task 15 — Website flow (mode = 'website')

## Goal
When `$mode === 'website'`, the empty-state landing changes to:
1. Composer placeholder: "Describe the website you want to build".
2. Inline pill row inside the composer: a blue "Website" mode pill (selected).
3. Right-side affordances above the categories row: "Add website reference" (link icon) and "Import from Figma" (Figma logo).
4. Below the composer, a horizontal scrollable row labelled "What would you like to build?" with category chips: Landing Page, Dashboard, Portfolio, Corporate, SaaS, Link in bio (truncated as "Lin…" with chevron).
5. When a category is selected (Landing Page / Dashboard / Portfolio / Corporate / SaaS / Link in bio), an "Explore ideas" sub-row appears below it with 3 example chips (e.g. for Dashboard: "Analytics dashboard", "Sales tracking dashboard", "HR dashboard"). Each chip carries an `feArrowUpLeft` arrow.

## Codebase context
- Source root: `/workspaces/3D-Agent/chat/`.
- `mode` store in `stores.js` (created in task 06).
- Add a writable `websiteCategory` to `stores.js`:
  ```js
  export const websiteCategory = writable(null);
  ```

## Design tokens
- Categories row: chips with leading icon, `manus-chip` styling, selected state `manus-chip-selected` (blue).
- Section header row: `flex items-center justify-between mt-8`, left side `text-sm font-semibold text-[#1A1A1A]`, right side two text+icon buttons in `text-sm text-[#1A1A1A] hover:underline`, separator `|` in `text-[#9C9A93]`.
- "Explore ideas" section: `mt-6`, header `text-sm font-semibold mb-3`, body row `flex flex-wrap gap-2`. Each idea chip uses `manus-chip` plus a trailing `feArrowUpLeft` icon, `text-[#9C9A93]`, 14px.

## Category data
```js
const categories = [
  { id: 'landing',    label: 'Landing Page', icon: feLayout },
  { id: 'dashboard',  label: 'Dashboard',    icon: fePieChart },
  { id: 'portfolio',  label: 'Portfolio',    icon: feImage },
  { id: 'corporate',  label: 'Corporate',    icon: feHome },     // building
  { id: 'saas',       label: 'SaaS',         icon: feCloud },
  { id: 'linkbio',    label: 'Link in bio',  icon: feLink },
];

const ideasByCategory = {
  landing:   ['Product launch landing page', 'SaaS marketing landing page', 'Event signup landing page'],
  dashboard: ['Analytics dashboard', 'Sales tracking dashboard', 'HR dashboard'],
  portfolio: ['Build full-stack developer portfolio', 'Product designer portfolio website', 'Photographer showcase portfolio page'],
  corporate: ['Law firm corporate site', 'Consulting agency website', 'Real estate corporate site'],
  saas:      ['SaaS product home page', 'Pricing page for B2B SaaS', 'Feature comparison page'],
  linkbio:   ['Creator link-in-bio page', 'Musician fan hub', 'Restaurant menu link page'],
};
```

## What to ship

### 1. Component: `chat/src/manus/flows/WebsiteFlow.svelte`
Renders the header row ("What would you like to build?" + Add ref + Import from Figma), the categories chips, and (when `$websiteCategory` is set) the Explore ideas list.

```svelte
<script>
  import { websiteCategory } from '../../stores.js';
  import Icon from '../../Icon.svelte';
  import { feLayout, fePieChart, feImage, feHome, feCloud, feLink, feArrowUpLeft, feLink as feLinkIcon, feFigma } from '../../feather.js';

  const categories = [/* as above */];
  const ideasByCategory = {/* as above */};

  function pick(id) { websiteCategory.set($websiteCategory === id ? null : id); }
</script>

<div class="mt-8 max-w-[760px] mx-auto px-1">
  <div class="flex items-center justify-between">
    <h3 class="text-sm font-semibold">What would you like to build?</h3>
    <div class="flex items-center gap-3 text-sm">
      <button class="inline-flex items-center gap-1.5 hover:underline">
        <Icon icon={feLinkIcon} size={14} /> Add website reference
      </button>
      <span class="text-[#9C9A93]">|</span>
      <button class="inline-flex items-center gap-1.5 hover:underline">
        <Icon icon={feFigma} size={14} /> Import from Figma
      </button>
    </div>
  </div>
  <div class="mt-4 flex gap-2 overflow-x-auto scrollbar-none">
    {#each categories as c}
      <button class={'manus-chip whitespace-nowrap ' + ($websiteCategory === c.id ? 'manus-chip-selected' : '')}
              on:click={() => pick(c.id)}>
        <Icon icon={c.icon} size={16} /> {c.label}
      </button>
    {/each}
  </div>

  {#if $websiteCategory && ideasByCategory[$websiteCategory]}
    <div class="mt-8">
      <h3 class="text-sm font-semibold mb-3">Explore ideas</h3>
      <div class="flex flex-wrap gap-2">
        {#each ideasByCategory[$websiteCategory] as idea}
          <button class="manus-chip">
            <span>{idea}</span>
            <Icon icon={feArrowUpLeft} size={14} class="text-[#9C9A93]" />
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>
```

If `feFigma` is not in `chat/src/feather.js`, add a stub icon: an "F" letter glyph in a 14px square, or substitute `feLayers`.

### 2. Composer wiring
- When `$mode === 'website'`, set composer `placeholderOverride = 'Describe the website you want to build'`.
- The selected mode pill (from task 05) already shows "Website".

### 3. Sample-prompt prefill (per Manus reference)
Some screenshots show pre-filled descriptive text in the composer when a category is selected. Implement: when a category becomes selected, if the composer is empty, autofill it with a starter sentence:
- landing → "Build a landing page for "
- dashboard → "Build a dashboard for "
- portfolio → "Build a portfolio website for "
- corporate → "Build a corporate website for "
- saas → "Build a SaaS marketing site for "
- linkbio → "Create a link-in-bio page for "

This match the reference where selecting a category seeds an outline; the user finishes the sentence.

## Acceptance criteria
- "Build website" chip activates this flow: composer placeholder updates, blue "Website" inline pill shows.
- Below the composer, the "What would you like to build?" header + 6 category chips appear, with the right-side "Add website reference" + "Import from Figma" buttons.
- Selecting a category seeds the composer text and reveals the "Explore ideas" sub-row.
- Clicking an idea chip fills the composer with that text and submits.

## Out of scope
- Other modes.
- Real website generation backend.
