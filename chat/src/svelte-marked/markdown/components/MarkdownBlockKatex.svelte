<script lang="ts">
	import katex from 'katex';

	export let token = undefined;

	$: html = katex.renderToString(token.text, { throwOnError: false, displayMode: token.displayMode }) + '\n';
</script>

{@html html}
