<script>
	import { notifications } from './stores.js';
</script>

{#if $notifications.length > 0}
	<div class="fixed bottom-16 left-1/2 z-[200] flex -translate-x-1/2 flex-col gap-2">
		{#each $notifications as n (n.id)}
			<div class="rounded-lg px-4 py-2 text-sm text-white shadow-lg
				{n.type === 'error' ? 'bg-red-600' : 'bg-slate-800'}">
				{n.message}
			</div>
		{/each}
	</div>
{/if}
