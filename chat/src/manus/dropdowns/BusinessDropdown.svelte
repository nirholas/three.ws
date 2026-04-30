<script>
  import { route } from '../../stores.js';
  import Icon from '../../Icon.svelte';
  import { feBriefcase, feShield, feServer, feUsers, feMessageCircle } from '../../feather.js';

  const items = [
    { title: 'Enterprise',            subtitle: 'Deploy Manus across your org',        route: 'business/enterprise',     icon: feBriefcase },
    { title: 'Security & compliance', subtitle: 'SOC 2, GDPR, custom DPAs',            route: 'business/security',       icon: feShield },
    { title: 'Custom deployments',    subtitle: 'VPC and on-prem options',             route: 'business/deployments',    icon: feServer },
    { title: 'Customer stories',      subtitle: 'How teams ship faster with Manus',    route: 'business/customers',      icon: feUsers },
    { title: 'Contact sales',         subtitle: 'Talk to a real human',                route: 'business/contact-sales',  icon: feMessageCircle },
  ];
</script>

<div class="bg-white border border-[#E5E3DC] rounded-2xl shadow-pop p-3 w-[420px]">
  {#each items as item}
    <button
      class="flex items-start gap-3 w-full px-3 py-3 rounded-xl text-left hover:bg-[#F5F4EF]"
      on:click={() => route.set(item.route)}>
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
