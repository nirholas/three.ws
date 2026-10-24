<script lang="ts">
  import Icon from '../../Icon.svelte';
  import { feArrowUpLeft } from '../../feather.js';
  import { composerFill } from '../../stores.js';

  let { title, prompts } = $props();
</script>

<div>
  <p class="text-sm font-semibold mt-10 mb-3">{title}</p>
  <div class="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
    {#each prompts as prompt}
      <button
        class="relative bg-white border border-rule rounded-xl p-4 h-[96px] text-left text-sm hover:bg-paper transition-colors overflow-hidden"
        onclick={() => composerFill.set({ text: prompt, submit: true })}
      >
        <span class="line-clamp-3 block pr-5">{prompt}</span>
        <Icon
          icon={feArrowUpLeft}
          class="absolute bottom-3 right-3 h-3.5 w-3.5 text-ink-faint"
        />
      </button>
    {/each}
  </div>
</div>
