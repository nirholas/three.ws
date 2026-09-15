import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// The filmstrip harness only needs static assets and native module resolution.
// Keeping it off the full application config makes visual animation QA fast,
// deterministic, and independent of Codespaces HMR/proxy settings.
export default defineConfig({
	root: resolve(import.meta.dirname, '..'),
	server: {
		host: '127.0.0.1',
		hmr: false,
	},
});
