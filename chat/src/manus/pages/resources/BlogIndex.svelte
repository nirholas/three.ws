<script>
  const articles = [
    { tag: 'Engineering', title: 'How we think about agent reliability', excerpt: 'Building systems that fail gracefully is harder than building systems that work. Here is our approach.', date: 'Apr 14, 2026', read: '6 min read' },
    { tag: 'Design', title: 'Designing chat for non-engineers', excerpt: 'Most chat interfaces are built by engineers, for engineers. We asked a different question.', date: 'Apr 2, 2026', read: '4 min read' },
    { tag: 'Engineering', title: 'Inside the Manus runtime', excerpt: 'A look at how we execute multi-step agent tasks safely and efficiently at scale.', date: 'Mar 24, 2026', read: '8 min read' },
    { tag: 'Product', title: 'Shipping the new composer', excerpt: 'What we learned from six months of user research on how people write prompts.', date: 'Mar 10, 2026', read: '5 min read' },
    { tag: 'Company', title: 'Why we built Manus', excerpt: 'The original insight that led us to build an agent-first platform from the ground up.', date: 'Feb 28, 2026', read: '7 min read' },
    { tag: 'Engineering', title: 'Streaming responses at scale', excerpt: 'How we cut median time-to-first-token by 40% without changing model providers.', date: 'Feb 14, 2026', read: '5 min read' },
    { tag: 'Product', title: 'Multi-agent runs: what we shipped', excerpt: 'A deep dive into the new orchestration layer that powers parallel agent execution.', date: 'Jan 30, 2026', read: '6 min read' },
    { tag: 'Design', title: 'The typography behind the interface', excerpt: 'On using a serif wordmark inside a tool-first product and making it feel right.', date: 'Jan 18, 2026', read: '3 min read' },
    { tag: 'Company', title: 'Our approach to trust and safety', excerpt: 'How we think about the responsibility that comes with building powerful AI agents.', date: 'Jan 6, 2026', read: '5 min read' },
  ];
</script>

<div class="max-w-[1100px] mx-auto px-6 pt-16 pb-24">
  <h1 class="font-serif text-4xl font-semibold mb-2">Blog</h1>
  <p class="text-[#6B6B6B] text-base mb-12">Ideas, guides, and stories from the Manus team</p>

  <div class="grid md:grid-cols-3 gap-6">
    {#each articles as a}
      <article class="bg-white border border-[#E5E3DC] rounded-2xl p-6 hover:bg-[#FAF9F4] transition-colors cursor-pointer">
        <div class="aspect-[16/9] rounded-xl bg-[#EFECE3]"></div>
        <span class="inline-block text-xs uppercase tracking-wide text-[#6B6B6B] mt-4">{a.tag}</span>
        <h2 class="font-serif text-xl mt-2 text-[#1A1A1A]">{a.title}</h2>
        <p class="text-sm text-[#6B6B6B] mt-2 line-clamp-2">{a.excerpt}</p>
        <div class="text-xs text-[#9C9A93] mt-4">{a.date} · {a.read}</div>
      </article>
    {/each}
  </div>
</div>
