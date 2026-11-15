// The site CSP has no 'unsafe-eval' outside /scene. Some dependencies probe
// for eval at import time (`try { Function('') } catch {}`) and fall back
// cleanly when it is blocked, but the blocked probe still files a script-src
// violation report on every page that loads them:
//   - zod v4 probes the first time an object schema is constructed. The
//     src/shared/zod.js jitless config only covers schemas built after it
//     runs; x402, the MCP SDK, reown and cdp-sdk build theirs at import time,
//     and /showcase kept reporting `script-src blocked eval` in production.
//   - msgpackr (Colyseus) probes once at module load; /temporary reported it.
//
// The cspEvalProbes Vite plugin rewrites each probe to its no-eval outcome at
// build time. These tests bundle real imports of each library and run the
// bundle with `Function` blocked the way the CSP blocks it: probed without the
// plugin, untouched with it, and the library still works.
import { describe, it, expect } from 'vitest';
import { build } from 'vite';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cspEvalProbes, EVAL_PROBE_REWRITES } from '../scripts/vite/csp-eval-probes.mjs';

const root = path.resolve(import.meta.dirname, '..');
const ENTRY = '\0csp-eval-probe-fixture';

const FIXTURES = {
	// A dependency module: imports zod directly and constructs an object schema
	// at module top level, never touching src/shared/zod.js.
	zod: [
		"import { z } from 'zod';",
		'const Payment = z.object({ scheme: z.string(), amount: z.string() });',
		"const r = Payment.safeParse({ scheme: 'exact', amount: '1' });",
		'export const ok = r.success === true;',
	].join('\n'),
	// The Colyseus wire codec: round-trip a record through pack/unpack.
	msgpackr: [
		"import { pack, unpack } from '@colyseus/msgpackr';",
		"const out = unpack(pack({ room: 'plaza', seq: 7, tags: ['a', 'b'] }));",
		"export const ok = out.room === 'plaza' && out.seq === 7 && out.tags[1] === 'b';",
	].join('\n'),
};

function fixturePlugin(source) {
	return {
		name: 'csp-eval-probe-fixture',
		enforce: 'pre',
		resolveId(id) {
			return id.endsWith('csp-eval-probe-fixture') ? ENTRY : null;
		},
		load(id) {
			return id === ENTRY ? source : null;
		},
	};
}

async function bundleAndRun(source, plugins) {
	const out = await build({
		root,
		configFile: false,
		logLevel: 'silent',
		plugins: [fixturePlugin(source), ...plugins],
		build: {
			write: false,
			minify: false,
			lib: { entry: 'csp-eval-probe-fixture', formats: ['es'], fileName: 'fixture' },
		},
	});
	const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => o.output);
	const chunk = outputs.find((o) => o.type === 'chunk' && o.isEntry);
	const dir = mkdtempSync(path.join(tmpdir(), 'csp-eval-probe-'));
	const file = path.join(dir, 'fixture.mjs');
	writeFileSync(file, chunk.code);

	const calls = [];
	const RealFunction = globalThis.Function;
	globalThis.Function = function CspBlockedFunction(...args) {
		calls.push(args);
		throw new EvalError('Evaluating a string as JavaScript violates the Content Security Policy');
	};
	const prior = globalThis.__zod_globalConfig;
	delete globalThis.__zod_globalConfig;
	try {
		const mod = await import(pathToFileURL(file).href);
		return { calls, ok: mod.ok };
	} finally {
		globalThis.Function = RealFunction;
		if (prior === undefined) delete globalThis.__zod_globalConfig;
		else globalThis.__zod_globalConfig = prior;
		rmSync(dir, { recursive: true, force: true });
	}
}

describe('cspEvalProbes (Vite plugin)', () => {
	for (const [name, source] of Object.entries(FIXTURES)) {
		it(`${name}: without the plugin the bundle probes Function (the CSP violation)`, async () => {
			const { calls, ok } = await bundleAndRun(source, []);
			expect(ok).toBe(true);
			expect(calls.length).toBeGreaterThan(0);
		}, 60_000);

		it(`${name}: with the plugin the bundle never calls Function and still works`, async () => {
			const { calls, ok } = await bundleAndRun(source, [cspEvalProbes()]);
			expect(ok).toBe(true);
			expect(calls).toEqual([]);
		}, 60_000);
	}

	it('fails the build when a known probe module no longer matches, instead of silently doing nothing', () => {
		for (const rewrite of EVAL_PROBE_REWRITES) {
			const plugin = cspEvalProbes();
			const errors = [];
			expect(plugin.transform('export const x = 1;', rewrite.sampleId)).toBeNull();
			plugin.buildEnd.call({ error: (msg) => errors.push(msg) });
			expect(errors.length, rewrite.name).toBe(1);
			expect(errors[0]).toContain(rewrite.name);
		}
	});
});
