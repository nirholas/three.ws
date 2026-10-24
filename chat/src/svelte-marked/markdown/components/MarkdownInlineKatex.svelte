<script lang="ts">
	import katex from 'katex';

	let { token = undefined } = $props();

	let html = $derived(katex.renderToString(token.text, { throwOnError: false, displayMode: token.displayMode }));
</script>

{@html html}
