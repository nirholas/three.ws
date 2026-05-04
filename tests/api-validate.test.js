// Coverage for api/_lib/validate.js — the zod helpers that gate every API
// endpoint's input. We verify:
//
//   1. parse() returns parsed data on success
//   2. parse() throws a structured 400 with `issues` on failure
//   3. validateQuery() correctly extracts and parses URL search params
//   4. validateBody() round-trips through readJson + parse and surfaces the
//      same structured error envelope on bad input

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { parse, validateQuery, validateBody } from '../api/_lib/validate.js';

const schema = z.object({
	name: z.string().min(1),
	count: z.coerce.number().int().min(0).max(100),
});

describe('validate.parse', () => {
	it('returns parsed data on success', () => {
		const res = parse(schema, { name: 'a', count: 5 });
		expect(res).toEqual({ name: 'a', count: 5 });
	});

	it('throws structured 400 with issues on failure', () => {
		try {
			parse(schema, { name: '', count: 999 });
			expect.fail('parse should have thrown');
		} catch (err) {
			expect(err.status).toBe(400);
			expect(err.code).toBe('validation_error');
			expect(Array.isArray(err.issues)).toBe(true);
			expect(err.issues.length).toBeGreaterThan(0);
			expect(err.issues[0]).toHaveProperty('path');
			expect(err.issues[0]).toHaveProperty('message');
		}
	});
});

describe('validate.validateQuery', () => {
	it('parses search params, coercing numerics', () => {
		const req = { url: '/x?name=foo&count=42' };
		expect(validateQuery(req, schema)).toEqual({ name: 'foo', count: 42 });
	});

	it('throws with issues on bad query', () => {
		const req = { url: '/x?name=&count=-1' };
		try {
			validateQuery(req, schema);
			expect.fail('validateQuery should have thrown');
		} catch (err) {
			expect(err.code).toBe('validation_error');
			expect(err.issues.length).toBeGreaterThan(0);
		}
	});
});

describe('validate.validateBody', () => {
	function makeReq(body, ct = 'application/json') {
		const buf = Buffer.from(JSON.stringify(body));
		return {
			headers: { 'content-type': ct },
			on(evt, cb) {
				if (evt === 'data') queueMicrotask(() => cb(buf));
				if (evt === 'end') queueMicrotask(() => cb());
			},
			destroy() {},
		};
	}

	it('parses a JSON body through the schema', async () => {
		const req = makeReq({ name: 'x', count: 7 });
		const res = await validateBody(req, schema);
		expect(res).toEqual({ name: 'x', count: 7 });
	});

	it('throws structured error on bad JSON body', async () => {
		const req = makeReq({ name: '', count: 'not-a-number' });
		try {
			await validateBody(req, schema);
			expect.fail('validateBody should have thrown');
		} catch (err) {
			expect(err.status).toBe(400);
			expect(err.code).toBe('validation_error');
			expect(err.issues.length).toBeGreaterThan(0);
		}
	});

	it('refuses non-JSON content-type', async () => {
		const req = makeReq({ name: 'x', count: 1 }, 'text/plain');
		await expect(validateBody(req, schema)).rejects.toThrow(/content-type/);
	});
});
