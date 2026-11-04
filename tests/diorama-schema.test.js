import { describe, it, expect } from 'vitest';
import {
	normalizeDiorama,
	normalizeGame,
	ISLAND_RADIUS,
	SPAWN_RADIUS,
	SAMPLE_DIORAMA,
	DEFAULT_SURVIVE_SEC,
} from '../src/diorama/schema.js';

const objects = ['lantern-a', 'lantern-b', 'lantern-c', 'cabin'].map((id, i) => ({
	id,
	prompt: `a ${id}`,
	position: [i, 0, i],
}));
const world = (game) => ({ prompt: 'lanterns at dusk', mood: 'dusk', objects, ...(game === undefined ? {} : { game }) });

describe('normalizeDiorama game block', () => {
	it('keeps a legacy plan valid as exploration only', () => {
		const { ok, diorama, warnings } = normalizeDiorama(world());
		expect(ok).toBe(true);
		expect(diorama.game).toBeNull();
		expect(warnings).toEqual([]);
		expect(SAMPLE_DIORAMA.game).toBeNull();
	});

	it('accepts a collect goal and bounds count to the targets', () => {
		const { diorama } = normalizeDiorama(world({ goal: 'collect', targetIds: ['lantern-a', 'lantern-b', 'lantern-c'], count: 99, timeLimitSec: 90 }));
		expect(diorama.game).toMatchObject({ goal: 'collect', count: 3, timeLimitSec: 90 });
		expect(normalizeDiorama(world({ goal: 'collect', targetIds: ['lantern-a', 'lantern-b'], count: 0 })).diorama.game.count).toBe(2);
		expect(normalizeDiorama(world({ goal: 'collect', targetIds: ['lantern-a', 'lantern-b'], count: 1 })).diorama.game.count).toBe(1);
	});

	it('reach keeps only the first target and count 1', () => {
		const { diorama } = normalizeDiorama(world({ goal: 'reach', targetIds: ['cabin', 'lantern-a'], count: 5 }));
		expect(diorama.game.targetIds).toEqual(['cabin']);
		expect(diorama.game.count).toBe(1);
		expect(diorama.game.timeLimitSec).toBeNull();
	});

	it('survive always carries a time limit', () => {
		const { diorama } = normalizeDiorama(world({ goal: 'survive', targetIds: ['cabin'] }));
		expect(diorama.game.timeLimitSec).toBe(DEFAULT_SURVIVE_SEC);
		expect(normalizeDiorama(world({ goal: 'survive', targetIds: ['cabin'], timeLimitSec: 99999 })).diorama.game.timeLimitSec).toBe(600);
	});

	it('drops unknown target ids and reports them without failing the world', () => {
		const { ok, diorama, warnings } = normalizeDiorama(world({ goal: 'collect', targetIds: ['lantern-a', 'ghost', 'lantern-a'] }));
		expect(ok).toBe(true);
		expect(diorama.game.targetIds).toEqual(['lantern-a']);
		expect(warnings.join(' ')).toContain('ghost');
	});

	it('drops the game when no valid target survives or the goal is unknown', () => {
		const a = normalizeDiorama(world({ goal: 'collect', targetIds: ['ghost'] }));
		expect(a.ok).toBe(true);
		expect(a.diorama.game).toBeNull();
		expect(normalizeDiorama(world({ goal: 'fly', targetIds: ['cabin'] })).diorama.game).toBeNull();
		expect(normalizeDiorama(world('collect all')).diorama.game).toBeNull();
	});

	it('clamps an out-of-bounds spawn inside the island and defaults a missing one', () => {
		const far = normalizeDiorama(world({ goal: 'reach', targetIds: ['cabin'], spawn: { x: 50, z: 50, heading: 1 } })).diorama.game.spawn;
		expect(Math.hypot(far.x, far.z)).toBeLessThanOrEqual(SPAWN_RADIUS + 0.01);
		expect(SPAWN_RADIUS).toBeLessThan(ISLAND_RADIUS);
		const none = normalizeDiorama(world({ goal: 'reach', targetIds: ['cabin'] })).diorama.game.spawn;
		expect(Math.hypot(none.x, none.z)).toBeLessThanOrEqual(SPAWN_RADIUS);
	});

	it('is idempotent', () => {
		const once = normalizeDiorama(world({ goal: 'collect', targetIds: ['lantern-a', 'lantern-b'], count: 2, timeLimitSec: 60, spawn: { x: 9, z: -9, heading: 0.5 } })).diorama;
		const twice = normalizeDiorama(once).diorama;
		expect(twice).toEqual(once);
	});

	it('normalizeGame treats absent input as no game with no warning', () => {
		expect(normalizeGame(undefined, objects)).toEqual({ game: null, warnings: [] });
		expect(normalizeGame(null, objects)).toEqual({ game: null, warnings: [] });
	});
});
