// @vitest-environment jsdom
// zod v4 probes `Function("")` the first time an object schema is constructed,
// to decide whether it may JIT-compile a fast parser. Under the production CSP
// (no 'unsafe-eval' outside /scene) that probe is blocked: zod falls back, but
// the browser files a script-src violation report on every page that loads a
// zod schema (/app-classic and /showcase did, via src/widget-types.js).
// src/shared/zod.js turns the JIT off before any schema exists, so the probe
// never runs. This test makes `Function` behave as it does under the CSP and
// asserts nothing reaches it while the schema modules load and parse.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const calls = [];
const RealFunction = globalThis.Function;

beforeAll(() => {
	globalThis.Function = function CspBlockedFunction(...args) {
		calls.push(args);
		throw new EvalError('Evaluating a string as JavaScript violates the Content Security Policy');
	};
});

afterAll(() => {
	globalThis.Function = RealFunction;
});

describe('zod schemas under a no-eval CSP', () => {
	it('widget-types builds and validates schemas without calling Function', async () => {
		const { defaultConfig, widgetConfigSchemas, WIDGET_TYPE_KEYS } = await import(
			'../src/widget-types.js'
		);
		for (const type of WIDGET_TYPE_KEYS) {
			const res = widgetConfigSchemas[type].safeParse(defaultConfig(type));
			expect(typeof res.success, type).toBe('boolean');
		}
		expect(calls).toEqual([]);
	});

	it('the agent manifest schema module loads without calling Function', async () => {
		await import('../src/editor/manifest-builder.js');
		expect(calls).toEqual([]);
	});

	it('no browser module imports zod directly, so the jitless config always applies first', () => {
		const root = path.resolve(import.meta.dirname, '../src');
		const direct = [];
		const walk = (dir) => {
			for (const ent of readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, ent.name);
				if (ent.isDirectory()) {
					if (ent.name !== 'node_modules' && ent.name !== 'vendor') walk(full);
				} else if (/\.(m?js|ts)$/.test(ent.name) && full !== path.join(root, 'shared/zod.js')) {
					if (/from\s+['"]zod(\/[^'"]*)?['"]/.test(readFileSync(full, 'utf8'))) {
						direct.push(path.relative(root, full));
					}
				}
			}
		};
		walk(root);
		expect(direct, 'import { z } from src/shared/zod.js instead').toEqual([]);
	});
});
