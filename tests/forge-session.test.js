// Forge-in-world session state (src/game/forge-session.js): the part of the
// placement-first flow that has to be right regardless of rendering.
//
//   - one generation at a time, with the hologram pose carried on the job, so a
//     result lands where the player aimed and a retry goes back to the same spot;
//   - a failed attempt is recorded in history but never touches the build budget
//     (nothing was spawned);
//   - session history is newest first, capped, and re-armable without regenerating;
//   - observed timing is computed from real completed forges only;
//   - a placement the room refuses for its ASSET (asset_url, asset_size) rolls
//     back the palette entry that was armed for it; a refusal for a cap does not,
//     because the model is still fine to place elsewhere or later.

import { describe, it, expect } from 'vitest';
import { ForgeSession, PendingSpawns, ASSET_REJECT_REASONS } from '../src/game/forge-session.js';
import { registerUploadedProp, unregisterUploadedProp, propDef } from '../src/game/world-objects.js';

function clock(start = 1_000_000) {
	let t = start;
	return { now: () => t, advance: (ms) => { t += ms; } };
}

describe('ForgeSession', () => {
	it('runs one generation at a time and carries the hologram pose on the job', () => {
		const c = clock();
		const s = new ForgeSession({ now: c.now });
		const job = s.begin({ prompt: 'a brass lantern', name: 'a brass lantern' });
		expect(s.busy).toBe(true);
		expect(() => s.begin({ prompt: 'another' })).toThrow();
		s.setPose({ x: 4, y: 0, z: -2, yaw: Math.PI / 2, scale: 1 });
		expect(job.pose).toEqual({ x: 4, y: 0, z: -2, yaw: Math.PI / 2, scale: 1 });
	});

	it('records a success with its measured duration and size, newest first', () => {
		const c = clock();
		const s = new ForgeSession({ now: c.now });
		s.begin({ prompt: 'first', name: 'first' });
		c.advance(41_000);
		s.succeed({ url: 'https://pub-test.r2.dev/a.glb', propId: 'u:a', triangles: 12_000, bytes: 900_000, simplified: false });
		s.clear();
		s.begin({ prompt: 'second', name: 'second' });
		c.advance(29_000);
		const entry = s.succeed({ url: 'https://pub-test.r2.dev/b.glb', propId: 'u:b', triangles: 59_000, bytes: 4_000_000, simplified: true });
		expect(entry).toMatchObject({ ok: true, name: 'second', seconds: 29, simplified: true, propId: 'u:b' });
		expect(s.history.map((e) => e.name)).toEqual(['second', 'first']);
		expect(s.busy).toBe(false);
	});

	it('records a failure with the reason and keeps the request so it can be retried', () => {
		const s = new ForgeSession({ now: clock().now });
		const file = { name: 'ref.png' };
		s.begin({ prompt: 'a lantern', file, name: 'a lantern' });
		s.setPose({ x: 1, y: 0, z: 1, yaw: 0, scale: 1 });
		const entry = s.fail('The forge could not build that.');
		expect(entry).toMatchObject({ ok: false, message: 'The forge could not build that.', prompt: 'a lantern' });
		expect(s.job.state).toBe('failed');
		expect(s.busy).toBe(false);
		expect(s.retryRequest()).toEqual({ prompt: 'a lantern', file, pose: { x: 1, y: 0, z: 1, yaw: 0, scale: 1 } });
	});

	it('caps the history so a long session cannot grow it without bound', () => {
		const s = new ForgeSession({ now: clock().now, historyMax: 3 });
		for (let i = 0; i < 5; i++) {
			s.begin({ prompt: `item ${i}`, name: `item ${i}` });
			s.succeed({ url: `https://pub-test.r2.dev/${i}.glb`, propId: `u:${i}`, triangles: 1, bytes: 1, simplified: false });
			s.clear();
		}
		expect(s.history.map((e) => e.name)).toEqual(['item 4', 'item 3', 'item 2']);
	});

	it('reports observed timing only from completed forges', () => {
		const c = clock();
		const s = new ForgeSession({ now: c.now });
		expect(s.observed()).toEqual({ count: 0, medianSeconds: null });
		for (const ms of [30_000, 52_000, 41_000]) {
			s.begin({ prompt: 'x', name: 'x' });
			c.advance(ms);
			s.succeed({ url: `https://pub-test.r2.dev/${ms}.glb`, propId: `u:${ms}`, triangles: 1, bytes: 1, simplified: false });
			s.clear();
		}
		s.begin({ prompt: 'y', name: 'y' });
		c.advance(300_000);
		s.fail('timed out');
		expect(s.observed()).toEqual({ count: 3, medianSeconds: 41 });
	});
});

describe('PendingSpawns (refused-placement rollback)', () => {
	it('rolls back the palette entry when the room refuses the asset itself', () => {
		const p = new PendingSpawns();
		const id = p.track({ propId: 'u:heavy', url: 'https://pub-test.r2.dev/heavy.glb' });
		expect(id).toMatch(/^[A-Za-z0-9_-]{1,48}$/);
		for (const reason of ASSET_REJECT_REASONS) {
			const pid = p.track({ propId: `u:${reason}`, url: 'https://pub-test.r2.dev/x.glb' });
			expect(p.reject(pid, reason)).toEqual({ propId: `u:${reason}`, url: 'https://pub-test.r2.dev/x.glb', rollback: true, reason });
		}
		expect(p.reject(id, 'asset_size').rollback).toBe(true);
		expect(p.reject(id, 'asset_size')).toBeNull();
	});

	it('keeps the palette entry when the refusal is a cap, not the model', () => {
		const p = new PendingSpawns();
		const id = p.track({ propId: 'u:ok', url: 'https://pub-test.r2.dev/ok.glb' });
		expect(p.reject(id, 'player_full')).toMatchObject({ propId: 'u:ok', rollback: false });
	});

	it('forgets a placement once the room confirms it', () => {
		const p = new PendingSpawns();
		const id = p.track({ propId: 'u:ok', url: 'https://pub-test.r2.dev/ok.glb' });
		expect(p.confirm(id)).toMatchObject({ propId: 'u:ok' });
		expect(p.reject(id, 'asset_url')).toBeNull();
	});
});

describe('unregisterUploadedProp', () => {
	it('removes a registered model so the palette and propDef no longer offer it', () => {
		const def = registerUploadedProp('https://pub-test.r2.dev/rollback.glb', { name: 'Rollback' });
		expect(propDef(def.id)).toBe(def);
		expect(unregisterUploadedProp(def.id)).toBe(true);
		expect(propDef(def.id)).toBeNull();
		expect(unregisterUploadedProp(def.id)).toBe(false);
	});
});
