<script>
  import { route } from '../stores.js';
  import FeaturesDropdown from './dropdowns/FeaturesDropdown.svelte';
  import SolutionsDropdown from './dropdowns/SolutionsDropdown.svelte';
  import ResourcesDropdown from './dropdowns/ResourcesDropdown.svelte';
  import EventsDropdown from './dropdowns/EventsDropdown.svelte';
  import BusinessDropdown from './dropdowns/BusinessDropdown.svelte';

  let featuresOpen = false;
  let solutionsOpen = false;
  let resourcesOpen = false;
  let eventsOpen = false;
  let businessOpen = false;

  const featOpen  = { value: null };
  const featClose = { value: null };
  const solOpen   = { value: null };
  const solClose  = { value: null };
  const resOpen   = { value: null };
  const resClose  = { value: null };
  const evtOpen   = { value: null };
  const evtClose  = { value: null };
  const bizOpen   = { value: null };
  const bizClose  = { value: null };

  function onFeatEnter()  { clearTimeout(featClose.value); featOpen.value  = setTimeout(() => (featuresOpen  = true),  120); }
  function onFeatLeave()  { clearTimeout(featOpen.value);  featClose.value = setTimeout(() => (featuresOpen  = false), 200); }
  function onSolEnter()   { clearTimeout(solClose.value);  solOpen.value   = setTimeout(() => (solutionsOpen = true),  120); }
  function onSolLeave()   { clearTimeout(solOpen.value);   solClose.value  = setTimeout(() => (solutionsOpen = false), 200); }
  function onResEnter()   { clearTimeout(resClose.value);  resOpen.value   = setTimeout(() => (resourcesOpen = true),  120); }
  function onResLeave()   { clearTimeout(resOpen.value);   resClose.value  = setTimeout(() => (resourcesOpen = false), 200); }
  function onEvtEnter()   { clearTimeout(evtClose.value);  evtOpen.value   = setTimeout(() => (eventsOpen    = true),  120); }
  function onEvtLeave()   { clearTimeout(evtOpen.value);   evtClose.value  = setTimeout(() => (eventsOpen    = false), 200); }
  function onBizEnter()   { clearTimeout(bizClose.value);  bizOpen.value   = setTimeout(() => (businessOpen  = true),  120); }
  function onBizLeave()   { clearTimeout(bizOpen.value);   bizClose.value  = setTimeout(() => (businessOpen  = false), 200); }
</script>

<header class="sticky top-0 z-40 bg-white border-b border-[#E5E3DC]">
  <div class="max-w-[1240px] mx-auto h-14 px-6 flex items-center justify-between">

    <!-- Logo -->
    <button
      class="font-serif text-[22px] font-semibold text-[#1A1A1A] lowercase tracking-tight"
      on:click={() => route.set('chat')}
    >
      manus
    </button>

    <!-- Center nav -->
    <nav class="hidden md:flex items-center">

      <!-- Features -->
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div class="relative" on:mouseenter={onFeatEnter} on:mouseleave={onFeatLeave}>
        <button
          class="h-14 px-3 inline-flex items-center text-sm font-medium text-[#1A1A1A] hover:text-[#6B6B6B] transition-colors"
          aria-haspopup="true"
          aria-expanded={featuresOpen}
        >Features</button>
        {#if featuresOpen}
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div
            class="absolute top-full mt-2 left-0 z-50"
            on:mouseenter={onFeatEnter}
            on:mouseleave={onFeatLeave}
          >
            <FeaturesDropdown />
          </div>
        {/if}
      </div>

      <!-- Solutions -->
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div class="relative" on:mouseenter={onSolEnter} on:mouseleave={onSolLeave}>
        <button
          class="h-14 px-3 inline-flex items-center text-sm font-medium text-[#1A1A1A] hover:text-[#6B6B6B] transition-colors"
          aria-haspopup="true"
          aria-expanded={solutionsOpen}
        >Solutions</button>
        {#if solutionsOpen}
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div
            class="absolute top-full mt-2 left-0 z-50"
            on:mouseenter={onSolEnter}
            on:mouseleave={onSolLeave}
          >
            <SolutionsDropdown />
          </div>
        {/if}
      </div>

      <!-- Resources -->
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div class="relative" on:mouseenter={onResEnter} on:mouseleave={onResLeave}>
        <button
          class="h-14 px-3 inline-flex items-center text-sm font-medium text-[#1A1A1A] hover:text-[#6B6B6B] transition-colors"
          aria-haspopup="true"
          aria-expanded={resourcesOpen}
        >Resources</button>
        {#if resourcesOpen}
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div
            class="absolute top-full mt-2 left-0 z-50"
            on:mouseenter={onResEnter}
            on:mouseleave={onResLeave}
          >
            <ResourcesDropdown />
          </div>
        {/if}
      </div>

      <!-- Events -->
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div class="relative" on:mouseenter={onEvtEnter} on:mouseleave={onEvtLeave}>
        <button
          class="h-14 px-3 inline-flex items-center text-sm font-medium text-[#1A1A1A] hover:text-[#6B6B6B] transition-colors"
          aria-haspopup="true"
          aria-expanded={eventsOpen}
        >Events</button>
        {#if eventsOpen}
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div
            class="absolute top-full mt-2 left-0 z-50"
            on:mouseenter={onEvtEnter}
            on:mouseleave={onEvtLeave}
          >
            <EventsDropdown />
          </div>
        {/if}
      </div>

      <!-- Business -->
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div class="relative" on:mouseenter={onBizEnter} on:mouseleave={onBizLeave}>
        <button
          class="h-14 px-3 inline-flex items-center text-sm font-medium text-[#1A1A1A] hover:text-[#6B6B6B] transition-colors"
          aria-haspopup="true"
          aria-expanded={businessOpen}
        >Business</button>
        {#if businessOpen}
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div
            class="absolute top-full mt-2 left-0 z-50"
            on:mouseenter={onBizEnter}
            on:mouseleave={onBizLeave}
          >
            <BusinessDropdown />
          </div>
        {/if}
      </div>
      <button
        class="h-14 px-3 inline-flex items-center text-sm font-medium text-[#1A1A1A] hover:text-[#6B6B6B] transition-colors"
        on:click={() => route.set('pricing')}
      >Pricing</button>
    </nav>

    <!-- Right actions -->
    <div class="hidden md:flex items-center gap-2">
      <button
        class="bg-black text-white rounded-full px-4 h-9 text-sm font-medium hover:bg-[#333] transition-colors"
        on:click={() => route.set('signin')}
      >Sign in</button>
      <button
        class="bg-white border border-[#E5E3DC] text-[#1A1A1A] rounded-full px-4 h-9 text-sm font-medium hover:bg-[#F5F4EF] transition-colors"
        on:click={() => route.set('signup')}
      >Sign up</button>
    </div>

  </div>
</header>
