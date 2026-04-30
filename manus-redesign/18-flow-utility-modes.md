# Task 18 — Utility flows: Schedule, Wide Research, Spreadsheet, Visualization, Video, Audio, Chat mode, Playbook

## Goal
Eight modes from the "More" dropdown each need their own minimal landing UI on the empty state. These are simpler than Slides/Website/Design — most just need a tailored composer placeholder, a blue mode pill, and one section below with 4–8 example prompts.

This task ships all eight in one self-contained component bundle.

## Codebase context
- Source root: `/workspaces/3D-Agent/chat/`.
- `mode` store in `stores.js`. Values: `'schedule' | 'research' | 'spreadsheet' | 'visualization' | 'video' | 'audio' | 'chat' | 'playbook'`.
- For `playbook`, `mode` is also set when the user lands on `route === 'playbook'` (separate route, but the empty-state composer is shown there too; in this task, treat `playbook` as a regular mode whose flow renders inline on the chat empty state).

## Design tokens
- Mode pill (selected): `manus-chip-selected` with the corresponding icon.
- Sample prompt card: `bg-white border border-[#E5E3DC] rounded-xl p-4 h-[96px] text-left text-sm` with trailing `feArrowUpLeft`.
- Section header: `text-sm font-semibold mt-10 mb-3`.
- Cards grid: `grid md:grid-cols-2 lg:grid-cols-4 gap-3` for prompts, `flex-wrap gap-2` for chips.

## Per-mode spec

### `schedule` (Schedule task)
- Icon: `feCalendar`. Mode pill label: "Schedule task".
- Composer placeholder: "What should we run on a schedule?"
- Section: **Schedule examples**
  - "Every weekday at 9am, summarize new GitHub issues in repo X"
  - "Each Monday, draft a weekly status report from Linear"
  - "Every hour, check for new Stripe disputes and email me"
  - "Daily at 7pm, post a digest of unread Slack mentions"
  - "Weekly on Friday, generate sales pipeline snapshot from CRM"
  - "Every 15 minutes, poll uptime for our 3 critical services"
- Inline secondary pill in composer: a "Cadence ▾" pill (Hourly / Daily / Weekly / Custom cron).

### `research` (Wide Research)
- Icon: `feTarget`. Mode pill: "Wide Research".
- Placeholder: "What should we research, in parallel?"
- Section: **Research examples**
  - "Compare the top 10 vector databases on price, latency, scale"
  - "Find every YC W24 company in dev tools with public pricing"
  - "Summarize recent papers on LLM evaluation from 2024–2026"
  - "List all Series A AI infra startups with announced rounds in Q1"
  - "Extract feature parity matrix for Cursor, Claude Code, and Manus"
  - "Find hiring pages of top 50 robotics startups; pull JD for SWE"
- Inline pill: "Sources: Web ▾" (Web / Web + Docs / Web + Code / Custom URLs).

### `spreadsheet`
- Icon: `feGrid`. Mode pill: "Spreadsheet".
- Placeholder: "Describe the spreadsheet you want to build"
- Section: **Spreadsheet templates**
  - "Sales pipeline tracker with weighted forecast"
  - "Personal monthly budget with category rollups"
  - "Hiring funnel: candidates × stages × dropoff"
  - "OKR tracker with quarterly progress"
  - "Inventory tracker with reorder points"
  - "SaaS metrics dashboard (ARR, MRR, churn)"
- Inline pill: "Format: Google Sheets ▾" (Google Sheets / Excel / CSV / Numbers).

### `visualization`
- Icon: `feBarChart2`. Mode pill: "Visualization".
- Placeholder: "Describe the chart or dashboard you want"
- Section: **Visualization examples**
  - "Stacked bar chart of revenue by region by quarter"
  - "Time-series of weekly active users with annotations"
  - "Funnel chart for the signup-to-activation flow"
  - "Geo heatmap of customer concentration"
  - "Cohort retention grid (week-over-week)"
  - "Sankey diagram of traffic source → conversion"
- Inline pill: "Style: Minimal ▾" (Minimal / Editorial / Dark / Print).

### `video`
- Icon: `fePlay`. Mode pill: "Video".
- Placeholder: "Describe the video you want to create"
- Section: **Video examples**
  - "30-second product launch teaser with motion graphics"
  - "60-second explainer for a B2B SaaS feature"
  - "Customer story with overlaid quotes"
  - "Conference talk highlight reel"
  - "Loop of a UI walkthrough with captions"
  - "Short-form vertical reel for Instagram"
- Inline pill: "Aspect: 16:9 ▾" (16:9, 9:16, 1:1, 4:5).

### `audio`
- Icon: `feActivity`. Mode pill: "Audio".
- Placeholder: "Describe the audio you want"
- Section: **Audio examples**
  - "Two-host podcast episode (15 min) on agentic coding"
  - "Voiceover for a 60-second product demo, calm tone"
  - "Soundtrack for a 30-second ad, upbeat and modern"
  - "Audio summary of a long article, conversational"
  - "Meditation guided session, 10 minutes"
  - "Phone IVR greeting in 5 languages"
- Inline pill: "Voice: Auto ▾" (Auto / Specific voices / Multi-host).

### `chat` (Chat mode)
- Icon: `feMessageSquare`. Mode pill: "Chat mode".
- Placeholder: "Just chat — no tools, no agents."
- Section omitted; this mode is plain conversation. Show only a small caption under the composer: `text-xs text-[#6B6B6B]`: "Tools and agents are off. Plain chat with the model."

### `playbook`
- Icon: `feBookOpen`. Mode pill: "Playbook".
- Placeholder: "Describe a multi-step playbook to run"
- Section: **Playbook examples**
  - "Onboard a new SDR: pull rep, send welcome email, schedule training"
  - "Triage inbound bug report: dedupe, label, assign, draft reply"
  - "Run a weekly RevOps review across CRM, Stripe, and Mixpanel"
  - "Migrate a Notion doc tree into a Manus skill"
  - "Audit GitHub repos for missing CI on default branch"
  - "End-of-quarter portfolio review for a VC firm"
- Inline pill: "Tools: Default ▾" with a sub-multi-select.

## What to ship

### Component bundle: `chat/src/manus/flows/UtilityFlows.svelte`
A switch-based component:
```svelte
<script>
  import { mode } from '../../stores.js';
  import SamplePromptGrid from './SamplePromptGrid.svelte';
  import { schedulePrompts, researchPrompts, /* etc. */ } from './utilityFlowData.js';
</script>

{#if $mode === 'schedule'}
  <SamplePromptGrid title="Schedule examples" prompts={schedulePrompts} />
{:else if $mode === 'research'}
  <SamplePromptGrid title="Research examples" prompts={researchPrompts} />
{/* etc. for each */}
```

Plus:
- `chat/src/manus/flows/SamplePromptGrid.svelte` — generic 4-up card grid that fills the composer + submits on click. Reuse this for tasks 14 and 17 if convenient.
- `chat/src/manus/flows/utilityFlowData.js` — exports the prompt arrays above.

### Composer wiring per mode
For each mode listed, set:
- `placeholderOverride` = the placeholder above.
- `extraInlinePills` = `[{ id: '<modeId>', label: '<Mode label>', icon: <icon>, kind: 'mode' }, /* + cadence/aspect/etc. for modes that have one */]`.

The "cadence/sources/format/style/aspect/voice/tools" secondary pill is a soft-state dropdown stored as `$flowSecondary[$mode]` in a single writable map in `stores.js`. Persist via `localStorage` if cheap.

### Mounting
In `EmptyState`, after the chips slot, render `<UtilityFlows />` (no-op when `$mode` isn't one of the 8 covered).

## Acceptance criteria
- Each of the 8 modes (`schedule`, `research`, `spreadsheet`, `visualization`, `video`, `audio`, `chat`, `playbook`) activates correctly from the More dropdown.
- The composer placeholder, blue mode pill, and the secondary pill (where applicable) update when the mode changes.
- Each mode (except `chat`) shows a 6-card grid of sample prompts; clicking a card fills + submits.
- `chat` mode shows the small caption instead of a card grid.

## Out of scope
- Backend execution of any of these modes.
