// zod v4 probes `Function("")` the first time an object schema is constructed,
// to decide whether it may JIT-compile a fast parser. The site CSP has no
// 'unsafe-eval' outside /scene, so that probe files a script-src violation
// report. src/shared/zod.js turns the JIT off, but only for schemas built after
// it runs: dependencies (x402, the MCP SDK, reown, cdp-sdk) build their own
// schemas at import time, before any app module, and /showcase kept reporting
// `script-src blocked eval` from the agent-home chunk in production.
//
// The zodJitlessDefault Vite plugin makes jitless zod's own default, inside
// zod's core module, so it holds before the first schema anywhere exists.
// This test bundles a module that builds a schema at import time (the shape
// of those dependencies) and runs the bundle with `Function` blocked the way
// the CSP blocks it.
import { describe, it, expect } from 'vitest';
import { build } from 'vite';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { zodJitlessDefault } from '../scripts/vite/zod-jitless-default.mjs';

const root = path.resolve(import.meta.dirname, '..');
const ENTRY = '\0zod-dependency-fixture';

// Mirrors a dependency module: imports zod directly and constructs an object
// schema at module top level, never touching src/shared/zod.js.
const fixture = {
	name: 'zod-dependency-fixture',
	enforce: 'pre',
	resolveId(id) {
		return id.endsWith('zod-dependency-fixture') ? ENTRY : null;
	},
	load(id) {
		if (id !== ENTRY) return null;
		return [
			"import { z } from 'zod';",
			'const Payment = z.object({ scheme: z.string(), amount: z.string() });',
			"export const result = Payment.safeParse({ scheme: 'exact', amount: '1' });",
		].join('\n');
	},
};

async function bundleAndRun(plugins) {
	const out = await build({
		root,
		configFile: false,
		logLevel: 'silent',
		plugins: [fixture, ...plugins],
		build: {
			write: false,
			minify: false,
			lib: { entry: 'zod-dependency-fixture', formats: ['es'], fileName: 'fixture' },
		},
	});
	const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => o.output);
	const chunk = outputs.find((o) => o.type === 'chunk' && o.isEntry);
	const dir = mkdtempSync(path.join(tmpdir(), 'zod-jitless-'));
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
		return { calls, result: mod.result };
	} finally {
		globalThis.Function = RealFunction;
		if (prior === undefined) delete globalThis.__zod_globalConfig;
		else globalThis.__zod_globalConfig = prior;
		rmSync(dir, { recursive: true, force: true });
	}
}

describe('zod jitless default (Vite plugin)', () => {
	it('without the plugin, a schema built at import time probes Function (the CSP violation)', async () => {
		const { calls, result } = await bundleAndRun([]);
		expect(result.success).toBe(true);
		expect(calls.length).toBeGreaterThan(0);
	}, 60_000);

	it('with the plugin, the same bundle never calls Function and still validates', async () => {
		const { calls, result } = await bundleAndRun([zodJitlessDefault()]);
		expect(result.success).toBe(true);
		expect(calls).toEqual([]);
	}, 60_000);

	it('fails the build when the zod core no longer matches, instead of silently doing nothing', () => {
		const plugin = zodJitlessDefault();
		const errors = [];
		const untouched = plugin.transform(
			'export const globalConfig = {};',
			'/repo/node_modules/zod/v4/core/core.js',
		);
		expect(untouched).toBeNull();
		plugin.buildEnd.call({ error: (msg) => errors.push(msg) });
		expect(errors.length).toBe(1);
		expect(errors[0]).toMatch(/__zod_globalConfig/);
	});
});
