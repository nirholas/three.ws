// The site CSP has no 'unsafe-eval' outside /scene (vercel.json). A few
// dependencies probe for eval at import time, `try { Function('') } catch {}`,
// and fall back to an interpreted path when it is blocked. The fallback works,
// but the blocked probe still files a script-src violation report on every
// page that loads the library, which drowns real reports at
// /api/client-errors and fails scripts/audit-csp.mjs.
//
// This plugin rewrites each known probe to its no-eval outcome at build time,
// so the library takes the same code path it would under the CSP without ever
// touching Function. Each rewrite names the module it targets; if a dependency
// upgrade changes that module so the rewrite no longer matches, the build
// fails instead of silently shipping the violation again.
//
// Pinned by tests/vite-csp-eval-probes.test.js, which bundles real imports of
// each library and runs them with Function blocked.

/**
 * @typedef {object} EvalProbeRewrite
 * @property {string} name      shown in the build error when the probe moved
 * @property {RegExp} id        module ids this rewrite applies to
 * @property {string} sampleId  an id the `id` pattern matches (for tests)
 * @property {RegExp} find      the probe as the package ships it
 * @property {(match: string) => string} replace  its no-eval replacement
 */

/** @type {EvalProbeRewrite[]} */
export const EVAL_PROBE_REWRITES = [
	{
		// zod v4 probes `Function("")` the first time an object schema is
		// constructed, unless globalThis.__zod_globalConfig.jitless is set.
		// src/shared/zod.js sets it, but dependencies (payment, wallet and MCP
		// SDKs) build schemas at import time, before any app module runs. Make
		// jitless the default where zod's core creates the global config: every
		// zod copy shares that global and the core module evaluates before any
		// schema exists. An explicit `z.config({ jitless: false })` still wins.
		name: 'zod jitless default',
		id: /[\\/]zod[\\/]v4[\\/]core[\\/]core\.c?js(\?.*)?$/,
		sampleId: '/repo/node_modules/zod/v4/core/core.js',
		find: /(?:\(\s*\w+\s*=\s*globalThis\s*\)|globalThis)\.__zod_globalConfig\s*(?:\?\?=\s*\{\s*\}|\?\?\s*\(\s*(?:\w+|globalThis)\.__zod_globalConfig\s*=\s*\{\s*\}\s*\))\s*;?/,
		replace: (m) =>
			`${m}\nif (globalThis.__zod_globalConfig.jitless === undefined) globalThis.__zod_globalConfig.jitless = true;\n`,
	},
	{
		// msgpackr (the Colyseus wire codec) probes once at module load and, when
		// eval is blocked, never builds inline record readers. Take that branch
		// directly.
		name: 'msgpackr inline reader probe',
		id: /[\\/]msgpackr[\\/]unpack\.m?js(\?.*)?$/,
		sampleId: '/repo/node_modules/@colyseus/msgpackr/unpack.js',
		find: /try\s*\{\s*new Function\(\s*(['"`])\1\s*\)\s*;?\s*\}\s*catch\s*\(\s*\w+\s*\)\s*\{[^{}]*?(inlineObjectReadThreshold\s*=\s*Infinity)[^{}]*\}/,
		replace: (m) => /inlineObjectReadThreshold\s*=\s*Infinity/.exec(m)[0],
	},
];

/** @returns {import('vite').Plugin} */
export function cspEvalProbes(rewrites = EVAL_PROBE_REWRITES) {
	const unmatched = new Map();
	return {
		name: 'three-ws:csp-eval-probes',
		apply: 'build',
		transform(code, id) {
			let out = code;
			let changed = false;
			for (const rw of rewrites) {
				if (!rw.id.test(id)) continue;
				const m = rw.find.exec(out);
				if (!m) {
					unmatched.set(id, rw.name);
					continue;
				}
				unmatched.delete(id);
				out = out.slice(0, m.index) + rw.replace(m[0]) + out.slice(m.index + m[0].length);
				changed = true;
			}
			return changed ? { code: out, map: null } : null;
		},
		buildEnd(err) {
			if (err || unmatched.size === 0) return;
			const list = [...unmatched].map(([id, name]) => `${name} (${id})`).join(', ');
			this.error(
				`csp-eval-probes: the eval probe moved in ${list}. A dependency upgrade changed its source; ` +
					'update EVAL_PROBE_REWRITES in scripts/vite/csp-eval-probes.mjs so the library stays quiet under the no-eval CSP.',
			);
		},
	};
}
