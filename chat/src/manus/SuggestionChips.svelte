<script>
  import { mode } from '../stores.js';
  import Icon from '../Icon.svelte';
  import { feCode, feMonitor, feZap, feLayout, feMoreHorizontal } from '../feather.js';
  import MoreDropdown from './MoreDropdown.svelte';

  let moreOpen = false;

  const chips = [
    { id: 'slides',  label: 'Create slides',        icon: feLayout },
    { id: 'website', label: 'Build website',         icon: feCode },
    { id: 'desktop', label: 'Develop desktop apps',  icon: feMonitor },
    { id: 'design',  label: 'Design',                icon: feZap },
  ];

  function pick(id) {
    mode.set($mode === id ? null : id);
  }
</script>

<div class="flex flex-wrap gap-3 justify-center mt-4">
  {#each chips as c}
    <button
      class="manus-chip {$mode === c.id ? 'manus-chip-selected' : ''}"
      on:click={() => pick(c.id)}
    >
      <Icon icon={c.icon} class="h-4 w-4" />
      {c.label}
    </button>
  {/each}
  <div class="relative">
    <button class="manus-chip" on:click={() => (moreOpen = !moreOpen)}>
      <Icon icon={feMoreHorizontal} class="h-4 w-4" />
      More
    </button>
    {#if moreOpen}
      <MoreDropdown on:close={() => (moreOpen = false)} />
    {/if}
  </div>
</div>
