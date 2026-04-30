<script>
  import { tick } from 'svelte';
  import { route, mode, composerFill } from '../../stores.js';
  import Icon from '../../Icon.svelte';
  import { feArrowUp } from '../../feather.js';
  import WebsiteFlow from '../flows/WebsiteFlow.svelte';
  import { getPageContent } from './marketingPages.js';

  export let slug = '';

  $: content = getPageContent(slug);
  $: headlineParts = content.headline.split('\n');

  let text = '';
  let textareaEl;

  function autoresize() {
    if (!textareaEl) return;
    textareaEl.style.height = 'auto';
    textareaEl.style.height = Math.min(textareaEl.scrollHeight + 2, 320) + 'px';
  }

  async function submit() {
    const msg = text.trim();
    if (!msg) return;
    composerFill.set({ text: msg, submit: false, ifEmpty: false });
    if (slug.startsWith('solutions/') || slug.startsWith('business/')) {
      mode.set('website');
    }
    route.set('chat');
  }

  const logos = ['ACME', 'NORTHWIND', 'LATTE', 'PIVOT', 'ATLAS', 'BEACON'];
</script>

<div class="bg-paper min-h-screen">
  <div class="max-w-[1100px] mx-auto px-6 pt-24 pb-32">

    <!-- Eyebrow -->
    {#if content.eyebrow}
      <p class="text-center text-xs font-semibold uppercase tracking-[0.14em] text-[#9C9A93] mb-4">
        {content.eyebrow}
      </p>
    {/if}

    <!-- Headline -->
    <h1 class="manus-display text-center">
      {#each headlineParts as part, i}
        {part}{#if i < headlineParts.length - 1}<br />{/if}
      {/each}
    </h1>

    <!-- Sub -->
    <p class="text-[#6B6B6B] text-lg max-w-[640px] mx-auto text-center mt-6">
      {content.sub}
    </p>

    <!-- Composer -->
    <div class="mt-12 max-w-[680px] mx-auto">
      <div
        class="bg-white border border-[#E5E3DC] rounded-[20px] shadow-composer pt-5 px-5 pb-3"
        style="min-height:140px"
      >
        <textarea
          bind:this={textareaEl}
          bind:value={text}
          placeholder={content.placeholder}
          rows={1}
          class="w-full resize-none bg-transparent border-0 p-0 outline-none ring-0 focus:outline-none focus:ring-0 text-base text-[#1A1A1A] placeholder-[#9C9A93] font-sans overflow-y-auto scrollbar-ultraslim"
          style="max-height:320px;"
          on:input={autoresize}
          on:keydown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div class="flex items-center justify-end mt-3">
          <button
            disabled={!text.trim()}
            on:click={submit}
            class="flex h-9 w-9 items-center justify-center rounded-full transition-colors {text.trim()
              ? 'bg-black text-white hover:bg-[#333] cursor-pointer'
              : 'bg-[#E7E5DD] text-[#9C9A93] cursor-default'}"
            title="Send"
          >
            <Icon icon={feArrowUp} class="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>

    <!-- Categories row (compact — no Add reference / Import from Figma) -->
    <WebsiteFlow compact={true} />

    <!-- Logos strip -->
    <div class="mt-20 grid grid-cols-3 md:grid-cols-6 gap-6 items-center opacity-70">
      {#each logos as logo}
        <div class="text-[#6B6B6B] text-sm uppercase tracking-[0.16em] text-center">
          {logo}
        </div>
      {/each}
    </div>

  </div>
</div>
