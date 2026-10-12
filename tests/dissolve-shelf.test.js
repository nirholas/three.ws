/**
 * The /dissolve shelf and share links (src/dissolve/shelf.js).
 *
 *  · every shelf model is a real file on disk, not a dead link
 *  · a share link round-trips, and a hostile or stale one falls back safely
 *  · only https or same-origin model links are ever fetched
 */

import { describe, it, expect } from 'vitest';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SHELF, PRESETS, QUALITY, shelfEntry, parseModelUrl, readState, writeState } from '../src/dissolve/shelf.js';

const root = resolve(__dirname, '..');

describe('shelf', () => {
	it('points every model at a real GLB under public/', () => {
		for (const item of SHELF) {
			const file = resolve(root, 'public', item.url.replace(/^\//, ''));
			expect(existsSync(file), item.url).toBe(true);
			expect(statSync(file).size, item.url).toBeGreaterThan(1024);
			// glTF binary magic
			expect(readFileSync(file).subarray(0, 4).toString('ascii'), item.url).toBe('glTF');
		}
	});

	it('has unique ids', () => {
		expect(new Set(SHELF.map((s) => s.id)).size).toBe(SHELF.length);
	});

	it('finds an entry by id and nothing for an unknown one', () => {
		expect(shelfEntry('fox').url).toBe('/avatars/fox.glb');
		expect(shelfEntry('nope')).toBeNull();
	});

	it('gives every preset the parameters the engine reads', () => {
		for (const p of Object.values(PRESETS)) {
			for (const key of ['spring', 'damp', 'turb', 'arc', 'stagger', 'size', 'bright', 'bloom']) {
				expect(Number.isFinite(p[key]), key).toBe(true);
			}
		}
	});

	it('keeps every quality tier a power-of-two texture side', () => {
		for (const q of Object.values(QUALITY)) expect(Math.log2(q.side) % 1).toBe(0);
	});
});

describe('parseModelUrl', () => {
	it('accepts https and same-origin paths', () => {
		expect(parseModelUrl('https://cdn.example.com/a.glb')).toBe('https://cdn.example.com/a.glb');
		expect(parseModelUrl('/avatars/fox.glb')).toBe('https://three.ws/avatars/fox.glb');
	});

	it('refuses everything that is not a safe model link', () => {
		for (const bad of ['http://evil.example/a.glb', 'javascript:alert(1)', 'data:model/gltf-binary;base64,AAAA', 'file:///etc/passwd', '', null, undefined, 42, 'https://' + 'a'.repeat(3000)]) {
			expect(parseModelUrl(bad), String(bad).slice(0, 40)).toBeNull();
		}
	});
});

describe('share state', () => {
	it('round-trips', () => {
		const s = { a: 'xbot', b: 'fox', preset: 'ember', quality: 'ultra' };
		expect(readState(writeState(s))).toEqual(s);
	});

	it('falls back on unknown values instead of trusting the link', () => {
		const s = readState('?a=<script>&b=ftp://x&p=nuke&q=9000');
		expect(s).toEqual({ a: 'agent', b: 'fox', preset: 'storm', quality: null });
	});

	it('keeps a valid external model link', () => {
		const s = readState('?a=https%3A%2F%2Fcdn.example.com%2Fm.glb');
		expect(s.a).toBe('https://cdn.example.com/m.glb');
	});
});
