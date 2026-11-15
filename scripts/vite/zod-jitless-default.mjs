// zod v4 probes `Function("")` the first time an object schema is constructed,
// to decide whether it may JIT-compile a fast parser. The site CSP has no
// 'unsafe-eval' outside /scene, so every page that builds a zod schema files a
// script-src violation report (zod itself falls back to its interpreted
// parser). `z.config({ jitless: true })` in src/shared/zod.js only covers
// schemas built after it runs; dependencies (x402, the MCP SDK, reown,
// cdp-sdk) build theirs at import time, before any app module evaluates.
//
// This plugin makes jitless zod's own default: right where zod's core module
// creates globalThis.__zod_globalConfig, it sets `jitless: true` unless
// something already chose a value. Every zod copy in the bundle shares that
// global, and the core module evaluates before any schema can exist, so the
// probe never runs. An explicit `z.config({ jitless: false })` still wins.
//
// If a zod upgrade changes the core source so the rewrite no longer matches,
// the build fails instead of silently shipping the violation again.

const CORE_ID = /[\\/]zod[\\/]v4[\\/]core[\\/]core\.c?js(\?.*)?$/;
// `globalThis.__zod_globalConfig ??= {}` as zod ships it, compiled
// (`(_a = globalThis).__zod_globalConfig ?? (_a.__zod_globalConfig = {});`)
// or as written in source.
const CONFIG_INIT =
	/(?:\(\s*\w+\s*=\s*globalThis\s*\)|globalThis)\.__zod_globalConfig\s*(?:\?\?=\s*\{\s*\}|\?\?\s*\(\s*(?:\w+|globalThis)\.__zod_globalConfig\s*=\s*\{\s*\}\s*\))\s*;?/;
const DEFAULT_JITLESS =
	'\nif (globalThis.__zod_globalConfig.jitless === undefined) globalThis.__zod_globalConfig.jitless = true;\n';

/** @returns {import('vite').Plugin} */
export function zodJitlessDefault() {
	const unmatched = new Set();
	return {
		name: 'three-ws:zod-jitless-default',
		apply: 'build',
		transform(code, id) {
			if (!CORE_ID.test(id)) return null;
			const m = CONFIG_INIT.exec(code);
			if (!m) {
				unmatched.add(id);
				return null;
			}
			unmatched.delete(id);
			const end = m.index + m[0].length;
			return { code: code.slice(0, end) + DEFAULT_JITLESS + code.slice(end), map: null };
		},
		buildEnd(err) {
			if (err || unmatched.size === 0) return;
			this.error(
				`zod-jitless-default: could not find the __zod_globalConfig initializer in ${[...unmatched].join(', ')}. ` +
					'zod changed its core source; update CONFIG_INIT in scripts/vite/zod-jitless-default.mjs so zod stays jitless under the no-eval CSP.',
			);
		},
	};
}
