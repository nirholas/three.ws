<script>
	import { route } from '../stores.js';
	import Icon from '../Icon.svelte';
	import { feMenu, feX } from '../feather.js';
	import WalletConnect from '../WalletConnect.svelte';
	import NotificationBell from '../NotificationBell.svelte';
	import FeaturesDropdown  from './dropdowns/FeaturesDropdown.svelte';
	import ResourcesDropdown from './dropdowns/ResourcesDropdown.svelte';

	let featuresOpen  = false;
	let resourcesOpen = false;
	let mobileOpen    = false;

	const featOpen  = { value: null }; const featClose = { value: null };
	const resOpen   = { value: null }; const resClose  = { value: null };

	function onFeatEnter() { clearTimeout(featClose.value); featOpen.value  = setTimeout(() => (featuresOpen  = true),  120); }
	function onFeatLeave() { clearTimeout(featOpen.value);  featClose.value = setTimeout(() => (featuresOpen  = false), 200); }
	function onResEnter()  { clearTimeout(resClose.value);  resOpen.value   = setTimeout(() => (resourcesOpen = true),  120); }
	function onResLeave()  { clearTimeout(resOpen.value);   resClose.value  = setTimeout(() => (resourcesOpen = false), 200); }

	function closeAll() {
		featuresOpen = resourcesOpen = false;
	}

	let headerEl;
	function handleWindowClick(e) {
		if (headerEl && !headerEl.contains(e.target)) closeAll();
	}
</script>

<svelte:window on:click={handleWindowClick} />

<header bind:this={headerEl} class="sticky top-0 z-40 border-b border-rule bg-paper">
	<div class="mx-auto flex h-14 max-w-[1240px] items-center justify-between px-6">

		<!-- LEFT: logo + wordmark -->
		<button
			class="flex items-center gap-2 text-ink"
			on:click={() => route.set('chat')}
		>
			<img src="{import.meta.env.BASE_URL}three.svg" alt="three.ws" class="h-5 w-5" />
			<span class="font-serif text-[22px] font-semibold lowercase tracking-tight">three.ws</span>
		</button>

		<!-- CENTER: desktop nav -->
		<nav class="hidden items-center md:flex">

			<!-- Features -->
			<!-- svelte-ignore a11y-no-static-element-interactions -->
			<div class="relative" on:mouseenter={onFeatEnter} on:mouseleave={onFeatLeave}>
				<button
					class="inline-flex h-14 items-center px-3 text-sm font-medium text-ink transition-colors hover:text-ink-soft"
					aria-haspopup="true"
					aria-expanded={featuresOpen}
				>Features</button>
				{#if featuresOpen}
					<!-- svelte-ignore a11y-no-static-element-interactions -->
					<div class="absolute left-0 top-full z-50 mt-2"
						on:mouseenter={onFeatEnter} on:mouseleave={onFeatLeave}>
						<FeaturesDropdown />
					</div>
				{/if}
			</div>

			<!-- Resources -->
			<!-- svelte-ignore a11y-no-static-element-interactions -->
			<div class="relative" on:mouseenter={onResEnter} on:mouseleave={onResLeave}>
				<button
					class="inline-flex h-14 items-center px-3 text-sm font-medium text-ink transition-colors hover:text-ink-soft"
					aria-haspopup="true"
					aria-expanded={resourcesOpen}
				>Resources</button>
				{#if resourcesOpen}
					<!-- svelte-ignore a11y-no-static-element-interactions -->
					<div class="absolute left-0 top-full z-50 mt-2"
						on:mouseenter={onResEnter} on:mouseleave={onResLeave}>
						<ResourcesDropdown />
					</div>
				{/if}
			</div>

			<!-- Pricing -->
			<button
				class="inline-flex h-14 items-center px-3 text-sm font-medium text-ink transition-colors hover:text-ink-soft"
				on:click={() => route.set('pricing')}
			>Pricing</button>
		</nav>

		<!-- RIGHT: auth buttons + hamburger -->
		<div class="flex items-center gap-2">
			<div class="hidden items-center gap-2 md:flex">
				<NotificationBell />
				<WalletConnect />
			</div>
			<button
				class="rounded p-2 text-ink hover:bg-paper-deep md:hidden"
				aria-label="Toggle menu"
				on:click={() => (mobileOpen = !mobileOpen)}
			>
				<Icon icon={mobileOpen ? feX : feMenu} class="h-5 w-5" />
			</button>
		</div>
	</div>

	<!-- Mobile sheet -->
	{#if mobileOpen}
		<div class="border-t border-rule bg-paper md:hidden">
			{#each ['Features','Resources','Pricing'] as label}
				<button
					class="block w-full px-6 py-3 text-left text-sm font-medium text-ink hover:bg-paper-deep"
					on:click={() => { route.set(label.toLowerCase()); mobileOpen = false; }}
				>{label}</button>
			{/each}
			<div class="flex gap-2 px-6 py-4">
				<WalletConnect />
			</div>
		</div>
	{/if}
</header>

<style>
	:global(.manus-card) {
		background: #F5F4EF;
		border: 1px solid #E5E3DC;
		border-radius: 12px;
	}
</style>
