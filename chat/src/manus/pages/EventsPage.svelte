<script>
  import { route } from '../../stores.js';
  import Icon from '../../Icon.svelte';
  import {
    feVideo, feMapPin, feClock, feZap, fePlay,
    feCalendar, feExternalLink, feUsers,
  } from '../../feather.js';

  export let slug = '';

  const pages = {
    'events/webinars': {
      title: 'Webinars',
      sub: 'Live sessions with the three.ws team — deep dives, demos, and Q&A.',
      cta: 'Register for upcoming webinars',
      upcoming: [
        { date: 'May 14, 2026', title: 'Building multi-agent workflows with three.ws', host: 'Lena Park · Product', duration: '45 min', spots: 'Open' },
        { date: 'May 21, 2026', title: 'Deploying on your own VPC: a step-by-step walkthrough', host: 'Marco Diaz · Engineering', duration: '60 min', spots: 'Open' },
        { date: 'Jun 4, 2026',  title: 'Agent Skills deep dive: recording, sharing, and versioning', host: 'Sarah Chen · Product', duration: '45 min', spots: 'Open' },
      ],
      past: [
        { date: 'Apr 23, 2026', title: 'What\'s new in three.ws — April edition', views: '1.2k views' },
        { date: 'Apr 9, 2026',  title: 'Intro to wide research: parallel agents at scale', views: '980 views' },
        { date: 'Mar 19, 2026', title: 'Building internal tools with three.ws + Postgres', views: '2.1k views' },
      ],
    },
    'events/conferences': {
      title: 'Conferences',
      sub: 'Meet the three.ws team in person at leading AI, developer, and product conferences.',
      cta: 'Request a meeting at an upcoming event',
      upcoming: [
        { date: 'May 19–21, 2026', title: 'AI Engineer World\'s Fair', host: 'San Francisco, CA', duration: 'Booth #412', spots: 'Open' },
        { date: 'Jun 3–5, 2026',   title: 'SaaStr Annual',            host: 'San Mateo, CA',    duration: 'Sponsor',    spots: 'Open' },
        { date: 'Jun 17–18, 2026', title: 'Config 2026 (Figma)',       host: 'San Francisco, CA', duration: 'Speaking',  spots: 'Open' },
      ],
      past: [
        { date: 'Mar 2026', title: 'GTC 2026 — NVIDIA', views: 'San Jose, CA' },
        { date: 'Feb 2026', title: 'ProductHunt Makers Festival', views: 'Remote' },
        { date: 'Jan 2026', title: 'CES 2026', views: 'Las Vegas, NV' },
      ],
    },
    'events/office-hours': {
      title: 'Office Hours',
      sub: 'Weekly open Q&A with three.ws engineers and product managers. Bring your questions, bugs, or ideas.',
      cta: 'Join the next session',
      upcoming: [
        { date: 'May 7, 2026',  title: 'Engineering office hours — general Q&A', host: 'Marco Diaz + Alex Kim', duration: '60 min', spots: '12 spots left' },
        { date: 'May 14, 2026', title: 'Product office hours — roadmap & feedback', host: 'Lena Park', duration: '45 min', spots: 'Open' },
        { date: 'May 21, 2026', title: 'Engineering office hours — general Q&A', host: 'Marco Diaz + Alex Kim', duration: '60 min', spots: 'Open' },
      ],
      past: [
        { date: 'Apr 30, 2026', title: 'Engineering Q&A — memory and context', views: 'Recording available' },
        { date: 'Apr 23, 2026', title: 'Product Q&A — new composer feedback', views: 'Recording available' },
        { date: 'Apr 16, 2026', title: 'Engineering Q&A — deployment options', views: 'Recording available' },
      ],
    },
    'events/hackathons': {
      title: 'Hackathons',
      sub: 'Build with three.ws alongside the community. Cash prizes, credits, and a chance to get featured.',
      cta: 'Apply for the next hackathon',
      upcoming: [
        { date: 'Jun 7–8, 2026',   title: 'three.ws Build Weekend — Agents Track', host: 'Remote', duration: '48 hours', spots: 'Applications open' },
        { date: 'Jul 12, 2026',    title: 'AI x Fintech Hackathon (co-hosted)',    host: 'New York, NY', duration: '24 hours', spots: 'Coming soon' },
      ],
      past: [
        { date: 'Apr 2026', title: 'Spring Build Weekend — 142 submissions', views: 'See winners' },
        { date: 'Feb 2026', title: 'Agents for Good Hackathon — $20k in prizes', views: 'See winners' },
        { date: 'Dec 2025', title: 'Launch Week Hackathon — inaugural event', views: 'See winners' },
      ],
    },
    'events/recordings': {
      title: 'Recordings',
      sub: 'Every webinar, demo, and talk — available on demand.',
      cta: null,
      upcoming: [],
      past: [
        { date: 'Apr 23, 2026', title: 'What\'s new in three.ws — April edition',             views: '1.2k views' },
        { date: 'Apr 9, 2026',  title: 'Intro to wide research: parallel agents at scale',    views: '980 views' },
        { date: 'Mar 19, 2026', title: 'Building internal tools with three.ws + Postgres',    views: '2.1k views' },
        { date: 'Mar 5, 2026',  title: 'Agent reliability — how we think about failure',      views: '1.5k views' },
        { date: 'Feb 19, 2026', title: 'Live demo: multi-agent runs from scratch',            views: '3.4k views' },
        { date: 'Feb 5, 2026',  title: 'Office hours recap — memory and context deep dive',   views: '760 views' },
        { date: 'Jan 22, 2026', title: 'New composer walkthrough — file and image support',   views: '1.1k views' },
        { date: 'Jan 8, 2026',  title: 'Building with the three.ws SDK — getting started',    views: '2.8k views' },
      ],
    },
  };

  $: page = pages[slug] ?? pages['events/webinars'];
</script>

<div class="max-w-[1100px] mx-auto px-6 pt-20 pb-32">

  <!-- Hero -->
  <div class="text-center mb-16">
    <h1 class="font-serif text-5xl font-semibold text-[#1A1A1A]">{page.title}</h1>
    <p class="text-[#6B6B6B] text-lg max-w-[560px] mx-auto mt-4">{page.sub}</p>
    {#if page.cta}
      <button class="mt-8 bg-black text-white rounded-full h-10 px-6 text-sm font-medium hover:bg-[#333] transition-colors">
        {page.cta}
      </button>
    {/if}
  </div>

  <!-- Upcoming -->
  {#if page.upcoming.length > 0}
    <h2 class="font-serif text-2xl font-semibold text-[#1A1A1A] mb-6">Upcoming</h2>
    <div class="space-y-3 mb-16">
      {#each page.upcoming as e}
        <div class="bg-white border border-[#E5E3DC] rounded-2xl px-6 py-5 flex items-center gap-6">
          <div class="flex items-center justify-center w-10 h-10 rounded-xl bg-[#F5F4EF] shrink-0">
            <Icon icon={feCalendar} class="w-5 h-5 text-[#1A1A1A]" strokeWidth={1.5} />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-[#1A1A1A]">{e.title}</p>
            <p class="text-xs text-[#6B6B6B] mt-1">{e.host} · {e.duration}</p>
          </div>
          <div class="text-right shrink-0">
            <p class="text-xs font-medium text-[#1A1A1A]">{e.date}</p>
            <p class="text-xs text-[#6B6B6B] mt-1">{e.spots}</p>
          </div>
          <button class="shrink-0 h-8 px-4 rounded-full border border-[#E5E3DC] text-xs font-medium text-[#1A1A1A] hover:bg-[#F5F4EF] transition-colors">
            Register
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Past / All Recordings -->
  <h2 class="font-serif text-2xl font-semibold text-[#1A1A1A] mb-6">
    {page.upcoming.length > 0 ? 'Past sessions' : 'All recordings'}
  </h2>
  <div class="grid md:grid-cols-2 gap-4">
    {#each page.past as e}
      <div class="bg-white border border-[#E5E3DC] rounded-2xl px-6 py-5 flex items-center gap-4 hover:bg-[#FAF9F4] transition-colors cursor-pointer">
        <div class="flex items-center justify-center w-10 h-10 rounded-xl bg-[#F5F4EF] shrink-0">
          <Icon icon={fePlay} class="w-4 h-4 text-[#1A1A1A]" strokeWidth={1.5} />
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold text-[#1A1A1A] line-clamp-1">{e.title}</p>
          <p class="text-xs text-[#6B6B6B] mt-1">{e.date} · {e.views}</p>
        </div>
        <Icon icon={feExternalLink} class="w-4 h-4 text-[#9C9A93] shrink-0" strokeWidth={1.5} />
      </div>
    {/each}
  </div>

</div>
