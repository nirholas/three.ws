<script>
  import { route } from '../../stores.js';
  import Icon from '../../Icon.svelte';
  import {
    feGlobe, feSmartphone, feZap, feLayout, feMonitor,
    feTarget, feMail, feGrid
  } from '../../feather.js';

  const items = [
    { title: 'Web app',                subtitle: 'Build full-stack, AI-powered sites',   route: 'features/web-app',          icon: feGlobe },
    { title: 'Mobile app',             subtitle: 'Build native iOS & Android apps',      route: 'features/mobile-app',       icon: feSmartphone },
    { title: 'AI design',              subtitle: 'Automates the entire design journey',  route: 'features/ai-design',        icon: feZap },
    { title: 'AI slides',              subtitle: 'Use Nano Banana Pro to create slides', route: 'features/ai-slides',        icon: feLayout },
    { title: 'Manus browser operator', subtitle: 'Lend a tab to Manus',                  route: 'features/browser-operator', icon: feMonitor },
    { title: 'Wide Research',          subtitle: 'Parallel research at scale',           route: 'features/wide-research',    icon: feTarget },
    { title: 'Mail Manus',             subtitle: 'Turn any email into action',           route: 'features/mail-manus',       icon: feMail },
    { title: 'Agent Skills',           subtitle: 'Automate your expertise',              route: 'features/agent-skills',     icon: feGrid },
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
