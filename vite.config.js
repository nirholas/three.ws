import { defineConfig } from 'vite';
import { resolve } from 'path';
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
	},
	build: {
		chunkSizeWarningLimit: 1000,
		rollupOptions: {
			input: {
				main: resolve(__dirname, 'index.html'),
				features: resolve(__dirname, 'features.html'),
				embed: resolve(__dirname, 'embed.html'),
				'agent-home': resolve(__dirname, 'agent-home.html'),
				'agent-embed': resolve(__dirname, 'agent-embed.html'),
			},
		},
	},
	plugins: [
		VitePWA({
			registerType: 'autoUpdate',
			includeAssets: ['favicon.ico', 'pwa-192x192.png', 'pwa-512x512.png', 'pwa-icon.svg'],
			manifest: {
				name: '3D Agent — AI-Powered 3D Model Viewer',
				short_name: '3D Agent',
				description: 'Drag and drop glTF, GLB, and 3D files to preview instantly in your browser.',
				theme_color: '#000000',
				background_color: '#080814',
				display: 'standalone',
				scope: '/',
				start_url: '/',
				icons: [
					{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
					{ src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
					{ src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
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
			fileName: (format) => format === 'es' ? 'agent-3d.js' : 'agent-3d.umd.cjs',
		},
		rollupOptions: {
			// No externals — we want a self-contained drop-in embed.
			output: { inlineDynamicImports: false },
		},
	},
};

export default defineConfig(TARGET === 'lib' ? libConfig : appConfig);
