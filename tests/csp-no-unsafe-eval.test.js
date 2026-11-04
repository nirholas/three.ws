// Audit finding H12: no CSP in vercel.json may carry the bare 'unsafe-eval'
// token outside the Scene Studio route. 'wasm-unsafe-eval' (WebAssembly only)
// is a different token and is allowed everywhere.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { unsafeEvalViolations, UNSAFE_EVAL_ALLOWED_SRCS } from '../scripts/lib/csp-headers.mjs';

const routes = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).routes;
const csp = (script) => ({ src: '/x', headers: { 'content-security-policy': `object-src 'none'; script-src ${script}` } });

describe('unsafeEvalViolations', () => {
	it('flags a bare unsafe-eval on a route outside the allow list', () => {
		expect(unsafeEvalViolations([csp("'self' 'unsafe-eval'")])).toEqual(['/x']);
	});
	it('accepts wasm-unsafe-eval (a different token)', () => {
		expect(unsafeEvalViolations([csp("'self' 'wasm-unsafe-eval'")])).toEqual([]);
	});
	it('accepts unsafe-eval on an allowed route', () => {
		const r = { src: UNSAFE_EVAL_ALLOWED_SRCS[0], headers: csp("'self' 'unsafe-eval'").headers };
		expect(unsafeEvalViolations([r])).toEqual([]);
	});
});

describe('vercel.json', () => {
	it('keeps unsafe-eval only on the allowed routes', () => {
		expect(unsafeEvalViolations(routes)).toEqual([]);
	});
	it('gives WebAssembly decoders wasm-unsafe-eval on the global policy', () => {
		const global = routes.find((r) => r.src === '/(.*)' && r.headers?.['content-security-policy']);
		expect(global.headers['content-security-policy']).toContain("'wasm-unsafe-eval'");
	});
});
