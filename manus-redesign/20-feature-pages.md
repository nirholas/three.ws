# Task 20 — Feature subpages

## Goal
Render the 7 feature pages reachable from the Features dropdown. All share a single template (`FeaturePage.svelte`) and a content map, so this task ships one component plus 7 content entries. Each page has: serif hero headline, 1–2 line subhead, primary CTA, an "image placeholder" hero block, a 3-column "What you get" feature grid, and a closing CTA strip.

## Codebase context
- Source root: `/workspaces/3D-Agent/chat/`.
- `route` store from task 02. Routes covered by this task:
  - `features/web-app`
  - `features/mobile-app`
  - `features/ai-design`
  - `features/ai-slides`
  - `features/browser-operator`
  - `features/wide-research`
  - `features/mail-manus`
  - `features/agent-skills`

## Design tokens
- Page bg: `bg-paper`.
- Hero headline: `manus-display` (serif, 56–80px). Centered on desktop; left-aligned on mobile.
- Eyebrow above headline: small uppercase tracker — `text-xs font-medium tracking-[0.16em] uppercase text-[#6B6B6B] mb-4`.
- Sub: `text-[#6B6B6B] text-lg max-w-[640px] mx-auto mt-6`.
- CTA primary: `manus-btn-primary` (black pill). Add a secondary "Watch demo" ghost button next to it on the hero.
- Hero image: `aspect-[16/9] rounded-2xl bg-gradient-to-br from-[#EFECE3] to-[#E5E3DC] mt-12`. If a real asset path is provided, render an `<img>`; otherwise use the gradient placeholder.
- "What you get" section header: `font-serif text-3xl font-semibold mt-24 mb-8 text-center`.
- Feature card: `bg-white border border-[#E5E3DC] rounded-2xl p-6`.
  - Icon 22px in a 36px tile (same as nav dropdown).
  - Title `text-base font-semibold mt-4`.
  - Body `text-sm text-[#6B6B6B] mt-2`.
- Bottom CTA strip: `bg-black text-white rounded-2xl p-10 max-w-[1100px] mx-auto mt-24 flex items-center justify-between`. Heading `font-serif text-3xl`; button `bg-white text-black rounded-full h-10 px-5`.

## What to ship

### 1. Component: `chat/src/manus/pages/FeaturePage.svelte`
Props: `slug` (string). Looks up content from a map and renders the template.

### 2. Content map: `chat/src/manus/pages/featurePages.js`
Each entry:
```js
{
  eyebrow: 'AI Web App',
  title: 'Build full-stack apps from a single prompt',
  sub: 'Manus generates the frontend, backend, database, and deploys it — no engineering team required.',
  primaryCta: 'Start building',
  secondaryCta: 'Watch a 2-min demo',
  features: [
    { title: 'Real frameworks',          body: 'Next.js, Postgres, Auth, Stripe — production-grade defaults.', icon: 'feCode' },
    { title: 'One-click deploys',        body: 'Push to your own domain, with HTTPS and previews per branch.', icon: 'feUpload' },
    { title: 'Editable from chat',       body: 'Iterate on copy, layout, and logic without leaving the conversation.', icon: 'feEdit2' },
    { title: 'Built-in observability',   body: 'Errors, traces, and costs visible from the start.', icon: 'feActivity' },
    { title: 'Bring your stack',         body: 'Swap any default — your DB, your auth, your CDN.', icon: 'feGrid' },
    { title: 'Team review',              body: 'Comment on diffs, approve before deploy.', icon: 'feUsers' },
  ],
  closingTitle: 'Ship a real app today.',
  closingCta: 'Start free',
}
```

Provide a similar entry for each of the 8 feature slugs. Use these as the seeds (rewrite copy lightly so each feels distinct):

| slug | eyebrow | title |
|---|---|---|
| `web-app` | AI Web App | Build full-stack apps from a single prompt |
| `mobile-app` | AI Mobile App | Native iOS & Android apps, generated end-to-end |
| `ai-design` | AI Design | From brief to brand: design that ships itself |
| `ai-slides` | AI Slides | Decks that write, design, and rehearse with you |
| `browser-operator` | Browser Operator | Lend Manus a tab. Watch it work. |
| `wide-research` | Wide Research | Parallel research across hundreds of sources at once |
| `mail-manus` | Mail Manus | Turn every inbox thread into a finished task |
| `agent-skills` | Agent Skills | Codify your team's expertise into reusable agents |

### 3. Wire into `App.svelte` route switch
```svelte
{:else if $route.startsWith('features/')}
  <FeaturePage slug={$route.slice('features/'.length)} />
```

### 4. Per-feature note on `agent-skills`
The reference includes a richer hero variant for Agent Skills (tall display headline + cloud illustration). Use the same template but render an extra image strip at the bottom of the hero: `<div class="aspect-[3/1] rounded-2xl bg-[url('/manus-redesign/skills-hero.jpg')] bg-cover bg-center mt-12">`. Path doesn't need to exist; fall back to the gradient placeholder.

## Acceptance criteria
- All 8 feature URLs render a complete page using the shared template.
- Each page differs in copy and feature card content.
- Top nav + announcement banner remain visible.
- Visual rhythm matches the Manus reference (large serif headline, hero image, 6-card grid, dark CTA strip).

## Out of scope
- Real assets/illustrations.
- Routing back from sub-features into specific composer modes.
