// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Scene, Object3D } from 'three';

// The marquee paints onto a canvas; jsdom has no 2D context, so give it a
// recording stand-in. Only the canvas surface is replaced, the landmark's own
// proximity and lifecycle logic runs for real.
vi.mock('../src/game/screen-texture.js', async () => {
	const { MeshBasicMaterial } = await import('three');
	const ctx = new Proxy({}, {
		get: (t, k) => (k === 'measureText' ? () => ({ width: 10 }) : (k in t ? t[k] : () => ({ addColorStop() {} }))),
		set: (t, k, v) => { t[k] = v; return true; },
	});
	return {
		makeScreenCanvas: () => ({ canvas: {}, ctx }),
		makeScreenTexture: () => ({ dispose() {} }),
		screenMaterial: () => new MeshBasicMaterial(),
	};
});

const shows = [];
vi.mock('../src/game/plaza-stage-show.js', () => ({
	PlazaStageShow: class {
		constructor(opts) { this.opts = opts; this.started = 0; this.disposed = 0; this.setDetail = vi.fn(); shows.push(this); }
		async start() { this.started++; }
		dispose() { this.disposed++; }
		setStageDetail(d) { this.setDetail(d); }
		togglePanel() {}
		ask() { return 'sent'; }
	},
}));

import { PlazaStage } from '../src/game/plaza-stage.js';
import { PLAZA_STAGE } from '../multiplayer/src/world-features.js';

const MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const flush = () => new Promise((r) => setTimeout(r, 0));

function makeStage() {
	const player = { x: 0, y: 0, z: 0 };
	const stage = new PlazaStage({
		scene: new Scene(), camera: new Object3D(), getPlayer: () => player, coin: { mint: MINT }, ui: { toast: vi.fn() },
	});
	const at = (dist) => { player.x = PLAZA_STAGE.x + dist; player.z = PLAZA_STAGE.z; };
	return { stage, at };
}

beforeEach(() => {
	shows.length = 0;
	document.body.innerHTML = '';
	globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ stage: null, live: false }) }));
});

describe('PlazaStage landmark lifecycle', () => {
	it('makes no request and mounts no show for a player who never approaches', async () => {
		const { stage, at } = makeStage();
		at(80);
		for (let i = 0; i < 120; i++) stage.tick(0.5);
		await flush();
		expect(globalThis.fetch).not.toHaveBeenCalled();
		expect(shows).toHaveLength(0);
		stage.dispose();
	});

	it('reads the show state once inside the marquee ring but does not join the room', async () => {
		const { stage, at } = makeStage();
		at(20);
		stage.tick(0.1);
		await flush();
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
		expect(globalThis.fetch.mock.calls[0][0]).toContain(`/api/stage?coin=${MINT}`);
		expect(shows).toHaveLength(0);
		stage.dispose();
	});

	it('joins the show only once inside the attend ring, then leaves with hysteresis', async () => {
		const { stage, at } = makeStage();
		at(20); stage.tick(0.1); await flush();
		at(12); stage.tick(0.1); await flush();
		expect(shows).toHaveLength(1);
		expect(shows[0].started).toBe(1);

		// Just past the attend edge but inside the hysteresis band: still attending.
		at(14.5); stage.tick(0.1);
		expect(shows[0].disposed).toBe(0);
		// Past the band: the show is torn down.
		at(17); stage.tick(0.1);
		expect(shows[0].disposed).toBe(1);

		// Re-approach builds a fresh show.
		at(12); stage.tick(0.1); await flush();
		expect(shows).toHaveLength(2);
		stage.dispose();
		expect(shows[1].disposed).toBe(1);
	});

	it('does not join when the player walked back out while the chunk was loading', async () => {
		const { stage, at } = makeStage();
		at(12); stage.tick(0.1);
		at(40); stage.tick(0.1);
		await flush();
		expect(shows.every((s) => s.started === 0 || s.disposed === 1)).toBe(true);
		stage.dispose();
	});

	it('interact() stays synchronous and consumes the press only inside the venue', () => {
		const { stage, at } = makeStage();
		at(60);
		expect(stage.interact()).toBe(false);
		at(8);
		const r = stage.interact();
		expect(r).toBe(true);
		expect(typeof r.then).toBe('undefined');
		stage.dispose();
	});

	it('ask() answers "away" with no show mounted', () => {
		const { stage } = makeStage();
		expect(stage.ask('hi')).toBe('away');
		stage.dispose();
	});
});

describe('the world mounts the plaza stage', () => {
	const src = readFileSync(resolve(process.cwd(), 'src/game/coincommunities.js'), 'utf8');

	it('constructs it only for worlds with a coin mint, beside the other landmarks', () => {
		expect(src).toMatch(/import \{ PlazaStage \} from '\.\/plaza-stage\.js'/);
		expect(src).toMatch(/this\.plazaStage = this\.coin\?\.mint\s*\?\s*new PlazaStage\(/);
	});

	it('ticks it, routes E to it and disposes it with the world', () => {
		expect(src).toContain('this.plazaStage?.tick(dt)');
		expect(src).toContain('!this.plazaStage?.interact()');
		expect(src).toMatch(/if \(this\.plazaStage\) \{ this\.plazaStage\.dispose\(\); this\.plazaStage = null; \}/);
	});

	it('sends chat-bar text to the host as a question when the player is at the stage', () => {
		expect(src).toMatch(/const asked = this\.plazaStage\?\.ask\(text\)/);
		expect(src).toMatch(/asked !== 'away'/);
	});
});
