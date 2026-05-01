<script>
	import { onMount } from 'svelte';
	import { currentUser } from './stores.js';
	import Icon from './Icon.svelte';
	import { feBell } from './feather.js';

	let notifications = [];
	let unreadCount = 0;
	let open = false;
	let loading = false;
	let el;

	async function fetchNotifications() {
		if (!$currentUser) return;
		try {
			const res = await fetch('/api/notifications', { credentials: 'include' });
			if (!res.ok) return;
			const data = await res.json();
			notifications = data.notifications ?? [];
			unreadCount = data.unread_count ?? 0;
		} catch {
			// silent
		}
	}

	async function markAllRead() {
		try {
			await fetch('/api/notifications/read-all', { method: 'POST', credentials: 'include' });
			notifications = notifications.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() }));
			unreadCount = 0;
		} catch {
			// silent
		}
	}

	function toggle() {
		open = !open;
		if (open) fetchNotifications();
	}

	function handleWindowClick(e) {
		if (el && !el.contains(e.target)) open = false;
	}

	function formatPayload(n) {
		if (n.type === 'payment_received') {
			const amt = (n.payload.net_amount / 1_000_000).toFixed(2);
			return `${n.payload.agent_name ?? 'Agent'} received ${amt} USDC for ${n.payload.skill}`;
		}
		if (n.type === 'withdrawal_completed') {
			const amt = (n.payload.amount / 1_000_000).toFixed(2);
			return `Withdrawal of ${amt} USDC sent`;
		}
		if (n.type === 'withdrawal_failed') {
			const amt = (n.payload.amount / 1_000_000).toFixed(2);
			return `Withdrawal of ${amt} USDC failed`;
		}
		return n.type;
	}

	function formatTime(iso) {
		const d = new Date(iso);
		const now = new Date();
		const diffMs = now - d;
		const diffMin = Math.floor(diffMs / 60000);
		if (diffMin < 1) return 'just now';
		if (diffMin < 60) return `${diffMin}m ago`;
		const diffH = Math.floor(diffMin / 60);
		if (diffH < 24) return `${diffH}h ago`;
		return d.toLocaleDateString();
	}

	onMount(() => {
		fetchNotifications();
		const interval = setInterval(() => {
			if (!open && $currentUser) fetchNotifications();
		}, 60_000);
		return () => clearInterval(interval);
	});
</script>

<svelte:window on:click={handleWindowClick} on:focus={() => { if ($currentUser) fetchNotifications(); }} />

{#if $currentUser}
<div class="relative" bind:this={el}>
	<button
		class="relative rounded p-2 text-ink hover:bg-paper-deep"
		aria-label="Notifications"
		on:click={toggle}
	>
		<Icon icon={feBell} class="h-5 w-5" />
		{#if unreadCount > 0}
			<span class="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
				{unreadCount > 9 ? '9+' : unreadCount}
			</span>
		{/if}
	</button>

	{#if open}
		<div class="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border border-rule bg-paper shadow-lg">
			<div class="flex items-center justify-between border-b border-rule px-4 py-2">
				<span class="text-sm font-semibold text-ink">Notifications</span>
				{#if unreadCount > 0}
					<button
						class="text-xs text-ink-soft hover:text-ink"
						on:click={markAllRead}
					>Mark all read</button>
				{/if}
			</div>

			{#if notifications.length === 0}
				<p class="px-4 py-6 text-center text-sm text-ink-soft">No notifications yet</p>
			{:else}
				<ul class="max-h-72 overflow-y-auto">
					{#each notifications as n (n.id)}
						<li class="border-b border-rule last:border-0 {n.read_at ? 'opacity-60' : ''}">
							<div class="flex items-start gap-2 px-4 py-3">
								{#if !n.read_at}
									<span class="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500"></span>
								{:else}
									<span class="mt-1.5 h-2 w-2 shrink-0"></span>
								{/if}
								<div class="min-w-0">
									<p class="text-sm text-ink">{formatPayload(n)}</p>
									<p class="text-xs text-ink-soft">{formatTime(n.created_at)}</p>
								</div>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>
{/if}
