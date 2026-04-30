# Task 17 — Develop apps flow (mode = 'desktop')

## Goal
When `$mode === 'desktop'`, the empty-state landing changes to:
1. Composer placeholder: "Describe the app you want to build".
2. Inline blue "Develop apps" mode pill (with `feSmartphone` or `feMonitor` icon).
3. A platform selector pill in the composer: "macOS · Windows · Linux · iOS · Android" — clicking opens a multi-select dropdown; default is macOS.
4. Below the composer, three sections:
   - **Sample prompts** (4 cards), e.g. "Build a markdown notes app", "Create a habit tracker for iOS", "Make a simple POS terminal", "Design a Kanban board for engineering".
   - **Platforms** chips row (Native macOS, Native Windows, Native Linux, iOS, Android, Cross-platform Tauri, Cross-platform Electron, PWA).
   - **Explore ideas** chips row (10–12 idea chips like "Pomodoro timer", "Lightweight RSS reader", "Local password manager", etc.).

## Codebase context
- Source root: `/workspaces/3D-Agent/chat/`.
- `mode` store in `stores.js`.
- Add `appPlatforms` writable in `stores.js` (Set of strings, default `new Set(['macOS'])`).

## Design tokens
- Sample prompt card: same as task 14 (`bg-white border border-[#E5E3DC] rounded-xl p-4 h-[112px]` with trailing `feArrowUpLeft`).
- Platforms chip: `manus-chip` with leading icon (use `feMonitor`, `feSmartphone`, `feTablet` as appropriate).
- Section heading: `text-sm font-semibold mt-10 mb-3`.
- Grid: `grid md:grid-cols-2 lg:grid-cols-4 gap-3` for sample prompts; flex-wrap rows for chips.

## What to ship

### Component: `chat/src/manus/flows/DesktopFlow.svelte`
- Renders the three sections.
- Clicking a sample prompt fills the composer and submits.
- Clicking a platform chip toggles its selection in `$appPlatforms`.
- Clicking an idea chip seeds the composer.

### Composer wiring
- `$mode === 'desktop'` → placeholder "Describe the app you want to build".
- Inline pills: blue Develop apps mode pill + platforms selector pill that summarizes `$appPlatforms` (e.g. "macOS, iOS"). Clicking opens a checkbox dropdown (reuse the existing `Checkbox.svelte` component).

### Mounting
In `EmptyState`, when `$mode === 'desktop'`, render `<DesktopFlow />` below the composer.

## Sample data (use these)
```js
const samplePrompts = [
  'Build a markdown notes app with a daily journal',
  'Create a habit tracker for iOS with widget support',
  'Make a simple POS terminal for a coffee shop',
  'Design a Kanban board for an engineering team',
];

const platforms = [
  { id: 'macos',        label: 'Native macOS',        icon: feMonitor },
  { id: 'windows',      label: 'Native Windows',      icon: feMonitor },
  { id: 'linux',        label: 'Native Linux',        icon: feMonitor },
  { id: 'ios',          label: 'iOS',                 icon: feSmartphone },
  { id: 'android',      label: 'Android',             icon: feSmartphone },
  { id: 'tauri',        label: 'Cross-platform (Tauri)',    icon: feMonitor },
  { id: 'electron',     label: 'Cross-platform (Electron)', icon: feMonitor },
  { id: 'pwa',          label: 'PWA',                 icon: feGlobe },
];

const ideas = [
  'Pomodoro timer','Lightweight RSS reader','Local password manager',
  'Daily mood journal','Time-zone team clock','Voice memo transcriber',
  'Recipe scaler','Currency converter','Resume builder',
  'Plant watering reminder','Workout planner','Trip itinerary builder',
];
```

## Acceptance criteria
- Clicking "More → Develop apps" or any chip mapped to `mode='desktop'` activates the flow.
- Composer placeholder updates; mode pill shows blue Develop apps; platforms pill summarizes the current selection.
- Three sections render below the composer; each interactive element seeds the composer or toggles state.

## Out of scope
- Real app generation.
