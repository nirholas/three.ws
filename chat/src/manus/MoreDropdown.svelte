<script>
  import { createEventDispatcher } from 'svelte';
  import Icon from '../Icon.svelte';
  import { mode } from '../stores.js';
  import {
    feRotateCw, feCamera, feLink, feSliders, feActivity, feLayers, feZap,
  } from '../feather.js';

  const dispatch = createEventDispatcher();

  const items = [
    { id: 'animate',    label: 'Animate model',     icon: feRotateCw },
    { id: 'ar',         label: 'AR experience',      icon: feCamera },
    { id: 'wallet',     label: 'Connect wallet',     icon: feLink },
    { id: 'emotions',   label: 'Configure emotions', icon: feSliders },
    { id: 'reputation', label: 'Track reputation',   icon: feActivity },
    { id: 'skills',     label: 'Add agent skills',   icon: feLayers },
    { id: 'solana',     label: 'Mint on Solana',     icon: feZap },
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
