import { defineConfig } from 'vitest/config';

// Pins this package to its own config. Without it vitest walks up to the repo
// root vitest.config.js, whose setupFiles do not exist relative to this package.
export default defineConfig({
	test: { environment: 'node', include: ['tests/**/*.test.js'] },
});
