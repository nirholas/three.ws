import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import viteCompression from 'vite-plugin-compression';
import path from 'path';
import fs from 'fs';

const ROOT_PUBLIC = path.resolve(__dirname, '../public');
const DIST_LIB = path.resolve(__dirname, '../dist-lib');

function serveDevAssets() {
	return {
		name: 'serve-dev-assets',
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				if (!req.url) return next();
				const url = req.url.split('?')[0];
				let filePath = null;
				if (url.startsWith('/animations/')) {
					filePath = path.join(ROOT_PUBLIC, url);
				} else if (url.startsWith('/agent-3d/')) {
					const tail = url.replace(/^\/agent-3d\/(latest|\d+(\.\d+){0,2})\//, '');
					filePath = path.join(DIST_LIB, tail);
				} else if (url.startsWith('/avatars/')) {
					filePath = path.join(ROOT_PUBLIC, url);
				}
				if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
					const ext = path.extname(filePath).toLowerCase();
					const mime = {
						'.js': 'application/javascript',
						'.mjs': 'application/javascript',
						'.cjs': 'application/javascript',
						'.json': 'application/json',
						'.glb': 'model/gltf-binary',
						'.gltf': 'model/gltf+json',
						'.fbx': 'application/octet-stream',
						'.png': 'image/png',
						'.jpg': 'image/jpeg',
					}[ext] || 'application/octet-stream';
					res.setHeader('Content-Type', mime);
					res.setHeader('Access-Control-Allow-Origin', '*');
					fs.createReadStream(filePath).pipe(res);
					return;
				}
				next();
			});
		},
	};
}

export default defineConfig(function () {
	const buildTimestamp = new Date();
	return {
		base: '/chat/',
		build: {
			outDir: '../public/chat',
			emptyOutDir: true,
		},
		server: {
			proxy: {
				'/api': { target: 'http://localhost:3000', changeOrigin: true },
			},
		},
		plugins: [
			serveDevAssets(),
			svelte(),
			viteCompression({
				filter: /^(?!.*pdf\.worker\.min-[A-Z0-9]+\.mjs$).*\.(js|mjs|json|css|html)$/i,
			}),
		],
		resolve: {
			dedupe: ['three'],
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
