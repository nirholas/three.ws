import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { VitePWA } from 'vite-plugin-pwa';

// The build emits two targets controlled by the TARGET env var:
//
//   TARGET=lib    → builds dist-lib/agent-3d.js (ES module + UMD) for CDN use
//   TARGET=app    → (default) builds the editor/app site into dist/
//
//   npm run build        → app
//   npm run build:lib    → lib
//   npm run build:all    → both
const TARGET = process.env.TARGET || 'app';

const appConfig = {
	esbuild: {
		jsx: 'transform',
		jsxFactory: 'vhtml',
		jsxFragment: '"div"',
		jsxDev: false,
	},
	build: {
		chunkSizeWarningLimit: 1000,
		rollupOptions: {
			input: {
				main: resolve(__dirname, 'index.html'),
				app: resolve(__dirname, 'app.html'),
				features: resolve(__dirname, 'features.html'),
				embed: resolve(__dirname, 'embed.html'),
				create: resolve(__dirname, 'create.html'),
				'agent-home': resolve(__dirname, 'agent-home.html'),
				'agent-edit': resolve(__dirname, 'agent-edit.html'),
				'agent-embed': resolve(__dirname, 'agent-embed.html'),
				'a-embed': resolve(__dirname, 'a-embed.html'),
				studio: resolve(__dirname, 'public/studio/index.html'),
				reputation: resolve(__dirname, 'public/reputation/index.html'),
				hydrate: resolve(__dirname, 'public/hydrate/index.html'),
			},
		},
	},
	plugins: [
		{
			name: 'vercel-rewrites',
			configureServer(server) {
				const root = resolve(__dirname);
				const fileMap = {
					'/app': resolve(root, 'app.html'),
					'/login': resolve(root, 'public/login.html'),
					'/deploy': resolve(root, 'app.html'),
					'/explore': resolve(root, 'public/explore/index.html'),
					'/explore/': resolve(root, 'public/explore/index.html'),
					'/agents': resolve(root, 'public/agents/index.html'),
					'/agents/': resolve(root, 'public/agents/index.html'),
					'/features': resolve(root, 'features.html'),
					'/create': resolve(root, 'create.html'),
					'/dashboard': resolve(root, 'public/dashboard/index.html'),
					'/studio': resolve(root, 'public/studio/index.html'),
					'/widgets': resolve(root, 'public/widgets-gallery/index.html'),
					'/docs/widgets': resolve(root, 'public/docs-widgets.html'),
					'/cz': resolve(root, 'public/cz/index.html'),
					'/cz/': resolve(root, 'public/cz/index.html'),
					'/validation': resolve(root, 'public/validation/index.html'),
					'/validation/': resolve(root, 'public/validation/index.html'),
					'/reputation': resolve(root, 'public/reputation/index.html'),
					'/reputation/': resolve(root, 'public/reputation/index.html'),
					'/hydrate': resolve(root, 'public/hydrate/index.html'),
					'/hydrate/': resolve(root, 'public/hydrate/index.html'),
					'/agent': resolve(root, 'agent-home.html'),
				};
				server.middlewares.use(async (req, res, next) => {
					const path = (req.url || '/').split('?')[0];
					let filePath = fileMap[path];
					if (!filePath && /^\/agent\/[^/]+\/edit$/.test(path))
						filePath = resolve(root, 'agent-edit.html');
					else if (!filePath && /^\/agent\/[^/]+\/embed$/.test(path))
						filePath = resolve(root, 'agent-embed.html');
					else if (!filePath && /^\/agent\/[^/]+$/.test(path))
						filePath = resolve(root, 'agent-home.html');
					// /a/<chainId>/<agentId>/embed or /a/<chainId>/<registry>/<agentId>/embed  → iframe viewer
					else if (!filePath && /^\/a\/[^/]+(?:\/[^/]+){1,2}\/embed\/?$/.test(path))
						filePath = resolve(root, 'a-embed.html');
					// /a/<chainId>/<agentId>  or  /a/<chainId>/<registry>/<agentId>
					else if (!filePath && /^\/a\/[^/]+(?:\/[^/]+){1,2}\/?$/.test(path))
						filePath = resolve(root, 'app.html');
					if (!filePath) return next();
					try {
						const html = readFileSync(filePath, 'utf8');
						const transformed = await server.transformIndexHtml(req.url, html);
						res.setHeader('Content-Type', 'text/html; charset=utf-8');
						res.end(transformed);
					} catch {
						next();
					}
				});
			},
		},
		VitePWA({
			registerType: 'autoUpdate',
			includeAssets: ['favicon.ico', 'pwa-192x192.png', 'pwa-512x512.png', 'pwa-icon.svg'],
			manifest: {
				name: '3D Agent — AI-Powered 3D Model Viewer',
				short_name: '3D Agent',
				description:
					'Drag and drop glTF, GLB, and 3D files to preview instantly in your browser.',
				theme_color: '#000000',
				background_color: '#080814',
				display: 'standalone',
				scope: '/',
				start_url: '/',
				icons: [
					{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
					{ src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
					{
						src: 'pwa-512x512.png',
						sizes: '512x512',
						type: 'image/png',
						purpose: 'any maskable',
					},
				],
			},
			workbox: {
				globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
				runtimeCaching: [
					{
						urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
						handler: 'CacheFirst',
						options: {
							cacheName: 'google-fonts-cache',
							expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
							cacheableResponse: { statuses: [0, 200] },
						},
					},
					{
						urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
						handler: 'CacheFirst',
						options: {
							cacheName: 'gstatic-fonts-cache',
							expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
							cacheableResponse: { statuses: [0, 200] },
						},
					},
				],
			},
		}),
	],
};

// Library build — the web component + public API, for CDN drop-in:
//   <script type="module" src="https://cdn.example.com/agent-3d.js"></script>
//
// Three.js and ethers stay bundled (the element must be self-contained for a
// zero-install embed). Size will be ~600-900KB gzipped; split via dynamic
// imports in a later pass.
const libConfig = {
	build: {
		outDir: 'dist-lib',
		emptyOutDir: true,
		chunkSizeWarningLimit: 2000,
		lib: {
			entry: resolve(__dirname, 'src/lib.js'),
			name: 'Agent3D',
			formats: ['es', 'umd'],
			fileName: (format) => (format === 'es' ? 'agent-3d.js' : 'agent-3d.umd.cjs'),
		},
		rollupOptions: {
			// No externals — we want a self-contained drop-in embed.
			output: { inlineDynamicImports: false },
		},
	},
};

export default defineConfig(TARGET === 'lib' ? libConfig : appConfig);
