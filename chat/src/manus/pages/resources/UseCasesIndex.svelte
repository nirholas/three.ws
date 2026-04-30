<script>
  const cases = [
    { industry: 'Sales', headline: 'Cut SDR onboarding from 4 weeks to 3 days', summary: 'A B2B SaaS team automated prospect research, outreach drafting, and CRM hygiene with a single Manus workflow.', logo: 'Acme Corp' },
    { industry: 'Legal', headline: 'Contract review time dropped by 70%', summary: 'A mid-size law firm runs first-pass contract analysis through Manus, flagging high-risk clauses before human review.', logo: 'LexGroup' },
    { industry: 'Finance', headline: 'Weekly reporting from 6 hours to 12 minutes', summary: 'An investment ops team replaced manual data pulls with a scheduled Manus agent that writes and delivers the report.', logo: 'CapitalCo' },
    { industry: 'E-commerce', headline: '3× more product listings, same headcount', summary: 'A marketplace seller generates optimized titles, descriptions, and alt-text for every new SKU automatically.', logo: 'ShopNow' },
    { industry: 'Healthcare', headline: 'Patient intake summaries in under 60 seconds', summary: 'A clinic uses Manus to pull relevant history from notes and produce structured intake briefs before each appointment.', logo: 'Mediflow' },
    { industry: 'Engineering', headline: 'Code review backlog cleared in a day', summary: 'A 12-person engineering team uses Manus to do first-pass reviews, catch lint issues, and suggest test cases automatically.', logo: 'DevCo' },
    { industry: 'Marketing', headline: 'Campaign briefs drafted in minutes, not days', summary: 'A growth team runs research, audience profiling, and copy generation inside one Manus session before handing off to designers.', logo: 'GrowthLab' },
    { industry: 'Recruiting', headline: 'Screening volume up 5× without new headcount', summary: 'An internal TA team uses Manus to screen inbound applications, draft personalized responses, and schedule interviews.', logo: 'HireHub' },
  ];
</script>

<div class="max-w-[1100px] mx-auto px-6 pt-16 pb-24">
  <h1 class="font-serif text-4xl font-semibold mb-2">Use Cases</h1>
  <p class="text-[#6B6B6B] text-base mb-12">How teams are putting Manus to work</p>

  <div class="grid md:grid-cols-2 gap-6">
    {#each cases as c}
      <article class="bg-white border border-[#E5E3DC] rounded-2xl p-6 hover:bg-[#FAF9F4] transition-colors cursor-pointer flex flex-col">
        <span class="inline-block text-xs uppercase tracking-wide text-[#6B6B6B]">{c.industry}</span>
        <h2 class="font-serif text-xl mt-2 text-[#1A1A1A] leading-snug">{c.headline}</h2>
        <p class="text-sm text-[#6B6B6B] mt-2 line-clamp-2 flex-1">{c.summary}</p>
        <div class="mt-5 h-8 bg-[#F5F4EF] rounded-lg flex items-center px-3">
          <span class="text-xs text-[#9C9A93] font-medium">{c.logo}</span>
        </div>
      </article>
    {/each}
  </div>
</div>
