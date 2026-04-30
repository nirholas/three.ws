# Manus-style chat redesign — task pack

This directory contains 22 independent prompts that, taken together, redesign
the chat in `/workspaces/3D-Agent/chat/` to match the Manus reference design.

## Rules for whoever (or whatever) executes these tasks

- **Each `.md` is fully self-contained.** It restates the design tokens, the
  codebase context, and the exact spec needed to ship that piece. No task
  reads or depends on another task's output.
- **Ordering does not matter.** Tasks can run in parallel; merge conflicts in
  shared files (mostly `App.svelte` and `tailwind.config.cjs`) are expected
  and must be resolved by the integrator.
- **Definition of done = ship-ready.** When all 22 tasks are merged the chat
  visually matches the Manus reference, every nav link works, and every
  in-product flow (Slides, Website, Design, Schedule, etc.) renders its
  intended landing UI.

## Task index

| # | File | Scope |
|---|---|---|
| 01 | `01-design-tokens.md` | Tailwind theme, fonts, colors, base CSS |
| 02 | `02-top-navigation.md` | Logo, nav bar, Sign in/up buttons |
| 03 | `03-announcement-banner.md` | "Manus is now part of Meta" strip |
| 04 | `04-empty-state-landing.md` | Centered hero + composer + chips layout |
| 05 | `05-composer-input.md` | Rounded textarea with `+` and send button |
| 06 | `06-suggestion-chips.md` | Create slides / Build website / Develop apps / Design / More |
| 07 | `07-more-dropdown.md` | "More" popover (Schedule task, Wide Research, …) |
| 08 | `08-nav-dropdown-features.md` | Features mega-dropdown |
| 09 | `09-nav-dropdown-solutions.md` | Solutions mega-dropdown |
| 10 | `10-nav-dropdown-resources.md` | Resources mega-dropdown |
| 11 | `11-nav-dropdown-events-business.md` | Events + Business dropdowns |
| 12 | `12-pricing-page.md` | Pricing route |
| 13 | `13-auth-pages.md` | Sign in / Sign up routes |
| 14 | `14-flow-slides.md` | Slides chip selected — model picker + sample prompts + template grid |
| 15 | `15-flow-website.md` | Website chip — categories, Add ref, Import from Figma, Explore ideas |
| 16 | `16-flow-design.md` | Design chip — model selector + "Get started with" template cards |
| 17 | `17-flow-develop-apps.md` | Develop apps landing |
| 18 | `18-flow-utility-modes.md` | Schedule task / Spreadsheet / Visualization / Wide Research / Video / Audio / Playbook |
| 19 | `19-chat-mode-active.md` | Active conversation styling (post-first-message) |
| 20 | `20-feature-pages.md` | 7 feature subpages from Features dropdown |
| 21 | `21-resource-pages.md` | 5 subpages from Resources dropdown |
| 22 | `22-solutions-marketing-page.md` | "Launch business applications…" hero page |

## Shared codebase context (true for every task)

- Stack: Svelte 4 + Vite + Tailwind. Source root: `/workspaces/3D-Agent/chat/`.
- Main shell: `chat/src/App.svelte` (~1660 lines).
- Message bubble: `chat/src/Message.svelte`.
- Icons: `chat/src/feather.js` — re-export icons from there; add new ones if missing.
- Tailwind config: `chat/tailwind.config.cjs`.
- Global CSS: `chat/src/app.pcss`.
- Empty-state condition: `convo.messages.length === 0`.
- The chat already supports model selection, attachments, tool dropdowns, and
  agent picking. **Do not delete those features**; hide or restyle them on
  the empty state, but keep them reachable on the active chat view.
- Routing today is single-page; for new routes add a lightweight
  `route` store (`'chat' | 'pricing' | 'features/web-app' | …`) and switch on
  it inside `App.svelte`. Persist via `location.hash`.
