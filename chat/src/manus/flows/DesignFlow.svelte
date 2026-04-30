<script>
  import { composerFill } from '../../stores.js';
  import Icon from '../../Icon.svelte';
  import {
    feBarChart2, feBookOpen, feActivity, feLayout, feMonitor, feCoffee, feChevronRight,
  } from '../../feather.js';

  const cards = [
    {
      title: 'Create data infographic on coffee trends',
      description: 'Convert the key data from an article on "Global Coffee Consumption…" into a visual infographic.',
      icon: feBarChart2,
    },
    {
      title: 'Design Japanese restaurant menu',
      description: 'Design a menu for my high-end Japanese restaurant, "Sakura House."',
      icon: feBookOpen,
    },
    {
      title: 'Design smart bracelet and packaging',
      description: 'Design the product concept and packaging for my health-monitoring smart bracelet.',
      icon: feActivity,
    },
    {
      title: 'Design SaaS product launch posters',
      description: 'Design a set of product launch promotional posters for my project management SaaS.',
      icon: feLayout,
    },
    {
      title: 'Design interactive tech expo booth',
      description: "Design a 36-square-meter tech expo booth for my AI company's product showcase.",
      icon: feMonitor,
    },
    {
      title: 'Design modern coffee brand identity',
      description: 'Design a modern, minimalist logo and full VI for my specialty coffee brand.',
      icon: feCoffee,
    },
  ];

  function selectCard(description) {
    composerFill.set({ text: description, submit: true, ifEmpty: false });
  }
</script>

<div class="w-full pb-12">
  <p class="text-[#1A1A1A] font-medium mb-4 mt-10 max-w-[1100px] mx-auto px-6">Get started with</p>
  <div class="grid md:grid-cols-2 xl:grid-cols-3 gap-4 max-w-[1100px] mx-auto px-6">
    {#each cards as card}
      <button
        class="bg-white border border-[#E5E3DC] rounded-2xl p-5 flex gap-4 hover:bg-[#F5F4EF] transition-colors text-left w-full"
        on:click={() => selectCard(card.description)}
      >
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between text-[#1A1A1A] font-semibold text-sm">
            <span class="text-ellipsis overflow-hidden whitespace-nowrap mr-2">{card.title}</span>
            <Icon icon={feChevronRight} class="h-4 w-4 shrink-0 text-[#9C9A93]" />
          </div>
          <p class="text-xs text-[#6B6B6B] mt-1.5 line-clamp-2">{card.description}</p>
        </div>
        <div class="w-24 h-24 shrink-0 rounded-lg bg-[#EFECE3] flex items-center justify-center">
          <Icon icon={card.icon} class="h-8 w-8 text-[#9C9A93]" />
        </div>
      </button>
    {/each}
  </div>
</div>
