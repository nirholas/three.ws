<script>
	import { route } from '../stores.js';
	import Icon from '../Icon.svelte';
	import { feMenu, feX } from '../feather.js';
	import WalletConnect from '../WalletConnect.svelte';
	import NotificationBell from '../NotificationBell.svelte';

	let mobileOpen = false;
</script>

<header class="sticky top-0 z-40 border-b border-rule bg-paper">
	<div class="mx-auto flex h-14 max-w-[1240px] items-center justify-between px-6">

		<!-- LEFT: logo + wordmark -->
		<button
			class="flex items-center gap-2 text-ink"
			on:click={() => route.set('chat')}
		>
			<img src="{import.meta.env.BASE_URL}three.svg" alt="three.ws" class="h-5 w-5" />
			<span class="font-serif text-[22px] font-semibold lowercase tracking-tight">three.ws</span>
		</button>

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
			<div class="flex gap-2 px-6 py-4">
				<WalletConnect />
			</div>
		</div>
	{/if}
</header>

<style>
	:global(.three-ui-card) {
		background: #F5F4EF;
		border: 1px solid #E5E3DC;
		border-radius: 12px;
	}
</style>
