# Task 11 — Events and Business nav dropdowns

## Goal
Two more nav dropdowns matching the Features/Solutions/Resources style. Both have shorter item lists and route to `events/<slug>` and `business/<slug>` respectively.

## Codebase context
- Source root: `/workspaces/3D-Agent/chat/`.
- `route` store + `TopNav` from task 02.
- Add to `chat/src/manus/dropdowns/`.

## Design tokens
Same as tasks 08–10. Card 420px wide, item rows with 36px icon tile + title + subtitle.

## Events items
| Title | Subtitle | route | Icon |
|---|---|---|---|
| Webinars | Live sessions with the Manus team | `events/webinars` | `feVideo` |
| Conferences | Where you can find us in person | `events/conferences` | `feMapPin` |
| Office hours | Weekly Q&A with engineers | `events/office-hours` | `feClock` |
| Hackathons | Build with Manus alongside the community | `events/hackathons` | `feZap` |
| Past recordings | Replay every session on demand | `events/recordings` | `fePlay` |

## Business items
| Title | Subtitle | route | Icon |
|---|---|---|---|
| Enterprise | Deploy Manus across your org | `business/enterprise` | `feBriefcase` |
| Security & compliance | SOC 2, GDPR, custom DPAs | `business/security` | `feShield` |
| Custom deployments | VPC and on-prem options | `business/deployments` | `feServer` |
| Customer stories | How teams ship faster with Manus | `business/customers` | `feUsers` |
| Contact sales | Talk to a real human | `business/contact-sales` | `feMessageCircle` |

## What to ship
- Component `chat/src/manus/dropdowns/EventsDropdown.svelte` — items above, same template.
- Component `chat/src/manus/dropdowns/BusinessDropdown.svelte` — items above, same template.
- Wire both into `TopNav`.
- Ensure feather icons exist; add any missing.

## Page bodies for these routes
This task does not own the destination pages. In `App.svelte`'s route switch, render a generic placeholder for `events/*` and `business/*` slugs:
```html
<div class="max-w-[760px] mx-auto px-6 pt-24 text-center">
  <h1 class="manus-display">{title}</h1>
  <p class="text-[#6B6B6B] mt-4 text-lg">Coming soon.</p>
</div>
```
where `title` is derived from the slug ("contact-sales" → "Contact sales"). Task 22's marketing page can be reused later if a richer template is desired.

## Acceptance criteria
- Hovering `Events` and `Business` reveals their respective dropdowns.
- Each item routes correctly and the placeholder page renders the slug-derived title.
- Existing flows are untouched.

## Out of scope
- Real marketing copy / illustrations for these subpages.
