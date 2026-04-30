<script>
  import Icon from '../Icon.svelte';
  import { feMoreHorizontal } from '../feather.js';
  import MoreDropdown from './MoreDropdown.svelte';

  let moreOpen = false;
</script>

<div class="relative inline-flex items-center gap-2">
  <button
    class="flex items-center gap-1.5 px-3 h-8 rounded-full border border-[#E5E3DC] bg-white text-sm font-medium text-[#1A1A1A] hover:bg-[#F5F4EF]"
    on:click={() => (moreOpen = !moreOpen)}
    aria-expanded={moreOpen}
  >
    <Icon icon={feMoreHorizontal} class="h-4 w-4" />
    <span>More</span>
  </button>

  {#if moreOpen}
    <MoreDropdown on:close={() => (moreOpen = false)} />
  {/if}
</div>
