<script>
  import Icon from '../../Icon.svelte';
  import { featurePages } from './featurePages.js';

  export let slug;

  $: page = featurePages[slug] ?? featurePages['web-app'];
</script>

<div class="overflow-y-auto">
  <div class="max-w-[1100px] mx-auto px-6 pt-20 pb-32">

    <!-- Hero -->
    <div class="text-center">
      <p class="text-xs font-medium tracking-[0.16em] uppercase text-[#6B6B6B] mb-4">{page.eyebrow}</p>
      <h1 class="manus-display">{page.title}</h1>
      <p class="text-[#6B6B6B] text-lg max-w-[640px] mx-auto mt-6">{page.sub}</p>
      <div class="flex items-center justify-center gap-3 mt-8">
        <button class="manus-btn-primary">{page.primaryCta}</button>
        <button class="manus-btn-ghost border border-[#E5E3DC]">{page.secondaryCta}</button>
      </div>
    </div>

    <!-- Hero image -->
    {#if slug === 'agent-skills'}
      <div
        class="aspect-[3/1] rounded-2xl mt-12 bg-cover bg-center"
        style="background-image: url('/manus-redesign/skills-hero.jpg'), linear-gradient(to bottom right, #EFECE3, #E5E3DC)"
      ></div>
    {:else}
      <div class="aspect-[16/9] rounded-2xl bg-gradient-to-br from-[#EFECE3] to-[#E5E3DC] mt-12"></div>
    {/if}

    <!-- What you get -->
    <h2 class="font-serif text-3xl font-semibold mt-24 mb-8 text-center">What you get</h2>
    <div class="grid md:grid-cols-3 gap-4">
      {#each page.features as feat}
        <div class="bg-white border border-[#E5E3DC] rounded-2xl p-6">
          <div class="w-9 h-9 flex items-center justify-center rounded-xl bg-paper border border-[#E5E3DC]">
            <Icon icon={feat.icon} class="h-[22px] w-[22px] text-ink" strokeWidth={1.5} />
          </div>
          <p class="text-base font-semibold mt-4">{feat.title}</p>
          <p class="text-sm text-[#6B6B6B] mt-2">{feat.body}</p>
        </div>
      {/each}
    </div>

    <!-- Bottom CTA strip -->
    <div class="bg-black text-white rounded-2xl p-10 max-w-[1100px] mx-auto mt-24 flex items-center justify-between gap-6">
      <h3 class="font-serif text-3xl">{page.closingTitle}</h3>
      <button class="shrink-0 bg-white text-black rounded-full h-10 px-5 text-sm font-medium hover:bg-paper transition-colors">
        {page.closingCta}
      </button>
    </div>

  </div>
</div>
