import { describe, expect, it } from 'vitest';
import {
	answerGlb,
	childEnv,
	firstGlb,
	INVALID_XAI_KEY,
	isDocumentedRejection,
	legContext,
	redact,
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

	it("reports the GLB on the example's own glb line, not a catalog row printed before it", () => {
		const curl = [
			'catalog  Arm Chair 01  https://cdn.example/objects/ArmChair_01.glb',
			'tool     search_catalog {"q":"wooden chair"}',
			'',
			'GLB: https://cdn.example/objects/painted_wooden_chair_01.glb',
			'',
			'glb      https://cdn.example/objects/painted_wooden_chair_01.glb',
		].join('\n');
		expect(answerGlb(curl)).toBe('https://cdn.example/objects/painted_wooden_chair_01.glb');
		expect(answerGlb('GLB: https://cdn.example/a.glb')).toBe('https://cdn.example/a.glb');
		expect(answerGlb('no model here')).toBeNull();
	});

	it('prints one PASS or FAIL line per example', () => {
		expect(resultLine({ name: 'grok-curl', ok: true, legs: [{ leg: 'three.ws', note: 'live' }] })).toBe(
			`PASS  ${'grok-curl'.padEnd(22)} three.ws: live`,
		);
		expect(resultLine({ name: 'grok-curl', ok: false, legs: [], error: 'npm ci exited 1' })).toBe(
			`FAIL  ${'grok-curl'.padEnd(22)} error: npm ci exited 1`,
		);
	});

	it('points only the remote MCP examples at --mcp-url and never sends that server the three.ws key', () => {
		const base = { PATH: '/bin' };
		const tunnel = 'https://dev.example.test/api/mcp-studio';
		for (const name of ['grok-python-mcp', 'grok-node-responses', 'grok-curl']) {
			expect(legContext({ name, base, threeWsKey: 'sk_live_x', mcpUrl: tunnel })).toEqual({
				base: { PATH: '/bin', THREE_WS_MCP_URL: tunnel },
				threeWsKey: null,
			});
		}
		for (const name of ['grok-x-search-to-3d', 'grok-agent-avatar', 'grok-build-workflow']) {
			expect(legContext({ name, base, threeWsKey: 'sk_live_x', mcpUrl: tunnel })).toEqual({ base, threeWsKey: 'sk_live_x' });
		}
		expect(legContext({ name: 'grok-curl', base, threeWsKey: 'sk_live_x', mcpUrl: null })).toEqual({ base, threeWsKey: 'sk_live_x' });
		expect(base).toEqual({ PATH: '/bin' });
	});

	it('masks every secret in a saved transcript and leaves the rest alone', () => {
		const text = 'authorization: Bearer xai-secret-value\nkey sk_live_abc used twice: sk_live_abc\nglb https://three.ws/a.glb';
		expect(redact(text, { '<XAI_API_KEY>': 'xai-secret-value', '<THREE_WS_API_KEY>': 'sk_live_abc', '<UNSET>': null })).toBe(
			'authorization: Bearer <XAI_API_KEY>\nkey <THREE_WS_API_KEY> used twice: <THREE_WS_API_KEY>\nglb https://three.ws/a.glb',
		);
	});
});
