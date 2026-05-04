import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync, cpSync, createReadStream, existsSync, statSync } from 'fs';
import { execSync } from 'child_process';
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
// FAST_BUILD=1: build only the two critical entries so the local done-gate
// check passes on memory-constrained machines (Codespaces, etc.).
// Vercel uses build:vercel which calls vite build directly — no FAST_BUILD.
const FAST_BUILD = process.env.FAST_BUILD === '1';

const appConfig = {
	server: {
		proxy: {
			'/chat': {
				target: 'http://localhost:5174',
				rewrite: (path) => path.replace(/^\/chat/, ''),
				changeOrigin: true,
			},
		},
	},
	esbuild: {
		jsx: 'transform',
		jsxFactory: 'vhtml',
		jsxFragment: '"div"',
		jsxDev: false,
		define: {
			'global': 'window',
			'process.env': '{}',
			'Buffer': 'buffer.Buffer'
		}
	},
	resolve: {
		// Force a single Three.js instance — addons (GLTFLoader, OrbitControls,
		// etc.) must share the same `three` module as the app, otherwise
		// Three's module-scoped registry warns "Multiple instances of Three.js".
		dedupe: ['three'],
	},
	build: {
		target: 'esnext',
		reportCompressedSize: false,
		chunkSizeWarningLimit: 1000,
		emptyOutDir: false,
		// In FAST_BUILD mode skip minification to cut peak memory further.
		minify: FAST_BUILD ? false : 'esbuild',
		rollupOptions: {
			maxParallelFileOps: 1,
			// FAST_BUILD: treat heavy third-party packages as external so Rollup
			// never loads their source, slashing peak memory by ~70%.
			// Vercel's full build bundles everything (no FAST_BUILD flag).
			...(FAST_BUILD ? {
				external: [
					/^three($|\/)/,
					/^ethers($|\/)/,
					/^@solana\//,
					/^@bonfida\//,
					/^livekit-client($|\/)/,
					/^@livekit\//,
					/^@pump-fun\//,
					/^@jup-ag\//,
					/^@pythnetwork\//,
					/^@metaplex-foundation\//,
					/^@noble\/curves($|\/)/,
					/^@coral-xyz\//,
					/^ethers($|\/)/,
					/^viem($|\/)/,
					/^@solana-mobile\//,
				],
			} : {}),
			output: {
				manualChunks(id) {
					if (id.includes('node_modules/three/')) return 'three';
					if (id.includes('node_modules/ethers/')) return 'ethers';
					if (id.includes('node_modules/@solana/web3.js/') || id.includes('node_modules/@solana/spl-token/') || id.includes('node_modules/@solana/actions/') || id.includes('node_modules/@solana/kit/')) return 'solana';
					if (id.includes('node_modules/@bonfida/')) return 'bonfida';
					if (id.includes('node_modules/livekit-client/') || id.includes('node_modules/@livekit/')) return 'livekit';
					if (id.includes('node_modules/@pump-fun/pump-sdk/') || id.includes('node_modules/@pump-fun/pump-swap-sdk/')) return 'pump';
					if (id.includes('node_modules/@jup-ag/')) return 'jup';
					if (id.includes('node_modules/@pythnetwork/')) return 'pyth';
					if (id.includes('node_modules/@metaplex-foundation/') || id.includes('node_modules/@noble/curves/')) return 'crypto';
					if (id.includes('node_modules/@coral-xyz/anchor/')) return 'anchor';
				},
			},
			input: FAST_BUILD ? {
				// Minimal set for local/CI builds on memory-constrained machines.
				// Vercel uses build:vercel which bypasses the FAST_BUILD flag and
				// builds all entries via `vite build` directly.
				app: resolve(__dirname, 'app.html'),
				main: resolve(__dirname, 'index.html'),
			} : {
				main: resolve(__dirname, 'index.html'),
				app: resolve(__dirname, 'app.html'),
				home: resolve(__dirname, 'home.html'),
				embed: resolve(__dirname, 'embed.html'),
				create: resolve(__dirname, 'create.html'),
				'agent-home': resolve(__dirname, 'agent-home.html'),
				marketplace: resolve(__dirname, 'marketplace.html'),
				'agent-edit': resolve(__dirname, 'agent-edit.html'),
				'agent-embed': resolve(__dirname, 'agent-embed.html'),
				'agent-detail': resolve(__dirname, 'agent-detail.html'),
				'a-embed': resolve(__dirname, 'a-embed.html'),
				'pump-live': resolve(__dirname, 'pump-live.html'),
				'pump-dashboard': resolve(__dirname, 'pump-dashboard.html'),
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
			name: 'clean-dist',
			apply: 'build',
			buildStart() {
				try {
					execSync('rm -rf dist', { cwd: resolve(__dirname), stdio: 'ignore' });
				} catch {}
			},
		},
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
					// /agents/:id  → rich detail page (UUID expected, validated client-side)
					else if (!filePath && /^\/agents\/[^/]+\/?$/.test(path))
						filePath = resolve(root, 'agent-detail.html');
					else if (!filePath && /^\/agent\/[^/]+\/edit$/.test(path))
						filePath = resolve(root, 'agent-edit.html');
					else if (!filePath && /^\/agent\/[^/]+\/embed$/.test(path))
						filePath = resolve(root, 'agent-embed.html');
					else if (!filePath && /^\/agent\/[^/]+$/.test(path))
						filePath = resolve(root, 'agent-home.html');
					// /a/<chainId>/<agentId>/edit  → chain-edit page
					else if (!filePath && /^\/a\/[^/]+(?:\/[^/]+){1,2}\/edit\/?$/.test(path))
						filePath = resolve(root, 'a-edit.html');
					// /a/<chainId>/<agentId>/embed or /a/<chainId>/<registry>/<agentId>/embed  → iframe viewer
					else if (!filePath && /^\/a\/[^/]+(?:\/[^/]+){1,2}\/embed\/?$/.test(path))
						filePath = resolve(root, 'a-embed.html');
					// /a/<chainId>/<agentId>  or  /a/<chainId>/<registry>/<agentId>
					else if (!filePath && /^\/a\/[^/]+(?:\/[^/]+){1,2}\/?$/.test(path))
						filePath = resolve(root, 'app.html');
					// Serve the rider webpack app as static files.
					if (path === '/rider' || path === '/rider/') {
						const html = readFileSync(resolve(root, 'rider/index.html'), 'utf8');
						res.setHeader('Content-Type', 'text/html; charset=utf-8');
						return res.end(html);
					}
					if (path.startsWith('/rider/')) {
						const ext = path.split('.').pop().toLowerCase();
						const mimes = { js: 'application/javascript', map: 'application/json', css: 'text/css', json: 'application/json', html: 'text/html', ogg: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav', glb: 'model/gltf-binary', gltf: 'model/gltf+json', obj: 'text/plain', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf' };
						const fileDisk = resolve(root, path.slice(1));
						if (existsSync(fileDisk) && statSync(fileDisk).isFile()) {
							res.setHeader('Content-Type', mimes[ext] || 'application/octet-stream');
							return createReadStream(fileDisk).pipe(res);
						}
						return next();
					}
					if (!filePath) return next();
					try {
						const html = readFileSync(filePath, 'utf8');
						// Always use the actual on-disk file path as the URL for
						// transformIndexHtml so Vite can resolve html-proxy requests
						// for inline <script type="module"> back to the correct file,
						// regardless of which dynamic URL the page was served from.
						const rel = filePath.slice(root.length + 1).replace(/\\/g, '/');
						const fileUrl = '/' + rel;
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
		{
			// Several static pages (dashboard, vanity-wallet, …) import ESM
			// directly from `/src/*.js`. Vite's dev server serves these from
			// the project root, but production needs them under dist/. Mirror
			// the tree so the runtime URLs resolve.
			name: 'copy-src-to-dist',
			closeBundle() {
				cpSync(resolve(__dirname, 'src'), resolve(__dirname, 'dist/src'), {
					recursive: true,
				});
				cpSync(resolve(__dirname, 'pump-fun-skills'), resolve(__dirname, 'dist/pump-fun-skills'), {
					recursive: true,
				});
			},
		},
		...(FAST_BUILD ? [] : [VitePWA({
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
				maximumFileSizeToCacheInBytes: 256 * 1024,
				globPatterns: ['**/*.{html,ico}'],
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
					'chat/**',
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
		})]),
	],
};

// Library build — the web component + public API, for CDN drop-in:
//   <script type="module" src="https://cdn.example.com/agent-3d.js"></script>
//
// Three.js and ethers stay bundled (the element must be self-contained for a
// zero-install embed). Size will be ~600-900KB gzipped; split via dynamic
// imports in a later pass.
const libConfig = {
	resolve: {
		dedupe: ['three'],
	},
	build: {
		target: 'esnext',
		reportCompressedSize: false,
		outDir: 'dist-lib',
		emptyOutDir: true,
		chunkSizeWarningLimit: 2000,
		lib: {
			entry: resolve(__dirname, 'src/lib.js'),
			name: 'Agent3D',
			formats: process.env.LIB_FORMATS ? process.env.LIB_FORMATS.split(',') : ['es'],
			fileName: (format) => (format === 'es' ? 'agent-3d.js' : 'agent-3d.umd.cjs'),
		},
		rollupOptions: {
			// No externals — self-contained drop-in embed.
			// inlineDynamicImports keeps the output as a single file so CDN
			// consumers get one <script type="module"> with no chunk fetches.
			output: { inlineDynamicImports: true },
		},
	},
};

export default defineConfig(TARGET === 'lib' ? libConfig : appConfig);
