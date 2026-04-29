import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync, cpSync } from 'fs';
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
	resolve: {
		// Force a single Three.js instance — addons (GLTFLoader, OrbitControls,
		// etc.) must share the same `three` module as the app, otherwise
		// Three's module-scoped registry warns "Multiple instances of Three.js".
		dedupe: ['three'],
	},
	build: {
		chunkSizeWarningLimit: 1000,
		rollupOptions: {
			input: {
				main: resolve(__dirname, 'index.html'),
				app: resolve(__dirname, 'app.html'),
				home: resolve(__dirname, 'home.html'),
				embed: resolve(__dirname, 'embed.html'),
				create: resolve(__dirname, 'create.html'),
				'agent-home': resolve(__dirname, 'agent-home.html'),
				marketplace: resolve(__dirname, 'marketplace.html'),
				'agent-edit': resolve(__dirname, 'agent-edit.html'),
				'agent-embed': resolve(__dirname, 'agent-embed.html'),
				'a-embed': resolve(__dirname, 'a-embed.html'),
				studio: resolve(__dirname, 'public/studio/index.html'),
				features: resolve(__dirname, 'public/features/index.html'),
				reputation: resolve(__dirname, 'public/reputation/index.html'),
				hydrate: resolve(__dirname, 'public/hydrate/index.html'),
				// BEGIN:DISCOVER_ROUTE
				'my-agents': resolve(__dirname, 'public/my-agents/index.html'),
				discover: resolve(__dirname, 'public/discover/index.html'),
				// END:DISCOVER_ROUTE
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
					'/agents': resolve(root, 'public/agents/index.html'),
					'/agents/': resolve(root, 'public/agents/index.html'),
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
					// BEGIN:DISCOVER_ROUTE
					'/my-agents': resolve(root, 'public/my-agents/index.html'),
					'/my-agents/': resolve(root, 'public/my-agents/index.html'),
					'/discover': resolve(root, 'public/discover/index.html'),
					'/discover/': resolve(root, 'public/discover/index.html'),
					'/marketplace': resolve(root, 'marketplace.html'),
					'/marketplace/': resolve(root, 'marketplace.html'),
					'/explore': resolve(root, 'public/discover/index.html'),
					'/explore/': resolve(root, 'public/discover/index.html'),
					// END:DISCOVER_ROUTE
					'/features': resolve(root, 'public/features/index.html'),
					'/features/': resolve(root, 'public/features/index.html'),
					'/': resolve(root, 'home.html'),
					'/home': resolve(root, 'home.html'),
					'/agent': resolve(root, 'agent-home.html'),
					'/docs': resolve(root, 'docs/index.html'),
					'/docs/': resolve(root, 'docs/index.html'),
				};
				// Routes that resolve to public/<dir>/index.html — these need a
				// trailing slash so relative imports (./foo.js) inside the HTML
				// resolve to /<dir>/foo.js rather than /foo.js at the root.
				const dirRoutes = new Set([
					'/agents',
					'/dashboard',
					'/studio',
					'/widgets',
					'/cz',
					'/validation',
					'/reputation',
					'/hydrate',
					'/my-agents',
					'/discover',
					'/features',
					'/docs',
				]);
				server.middlewares.use(async (req, res, next) => {
					const url = req.url || '/';
					// Don't intercept Vite's internal html-proxy / module requests —
					// it needs to serve the inline-script content for our HTML.
					if (url.includes('html-proxy') || url.includes('@id/') || url.includes('@vite/'))
						return next();
					const path = url.split('?')[0];
					if (dirRoutes.has(path)) {
						res.statusCode = 301;
						res.setHeader('Location', path + '/' + (req.url.slice(path.length) || ''));
						return res.end();
					}
					// /explore is an alias for /discover — share the same JS bundle
					if (path === '/explore' || path === '/explore/') {
						res.statusCode = 301;
						res.setHeader('Location', '/discover/');
						return res.end();
					}
					let filePath = fileMap[path];
					if (!filePath && /^\/marketplace\/agents\/[^/]+\/?$/.test(path))
						filePath = resolve(root, 'marketplace.html');
					else if (!filePath && /^\/agent\/[^/]+\/edit$/.test(path))
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
						// Use the file's path-relative URL (not req.url) so Vite can
						// resolve html-proxy modules (inline <script type="module">)
						// back to a real file. Otherwise virtual module IDs derived
						// from req.url (e.g. /agent/0xfoo) 500 because nothing on
						// disk matches.
						// Use the file's path-relative URL (not req.url) so Vite can
						// resolve html-proxy modules (inline <script type="module">)
						// back to a real file. Otherwise virtual module IDs derived
						// from req.url (e.g. /agent/0xfoo) 500 because nothing on
						// disk matches. Files in /public stay on req.url since they
						// can't be import-analyzed by Vite anyway.
						const rel = filePath.slice(root.length + 1).replace(/\\/g, '/');
						const fileUrl = rel.startsWith('public/') ? url : '/' + rel;
						const transformed = await server.transformIndexHtml(fileUrl, html);
						res.setHeader('Content-Type', 'text/html; charset=utf-8');
						res.end(transformed);
					} catch {
						next();
					}
				});
			},
		},
		{
			name: 'copy-static-docs',
			closeBundle() {
				cpSync(resolve(__dirname, 'docs'), resolve(__dirname, 'dist/docs'), {
					recursive: true,
				});
			},
		},
		VitePWA({
			registerType: 'autoUpdate',
			includeAssets: ['favicon.ico', 'pwa-192x192.png', 'pwa-512x512.png', 'pwa-icon.svg'],
			manifest: {
				name: 'three.ws — AI-Powered 3D Model Viewer',
				short_name: 'three.ws',
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
				maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
				globPatterns: ['**/*.{js,css,html,ico,woff2}'],
				globIgnores: [
					'**/animations/**',
					'**/avatars/**',
					'**/screenshots/**',
					'**/docs/**',
					'**/og-image.*',
					'**/three.svg',
					'**/3d.png',
					'**/ddd.png',
					'**/skills.mp4',
				],
				navigateFallback: null,
				skipWaiting: true,
				clientsClaim: true,
				cleanupOutdatedCaches: true,
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
			// inlineDynamicImports must be true: UMD output is incompatible
			// with code-splitting, and the lib is meant to be a single drop-in
			// bundle anyway. Splitting can come later via a separate ES-only
			// build target.
			output: { inlineDynamicImports: true },
		},
	},
};

export default defineConfig(TARGET === 'lib' ? libConfig : appConfig);
