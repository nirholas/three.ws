# Task 10 — Resources mega-dropdown

## Goal
Build the `Resources` dropdown matching the reference: 5 items — Blog, Docs, Updates, Use cases, Trust center — each with icon, title, and subtitle. Routes go to `resources/<slug>`.

## Codebase context
- Source root: `/workspaces/3D-Agent/chat/`.
- `route` store + `TopNav` from task 02.
- Add to `chat/src/manus/dropdowns/`.

## Design tokens
Same as tasks 08–09:
- Card: `bg-white border border-[#E5E3DC] rounded-2xl shadow-pop p-3 w-[420px]`.
- Item: `flex items-start gap-3 w-full px-3 py-3 rounded-xl text-left hover:bg-[#F5F4EF]`.
- Icon tile: 36px square, `bg-[#F5F4EF] rounded-lg`, icon 18px.
- Title 14px semibold ink; subtitle 12px ink-soft.

## Items (in order)
| Title | Subtitle | route | Icon |
|---|---|---|---|
| Blog | Ideas, guides, and user stories | `resources/blog` | `feFileText` |
| Docs | Learn about Manus and get started | `resources/docs` | `feBook` |
| Updates | What's new with Manus? | `resources/updates` | `feList` |
| Use cases | Best practices in action | `resources/use-cases` | `feCompass` (fallback `feGlobe`) |
| Trust center | Security and compliance | `resources/trust-center` | `feShield` |

## What to ship
- Component `chat/src/manus/dropdowns/ResourcesDropdown.svelte` (same template as Features dropdown, items above).
- Wire into `TopNav` `Resources` slot.
- Ensure missing feather icons exist in `chat/src/feather.js`.

## Acceptance criteria
- Hovering `Resources` reveals the 5-item dropdown.
- Clicking each item updates `$route` and the URL hash.
- Destination page bodies are owned by task 21 — if task 21 is not yet merged, a placeholder `<div>` is acceptable.

## Out of scope
- Page bodies (task 21).
