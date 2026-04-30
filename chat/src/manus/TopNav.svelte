<script>
  import { route } from '../stores.js';
  import FeaturesDropdown from './dropdowns/FeaturesDropdown.svelte';
  import SolutionsDropdown from './dropdowns/SolutionsDropdown.svelte';

  let featuresOpen = false;
  let solutionsOpen = false;

  let featuresOpenTimer = null;
  let featuresCloseTimer = null;
  let solutionsOpenTimer = null;
  let solutionsCloseTimer = null;

  function makeHover(getOpen, setOpen, openTimer, closeTimer) {
    return {
      enter() {
        clearTimeout(closeTimer.value);
        openTimer.value = setTimeout(() => setOpen(true), 120);
      },
      leave() {
        clearTimeout(openTimer.value);
        closeTimer.value = setTimeout(() => setOpen(false), 200);
      },
    };
  }

  const featOpen  = { value: null };
  const featClose = { value: null };
  const solOpen   = { value: null };
  const solClose  = { value: null };

  function onFeatEnter()  { clearTimeout(featClose.value); featOpen.value  = setTimeout(() => (featuresOpen  = true),  120); }
  function onFeatLeave()  { clearTimeout(featOpen.value);  featClose.value = setTimeout(() => (featuresOpen  = false), 200); }
  function onSolEnter()   { clearTimeout(solClose.value);  solOpen.value   = setTimeout(() => (solutionsOpen = true),  120); }
  function onSolLeave()   { clearTimeout(solOpen.value);   solClose.value  = setTimeout(() => (solutionsOpen = false), 200); }
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

      <!-- Stub triggers for Resources / Events / Business -->
      <button class="h-14 px-3 inline-flex items-center text-sm font-medium text-[#1A1A1A] hover:text-[#6B6B6B] transition-colors">Resources</button>
      <button class="h-14 px-3 inline-flex items-center text-sm font-medium text-[#1A1A1A] hover:text-[#6B6B6B] transition-colors">Events</button>
      <button class="h-14 px-3 inline-flex items-center text-sm font-medium text-[#1A1A1A] hover:text-[#6B6B6B] transition-colors">Business</button>
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
