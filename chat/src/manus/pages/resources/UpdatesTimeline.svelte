<script>
  const entries = [
    {
      date: 'April 2026',
      title: 'Multi-agent runs are now generally available',
      body: 'Parallel agent execution exits beta. You can now run up to 8 agents simultaneously on any Pro or Business plan, with shared context and cross-agent tool calls.',
      hasImage: true,
    },
    {
      date: 'March 2026',
      title: 'Introducing Skills — reusable agent capabilities',
      body: 'Skills let you package a set of instructions, tools, and context into a shareable unit. Publish to the library or keep them private to your workspace.',
      hasImage: false,
    },
    {
      date: 'February 2026',
      title: 'New composer with file and image support',
      body: 'The composer now accepts image uploads, PDFs, and spreadsheets. Agents can reference attachments directly within a task run.',
      hasImage: true,
    },
    {
      date: 'January 2026',
      title: 'Deployments: run agents on a schedule',
      body: 'Set any agent to run on a cron schedule, trigger on webhook events, or expose it as a callable API endpoint. Available on Business plans.',
      hasImage: false,
    },
    {
      date: 'December 2025',
      title: 'Memory and persistent context',
      body: 'Agents can now store facts across sessions using the built-in memory tool. Set a retention window or let the agent decide what to remember.',
      hasImage: false,
    },
    {
      date: 'November 2025',
      title: 'Manus is open to everyone',
      body: 'After six months in private beta we are opening Manus to the public. Free accounts include 50 runs per month — no credit card required to get started.',
      hasImage: true,
    },
  ];
</script>

<div class="max-w-[1100px] mx-auto px-6 pt-16 pb-24">
  <h1 class="font-serif text-4xl font-semibold mb-2">Updates</h1>
  <p class="text-[#6B6B6B] text-base mb-12">What's new in Manus</p>

  <div class="relative">
    <!-- vertical line -->
    <div class="absolute left-[120px] top-0 bottom-0 w-px bg-[#E5E3DC]"></div>

    <div class="space-y-10">
      {#each entries as e}
        <div class="flex gap-10">
          <time class="w-[100px] shrink-0 text-xs text-[#9C9A93] uppercase tracking-wide pt-5 text-right">{e.date}</time>
          <div class="flex-1 pl-8">
            <div class="bg-white border border-[#E5E3DC] rounded-2xl p-6 hover:bg-[#FAF9F4] transition-colors">
              {#if e.hasImage}
                <div class="aspect-[16/6] rounded-xl bg-[#EFECE3] mb-5"></div>
              {/if}
              <h2 class="font-serif text-xl font-semibold text-[#1A1A1A]">{e.title}</h2>
              <p class="text-sm text-[#6B6B6B] mt-2 leading-relaxed">{e.body}</p>
            </div>
          </div>
        </div>
      {/each}
    </div>
  </div>
</div>
