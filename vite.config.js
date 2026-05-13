import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync, cpSync, createReadStream, existsSync, statSync } from 'fs';
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

// Vercel serverless functions live under /api/* in production but Vite dev
// does not run them. Forward /api/* to a real upstream (default: production)
// so pages like /pumpfun see real SSE feeds and JSON responses in dev.
// Override with DEV_API_PROXY=http://localhost:3001 to point at vercel-dev.
const DEV_API_PROXY = process.env.DEV_API_PROXY || 'https://three.ws';
// Local-only override for /api/x402-pay (the demo's paid-call backend).
// Spin up the helper with `node scripts/dev-x402-pay-server.mjs`; if set, the
// main Vite dev server will route /api/x402-pay → here while other /api/* still
// proxy to prod. Default is empty so /api/x402-pay falls through to the prod
// proxy when the helper isn't running — otherwise the first hit to /pay would
// crash the dev server with an unhandled ECONNREFUSED proxy error.
const X402_PAY_DEV_URL = process.env.X402_PAY_DEV_URL ?? '';

const appConfig = {
	server: {
		proxy: {
			'/chat': {
				target: 'http://localhost:5174',
				changeOrigin: true,
			},
			...(X402_PAY_DEV_URL
				? {
					'/api/x402-pay': {
						target: X402_PAY_DEV_URL,
						changeOrigin: true,
						secure: false,
						configure: (proxy) => {
							proxy.on('error', (err, _req, res) => {
								if (!res || res.headersSent || res.writableEnded) return;
								res.statusCode = 502;
								res.setHeader('content-type', 'application/json');
								res.end(JSON.stringify({
									error: 'bad_gateway',
									message: `x402-pay dev helper unreachable at ${X402_PAY_DEV_URL}: ${err.message}`,
								}));
							});
						},
					},
				}
				: {}),
			'/api': {
				target: DEV_API_PROXY,
				changeOrigin: true,
				secure: true,
				ws: true,
				// SSE responses (text/event-stream) must not be buffered.
				// http-proxy + Node's stream pipe handle this when we don't
				// touch the response, so leave selfHandleResponse off.
				configure: (proxy) => {
					proxy.on('proxyReq', (proxyReq) => {
						// Disable any compression that would force buffering
						// of streaming responses on the upstream side.
						proxyReq.setHeader('accept-encoding', 'identity');
					});
					proxy.on('error', (err, _req, res) => {
						// Without this handler, an upstream connection failure
						// (ECONNREFUSED on a transient blip) bubbles up as an
						// uncaught exception and kills the dev server.
						if (!res || res.headersSent || res.writableEnded) return;
						res.statusCode = 502;
						res.setHeader('content-type', 'application/json');
						res.end(JSON.stringify({
							error: 'bad_gateway',
							message: `api proxy → ${DEV_API_PROXY} failed: ${err.message}`,
						}));
					});
				},
			},
		},
	},
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
		// Skip computing gzip/brotli sizes during build — saves several seconds on
		// large bundles (Three.js, ethers) without affecting the output.
		reportCompressedSize: false,
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (id.includes('node_modules/three/')) return 'three';
					if (id.includes('node_modules/ethers/')) return 'ethers';
				},
				// footer-bot.js needs a stable, unhashed filename so footer.js can
				// load it by a predictable URL without knowing the build hash.
				entryFileNames: (chunk) =>
					chunk.name === 'footer-bot'
						? 'footer-bot.js'
						: 'assets/[name]-[hash].js',
			},
			input: {
				'footer-bot': resolve(__dirname, 'src/footer-bot.js'),
				app: resolve(__dirname, 'app.html'),
				'app-demo': resolve(__dirname, 'app-demo.html'),
				home: resolve(__dirname, 'home.html'),
				features: resolve(__dirname, 'features.html'),
				tutorials: resolve(__dirname, 'tutorials.html'),
				playground: resolve(__dirname, 'playground.html'),
				embed: resolve(__dirname, 'embed.html'),
				create: resolve(__dirname, 'create.html'),
				'agent-home': resolve(__dirname, 'agent-home.html'),
				marketplace: resolve(__dirname, 'marketplace.html'),
				'agent-edit': resolve(__dirname, 'agent-edit.html'),
				'agent-embed': resolve(__dirname, 'agent-embed.html'),
				'agent-detail': resolve(__dirname, 'agent-detail.html'),
				'a-embed': resolve(__dirname, 'a-embed.html'),
				'a-edit': resolve(__dirname, 'a-edit.html'),
				'pump-live': resolve(__dirname, 'pump-live.html'),
				'pump-dashboard': resolve(__dirname, 'pump-dashboard.html'),
				'pump-visualizer': resolve(__dirname, 'pump-visualizer.html'),
				'avatar-artifact': resolve(__dirname, 'avatar-artifact.html'),
				'pretext-demo': resolve(__dirname, 'pretext-demo.html'),
				'launch-week': resolve(__dirname, 'three-ws-launch-week.html'),
				community: resolve(__dirname, 'community.html'),
				profile: resolve(__dirname, 'profile.html'),
				'avatar-page': resolve(__dirname, 'avatar-page.html'),
				'widget-studio': resolve(__dirname, 'widget-studio.html'),
				studio: resolve(__dirname, 'public/studio/index.html'),
				reputation: resolve(__dirname, 'public/reputation/index.html'),
				hydrate: resolve(__dirname, 'public/hydrate/index.html'),
				// BEGIN:DISCOVER_ROUTE
				'my-agents': resolve(__dirname, 'public/my-agents/index.html'),
				discover: resolve(__dirname, 'public/discover/index.html'),
				gallery: resolve(__dirname, 'public/gallery/index.html'),
				// END:DISCOVER_ROUTE
				'vanity-wallet': resolve(__dirname, 'public/vanity-wallet.html'),
				'eth-vanity': resolve(__dirname, 'public/eth-vanity.html'),
				pay: resolve(__dirname, 'public/pay/index.html'),
				'pay-calls': resolve(__dirname, 'public/pay/calls/index.html'),
				sitemap: resolve(__dirname, 'public/sitemap/index.html'),
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
					'/app-demo': resolve(root, 'app-demo.html'),
					'/login': resolve(root, 'public/login.html'),
					'/deploy': resolve(root, 'app.html'),
					'/agents': resolve(root, 'public/agents/index.html'),
					'/agents/': resolve(root, 'public/agents/index.html'),
					'/create': resolve(root, 'create.html'),
					'/dashboard': resolve(root, 'public/dashboard/index.html'),
					'/studio': resolve(root, 'public/studio/index.html'),
					'/studio/': resolve(root, 'public/studio/index.html'),
					'/widgets': resolve(root, 'public/widgets-gallery/index.html'),
					'/widgets/': resolve(root, 'public/widgets-gallery/index.html'),
					'/docs/widgets': resolve(root, 'public/docs-widgets.html'),
					'/cz': resolve(root, 'public/cz/index.html'),
					'/cz/': resolve(root, 'public/cz/index.html'),
					'/validation': resolve(root, 'public/validation/index.html'),
					'/validation/': resolve(root, 'public/validation/index.html'),
					'/reputation': resolve(root, 'public/reputation/index.html'),
					'/reputation/': resolve(root, 'public/reputation/index.html'),
					'/hydrate': resolve(root, 'public/hydrate/index.html'),
					'/hydrate/': resolve(root, 'public/hydrate/index.html'),
					'/artifact': resolve(root, 'public/artifact/index.html'),
					'/artifact/': resolve(root, 'public/artifact/index.html'),
					// BEGIN:DISCOVER_ROUTE
					'/my-agents': resolve(root, 'public/my-agents/index.html'),
					'/my-agents/': resolve(root, 'public/my-agents/index.html'),
					'/discover': resolve(root, 'public/discover/index.html'),
					'/discover/': resolve(root, 'public/discover/index.html'),
					'/gallery': resolve(root, 'public/gallery/index.html'),
					'/gallery/': resolve(root, 'public/gallery/index.html'),
					'/marketplace': resolve(root, 'marketplace.html'),
					'/marketplace/': resolve(root, 'marketplace.html'),
					'/pay': resolve(root, 'public/pay/index.html'),
					'/pay/': resolve(root, 'public/pay/index.html'),
					'/pay/calls': resolve(root, 'public/pay/calls/index.html'),
					'/pay/calls/': resolve(root, 'public/pay/calls/index.html'),
					'/explore': resolve(root, 'public/discover/index.html'),
					'/explore/': resolve(root, 'public/discover/index.html'),
					// END:DISCOVER_ROUTE
					'/tutorials': resolve(root, 'tutorials.html'),
					'/tutorials/': resolve(root, 'tutorials.html'),
					'/pump-live': resolve(root, 'pump-live.html'),
					'/pump-live/': resolve(root, 'pump-live.html'),
					'/pump-dashboard': resolve(root, 'pump-dashboard.html'),
					'/pump-dashboard/': resolve(root, 'pump-dashboard.html'),
					'/pump-visualizer': resolve(root, 'pump-visualizer.html'),
					'/pump-visualizer/': resolve(root, 'pump-visualizer.html'),
					'/avatar-artifact': resolve(root, 'avatar-artifact.html'),
					'/avatar-artifact/': resolve(root, 'avatar-artifact.html'),
					'/pretext-demo': resolve(root, 'pretext-demo.html'),
					'/pretext-demo/': resolve(root, 'pretext-demo.html'),
					'/launch-week': resolve(root, 'three-ws-launch-week.html'),
					'/launch-week/': resolve(root, 'three-ws-launch-week.html'),
					'/eth-vanity': resolve(root, 'public/eth-vanity.html'),
					'/eth-vanity/': resolve(root, 'public/eth-vanity.html'),
					'/strategy-lab': resolve(root, 'public/strategy-lab.html'),
					'/strategy-lab/': resolve(root, 'public/strategy-lab.html'),
					'/': resolve(root, 'home.html'),
					'/home': resolve(root, 'home.html'),
					'/features': resolve(root, 'features.html'),
					'/features/': resolve(root, 'features.html'),
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
					'/gallery',
					'/docs',
				]);
				server.middlewares.use(async (req, res, next) => {
					const url = req.url || '/';
					// Don't intercept Vite's internal html-proxy / module requests —
					// it needs to serve the inline-script content for our HTML.
					if (url.includes('html-proxy') || url.includes('@id/') || url.includes('@vite/'))
						return next();
					const path = url.split('?')[0];
					// /api/* is handled by the http proxy in server.proxy above —
					// the middleware must not intercept those requests.
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
					// Chat sub-app is proxied to its own Vite dev server at :5174
					// which serves under /chat/. Redirect /chat → /chat/ so the
					// proxy can forward the trailing-slash form upstream.
					if (path === '/chat') {
						res.statusCode = 301;
						res.setHeader('Location', '/chat/');
						return res.end();
					}
					let filePath = fileMap[path];
					if (!filePath && /^\/marketplace\/agents\/[^/]+\/?$/.test(path))
						filePath = resolve(root, 'marketplace.html');
					else if (!filePath && /^\/marketplace\/avatars\/[^/]+\/?$/.test(path))
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
					// /pay/calls/<base58 tx sig> → permalink for a paid x402 call
					else if (!filePath && /^\/pay\/calls\/[1-9A-HJ-NP-Za-km-z]+\/?$/.test(path))
						filePath = resolve(root, 'public/pay/calls/index.html');
					// /dashboard/<tab> and /dashboard/edit/<id> → SPA index
					else if (
						!filePath &&
						/^\/dashboard\/(?:agents|avatars|create|upload|animations|widgets|embed|keys|mcp|monetization|payments|subscriptions|billing|revenue|earnings|account)\/?$/.test(
							path,
						)
					)
						filePath = resolve(root, 'public/dashboard/index.html');
					else if (!filePath && /^\/dashboard\/edit\/[^/]+\/?$/.test(path))
						filePath = resolve(root, 'public/dashboard/index.html');
					// /dashboard/<page> → corresponding static HTML page
					else if (!filePath && /^\/dashboard\/(?:portfolio|wallets|sessions|actions|embed-policy|agent-pumpfun|usage|storage)\/?$/.test(path)) {
						const slug = path.replace(/^\/dashboard\//, '').replace(/\/$/, '');
						filePath = resolve(root, `public/dashboard/${slug}.html`);
					}
					// Serve the rider webpack app as static files.
					// /footer-bot.js — serve the Vite-processed src/footer-bot.js at a
				// stable URL in dev so footer.js can load it without knowing the hash.
				if (path === '/footer-bot.js') {
					req.url = '/src/footer-bot.js';
					return next();
				}
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
			// Stamp every Vite-processed HTML page so footer.js can detect that
			// Three.js is already bundled and skip loading the model-viewer CDN script.
			name: 'three-bundle-meta',
			transformIndexHtml: {
				order: 'pre',
				handler() {
					return [{ tag: 'meta', attrs: { name: 'has-three-bundle', content: 'true' }, injectTo: 'head' }];
				},
			},
		},
		(() => {
			// Suppress the cosmetic "Multiple instances of Three.js being imported"
			// warning. Three.js does `if (window.__THREE__) warn(); else __THREE__ = REVISION;`
			// so the naive "pre-claim the global" trick actively triggers the warning
			// instead of suppressing it. Instead, install a property accessor whose
			// getter always returns undefined and whose setter is a no-op — every
			// three.js instance's check then passes silently. Runs in head-prepend
			// so it executes before model-viewer's bundled three or our app bundle.
			const GUARD = 'try{Object.defineProperty(window,"__THREE__",{configurable:true,get:function(){return undefined},set:function(){}})}catch(_){}';
			return {
				name: 'three-multi-instance-guard',
				transformIndexHtml: {
					order: 'pre',
					handler() {
						return [{ tag: 'script', children: GUARD, injectTo: 'head-prepend' }];
					},
				},
				closeBundle: {
					sequential: true,
					order: 'post',
					async handler() {
						const { readdirSync, statSync, readFileSync, writeFileSync } = await import('fs');
						const { join } = await import('path');
						const distDir = resolve(__dirname, 'dist');
						if (!existsSync(distDir)) return;
						const MARKER = 'Object.defineProperty(window,"__THREE__"';
						const LEGACY = /<script>\s*window\.__THREE__\s*=\s*window\.__THREE__\s*\|\|\s*["'][^"']+["']\s*;?\s*<\/script>\s*/g;
						const tag = `<script>${GUARD}</script>`;
						const walk = (dir) => {
							for (const entry of readdirSync(dir)) {
								const full = join(dir, entry);
								if (statSync(full).isDirectory()) walk(full);
								else if (entry.endsWith('.html')) {
									const html = readFileSync(full, 'utf8');
									let next = html.replace(LEGACY, '');
									if (!next.includes(MARKER)) {
										next = next.replace(/<head(\s[^>]*)?>/i, (m) => `${m}\n\t\t${tag}`);
									}
									if (next !== html) writeFileSync(full, next);
								}
							}
						};
						walk(distDir);
					},
				},
			};
		})(),
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
	resolve: {
		dedupe: ['three'],
	},
	build: {
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
