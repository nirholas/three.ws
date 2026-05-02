<script>
  import { composerFill } from '../../stores.js';
  import Icon from '../../Icon.svelte';
  import { feArrowUpLeft, feLayout, feChevronDown, feUpload } from '../../feather.js';

  const samplePrompts = [
    'Automate weekly team status reporting',
    'Build quarterly sales performance dashboard',
    'Create strategic business review presentation',
    'Design investor pitch deck with projections',
  ];

  const templateCount = 8;

  const slideCountOptions = ['4 - 8', '8 - 12', '12 - 16', '16 - 20'];
  let selectedSlideCount = '8 - 12';
  let slideCountOpen = false;

  function selectPrompt(prompt) {
    composerFill.set({ text: prompt, submit: true, ifEmpty: false });
  }
</script>

<div class="w-full max-w-[760px] mx-auto">
  <h2 class="text-sm font-semibold text-[#1A1A1A] mb-3 mt-10">Sample prompts</h2>
  <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
    {#each samplePrompts as prompt}
      <button
        class="bg-white border border-[#E5E3DC] rounded-xl p-4 text-left h-[112px] flex flex-col justify-between hover:bg-[#F5F4EF] transition-colors"
        on:click={() => selectPrompt(prompt)}
      >
        <span class="text-sm text-[#1A1A1A] line-clamp-2">{prompt}</span>
        <Icon icon={feArrowUpLeft} class="w-[14px] h-[14px] text-[#9C9A93] self-end shrink-0" />
      </button>
    {/each}
  </div>

  <div class="flex items-center justify-between mb-3 mt-10">
    <h2 class="text-sm font-semibold text-[#1A1A1A]">Choose a template</h2>
    <div class="relative">
      <button
        class="bg-white border border-[#E5E3DC] rounded-full h-9 px-3 text-sm flex items-center gap-2 hover:bg-[#F5F4EF] transition-colors"
        on:click={() => (slideCountOpen = !slideCountOpen)}
      >
        <Icon icon={feLayout} class="w-4 h-4 text-[#6B6B6B]" />
        {selectedSlideCount}
        <Icon icon={feChevronDown} class="w-3 h-3 text-[#6B6B6B]" />
      </button>
      {#if slideCountOpen}
        <div class="absolute right-0 top-full mt-1 bg-white border border-[#E5E3DC] rounded-xl shadow-pop z-10 min-w-[120px]">
          {#each slideCountOptions as option}
            <button
              class="block w-full px-4 py-2 text-sm text-left text-[#1A1A1A] hover:bg-[#F5F4EF] first:rounded-t-xl last:rounded-b-xl"
              on:click={() => { selectedSlideCount = option; slideCountOpen = false; }}
            >
              {option}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  <div class="grid grid-cols-4 gap-4 pb-8">
    <button class="aspect-[4/3] bg-white border border-[#E5E3DC] rounded-xl flex flex-col items-center justify-center gap-2 hover:bg-[#F5F4EF] transition-colors">
      <Icon icon={feUpload} class="w-5 h-5 text-[#6B6B6B]" />
      <span class="text-xs text-[#6B6B6B]">Import template</span>
    </button>
    {#each Array(templateCount) as _, i}
      <button class="aspect-[4/3] bg-[#EFECE3] rounded-xl flex items-center justify-center hover:opacity-80 transition-opacity">
        <span class="text-xs text-[#6B6B6B] font-serif text-center px-2">Sample template {i + 1}</span>
      </button>
    {/each}
  </div>
</div>
