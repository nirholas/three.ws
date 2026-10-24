<script lang="ts">
	import { feX, feFileText } from '$src/feather';
	import Icon from '$src/Icon.svelte';


	interface Props {
		file: any;
		canDelete?: boolean;
		ondelete?: (...args: any[]) => void;
		onshowContents?: (...args: any[]) => void;
	}

	let { file, canDelete = false, ondelete, onshowContents }: Props = $props();
</script>

<div class="flex mb-2 items-center self-start gap-1.5 rounded-full border border-slate-200 bg-white pl-2.5 pr-3 py-1.5">
	{#if canDelete}
		<button
			onclick={() => {
				ondelete?.();
			}}
			class="flex h-4 w-4 rounded-full"
		>
			<Icon icon={feX} class="m-auto h-3.5 w-3.5 text-slate-600" />
		</button>
	{:else}
		<!-- If can not delete, then the action is to show file contents.	-->
		<button
			onclick={() => {
				onshowContents?.();
			}}
			class="flex h-4 w-4 rounded-full"
		>
			<Icon icon={feFileText} class="m-auto h-3.5 w-3.5 text-slate-600" />
		</button>
	{/if}
	<span class="text-xs text-black">{file.path.replace(/^.*[\/\\]/, '')}</span>
</div>
