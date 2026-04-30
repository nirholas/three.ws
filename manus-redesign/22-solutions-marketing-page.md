# Task 22 — Solutions / Business marketing template

## Goal
Render the marketing template behind every `solutions/<slug>` and `business/<slug>` route, plus a generic catch-all for `events/<slug>` if no other template applies. The reference uses one tall hero pattern: huge serif headline ("Launch business applications without engineering resources"), subhead, and a centered Manus-style composer that doubles as a "describe your project" entry. Below the composer: the same "What would you like to build?" categories row from task 15, and a short logos / testimonials strip.

## Codebase context
- Source root: `/workspaces/3D-Agent/chat/`.
- `route` store from task 02; `mode` and `websiteCategory` from tasks 06/15.
- Reuses: `Composer.svelte` (task 05), `WebsiteFlow.svelte` (task 15).

## Design tokens
- Page bg: `bg-paper`.
- Outer wrapper: `max-w-[1100px] mx-auto px-6 pt-24 pb-32`.
- Headline (centered): `manus-display` — 56–80px serif. Allow 2 lines.
- Sub: `text-[#6B6B6B] text-lg max-w-[640px] mx-auto text-center mt-6`.
- Composer block: same component as task 05; rendered with no inline mode pill by default and a placeholder taken from the slug map.
- Categories row: reuse `WebsiteFlow.svelte`. Render only the chips, not the "Add reference" or "Import from Figma" affordances (gate them with a prop `compact={true}`).
- Logos row: `mt-20 grid grid-cols-3 md:grid-cols-6 gap-6 items-center opacity-70` — 6 placeholder logos in `text-[#6B6B6B] text-sm uppercase tracking-[0.16em] text-center`, e.g. ACME · NORTHWIND · LATTE · PIVOT · ATLAS · BEACON.

## Content per slug

Define a content map at `chat/src/manus/pages/marketingPages.js` keyed by full route (`solutions/sales`, `business/enterprise`, etc.). Each entry:
```js
{
  eyebrow: 'For Sales teams',
  headline: 'Close more deals\nwithout writing more SQL',
  sub: 'Forecasts, dashboards, and outreach drafts — generated from your CRM in minutes.',
  placeholder: 'Describe the sales workflow you want to ship.',
}
```

Provide entries for all routes from tasks 09 and 11. Suggested headlines:

| route | headline |
|---|---|
| `solutions/sales` | Close more deals without writing more SQL |
| `solutions/marketing` | Campaigns, briefs, and analytics — drafted in chat |
| `solutions/engineering` | Internal tools your team will actually use |
| `solutions/operations` | Operational reporting that runs itself |
| `solutions/support` | Triage, draft, and resolve — alongside your humans |
| `solutions/finance` | Forecasts and spend reviews on demand |
| `solutions/hr` | Hiring, onboarding, internal Q&A — automated |
| `solutions/founders` | Launch the v1 of your idea this weekend |
| `business/enterprise` | Launch business applications without engineering resources |
| `business/security` | Security and compliance you can show your board |
| `business/deployments` | Run Manus inside your VPC |
| `business/customers` | Real teams. Real outcomes. |
| `business/contact-sales` | Talk to a real human about your rollout |

Use the headline "Launch business applications without engineering resources" (from the reference) for `business/enterprise` exactly, and seed similar tone for the rest.

## What to ship

### 1. Component: `chat/src/manus/pages/MarketingPage.svelte`
Props: `slug` (full route, e.g. `solutions/sales`).
Renders:
- Eyebrow (small uppercase tracker, optional).
- Centered serif headline (with `\n` rendered as `<br>`).
- Sub.
- A composer (instantiate `<Composer>` with the slug-specific placeholder; submitting sets `route='chat'`, sets `mode='website'` if route starts with `solutions/` or `business/`, and feeds the typed text into the chat composer).
- Categories row from `WebsiteFlow` (compact mode).
- Logos strip.

### 2. Wire into `App.svelte` route switch
```svelte
{:else if $route.startsWith('solutions/') || $route.startsWith('business/') || $route.startsWith('events/')}
  <MarketingPage slug={$route} />
```

If a slug isn't in the content map, fall back to deriving a heading from the slug ("contact-sales" → "Contact sales") and a generic sub.

### 3. Compact prop on `WebsiteFlow.svelte` (task 15)
- When `compact={true}`, hide the "Add website reference" and "Import from Figma" buttons; keep the chips and the "Explore ideas" sub-row.
- Default false to preserve task 15 behavior.

## Acceptance criteria
- All `solutions/*`, `business/*`, and `events/*` routes render the marketing template with their slug-specific headline and placeholder.
- The composer on the page accepts text and, on submit, navigates to `#chat` with the message pre-filled and the appropriate `mode` set.
- The categories row from task 15 is reused and renders without the right-side affordances.
- The logos strip is present at the bottom.

## Out of scope
- Real customer logos or testimonials.
- Per-solution custom illustrations (placeholder gradient hero is fine if you choose to include one).
