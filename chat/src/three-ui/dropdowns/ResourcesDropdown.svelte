<script>
  import { route } from '../../stores.js';
  import Icon from '../../Icon.svelte';
  import {
    feFileText, feBook, feList, feCompass, feShield
  } from '../../feather.js';

  const items = [
    { title: 'Blog',         subtitle: 'Ideas, guides, and user stories',    route: 'resources/blog',         icon: feFileText },
    { title: 'Docs',         subtitle: 'Learn about three.ws and get started',  route: 'resources/docs',         icon: feBook },
    { title: 'Updates',      subtitle: "What's new with three.ws?",             route: 'resources/updates',      icon: feList },
    { title: 'Use cases',    subtitle: 'Best practices in action',           route: 'resources/use-cases',    icon: feCompass },
    { title: 'Trust center', subtitle: 'Security and compliance',            route: 'resources/trust-center', icon: feShield },
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
