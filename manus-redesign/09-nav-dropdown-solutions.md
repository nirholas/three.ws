# Task 09 — Solutions mega-dropdown

## Goal
Build the `Solutions` dropdown in the top nav: a card listing role/industry solutions. Items route to `solutions/<slug>`. The actual destination is a single shared marketing template (task 22 owns the "Launch business applications…" hero); each Solutions item routes to that page with a slug query so it can render a heading variant.

## Codebase context
- Source root: `/workspaces/3D-Agent/chat/`.
- `route` store and `TopNav` from task 02.
- `chat/src/manus/dropdowns/` — same folder as task 08.
- Icons from `chat/src/feather.js`.

## Design tokens
Identical to task 08 (Features dropdown):
- Card: `bg-white border border-[#E5E3DC] rounded-2xl shadow-pop p-3 w-[420px]`.
- Item: `flex items-start gap-3 w-full px-3 py-3 rounded-xl text-left hover:bg-[#F5F4EF]`.
- Icon tile: `w-9 h-9 rounded-lg bg-[#F5F4EF] flex items-center justify-center`.
- Title `text-sm font-semibold text-[#1A1A1A]`; subtitle `text-xs text-[#6B6B6B] mt-0.5`.
- Open on hover (120ms intent), close on mouse-leave (200ms grace).

## Items (in order)
| Title | Subtitle | route | Icon |
|---|---|---|---|
| Sales | Pipeline insights and deal acceleration | `solutions/sales` | `feTrendingUp` |
| Marketing | Campaigns, content, and analytics | `solutions/marketing` | `feSpeaker` |
| Engineering | Internal tools and automations | `solutions/engineering` | `feCpu` |
| Operations | Reporting, dashboards, workflows | `solutions/operations` | `feActivity` |
| Customer Support | Ticket triage and knowledge bots | `solutions/support` | `feLifeBuoy` (fallback `feUsers`) |
| Finance | Spend analysis and forecasting | `solutions/finance` | `feDollarSign` |
| HR & People | Hiring, onboarding, internal Q&A | `solutions/hr` | `feUsers` |
| Founders & Startups | Launch faster with fewer engineers | `solutions/founders` | `feStar` |

## What to ship

### Component: `chat/src/manus/dropdowns/SolutionsDropdown.svelte`
Same shape as `FeaturesDropdown.svelte` but with the items above. On click: `route.set('solutions/' + slug)`.

### Wire into `TopNav.svelte`
Replace the `Solutions` placeholder with `<SolutionsDropdown />`.

### Ensure feather icons exist
If any of `feTrendingUp`, `feSpeaker`, `feCpu`, `feActivity`, `feLifeBuoy`, `feDollarSign`, `feUsers`, `feStar` is not exported from `chat/src/feather.js`, add it. The repo already has a `generatefeathericons.sh` script — use the same generator, or hand-add the SVG path data following the pattern of existing exports.

## Acceptance criteria
- Hovering `Solutions` opens an 8-item dropdown matching the Features dropdown styling.
- Clicking any item navigates to `solutions/<slug>` (hash route updates).
- The destination page rendering is owned by task 22; this task only ensures the routes resolve to *something* — if task 22 is not yet merged, render a temporary `<div>Solutions: {slug}</div>` placeholder in `App.svelte`'s route switch.

## Out of scope
- The marketing destination page body (task 22).
