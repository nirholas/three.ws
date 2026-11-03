// Flat ESLint config (ESLint 10 — eslintrc format is no longer supported).
// Scope: first-party vanilla-JS source at the repo root. Sub-projects that ship
// their own flat config (chat/, agent-payments-sdk/, character-studio/) and
// vendored/generated/build output are ignored here. TypeScript sources are left
// to each package's own tsc/typecheck pipeline, so we lint JS extensions only
// and avoid pulling in typescript-eslint at the root.
import js from '@eslint/js';
import globals from 'globals';

export default [
	{
		ignores: [
			'**/node_modules/**',
			'**/dist/**',
			'**/dist-lib/**',
			'**/dist-artifact/**',
			'**/build/**',
			'**/.vercel/**',
			'**/.svelte-kit/**',
			'**/coverage/**',
			// Playwright run output: traces and attachments appear and vanish
			// mid-run, so linting them races the e2e suite and crashes ESLint.
			'**/test-results/**',
			'**/playwright-report/**',
			// Vendored / external library code
			'contracts/lib/**',
			'character-studio/**',
			'docs/pumpfun-program/**',
			// Vendored third-party browser libs (Draco/Basis compression,
			// the scene-studio editor's bundled acorn/codemirror/esprima/etc.,
			// and MediaPipe's Emscripten-generated WASM glue).
			'**/draco/**',
			'**/basis/**',
			'public/scene-studio/libs/**',
			// Any directory named `vendor` holds third-party code we don't own
			// and must not lint (e.g. extensions/*/vendor/readability.js).
			'**/vendor/**',
			// Complete vendored upstream trees kept as reference material and
			// never built or shipped. See third_party/README.md.
			'third_party/**',
			'**/*.bundle.js',
			// The metaplex deployer site's esbuild output, committed so the static
			// docs/ folder serves without a build step. Its source is linted.
			'packages/metaplex-agent-mcp/docs/app.js',
			'public/dashboard/avaturn-sdk.js',
			// Self-contained sub-projects with their own ESLint flat config
			'chat/**',
			'public/chat/**',
			'agent-payments-sdk/**',
			// Generated output
			'data/_generated/**',
			// Saved Workflow-DSL scripts (top-level await/return + injected
			// runtime globals like agent()/log() — not standalone ES modules).
			'scripts/wf-*.mjs',
			'.claude/workflows/**',
			// Other agents' git worktrees: full checkouts (often with their own
			// eslint configs and uninstalled plugins) that are gitignored and
			// linted from their own tree, never from this one.
			'.claude/worktrees/**',
			// Bundled/minified build artifacts
			'**/*.min.js',
			// Bundler output formats (tsup/esbuild IIFE + global builds) and
			// TypeDoc-generated API-doc assets: single-line minified code where
			// minifier variable reuse trips no-redeclare/no-func-assign. These are
			// generated, never hand-edited, and must not gate the lint on real
			// source. (Hand-authored robinhood/**/docs demos stay linted.)
			'**/*.iife.js',
			'**/*.global.js',
			'**/docs/api/assets/**',
			'public/embed-sdk.js',
			'public/embed.js',
			'public/wallet-login.js',
			'public/artifact.js',
			'public/bazaar.js',
			'public/paywall.js',
			// onnxruntime-web's Emscripten-generated WASM glue, vendored as-is.
			'public/models/voice/runtime/**',
		],
	},
	js.configs.recommended,
	{
		files: ['**/*.{js,mjs,jsx}'],
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module',
			parserOptions: {
				ecmaFeatures: { jsx: true },
			},
			globals: {
				...globals.browser,
				...globals.node,
			},
		},
		rules: {
			// This codebase predates linting, so the first pass was a warn-level
			// baseline that the team ratchets to error as files are cleaned. Every
			// rule at error below has zero findings across the repo, so a new one
			// fails the gate immediately. The warn rules still carry a backlog.
			'no-unused-vars': 'warn',
			// Browser code may report real failures with console.warn/error;
			// stray console.log is what this catches. Node code is exempted below.
			'no-console': ['warn', { allow: ['warn', 'error'] }],
			'no-empty': 'warn',
			'no-useless-escape': 'warn',
			'preserve-caught-error': 'warn',
			'no-useless-assignment': 'off',
			'no-control-regex': 'off',
			'no-undef': 'error',
			'no-constant-condition': 'error',
			'no-constant-binary-expression': 'error',
			'no-prototype-builtins': 'error',
			'no-cond-assign': 'error',
			'no-fallthrough': 'error',
			'no-irregular-whitespace': 'error',
			'no-unreachable': 'error',
			'no-unassigned-vars': 'error',
			'no-async-promise-executor': 'error',
			'no-misleading-character-class': 'error',
			'no-unsafe-finally': 'error',
			'no-unused-private-class-members': 'error',
			'no-unused-labels': 'error',
		},
	},
	{
		// Node-side code (CLIs, API handlers, workers, servers, tests): stdout
		// and stderr are the log stream Cloud Run and the terminal collect, so
		// console is the logger here, not a leftover.
		files: [
			'scripts/**', 'api/**', 'workers/**', 'server/**', 'services/**',
			'tests/**', 'examples/**', 'agents/**', 'mcp-server/**', 'mcp-bridge/**',
			'**/bin/**', '**/scripts/**', '**/server/**', '**/cli/**', '**/*.cjs',
			'vite.config.js',
		],
		rules: { 'no-console': 'off' },
	},
	{
		// Browser extensions run with the WebExtensions `chrome` global.
		files: ['extensions/**'],
		languageOptions: { globals: { ...globals.webextensions } },
	},
	{
		// The scene-studio editor loads three.js as a classic script global.
		files: ['public/scene-studio/app/**'],
		languageOptions: { globals: { THREE: 'readonly' } },
	},
	{
		// VS Code webviews receive acquireVsCodeApi from the host.
		files: ['packages/vscode-*/webview/**'],
		languageOptions: { globals: { acquireVsCodeApi: 'readonly' } },
	},
	{
		// Service workers run in their own global scope (self, clients,
		// registration, skipWaiting, …). Flat config replaces the old
		// `/* eslint-env serviceworker */` directive with explicit globals.
		files: ['**/push-sw.js', '**/*-sw.js', '**/service-worker.js'],
		languageOptions: {
			globals: { ...globals.serviceworker },
		},
	},
	{
		files: ['**/*.cjs'],
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'commonjs',
			globals: { ...globals.node },
		},
		rules: {
			'no-unused-vars': 'warn',
			'no-undef': 'error',
		},
	},
];
