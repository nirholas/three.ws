<script>
  import { createEventDispatcher } from 'svelte';
  import Icon from '../Icon.svelte';
  import { mode } from '../stores.js';
  import {
    feSmartphone, feCalendar, feGlobe, feGrid, feBarChart2,
    fePlay, feActivity, feMessageSquare, feBookOpen, feZap,
  } from '../feather.js';

  const dispatch = createEventDispatcher();

  const items = [
    { id: 'design',        label: 'Design',        icon: feZap },
    { id: 'desktop',       label: 'Develop apps',  icon: feSmartphone },
    { id: 'schedule',      label: 'Schedule task', icon: feCalendar },
    { id: 'research',      label: 'Wide Research', icon: feGlobe },
    { id: 'spreadsheet',   label: 'Spreadsheet',   icon: feGrid },
    { id: 'visualization', label: 'Visualization', icon: feBarChart2 },
    { id: 'video',         label: 'Video',         icon: fePlay },
    { id: 'audio',         label: 'Audio',         icon: feActivity },
    { id: 'chat',          label: 'Chat mode',     icon: feMessageSquare },
    { id: 'playbook',      label: 'Playbook',      icon: feBookOpen },
  ];

  function pick(item) {
    mode.set(item.id);
    dispatch('close');
  }

  function onKey(e) {
    if (e.key === 'Escape') dispatch('close');
  }
</script>

<svelte:window on:keydown={onKey} />

<!-- Dismiss backdrop -->
<button
  class="fixed inset-0 z-20 cursor-default"
  aria-hidden="true"
  tabindex="-1"
  on:click={() => dispatch('close')}
/>

<!-- Dropdown card -->
<div class="absolute bottom-full mb-2 right-0 z-30 bg-white border border-[#E5E3DC] rounded-2xl shadow-pop p-2 w-[260px]">
  {#each items as item}
    <button
      class="flex items-center gap-3 w-full px-3 h-10 rounded-lg text-sm font-medium text-[#1A1A1A] hover:bg-[#F5F4EF]"
      on:click={() => pick(item)}
    >
      <Icon icon={item.icon} class="h-4 w-4 shrink-0" />
      <span>{item.label}</span>
    </button>
  {/each}
</div>
