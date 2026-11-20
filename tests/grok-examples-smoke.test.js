import { describe, expect, it } from 'vitest';
import {
	childEnv,
	firstGlb,
	INVALID_XAI_KEY,
	isDocumentedRejection,
	resultLine,
} from '../scripts/grok-examples-smoke.mjs';

describe('grok examples smoke helpers', () => {
	it('strips every secret from a child environment and adds only the leg values', () => {
		const env = childEnv(
			{ PATH: '/bin', XAI_API_KEY: 'x', GROK_API_KEY: 'g', THREE_WS_API_KEY: 't', AUDIT_EMAIL: 'e', AUDIT_PASSWORD: 'p' },
			{ PORT: '4000', XAI_API_KEY: INVALID_XAI_KEY, THREE_WS_API_KEY: null },
		);
		expect(env).toEqual({ PATH: '/bin', PORT: '4000', XAI_API_KEY: INVALID_XAI_KEY });
	});

	it('keeps the invalid key short enough that the repo key grep never matches it', () => {
		expect(/xai-[A-Za-z0-9]{20,}/.test(INVALID_XAI_KEY)).toBe(false);
	});

	it("accepts only a failed run that carries xAI's own invalid-key answer", () => {
		const answer = 'error    HTTP 400: Incorrect API key provided. You can obtain an API key from https://console.x.ai.';
		expect(isDocumentedRejection({ code: 1, output: answer })).toBe(true);
		expect(isDocumentedRejection({ code: 0, output: answer })).toBe(false);
		expect(isDocumentedRejection({ code: 1, output: 'error    fetch failed' })).toBe(false);
		expect(isDocumentedRejection({ code: 2, output: 'XAI_API_KEY is not set' })).toBe(false);
	});

	it('finds the first GLB URL a run printed', () => {
		const out = 'job      pending\nglb      https://three.ws/cdn/forge/anon/abc.glb  (made in 106s)\nviewer   https://three.ws/viewer?src=x.glb';
		expect(firstGlb(out)).toBe('https://three.ws/cdn/forge/anon/abc.glb');
		expect(firstGlb('no model here')).toBeNull();
	});

	it('prints one PASS or FAIL line per example', () => {
		expect(resultLine({ name: 'grok-curl', ok: true, legs: [{ leg: 'three.ws', note: 'live' }] })).toBe(
			`PASS  ${'grok-curl'.padEnd(22)} three.ws: live`,
		);
		expect(resultLine({ name: 'grok-curl', ok: false, legs: [], error: 'npm ci exited 1' })).toBe(
			`FAIL  ${'grok-curl'.padEnd(22)} error: npm ci exited 1`,
		);
	});
});
