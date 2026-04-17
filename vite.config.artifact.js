import { defineConfig } from 'vite';
import { resolve } from 'path';

// Artifact bundle build — lightweight IIFE that loads three.js from CDN
export default defineConfig({
	build: {
		outDir: 'dist-artifact',
		emptyOutDir: true,
		lib: {
			entry: resolve(__dirname, 'src/artifact/entry.js'),
			name: 'Agent3DArtifact',
			formats: ['iife'],
			fileName: () => 'artifact.js',
		},
		rollupOptions: {
			output: {
				inlineDynamicImports: false,
			},
		},
		minify: 'terser',
		target: 'ES2020',
		chunkSizeWarningLimit: 500,
	},
});
