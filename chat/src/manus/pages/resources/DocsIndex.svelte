<script>
  import { onMount } from 'svelte';
  import { marked } from 'marked';

  export let docSlug = '';

  // Load all markdown files at build time
  const rawDocs = import.meta.glob('../../../../../docs/*.md', { query: '?raw', import: 'default', eager: true });

  // Build a slug → raw content map
  const docs = {};
  for (const [path, content] of Object.entries(rawDocs)) {
    const slug = path.replace('../../../../../docs/', '').replace('.md', '');
    docs[slug] = content;
  }

  // Extract the first H1 heading from a doc, falling back to slug
  function getTitle(slug) {
    const src = docs[slug] || '';
    const m = src.match(/^#\s+(.+)/m);
    return m ? m[1] : slug;
  }

  const sections = [
    {
      label: 'Getting Started',
      items: ['introduction', 'quick-start', 'how-it-works'],
    },
    {
      label: 'Concepts',
      items: ['architecture', 'layers', 'agent-system', 'agent-manifest', 'memory', 'skills'],
    },
    {
      label: 'Embedding & SDK',
      items: ['embedding', 'web-component', 'widgets', 'widget-studio', 'js-api', 'sdk'],
    },
    {
      label: 'API',
      items: ['api-reference', 'authentication', 'permissions', 'configuration'],
    },
    {
      label: 'Avatars & 3D',
      items: ['viewer', 'avatar-creation', 'avaturn', 'character-studio', 'validation', 'editor', 'ar'],
    },
    {
      label: 'Blockchain',
      items: ['erc8004', 'smart-contracts', 'solana', 'solana-pumpfun', 'x402', 'reputation'],
    },
    {
      label: 'Platform',
      items: ['deployment', 'security', 'mcp', 'multi-agent'],
    },
    {
      label: 'Help',
      items: ['examples', 'troubleshooting', 'changelog', 'contributing'],
    },
  ].map(s => ({
    ...s,
    items: s.items.filter(slug => docs[slug]),
  })).filter(s => s.items.length > 0);

  let active = docSlug && docs[docSlug] ? docSlug : 'introduction';
  let search = '';
  let htmlContent = '';

  function navigate(slug) {
    active = slug;
    search = '';
    window.location.hash = `resources/docs/${slug}`;
  }

  $: {
    const src = docs[active] || '';
    htmlContent = marked.parse(src);
  }

  $: filtered = search.trim()
    ? sections
        .flatMap(s => s.items)
        .filter(slug =>
          getTitle(slug).toLowerCase().includes(search.toLowerCase()) ||
          slug.toLowerCase().includes(search.toLowerCase())
        )
    : null;

  onMount(() => {
    // Sync from hash if navigating directly to a sub-page
    const fromHash = window.location.hash.slice(1);
    if (fromHash.startsWith('resources/docs/')) {
      const slug = fromHash.slice('resources/docs/'.length);
      if (docs[slug]) active = slug;
    }
  });
</script>

<div class="max-w-[1100px] mx-auto px-6 pt-16 pb-24 flex gap-8">
  <!-- Left rail -->
  <aside class="w-[240px] shrink-0">
    <div class="sticky top-20">
      <input
        type="search"
        placeholder="Search docs"
        bind:value={search}
        class="bg-white border border-[#E5E3DC] rounded-full h-9 px-3 text-sm w-full mb-6 focus:outline-none focus:border-[#1A1A1A]"
      />
      {#if filtered}
        <div class="mb-4">
          <div class="text-xs font-semibold uppercase tracking-wide text-[#9C9A93] mb-1">Results</div>
          <ul class="space-y-0.5">
            {#each filtered as slug}
              <li>
                <button
                  class="w-full text-left text-sm px-2 py-1 rounded-lg transition-colors {active === slug ? 'bg-[#F5F4EF] text-[#1A1A1A] font-medium' : 'text-[#6B6B6B] hover:text-[#1A1A1A] hover:bg-[#F5F4EF]'}"
                  on:click={() => navigate(slug)}
                >{getTitle(slug)}</button>
              </li>
            {/each}
            {#if filtered.length === 0}
              <li class="text-sm text-[#9C9A93] px-2 py-1">No results</li>
            {/if}
          </ul>
        </div>
      {:else}
        {#each sections as s}
          <div class="mb-4">
            <div class="text-xs font-semibold uppercase tracking-wide text-[#9C9A93] mb-1">{s.label}</div>
            <ul class="space-y-0.5">
              {#each s.items as slug}
                <li>
                  <button
                    class="w-full text-left text-sm px-2 py-1 rounded-lg transition-colors {active === slug ? 'bg-[#F5F4EF] text-[#1A1A1A] font-medium' : 'text-[#6B6B6B] hover:text-[#1A1A1A] hover:bg-[#F5F4EF]'}"
                    on:click={() => navigate(slug)}
                  >{getTitle(slug)}</button>
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      {/if}
    </div>
  </aside>

  <!-- Content -->
  <main class="flex-1 min-w-0 prose prose-neutral max-w-none">
    {@html htmlContent}
  </main>
</div>
