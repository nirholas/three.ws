<script lang="ts">
	import { run } from 'svelte/legacy';

	import type { TokensList } from 'marked';

	import MarkdownTokens from './MarkdownTokens.svelte';
	import {
		defaultOptions,
		defaultRenderers,
		parse,
		type MarkdownOptions,
		type Renderers,
	} from './markedConfiguration';
	import { suppressWarnings } from './suppressWarnings';

	suppressWarnings();

	

	

	

	interface Props {
		/**
	 * The markdown source
	 */
		source: string;
		/**
	 * Options passed to markdown renderers
	 */
		options?: Partial<MarkdownOptions>;
		/**
	 * Optional renderers that can overwrite the default ones.
	 */
		renderers?: Partial<Renderers>;
		message: any;
	}

	let {
		source,
		options = {},
		renderers = {},
		message
	}: Props = $props();

	let tokens: TokensList = $state();
	let actualRenderers: Renderers = $state();
	let actualOptions: MarkdownOptions = $state();

	run(() => {
		// Only a single reactive block is needed here, so that changing the source
		// Will also re-create the options and renderers, so that a new Slugger is created
		tokens = parse(source);
		actualRenderers = { ...defaultRenderers(), ...renderers };
		actualOptions = { ...defaultOptions(), ...options };
	});
</script>

<MarkdownTokens {tokens} renderers={actualRenderers} options={actualOptions} {message} />
