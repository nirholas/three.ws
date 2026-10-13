import { defineConfig } from 'vite';

// Standalone dev server for harness/index.html (tests/e2e/agent-3d-webflow-component.spec.js).
// The repo root's vite.config.js sets esbuild.jsxFactory to its own static-site
// "vhtml" helper, which would silently break real React JSX. This package
// renders inside Webflow's own devlink bundler in production, so its local
// harness needs its own config with the real React automatic runtime instead.
export default defineConfig({
	esbuild: {
		jsx: 'automatic',
		jsxImportSource: 'react',
	},
});
