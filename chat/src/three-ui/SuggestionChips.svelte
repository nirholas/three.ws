<script>
  import { mode } from '../stores.js';
  import Icon from '../Icon.svelte';
  import { feTrendingUp, feBarChart2, feActivity, feAlertCircle, feMoreHorizontal, feBox, feLayers } from '../feather.js';
  import MoreDropdown from './MoreDropdown.svelte';

  let moreOpen = false;

  const chips = [
    { id: 'gems',      label: 'Find new gems',      icon: feTrendingUp },
    { id: 'track',     label: 'Track a token',      icon: feActivity },
    { id: 'portfolio', label: 'Check my portfolio', icon: feBarChart2 },
    { id: 'rugcheck',  label: 'Rug check',          icon: feAlertCircle },
    { id: 'chart3d',   label: '3D chart',           icon: feBox },
    { id: 'scene3d',   label: '3D scene',           icon: feLayers },
  ];

  function pick(id) {
    mode.set($mode === id ? null : id);
  }
</script>

<div class="flex flex-wrap gap-3 justify-center mt-4">
  {#each chips as c}
    <button
      class="three-ui-chip {$mode === c.id ? 'three-ui-chip-selected' : ''}"
      on:click={() => pick(c.id)}
    >
      <Icon icon={c.icon} class="h-4 w-4" />
      {c.label}
    </button>
  {/each}
  <div class="relative">
    <button class="three-ui-chip" on:click={() => (moreOpen = !moreOpen)}>
      <Icon icon={feMoreHorizontal} class="h-4 w-4" />
      More
    </button>
    {#if moreOpen}
      <MoreDropdown on:close={() => (moreOpen = false)} />
    {/if}
  </div>
</div>
