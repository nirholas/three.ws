// With the site CSP no longer granting 'unsafe-eval', libraries that probe for
// code generation must take their documented fallback. This executes that
// degradation (Function() throws) instead of assuming it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const realFunction = globalThis.Function;
let blocked = 0;

beforeAll(() => {
	globalThis.Function = new Proxy(realFunction, {
		construct() {
			blocked++;
			throw new EvalError('Refused to evaluate a string as JavaScript');
		},
		apply() {
			blocked++;
			throw new EvalError('Refused to evaluate a string as JavaScript');
		},
	});
});
afterAll(() => {
	globalThis.Function = realFunction;
});

describe('libraries degrade when eval is blocked', () => {
	it('colyseus.js loads with its code-generation probe refused', async () => {
		const colyseus = await import('colyseus.js');
		expect(typeof colyseus.Client).toBe('function');
		// Loading the module ran the library's own `Function('')` feature test,
		// which must have been refused and recorded rather than crashing the page.
		expect(blocked).toBeGreaterThan(0);
		const client = new colyseus.Client('ws://127.0.0.1:1');
		expect(client).toBeTruthy();
	});

	it('zod parses with its JIT probe refused', async () => {
		const { z } = await import('zod');
		const schema = z.object({ a: z.string(), b: z.number() });
		expect(schema.parse({ a: 'x', b: 2 })).toEqual({ a: 'x', b: 2 });
		expect(() => schema.parse({ a: 1 })).toThrow();
	});
});
