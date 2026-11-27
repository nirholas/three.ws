// A Forge submit or rig that fails inside a provider answers with our own copy
// and a support reference, never the provider's text.
//
// Before this, api/forge.js and its clone api/gpt-forge.js put `err.message`
// straight into the response for invalid_key, insufficient_credits (own key),
// generation_failed and rig_failed. The Forge page no longer shows `message`,
// but every direct API caller (the MCP tools, the SDKs, the ChatGPT surface)
// still received a provider's raw error: vendor names, task ids, internal
// hostnames, stack frames, and on one path a credential echoed back.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forgeFailureBody, FORGE_FAILURE_COPY } from '../../api/_lib/forge-public-error.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const HOSTILE =
	'Replicate prediction 9f3c2a1b failed: CUDA out of memory at ' +
	'https://api.replicate.com/v1/predictions?token=r8_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789 ' +
	'(model-trellis-abc123-uc.a.run.app) TypeError: x is undefined\n    at run (/srv/worker.js:12:7)';
const LEAK = [/replicate/i, /cuda/i, /https?:/i, /r8_/, /run\.app/, /TypeError/, /worker\.js/];

afterEach(() => vi.restoreAllMocks());

describe('forgeFailureBody', () => {
	it.each(Object.keys(FORGE_FAILURE_COPY))('%s: our copy and a ref, never the provider text', (code) => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const body = forgeFailureBody(code, Object.assign(new Error(HOSTILE), { code }));
		expect(body.error).toBe(code);
		expect(body.message).toBe(FORGE_FAILURE_COPY[code]);
		for (const re of LEAK) expect(JSON.stringify(body)).not.toMatch(re);
		expect(body.ref).toMatch(/^[A-Za-z0-9_-]{4,64}$/);
		// The operator still gets the raw failure, tied to the ref the user quotes,
		// with anything shaped like a credential removed.
		const line = log.mock.calls.map((c) => c.join(' ')).join('\n');
		expect(line).toContain(body.ref);
		expect(line).toContain('CUDA out of memory');
		expect(line).not.toContain('r8_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789');
	});

	it('each ref is distinct so one quote finds one log line', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const a = forgeFailureBody('generation_failed', new Error('x'));
		const b = forgeFailureBody('generation_failed', new Error('x'));
		expect(a.ref).not.toBe(b.ref);
	});
});

describe('the handlers relay no provider text for these codes', () => {
	// Every json() body in the two handlers whose error is one of these codes,
	// read from source, must not take its message from the caught error.
	for (const file of ['api/forge.js', 'api/gpt-forge.js']) {
		it(file, () => {
			const src = readFileSync(join(ROOT, file), 'utf8');
			const offenders = [];
			const re = /json\(res,\s*\d+,\s*\{([^}]*)\}/g;
			for (const m of src.matchAll(re)) {
				const inner = m[1];
				const code = /error:\s*'([a-z_]+)'/.exec(inner)?.[1];
				if (!code || !Object.hasOwn(FORGE_FAILURE_COPY, code)) continue;
				if (/message:\s*err\??\.message/.test(inner)) offenders.push(`${code} at offset ${m.index}`);
			}
			expect(offenders).toEqual([]);
		});
	}
});
