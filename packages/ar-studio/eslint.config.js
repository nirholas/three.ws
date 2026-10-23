// Lint rules for this package.
//
// Deliberately small: the repository's own conventions (no placeholder code, no
// dead paths, every state designed) are not things a linter can check, and a
// wall of style rules would only bury the two or three that catch real bugs.

import js from '@eslint/js';

export default [
	js.configs.recommended,
	{
		files: ['**/*.js', '**/*.mjs'],
		languageOptions: {
			ecmaVersion: 2023,
			sourceType: 'module',
			globals: {
				window: 'readonly',
				document: 'readonly',
				navigator: 'readonly',
				location: 'readonly',
				history: 'readonly',
				screen: 'readonly',
				fetch: 'readonly',
				console: 'readonly',
				localStorage: 'readonly',
				performance: 'readonly',
				requestAnimationFrame: 'readonly',
				cancelAnimationFrame: 'readonly',
				setTimeout: 'readonly',
				clearTimeout: 'readonly',
				setInterval: 'readonly',
				clearInterval: 'readonly',
				crypto: 'readonly',
				URL: 'readonly',
				URLSearchParams: 'readonly',
				Blob: 'readonly',
				File: 'readonly',
				FileReader: 'readonly',
				Image: 'readonly',
				CustomEvent: 'readonly',
				HTMLElement: 'readonly',
				customElements: 'readonly',
				ResizeObserver: 'readonly',
				TextEncoder: 'readonly',
				TextDecoder: 'readonly',
				btoa: 'readonly',
				atob: 'readonly',
				DeviceOrientationEvent: 'readonly',
				AbortSignal: 'readonly',
				AbortController: 'readonly',
				process: 'readonly',
				globalThis: 'readonly',
			},
		},
		rules: {
			'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
			'no-console': 'off',
			eqeqeq: ['error', 'smart'],
			'prefer-const': 'error',
			'no-var': 'error',
		},
	},
	{
		// The MCP server and the CLI run in Node, where the DOM globals above are
		// meaningless but Node's own are not.
		files: ['mcp/**/*.js', 'bin/**/*.mjs', 'scripts/**/*.mjs', 'site/**/*.mjs', 'test/**/*.mjs'],
		languageOptions: { globals: { process: 'readonly', console: 'readonly', fetch: 'readonly', globalThis: 'readonly' } },
	},
	{ ignores: ['dist/**', 'docs/**', 'node_modules/**', 'templates/**'] },
];
