import { config } from '@n8n/node-cli/eslint';

export default [
	{ ignores: ['test/**', 'dist/**', 'vitest.config.mjs'] },
	...config,
	{
		// package.json "overrides" pin patched versions of transitive dev tooling
		// (undici, qs, uuid, stream-json, minimatch, glob, basic-ftp, and stagehand 4,
		// which drops the unpatched deepmerge peer) in this folder's
		// lockfile. npm ignores a dependency's overrides on install, so n8n users and
		// n8n core are unaffected; the node itself has no runtime dependencies.
		files: ['package.json'],
		rules: { '@n8n/community-nodes/no-overrides-field': 'off' },
	},
];
