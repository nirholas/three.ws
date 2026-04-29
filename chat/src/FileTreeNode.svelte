<script>
	import { slide } from 'svelte/transition';
	import Checkbox from './Checkbox.svelte';
	import Icon from './Icon.svelte';
	import { feChevronDown } from './feather.js';
	import { createEventDispatcher } from 'svelte';

	const dispatch = createEventDispatcher();

	export let item;
	export let level = 0;
	export let collapsed = {};
	export let selectedFiles = [];

	// Helper function to get all files in a directory
	function getAllFiles(dir) {
		let files = [];
		if (dir.children) {
			for (const child of dir.children) {
				if (child.isDir) {
					files = files.concat(getAllFiles(child));
				} else {
					files.push(child);
				}
			}
		}
		return files;
	}

	// Helper function to check if a file is selected
	function isFileSelected(selectedFiles, path) {
		return selectedFiles.includes(path);
	}

	// Helper function to check if a directory is fully selected
	function isDirFullySelected(selectedFiles, dir) {
		const allFiles = getAllFiles(dir);
		return (
			allFiles.length > 0 && allFiles.every((file) => isFileSelected(selectedFiles, file.path))
		);
	}

	// Helper function to toggle directory selection
	function toggleDir(dir, nowEnabled) {
		const files = getAllFiles(dir);

		if (nowEnabled) {
			// Select all files
			const filePaths = files.map((file) => file.path);

			for (const path of filePaths) {
				if (!selectedFiles.includes(path)) {
					selectedFiles = [...selectedFiles, path];
					dispatch('fileSelected', { path });
				}
			}
		} else {
			// Identify files that are about to be deselected
			const pathsToDeselect = selectedFiles.filter((path) =>
				files.some((file) => file.path === path)
			);

			// Deselect all files
			selectedFiles = selectedFiles.filter((path) => !files.some((file) => file.path === path));

			// Dispatch events for deselected files
			for (const path of pathsToDeselect) {
				dispatch('fileDeselected', { path });
			}
		}
	}

	// Helper function to toggle file selection
	function toggleFile(path, nowEnabled) {
		if (nowEnabled) {
			selectedFiles = [...selectedFiles, path];
			dispatch('fileSelected', { path });
		} else {
			selectedFiles = selectedFiles.filter((p) => p !== path);
			dispatch('fileDeselected', { path });
		}
	}
</script>

{#if item.isDir}
	<div class="relative w-full">
		<label
			style="padding-left: {12 + level * 16}px"
			class="flex w-full items-center gap-x-3 whitespace-nowrap py-2 pr-3 text-left text-xs transition-colors hover:bg-gray-100"
		>
			<Checkbox
				checked={isDirFullySelected(selectedFiles, item)}
				on:change={() => {
					toggleDir(item, !isDirFullySelected(selectedFiles, item));
				}}
			/>
			<p class="w-full text-xs font-semibold text-slate-800">{item.name}</p>
		</label>

		<button
			on:click={() => (collapsed[item.path] = !collapsed[item.path])}
			class="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 rounded-full transition-colors hover:bg-gray-100"
		>
			<Icon
				icon={feChevronDown}
				class="{collapsed[item.path]
					? ''
					: 'rotate-180'} m-auto h-4 w-4 text-slate-600 transition-transform"
			/>
		</button>
	</div>

	{#if !collapsed[item.path]}
		<div transition:slide={{ duration: 300 }}>
			{#each item.children as child}
				<svelte:self item={child} level={level + 1} {collapsed} bind:selectedFiles on:fileSelected on:fileDeselected />
			{/each}
		</div>
	{/if}
{:else}
	<div class="flex w-full">
		<label
			style="padding-left: {12 + level * 16}px"
			class="flex w-full items-center gap-x-3 whitespace-nowrap py-2 pr-3 text-left text-xs transition-colors hover:bg-gray-100"
		>
			<Checkbox
				checked={isFileSelected(selectedFiles, item.path)}
				on:change={() => {
					toggleFile(item.path, !isFileSelected(selectedFiles, item.path));
				}}
			/>
			<p class="w-full text-xs font-medium text-slate-800">
				{item.name}
			</p>
		</label>
	</div>
{/if}
