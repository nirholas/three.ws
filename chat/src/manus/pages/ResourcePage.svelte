<script>
  import BlogIndex from './resources/BlogIndex.svelte';
  import DocsIndex from './resources/DocsIndex.svelte';
  import UpdatesTimeline from './resources/UpdatesTimeline.svelte';
  import UseCasesIndex from './resources/UseCasesIndex.svelte';
  import TrustCenter from './resources/TrustCenter.svelte';

  export let slug = '';
</script>

{#if slug === 'blog'}
  <BlogIndex />
{:else if slug === 'docs'}
  <DocsIndex />
{:else if slug === 'updates'}
  <UpdatesTimeline />
{:else if slug === 'use-cases'}
  <UseCasesIndex />
{:else if slug === 'trust-center'}
  <TrustCenter />
{:else}
  <div class="max-w-[1100px] mx-auto px-6 pt-16 pb-24">
    <p class="text-[#6B6B6B]">Page not found: resources/{slug}</p>
  </div>
{/if}
