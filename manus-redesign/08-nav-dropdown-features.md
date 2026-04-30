# Task 08 — Features mega-dropdown

## Goal
Fill the `Features` dropdown in the top nav with eight rich items. Each item has an icon, a bold title, and a one-line subtitle. Clicking any item sets `route` to a feature subpage (`features/web-app`, `features/mobile-app`, `features/ai-design`, `features/ai-slides`, `features/browser-operator`, `features/wide-research`, `features/mail-manus`, `features/agent-skills`). The actual subpages are owned by task 20.

## Codebase context
- Source root: `/workspaces/3D-Agent/chat/`.
- `route` store at `chat/src/stores.js` (created in task 02). If not yet present, create it as `export const route = writable('chat')`.
- `TopNav` component from task 02 already renders a placeholder for `Features` — replace its body with this dropdown.
- Icons: `chat/src/feather.js`. Add any missing exports.

## Design tokens
- Card: `bg-white border border-[#E5E3DC] rounded-2xl shadow-pop p-3 w-[420px]`.
- Item: `flex items-start gap-3 w-full px-3 py-3 rounded-xl text-left hover:bg-[#F5F4EF]`.
- Icon container: 36px square, `bg-[#F5F4EF] text-[#1A1A1A] rounded-lg flex items-center justify-center`, icon 18px.
- Title: `text-sm font-semibold text-[#1A1A1A]`.
- Subtitle: `text-xs text-[#6B6B6B] mt-0.5`.
- Position: anchored under the `Features` trigger (`top-full mt-2 left-0`). Open on hover with 120ms intent delay; close on mouse-leave with 200ms grace.

## Items (in order)
| Title | Subtitle | route | Suggested feather icon |
|---|---|---|---|
| Web app | Build full-stack, AI-powered sites | `features/web-app` | `feGlobe` |
| Mobile app | Build native iOS & Android apps | `features/mobile-app` | `feSmartphone` |
| AI design | Automates the entire design journey | `features/ai-design` | `feZap` |
| AI slides | Use Nano Banana Pro to create slides | `features/ai-slides` | `feLayout` |
| Manus browser operator | Lend a tab to Manus | `features/browser-operator` | `feChrome` (fallback `feMonitor`) |
| Wide Research | Parallel research at scale | `features/wide-research` | `feTarget` |
| Mail Manus | Turn any email into action | `features/mail-manus` | `feMail` |
| Agent Skills | Automate your expertise | `features/agent-skills` | `fePuzzlePiece` (fallback `feGrid`) |

## What to ship

### Component: `chat/src/manus/dropdowns/FeaturesDropdown.svelte`
```svelte
<script>
  import { route } from '../../stores.js';
  import Icon from '../../Icon.svelte';
  import {
    feGlobe, feSmartphone, feZap, feLayout, feMonitor,
    feTarget, feMail, feGrid
  } from '../../feather.js';

  const items = [
    { title: 'Web app',                subtitle: 'Build full-stack, AI-powered sites',  route: 'features/web-app',          icon: feGlobe },
    { title: 'Mobile app',             subtitle: 'Build native iOS & Android apps',     route: 'features/mobile-app',       icon: feSmartphone },
    { title: 'AI design',              subtitle: 'Automates the entire design journey', route: 'features/ai-design',        icon: feZap },
    { title: 'AI slides',              subtitle: 'Use Nano Banana Pro to create slides',route: 'features/ai-slides',        icon: feLayout },
    { title: 'Manus browser operator', subtitle: 'Lend a tab to Manus',                 route: 'features/browser-operator', icon: feMonitor },
    { title: 'Wide Research',          subtitle: 'Parallel research at scale',          route: 'features/wide-research',    icon: feTarget },
    { title: 'Mail Manus',             subtitle: 'Turn any email into action',          route: 'features/mail-manus',       icon: feMail },
    { title: 'Agent Skills',           subtitle: 'Automate your expertise',             route: 'features/agent-skills',     icon: feGrid },
  ];
</script>

<div class="bg-white border border-[#E5E3DC] rounded-2xl shadow-pop p-3 w-[420px]">
  {#each items as item}
    <button
      class="flex items-start gap-3 w-full px-3 py-3 rounded-xl text-left hover:bg-[#F5F4EF]"
      on:click={() => route.set(item.route)}>
      <span class="w-9 h-9 rounded-lg bg-[#F5F4EF] flex items-center justify-center shrink-0">
        <Icon icon={item.icon} size={18} />
      </span>
      <span class="flex-1 min-w-0">
        <span class="block text-sm font-semibold text-[#1A1A1A]">{item.title}</span>
        <span class="block text-xs text-[#6B6B6B] mt-0.5">{item.subtitle}</span>
      </span>
    </button>
  {/each}
</div>
```

### Wire into `TopNav.svelte`
Replace the placeholder under the Features trigger with `<FeaturesDropdown />`. Keep the existing hover/click open logic from task 02.

## Acceptance criteria
- Hovering `Features` opens the 420px-wide card with eight items, icons, titles, and subtitles.
- Clicking an item sets `$route` (URL hash updates accordingly) and closes the dropdown.
- Tabbing into the dropdown also exposes items (use real `<button>` elements).
- Visually matches the Manus reference: icon tile on the left, title + grey subtitle on the right.

## Out of scope
- The destination pages themselves (task 20).
