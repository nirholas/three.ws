<script>
	import { createEventDispatcher } from 'svelte';
	import Button from './Button.svelte';
	import Icon from './Icon.svelte';
	import { feCheck, fePlus, feTrash } from './feather.js';

	const dispatch = createEventDispatcher();

	let viewingUI = true;

	let toolDefinition = {
		name: '',
		description: '',
		arguments: [
			{
				name: '',
				type: 'string',
				description: '',
			},
		],
		body: '',
	};
	export function load(definition) {
		toolDefinition = structuredClone(definition);
	}

	function convertFunctionFormat(inputObj) {
		// Create the base structure of the output object
		const outputObj = {
			clientDefinition: inputObj,
			type: 'function',
			function: {
				name: inputObj.name,
				description: inputObj.description,
				parameters: {
					type: 'object',
					properties: {},
					required: [],
				},
			},
		};

		// Process each argument from the input
		inputObj.arguments.forEach((arg) => {
			// Add the argument as a property
			outputObj.function.parameters.properties[arg.name] = {
				...getValidType(arg.type),
				description: arg.description,
			};

			// Add the argument name to the required array
			outputObj.function.parameters.required.push(arg.name);
		});

		return outputObj;
	}

	// Helper function to ensure we only use valid types
	function getValidType(type) {
		const validTypes = ['number', 'string', 'string_array', 'number_array', 'object'];
		if (!validTypes.includes(type.toLowerCase())) {
			return { type: 'string' };
		}

		// Check for "_array" suffix
		if (type.toLowerCase().endsWith('_array')) {
			return {
				type: 'array',
				items: {
					type: type.replace('_array', ''),
				},
			};
		}

		return { type: type.toLowerCase() };
	}
</script>

<div class="mb-4 flex items-center gap-8 sm:mb-5">
	<h1 class="text-xl font-semibold">Client-side tool</h1>
	<button
		on:click={(event) => {
			event.stopPropagation();
			viewingUI = !viewingUI;
		}}
		class="flex whitespace-nowrap rounded-full border border-slate-200 px-3 py-1 text-[10px] font-medium transition-colors hover:bg-gray-100 md:text-xs"
	>
		{#if viewingUI}
			View as code
		{:else}
			View as UI
		{/if}
	</button>
</div>

{#if viewingUI}
	<div class="flex flex-col items-start gap-y-3">
		<label class="flex flex-col text-[10px] uppercase tracking-wide">
			<span class="mb-2 ml-[3px]">Tool name:</span>
			<input
				type="text"
				bind:value={toolDefinition.name}
				class="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 transition-colors placeholder:text-gray-500 focus:border-slate-400 focus:outline-none"
			/></label
		>

		<label class="flex flex-col text-[10px] uppercase tracking-wide sm:w-[400px]">
			<span class="mb-2 ml-[3px]">Tool description:</span>
			<textarea
				bind:value={toolDefinition.description}
				rows={3}
				class="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 transition-colors placeholder:text-gray-500 focus:border-slate-400 focus:outline-none"
			/></label
		>

		<p class="ml-[3px] mt-2 text-[10px] uppercase tracking-wide">Arguments:</p>
		<div class="mb-3 flex w-full flex-col gap-y-3">
			{#each toolDefinition.arguments as argument, i}
				<div class="flex w-full flex-col gap-3 md:flex-row">
					<label class="flex w-full flex-col text-[10px] uppercase tracking-wide">
						<span class="mb-2 ml-[3px]">Name:</span>
						<input
							type="text"
							bind:value={argument.name}
							class="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 transition-colors placeholder:text-gray-500 focus:border-slate-400 focus:outline-none"
						/></label
					>
					<label class="flex w-[180px] shrink-0 flex-col text-[10px] uppercase tracking-wide">
						<span class="mb-2 ml-[3px]">Type:</span>
						<select
							bind:value={argument.type}
							class="appearance-none rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 transition-colors placeholder:text-gray-500 focus:border-slate-400 focus:outline-none"
						>
							<option value="string">String</option>
							<option value="number">Number</option>
							<option value="string_array">Array of Strings</option>
							<option value="number_array">Array of Numbers</option>
						</select>
					</label>
					<label class="flex w-full flex-col text-[10px] uppercase tracking-wide">
						<span class="mb-2 ml-[3px]">Description:</span>
						<input
							type="text"
							bind:value={argument.description}
							class="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 transition-colors placeholder:text-gray-500 focus:border-slate-400 focus:outline-none"
						/></label
					>
					<Button
						variant="outline"
						class="h-[38px] w-[38px] shrink-0 self-end rounded-lg"
						on:click={() => {
							toolDefinition.arguments.splice(i, 1);
							toolDefinition.arguments = toolDefinition.arguments;
						}}
					>
						<Icon icon={feTrash} class="h-4 w-4 text-slate-500" />
					</Button>
				</div>
			{:else}
				<p class="text-sm">No arguments.</p>
			{/each}
			<Button
				class="mt-1 self-start px-5"
				on:click={() => {
					toolDefinition.arguments = [
						...toolDefinition.arguments,
						{ name: '', type: 'string', description: '' },
					];
				}}
			>
				<Icon icon={fePlus} strokeWidth={3} class="mr-2 h-3 w-3 text-slate-700" />
				Add argument
			</Button>
		</div>
		<label class="flex w-full flex-col text-[10px] uppercase tracking-wide">
			<span class="mb-2 ml-[3px]">Function body:</span>
			<textarea
				bind:value={toolDefinition.body}
				rows={6}
				class="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-800 transition-colors placeholder:text-gray-500 focus:border-slate-400 focus:outline-none"
				on:keydown={(event) => {
					if (event.key == 'Tab') {
						event.preventDefault();
						var start = event.target.selectionStart;
						var end = event.target.selectionEnd;

						// set textarea value to: text before caret + tab + text after caret
						event.target.value =
							event.target.value.substring(0, start) + '\t' + event.target.value.substring(end);

						// put caret at right position again
						event.target.selectionStart = event.target.selectionEnd = start + 1;
					}
				}}
			/></label
		>
	</div>
{:else}
	<textarea
		value={JSON.stringify(toolDefinition, null, 2)}
		on:change={(event) => {
			try {
				toolDefinition = JSON.parse(event.target.value);
			} catch (error) {
				console.error(error);
			}
		}}
		class="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-800 transition-colors placeholder:text-gray-500 focus:border-slate-400 focus:outline-none"
		rows={14}
	/>
{/if}

<Button
	class="ml-auto mt-5 !px-6"
	on:click={() => {
		dispatch('save', convertFunctionFormat(toolDefinition));
	}}
>
	<Icon icon={feCheck} strokeWidth={3} class="mr-2 h-3 w-3 text-slate-700" />
	Save
</Button>
