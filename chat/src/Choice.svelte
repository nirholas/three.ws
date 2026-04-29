<script>
	import { fade } from 'svelte/transition';
	import Button from './Button.svelte';
	import { feCheck, feX } from './feather';
	import Icon from './Icon.svelte';

	export let choiceHandler;
	export let question = '';
	export let choices = [];
	export let chose = null;
</script>

<div class="mx-auto flex w-full max-w-[500px] flex-col">
	<h1 class="mb-6 text-center text-2xl font-semibold tracking-tight">Choose an option</h1>
	<p class="mb-8 text-center text-lg tracking-tight">
		{question}
	</p>
	<div
		class="{choices.length > 3
			? 'grid-cols-2'
			: 'grid-cols-1'} grid grid-flow-row auto-rows-fr gap-4"
	>
		{#each choices as choice, i}
			<Button
				variant="dark"
				disabled={chose !== null && chose !== i}
				class="{chose === i
					? 'ring-2 ring-slate-800 ring-offset-1'
					: ''} w-full !justify-center px-6 disabled:opacity-75 disabled:hover:bg-slate-800"
				on:click={() => {
					choiceHandler(choice);
					chose = i;
				}}
			>
				<div class="relative">
					{#if chose === i}
						<span
							in:fade={{ duration: 200 }}
							class="absolute top-1/2 -translate-y-1/2 translate-x-[calc(-100%-12px)]"
						>
							<Icon icon={feCheck} class="h-4 w-4" />
						</span>
					{/if}
					{choice}
				</div>
			</Button>
		{/each}
	</div>

	<Button
		class="{chose !== null ? 'invisible' : ''} mt-6 self-center"
		on:click={() => {
			choiceHandler(
				'User closed the prompt and refused to answer, do not prompt again unless explicitly asked.'
			);
			chose = -1;
		}}
	>
		<Icon icon={feX} class="mr-2 h-3.5 w-3.5" />
		Cancel choice
	</Button>
</div>
