<script>
	import { params, activeAgent } from './stores.js';
	import { t } from './i18n.js';
	import KnowledgeBasePanel from './KnowledgeBasePanel.svelte';

	export let knobsOpen = false;
	export let db = null;
</script>

<aside
	data-sidebar="knobs"
	class="{knobsOpen
		? ''
		: 'translate-x-full'} fixed right-0 top-0 z-[100] flex h-full w-[230px] flex-col gap-2 border-l border-slate-200 bg-white px-3 py-4 transition-transform ease-in-out duration-500"
>
	<label class="mb-4 flex flex-col text-[10px] uppercase tracking-wide">
		<div class="mb-2 ml-[3px] flex items-baseline">
			<span>{$t('temperature')}</span>
			<span class="ml-auto">{$params.temperature}</span>
		</div>
		<input
			type="range"
			min={0}
			max={2}
			bind:value={$params.temperature}
			step={0.1}
			class="appearance-none overflow-hidden rounded-full border border-slate-300
				[&::-webkit-slider-runnable-track]:h-2.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-slate-100
				[&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
			[&::-webkit-slider-thumb]:bg-slate-700 [&::-webkit-slider-thumb]:shadow-[-407px_0_0_404px_theme('colors.slate.200')]"
		/>
	</label>

	<label class="mb-4 flex flex-col text-[10px] uppercase tracking-wide">
		<div class="mb-2 ml-[3px] flex items-baseline">
			<span>{$t('maxTokens')}</span>
		</div>
		<input
			type="number"
			min={0}
			bind:value={$params.maxTokens}
			class="rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-800 transition-colors placeholder:text-gray-500 focus:border-slate-400 focus:outline-none"
		/>
	</label>

	<label class="mb-4 flex flex-col text-[10px] uppercase tracking-wide">
		<div class="mb-2 ml-[3px] flex items-baseline">
			<span>{$t('messageHistoryLimit')}</span>
		</div>
		<input
			type="number"
			min={0}
			bind:value={$params.messagesContextLimit}
			class="rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-800 transition-colors placeholder:text-gray-500 focus:border-slate-400 focus:outline-none"
		/>
	</label>

	<label class="mb-4 flex flex-col text-[10px] uppercase tracking-wide">
		<div class="mb-2 ml-[3px] flex items-baseline">
			<span>{$t('reasoningEffort')}</span>
			<span class="ml-auto">{$params.reasoningEffort['low-medium-high']}</span>
		</div>
		<select
			bind:value={$params.reasoningEffort['low-medium-high']}
			class="rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-800 transition-colors focus:border-slate-400 focus:outline-none"
		>
			<option value="low">Low</option>
			<option value="medium">Medium</option>
			<option value="high">High</option>
		</select>
	</label>

	<label class="mb-4 flex flex-col text-[10px] uppercase tracking-wide">
		<div class="mb-2 ml-[3px] flex items-baseline">
			<span>Thinking Tokens</span>
			<span class="ml-auto">{$params.reasoningEffort['range'] === 0 ? 'off' : $params.reasoningEffort['range']}</span>
		</div>
		<input
			type="range"
			min={0}
			max={64000}
			step={1000}
			bind:value={$params.reasoningEffort['range']}
			class="appearance-none overflow-hidden rounded-full border border-slate-300
				[&::-webkit-slider-runnable-track]:h-2.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-slate-100
				[&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
			[&::-webkit-slider-thumb]:bg-slate-700 [&::-webkit-slider-thumb]:shadow-[-407px_0_0_404px_theme('colors.slate.200')]"
		/>
	</label>

	{#if $activeAgent && db}
		<div class="mt-2 border-t border-slate-100 pt-4">
			<KnowledgeBasePanel {db} />
		</div>
	{/if}
</aside>
