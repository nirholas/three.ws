<script>
  import { websiteCategory, composerFill } from '../../stores.js';
  import Icon from '../../Icon.svelte';
  import {
    feLayout,
    fePieChart,
    feImage,
    feHome,
    feCloud,
    feLink,
    feArrowUpLeft,
    feFigma,
  } from '../../feather.js';

  const categories = [
    { id: 'landing',   label: 'Landing Page', icon: feLayout },
    { id: 'dashboard', label: 'Dashboard',    icon: fePieChart },
    { id: 'portfolio', label: 'Portfolio',    icon: feImage },
    { id: 'corporate', label: 'Corporate',    icon: feHome },
    { id: 'saas',      label: 'SaaS',         icon: feCloud },
    { id: 'linkbio',   label: 'Link in bio',  icon: feLink },
  ];

  const ideasByCategory = {
    landing:   ['Product launch landing page', 'SaaS marketing landing page', 'Event signup landing page'],
    dashboard: ['Analytics dashboard', 'Sales tracking dashboard', 'HR dashboard'],
    portfolio: ['Build full-stack developer portfolio', 'Product designer portfolio website', 'Photographer showcase portfolio page'],
    corporate: ['Law firm corporate site', 'Consulting agency website', 'Real estate corporate site'],
    saas:      ['SaaS product home page', 'Pricing page for B2B SaaS', 'Feature comparison page'],
    linkbio:   ['Creator link-in-bio page', 'Musician fan hub', 'Restaurant menu link page'],
  };

  const starterByCategory = {
    landing:   'Build a landing page for ',
    dashboard: 'Build a dashboard for ',
    portfolio: 'Build a portfolio website for ',
    corporate: 'Build a corporate website for ',
    saas:      'Build a SaaS marketing site for ',
    linkbio:   'Create a link-in-bio page for ',
  };

  export let compact = false;

  function pick(id) {
    const isDeselecting = $websiteCategory === id;
    websiteCategory.set(isDeselecting ? null : id);
    if (!isDeselecting) {
      composerFill.set({ text: starterByCategory[id], submit: false, ifEmpty: true });
    }
  }

  function selectIdea(idea) {
    composerFill.set({ text: idea, submit: true, ifEmpty: false });
  }
</script>

<div class="mt-8 max-w-[760px] mx-auto px-1">
  <div class="flex items-center justify-between">
    <h3 class="text-sm font-semibold text-[#1A1A1A]">What would you like to build?</h3>
    {#if !compact}
      <div class="flex items-center gap-3 text-sm text-[#1A1A1A]">
        <button class="inline-flex items-center gap-1.5 hover:underline">
          <Icon icon={feLink} size={14} /> Add website reference
        </button>
        <span class="text-[#9C9A93]">|</span>
        <button class="inline-flex items-center gap-1.5 hover:underline">
          <Icon icon={feFigma} size={14} /> Import from Figma
        </button>
      </div>
    {/if}
  </div>

  <div class="mt-4 flex gap-2 overflow-x-auto scrollbar-none">
    {#each categories as c}
      <button
        class="manus-chip whitespace-nowrap {$websiteCategory === c.id ? 'manus-chip-selected' : ''}"
        on:click={() => pick(c.id)}
      >
        <Icon icon={c.icon} size={16} />
        {c.label}
      </button>
    {/each}
  </div>

  {#if $websiteCategory && ideasByCategory[$websiteCategory]}
    <div class="mt-6">
      <h3 class="text-sm font-semibold mb-3">Explore ideas</h3>
      <div class="flex flex-wrap gap-2">
        {#each ideasByCategory[$websiteCategory] as idea}
          <button class="manus-chip" on:click={() => selectIdea(idea)}>
            <span>{idea}</span>
            <Icon icon={feArrowUpLeft} size={14} class="text-[#9C9A93]" />
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>
