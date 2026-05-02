<script>
  import { route } from '../../stores.js';
  import Icon from '../../Icon.svelte';
  import {
    feTrendingUp, feSpeaker, feCpu, feActivity,
    feLifeBuoy, feDollarSign, feUsers, feStar,
  } from '../../feather.js';

  const items = [
    { title: 'Sales',               subtitle: 'Pipeline insights and deal acceleration', slug: 'solutions/sales',       icon: feTrendingUp },
    { title: 'Marketing',           subtitle: 'Campaigns, content, and analytics',       slug: 'solutions/marketing',   icon: feSpeaker },
    { title: 'Engineering',         subtitle: 'Internal tools and automations',          slug: 'solutions/engineering', icon: feCpu },
    { title: 'Operations',          subtitle: 'Reporting, dashboards, workflows',        slug: 'solutions/operations',  icon: feActivity },
    { title: 'Customer Support',    subtitle: 'Ticket triage and knowledge bots',        slug: 'solutions/support',     icon: feLifeBuoy },
    { title: 'Finance',             subtitle: 'Spend analysis and forecasting',          slug: 'solutions/finance',     icon: feDollarSign },
    { title: 'HR & People',         subtitle: 'Hiring, onboarding, internal Q&A',       slug: 'solutions/hr',          icon: feUsers },
    { title: 'Founders & Startups', subtitle: 'Launch faster with fewer engineers',      slug: 'solutions/founders',    icon: feStar },
  ];
</script>

<div class="bg-white border border-[#E5E3DC] rounded-2xl shadow-pop p-3 w-[420px]">
  {#each items as item}
    <button
      class="flex items-start gap-3 w-full px-3 py-3 rounded-xl text-left hover:bg-[#F5F4EF]"
      on:click={() => route.set(item.slug)}
    >
      <span class="w-9 h-9 rounded-lg bg-[#F5F4EF] flex items-center justify-center shrink-0">
        <Icon icon={item.icon} class="w-[18px] h-[18px] text-[#1A1A1A]" />
      </span>
      <span class="flex-1 min-w-0">
        <span class="block text-sm font-semibold text-[#1A1A1A]">{item.title}</span>
        <span class="block text-xs text-[#6B6B6B] mt-0.5">{item.subtitle}</span>
      </span>
    </button>
  {/each}
</div>
