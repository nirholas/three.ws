import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import viteCompression from 'vite-plugin-compression';
import path from 'path';

export default defineConfig(function () {
	const buildTimestamp = new Date();
	return {
		base: '/chat/',
		build: {
			outDir: '../public/chat',
			emptyOutDir: true,
		},
		server: {
			// Forward /api requests to the 3D-Agent dev server (vercel dev on port 3000)
			proxy: {
				'/api': { target: 'http://localhost:3000', changeOrigin: true },
				'/avatars': { target: 'http://localhost:3000', changeOrigin: true },
			},
		},
		plugins: [
			svelte(),
			viteCompression({
				filter: /^(?!.*pdf\.worker\.min-[A-Z0-9]+\.mjs$).*\.(js|mjs|json|css|html)$/i,
			}),
		],
		resolve: {
			alias: {
				'$src': path.resolve(__dirname, './src'),
			}
		},
		define: {
			'import.meta.env.BUILD_TIMESTAMP': JSON.stringify(buildTimestamp.toLocaleString()),
		},
		optimizeDeps: {
			include: ['svelte-fast-dimension/action'],
		},
	};
});
