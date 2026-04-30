<script>
  import { createEventDispatcher } from 'svelte';
  import { designModel } from '../stores.js';
  import Icon from '../Icon.svelte';
  import { feCheck } from '../feather.js';

  const dispatch = createEventDispatcher();

  const models = [
    { id: 'gpt-image-2', label: 'GPT Image 2', badge: '⊕' },
    { id: 'sdxl',        label: 'Stable Diffusion XL' },
    { id: 'flux-1',      label: 'Flux 1' },
    { id: 'banana',      label: 'Banana 🍌' },
  ];

  function pick(model) {
    designModel.set(model.id);
    dispatch('close');
  }

  function onKey(e) {
    if (e.key === 'Escape') dispatch('close');
  }
</script>

<svelte:window on:keydown={onKey} />

<button
  class="fixed inset-0 z-20 cursor-default"
  aria-hidden="true"
  tabindex="-1"
  on:click={() => dispatch('close')}
/>

<div class="absolute bottom-full mb-2 left-0 z-30 bg-white border border-[#E5E3DC] rounded-2xl shadow-pop p-2 w-[220px]">
  {#each models as model}
    <button
      class="flex items-center gap-3 w-full px-3 h-10 rounded-lg text-sm font-medium text-[#1A1A1A] hover:bg-[#F5F4EF]"
      on:click={() => pick(model)}
    >
      <span class="w-5 h-5 shrink-0 flex items-center justify-center text-base leading-none">
        {model.badge ?? ''}
      </span>
      <span class="flex-1 text-left">{model.label}</span>
      {#if $designModel === model.id}
        <Icon icon={feCheck} class="h-3.5 w-3.5 shrink-0 text-blue-600" />
      {/if}
    </button>
  {/each}
</div>
