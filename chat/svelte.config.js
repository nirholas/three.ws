import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { fastDimension } from 'svelte-fast-dimension';

export default {
	preprocess: [vitePreprocess({}), fastDimension()],
};
