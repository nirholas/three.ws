<script>
  import { appPlatforms, composerFill } from '../../stores.js';
  import Icon from '../../Icon.svelte';
  import {
    feMonitor,
    feSmartphone,
    feGlobe,
    feArrowUpLeft,
  } from '../../feather.js';

  const samplePrompts = [
    'Build a markdown notes app with a daily journal',
    'Create a habit tracker for iOS with widget support',
    'Make a simple POS terminal for a coffee shop',
    'Design a Kanban board for an engineering team',
  ];

  const platforms = [
    { id: 'macOS',    label: 'Native macOS',              icon: feMonitor },
    { id: 'Windows',  label: 'Native Windows',            icon: feMonitor },
    { id: 'Linux',    label: 'Native Linux',              icon: feMonitor },
    { id: 'iOS',      label: 'iOS',                       icon: feSmartphone },
    { id: 'Android',  label: 'Android',                   icon: feSmartphone },
    { id: 'Tauri',    label: 'Cross-platform (Tauri)',     icon: feMonitor },
    { id: 'Electron', label: 'Cross-platform (Electron)',  icon: feMonitor },
    { id: 'PWA',      label: 'PWA',                       icon: feGlobe },
  ];

  const ideas = [
    'Pomodoro timer',
    'Lightweight RSS reader',
    'Local password manager',
    'Daily mood journal',
    'Time-zone team clock',
    'Voice memo transcriber',
    'Recipe scaler',
    'Currency converter',
    'Resume builder',
    'Plant watering reminder',
    'Workout planner',
    'Trip itinerary builder',
  ];

  function togglePlatform(id) {
    appPlatforms.update((set) => {
      const next = new Set(set);
      if (next.has(id)) {
        if (next.size > 1) next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectPrompt(text) {
    composerFill.set({ text, submit: true, ifEmpty: false });
  }

  function selectIdea(idea) {
    composerFill.set({ text: idea, submit: false, ifEmpty: true });
  }
</script>

<div class="mt-8 max-w-[760px] mx-auto px-1">
  <!-- Sample prompts -->
  <h3 class="text-sm font-semibold mt-10 mb-3">Sample prompts</h3>
  <div class="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
    {#each samplePrompts as prompt}
      <button
        class="bg-white border border-[#E5E3DC] rounded-xl p-4 h-[112px] flex flex-col justify-between text-left hover:bg-[#F5F4EF] transition-colors"
        on:click={() => selectPrompt(prompt)}
      >
        <span class="text-sm text-[#1A1A1A] leading-snug">{prompt}</span>
        <Icon icon={feArrowUpLeft} size={14} class="text-[#9C9A93] self-end" />
      </button>
    {/each}
  </div>

  <!-- Platforms -->
  <h3 class="text-sm font-semibold mt-10 mb-3">Platforms</h3>
  <div class="flex flex-wrap gap-2">
    {#each platforms as p}
      <button
        class="manus-chip {$appPlatforms.has(p.id) ? 'manus-chip-selected' : ''}"
        on:click={() => togglePlatform(p.id)}
      >
        <Icon icon={p.icon} size={16} />
        {p.label}
      </button>
    {/each}
  </div>

  <!-- Explore ideas -->
  <h3 class="text-sm font-semibold mt-10 mb-3">Explore ideas</h3>
  <div class="flex flex-wrap gap-2">
    {#each ideas as idea}
      <button class="manus-chip" on:click={() => selectIdea(idea)}>
        {idea}
        <Icon icon={feArrowUpLeft} size={14} class="text-[#9C9A93]" />
      </button>
    {/each}
  </div>
</div>
