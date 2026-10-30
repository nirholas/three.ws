<script lang="ts">
	
	import { scale } from 'svelte/transition';
	import { cubicIn } from 'svelte/easing';
	import FileTreeNode from './FileTreeNode.svelte';


	interface Props {
		open?: boolean;
		tree: any;
		selectedFiles?: any;
		onfileSelected?: (...args: any[]) => void;
		onfileDeselected?: (...args: any[]) => void;
	}

	let { open = $bindable(false), tree, selectedFiles = $bindable([]), onfileSelected, onfileDeselected }: Props = $props();

	// For keeping track of collapsed state of directories
	let collapsed = $state({});

	// For search functionality
	let searchTerm = $state('');
	let debouncedSearchTerm = '';
	let debounceTimeout;

	let inputEl = $state();

	$effect.pre(() => {
		if (open && inputEl) {
			inputEl.focus();
		}
	});

	// Clear all selections
	function clearSelections() {
		selectedFiles = [];
	}

	// Handle search input with debounce
	function updateSearch(event) {
		searchTerm = event.target.value;
	}

	// Advanced fuzzy search that scores matches based on type and position
	function fuzzySearch(name, term) {
		if (!term) return { match: true, score: 1 };
		if (!name) return { match: false, score: 0 };

		const nameLower = name.toLowerCase();
		const termLower = term.toLowerCase();

		// Exact match gets highest score
		if (nameLower === termLower) {
			return { match: true, score: 1 };
		}

		// Starts with gets high score
		if (nameLower.startsWith(termLower)) {
			return { match: true, score: 0.9 };
		}

		// Contains as a substring gets medium score
		if (nameLower.includes(termLower)) {
			return { match: true, score: 0.7 };
		}

		// Contains all characters in sequence but not contiguously
		let nameIndex = 0;
		let termIndex = 0;

		while (nameIndex < nameLower.length && termIndex < termLower.length) {
			if (nameLower[nameIndex] === termLower[termIndex]) {
				termIndex++;
			}
			nameIndex++;
		}

		if (termIndex === termLower.length) {
			// Score based on how much of the name matches
			const nameRatio = termLower.length / nameLower.length;
			return { match: true, score: 0.4 + 0.1 * nameRatio };
		}

		return { match: false, score: 0 };
	}

	// Function to filter the tree based on search term
	function filterTree(node, term) {
		if (!term) return { ...node };
		if (!node) return null;

		// Check if the current node's name matches the search term
		const { match: nodeMatches, score: nodeScore } = fuzzySearch(node.name || '', term);

		// If this is a leaf node (file)
		if (!node.children) {
			return nodeMatches ? { ...node, _searchScore: nodeScore } : null;
		}

		// For directories, filter children and include if any children match or if the directory itself matches
		const filteredChildren = node.children.map((child) => filterTree(child, term)).filter(Boolean);

		if (nodeMatches || filteredChildren.length > 0) {
			// Sort children by search score if we're searching
			if (term && filteredChildren.length > 1) {
				filteredChildren.sort((a, b) => (b._searchScore || 0) - (a._searchScore || 0));
			}

			return {
				...node,
				children: filteredChildren,
				_searchScore: nodeMatches
					? nodeScore
					: Math.max(...filteredChildren.map((c) => c._searchScore || 0)) * 0.9,
			};
		}

		return null;
	}

	// When search term changes, filter the tree
	let filteredTree = $derived(tree && filterTree(tree, searchTerm));

	// When searching, expand directories that contain matches
	$effect.pre(() => {
		if (searchTerm && filteredTree) {
			// Reset collapsed state when search term changes
			collapsed = {};
		}
	});
</script>

<svelte:window
	onclick={(event) => {
		if (!event.target.closest('#files-dropdown')) {
			open = false;
		}
	}}
	ontouchstart={(event) => {
		if (!event.target.closest('#files-dropdown')) {
			open = false;
		}
	}}
/>

{#if open && tree}
	<div
		id="files-dropdown"
		class="absolute bottom-10 left-0 z-10 flex w-max rounded-[10px]"
	>
		<div
			transition:scale={{ opacity: 0, start: 0.98, duration: 100, easing: cubicIn }}
			class="flex h-auto w-auto min-w-[250px] flex-col self-start overflow-y-auto rounded-lg border border-slate-300 bg-white"
		>
			<div class="w-full px-3 pb-2 pt-2.5">
				<div class="mb-1 flex items-center justify-between">
					<h3 class="text-sm font-medium text-slate-800">Files</h3>
					<button class="text-xs text-gray-600 hover:text-gray-800" onclick={clearSelections}>
						Unselect all
					</button>
				</div>
				<input
					bind:this={inputEl}
					type="text"
					value={searchTerm}
					oninput={updateSearch}
					onkeydown={(event) => {
						if (event.key === 'Enter') {
							const firstFilteredFile = filteredTree?.children?.[0];
							if (firstFilteredFile) {
								onfileSelected?.(firstFilteredFile)
							}
						}
					}}
					placeholder="Search for files"
					class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 transition-colors placeholder:text-gray-500 focus:border-slate-400 focus:outline-hidden"
				/>
			</div>
			<ul class="max-h-[300px] overflow-y-auto pb-1.5 scrollbar-ultraslim">
				{#if filteredTree && (!searchTerm || filteredTree.children?.length > 0 || fuzzySearch(filteredTree.name || '', searchTerm).match)}
					<FileTreeNode
						item={filteredTree}
						level={0}
						{collapsed}
						bind:selectedFiles
						{onfileSelected}
						{onfileDeselected}
					/>
				{:else if searchTerm}
					<li class="px-4 py-2 text-xs text-gray-500">No matching files found</li>
				{/if}
			</ul>
		</div>
	</div>
{/if}
