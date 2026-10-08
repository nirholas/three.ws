// Worker test config. The worker shares the repo's vitest install (resolved from
// the root node_modules) and imports the gateway core from api/_lib/gateway, so
// tests run with the repo root as the server root and this directory's tests
// as the only include.

import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	root: fileURLToPath(new URL('../..', import.meta.url)),
	test: {
		environment: 'node',
		include: ['workers/agent-gateway/tests/**/*.test.js'],
		testTimeout: 60_000,
		hookTimeout: 120_000,
		pool: 'forks',
	},
});
