// scripts/forge-live-walkthrough.mjs: the pure checks behind each stage verdict.
// The live stages themselves run against production (npm run forge:walkthrough);
// these pin the parts that decide pass or fail, so a GLB validator or a 429 rule
// that silently loosens cannot turn a broken Forge green.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
	MAX_TRIANGLES,
	MIN_TRIANGLES,
	cookieHeader,
	exitCodeFor,
	freshPrompt,
	inspectGlb,
	isThrottled,
	judgeCanvas,
	parseArgs,
	plannedGenerations,
	retryAfterSeconds,
	scopeStorageState,
	summaryLine,
} from '../scripts/forge-live-walkthrough.mjs';

// Build a GLB from a glTF JSON object and a binary payload, padded per spec.
function buildGlb(json, bin = new Uint8Array(0)) {
	const enc = new TextEncoder().encode(JSON.stringify(json));
	const jsonLen = Math.ceil(enc.length / 4) * 4;
	const binLen = Math.ceil(bin.length / 4) * 4;
	const total = 12 + 8 + jsonLen + (bin.length ? 8 + binLen : 0);
	const out = new Uint8Array(total);
	const dv = new DataView(out.buffer);
	dv.setUint32(0, 0x46546c67, true);
	dv.setUint32(4, 2, true);
	dv.setUint32(8, total, true);
	dv.setUint32(12, jsonLen, true);
	dv.setUint32(16, 0x4e4f534a, true);
	out.fill(0x20, 20, 20 + jsonLen);
	out.set(enc, 20);
	if (bin.length) {
		const at = 20 + jsonLen;
		dv.setUint32(at, binLen, true);
		dv.setUint32(at + 4, 0x004e4942, true);
		out.set(bin, at + 8);
	}
	return out;
}

function meshJson(indexCount, { mode, viewLength = 16 } = {}) {
	return {
		asset: { version: '2.0' },
		buffers: [{ byteLength: 16 }],
		bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: viewLength }],
		accessors: [
			{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
			{ bufferView: 0, componentType: 5125, count: indexCount, type: 'SCALAR' },
		],
		meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, ...(mode != null ? { mode } : {}) }] }],
	};
}

describe('inspectGlb', () => {
	it('accepts a real served GLB and counts its meshes and triangles', () => {
		const buf = readFileSync(resolve(__dirname, '../public/avatars/default.glb'));
		const g = inspectGlb(buf);
		expect(g.ok).toBe(true);
		expect(g.meshes).toBeGreaterThan(0);
		expect(g.triangles).toBeGreaterThanOrEqual(MIN_TRIANGLES);
		expect(g.bytes).toBe(buf.length);
	});

	it('rejects an HTML error page served with a 200', () => {
		const g = inspectGlb(new TextEncoder().encode('<!doctype html><html><body>Not found</body></html>'));
		expect(g.ok).toBe(false);
		expect(g.reason).toMatch(/instead of the glTF magic bytes/);
	});

	it('rejects a truncated download by the length in its header', () => {
		const full = buildGlb(meshJson(300), new Uint8Array(16));
		const g = inspectGlb(full.subarray(0, full.length - 8));
		expect(g.ok).toBe(false);
		expect(g.reason).toMatch(/header says \d+ bytes but the file has \d+/);
	});

	it('rejects a GLB with no meshes', () => {
		const g = inspectGlb(buildGlb({ asset: { version: '2.0' } }));
		expect(g.ok).toBe(false);
		expect(g.reason).toBe('the file has no meshes');
	});

	it('rejects a model below the triangle floor and above the ceiling', () => {
		const tiny = inspectGlb(buildGlb(meshJson(30), new Uint8Array(16)));
		expect(tiny.ok).toBe(false);
		expect(tiny.reason).toMatch(/only 10 triangles/);
		const huge = inspectGlb(buildGlb(meshJson((MAX_TRIANGLES + 1) * 3), new Uint8Array(16)));
		expect(huge.ok).toBe(false);
		expect(huge.reason).toMatch(/not a sane Forge output/);
	});

	it('counts triangle strips and ignores line primitives', () => {
		expect(inspectGlb(buildGlb(meshJson(502, { mode: 5 }), new Uint8Array(16))).triangles).toBe(500);
		const lines = inspectGlb(buildGlb(meshJson(3000, { mode: 1 }), new Uint8Array(16)));
		expect(lines.ok).toBe(false);
		expect(lines.triangles).toBe(0);
	});

	it('rejects a buffer view that points past the binary chunk', () => {
		const g = inspectGlb(buildGlb(meshJson(300, { viewLength: 4096 }), new Uint8Array(16)));
		expect(g.ok).toBe(false);
		expect(g.reason).toMatch(/buffer view 0 runs past the end/);
	});

	it('rejects a file too short to hold a header', () => {
		expect(inspectGlb(new Uint8Array(8)).reason).toMatch(/too small to be a GLB/);
	});
});

describe('the 429 rule', () => {
	it('reads the wait from the body first, then Retry-After, then RateLimit-Reset', () => {
		expect(retryAfterSeconds({ body: { retry_after: 44.2 }, headers: { 'retry-after': '9' } })).toBe(45);
		expect(retryAfterSeconds({ headers: { 'retry-after': '30' } })).toBe(30);
		expect(retryAfterSeconds({ headers: { 'ratelimit-reset': '12' } })).toBe(12);
		const later = new Date(Date.now() + 20_000).toUTCString();
		const fromDate = retryAfterSeconds({ headers: { 'retry-after': later } });
		expect(fromDate).toBeGreaterThanOrEqual(18);
		expect(fromDate).toBeLessThanOrEqual(21);
	});

	it('returns null when no wait is stated, so the caller uses its own default', () => {
		expect(retryAfterSeconds({ headers: {}, body: { error: 'rate_limited' } })).toBeNull();
		expect(retryAfterSeconds()).toBeNull();
	});

	it('treats HTTP 429 and the rate_limited error code as throttled, nothing else', () => {
		expect(isThrottled(429, null)).toBe(true);
		expect(isThrottled(503, { error: 'rate_limited' })).toBe(true);
		expect(isThrottled(503, { error: 'unconfigured' })).toBe(false);
		expect(isThrottled(200, { status: 'done' })).toBe(false);
	});
});

describe('judgeCanvas', () => {
	it('calls an empty or single-colour canvas blank', () => {
		expect(judgeCanvas({ width: 0, height: 0 }).blank).toBe(true);
		expect(judgeCanvas({ width: 800, height: 600, changedFraction: 0.001, distinctColors: 200 }).blank).toBe(true);
		expect(judgeCanvas({ width: 800, height: 600, changedFraction: 0.3, distinctColors: 3 }).blank).toBe(true);
	});

	it('passes a canvas with a drawn, shaded model', () => {
		expect(judgeCanvas({ width: 800, height: 600, changedFraction: 0.05, distinctColors: 181 }).blank).toBe(false);
	});
});

describe('arguments and plan', () => {
	it('parses every flag', () => {
		expect(parseArgs(['--base', 'http://localhost:4105/', '--text', ' a lamp ', '--photo', 'p.jpg', '--out', 'r.json', '--headed'])).toEqual({
			base: 'http://localhost:4105',
			text: 'a lamp',
			photo: 'p.jpg',
			skipGenerate: false,
			out: 'r.json',
			headed: true,
			help: false,
		});
	});

	it('refuses contradictory or incomplete flags', () => {
		expect(() => parseArgs(['--skip-generate', '--text', 'x'])).toThrow(/cannot be combined/);
		expect(() => parseArgs(['--text'])).toThrow(/needs a value/);
		expect(() => parseArgs(['--photo', '--headed'])).toThrow(/needs a value/);
		expect(() => parseArgs(['--bogus'])).toThrow(/Unknown argument/);
	});

	it('makes one text generation by default, and only what was asked otherwise', () => {
		expect(plannedGenerations(parseArgs([]))).toEqual(['text']);
		expect(plannedGenerations(parseArgs(['--photo', 'p.jpg']))).toEqual(['photo']);
		expect(plannedGenerations(parseArgs(['--text', 'a', '--photo', 'p.jpg']))).toEqual(['text', 'photo']);
		expect(plannedGenerations(parseArgs(['--skip-generate']))).toEqual([]);
	});

	it('picks an ordinary single-object prompt', () => {
		expect(freshPrompt(() => 0)).toBe('a ceramic teapot with matte blue glaze, single object, plain background, studio lighting');
		expect(freshPrompt(() => 0.999)).toMatch(/^a enamel coffee mug with pastel painted wood/);
	});
});

describe('session cookies', () => {
	const state = {
		cookies: [
			{ name: '__Host-sid', value: 'abc', domain: 'three.ws', path: '/', secure: true },
			{ name: 'other', value: 'x', domain: 'example.com', path: '/' },
		],
		origins: [],
	};

	it('sends only the three.ws cookie to three.ws', () => {
		expect(cookieHeader(state, 'https://three.ws')).toBe('__Host-sid=abc');
		expect(cookieHeader(state, 'https://example.org')).toBe('');
	});

	it('re-scopes the three.ws session to a local dev server and drops foreign cookies', () => {
		const scoped = scopeStorageState(state, 'http://localhost:4105');
		expect(scoped.cookies).toHaveLength(1);
		expect(scoped.cookies[0]).toMatchObject({ name: '__Host-sid', domain: 'localhost' });
		expect(scopeStorageState(state, 'https://three.ws').cookies[0].domain).toBe('three.ws');
	});
});

describe('verdict', () => {
	it('exits 0 only when no stage that ran failed', () => {
		expect(exitCodeFor([{ status: 'pass' }, { status: 'skip' }])).toBe(0);
		expect(exitCodeFor([{ status: 'pass' }, { status: 'fail' }])).toBe(1);
		expect(exitCodeFor([])).toBe(0);
	});

	it('prints one readable line per stage', () => {
		expect(summaryLine({ status: 'pass', label: 'Signed in as the QA user', ms: 210, summary: 'qa@x' })).toBe('PASS  Signed in as the QA user (0.2s): qa@x');
		expect(summaryLine({ status: 'skip', label: 'Photo makes a model', ms: null, summary: 'skipped: no photo' })).toBe('SKIP  Photo makes a model: skipped: no photo');
	});
});
