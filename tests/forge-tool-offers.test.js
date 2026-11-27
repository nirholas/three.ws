// @vitest-environment jsdom
//
// Forge pages offer only the tools the worker fleet can run (forge-hardening
// order 83, 2026-11-27). Production had no LATO.2, texture or HoloPart worker
// configured, yet:
//
//   - Game-Ready offered "Artist mesh", and the API quietly ran QuadriFlow instead.
//   - The editor's Magic Brush let a visitor paint a region and write a prompt,
//     then answered 501 "Set GCP_RECONSTRUCTION_KEY and GCP_TEXTURE_URL".
//   - Restyle Studio offered "Regenerate part", which answered 503 "Set
//     MODEL_HOLOPART_URL ...".
//
// The server now says which tools can run (GET /api/forge?catalog -> tools).
// These tests pin that each page reads it and stops offering what cannot run,
// and that an unreadable catalog leaves every tool offered (fail-open).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/three-access.js', () => ({
	getAccess: vi.fn(async () => ({ signed_in: false, wallet_linked: false, access: null })),
	getTierPass: vi.fn(async () => null),
	attachTierPass: vi.fn((headers = {}) => headers),
}));
vi.mock('../src/forge-pay.js', () => ({
	payForConsumption: vi.fn(async () => ({ ok: false })),
}));

const GLB_URL = 'https://three.ws/cdn/models/knight.glb';

function catalogResponse(tools) {
	return { ok: true, status: 200, json: async () => ({ backends: [], tools }) };
}

function stubFetch(catalog) {
	global.fetch = vi.fn(async (url) => {
		const u = String(url);
		if (u.startsWith('/api/forge?catalog')) {
			if (catalog === 'error') throw new TypeError('Failed to fetch');
			return catalogResponse(catalog);
		}
		if (u === GLB_URL) return { ok: false, status: 404, json: async () => ({}) };
		return { ok: true, status: 200, json: async () => ({}) };
	});
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.resetModules();
	Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
	vi.useRealTimers();
	document.body.innerHTML = '';
});

describe('loadForgeTools / toolUnavailable', () => {
	it('treats only an explicit available:false as unavailable', async () => {
		const { toolUnavailable } = await import('../src/forge-tool-availability.js');
		const tools = { lato2: { available: false }, remesh: { available: true } };
		expect(toolUnavailable(tools, 'lato2')).toBe(true);
		expect(toolUnavailable(tools, 'remesh')).toBe(false);
		expect(toolUnavailable(tools, 'unknown')).toBe(false);
		expect(toolUnavailable(null, 'lato2')).toBe(false);
	});

	it('does not cache a failed read, so the next caller retries', async () => {
		const { loadForgeTools } = await import('../src/forge-tool-availability.js');
		stubFetch('error');
		expect(await loadForgeTools()).toBeNull();
		stubFetch({ lato2: { available: false } });
		expect(await loadForgeTools()).toEqual({ lato2: { available: false } });
	});
});

describe('Game-Ready export: Artist mesh topology', () => {
	async function mountGameReady(catalog) {
		stubFetch(catalog);
		document.body.innerHTML = `
			<section id="state-result">
				<div id="viewer-shell"><model-viewer id="viewer"></model-viewer></div>
				<button id="forge-gameready-btn" aria-expanded="false"></button>
			</section>`;
		await import('../src/forge-gameready.js');
		document.dispatchEvent(new CustomEvent('forge:model-ready', { detail: { glbUrl: GLB_URL, label: 'knight' } }));
		await vi.advanceTimersByTimeAsync(1);
		return document.querySelector('.gr-topo button[data-topo="artist"]');
	}

	it('is not offered when the server reports the artist-mesh worker unavailable', async () => {
		const artist = await mountGameReady({ lato2: { available: false }, remesh: { available: true } });
		expect(artist.hidden).toBe(true);
	});

	it('falls back to quad when Artist mesh was picked before the answer arrived', async () => {
		let release;
		const gate = new Promise((r) => (release = r));
		global.fetch = vi.fn(async (url) => {
			if (String(url).startsWith('/api/forge?catalog')) {
				await gate;
				return catalogResponse({ lato2: { available: false } });
			}
			return { ok: false, status: 404, json: async () => ({}) };
		});
		document.body.innerHTML = `
			<section id="state-result">
				<div id="viewer-shell"><model-viewer id="viewer"></model-viewer></div>
				<button id="forge-gameready-btn" aria-expanded="false"></button>
			</section>`;
		await import('../src/forge-gameready.js');
		const artist = document.querySelector('.gr-topo button[data-topo="artist"]');
		artist.click();
		expect(artist.getAttribute('aria-pressed')).toBe('true');
		release();
		await vi.advanceTimersByTimeAsync(1);
		expect(artist.hidden).toBe(true);
		expect(document.querySelector('.gr-topo button[data-topo="quad"]').getAttribute('aria-pressed')).toBe('true');
	});

	it('stays offered when the worker is available', async () => {
		const artist = await mountGameReady({ lato2: { available: true } });
		expect(artist.hidden).toBe(false);
	});

	it('stays offered when the catalog cannot be read', async () => {
		const artist = await mountGameReady('error');
		expect(artist.hidden).toBe(false);
	});
});

describe('Editor Magic Brush', () => {
	function fakeGui() {
		const ctrl = { hidden: false, name: vi.fn(() => ctrl), hide: vi.fn(() => { ctrl.hidden = true; return ctrl; }), show: vi.fn(() => ctrl) };
		return { ctrl, gui: { __folders: {}, add: vi.fn(() => ctrl) } };
	}

	async function attachBrush(catalog) {
		stubFetch(catalog);
		const { MagicBrush } = await import('../src/editor/magic-brush.js');
		const { ctrl, gui } = fakeGui();
		const brush = new MagicBrush({ gui, el: document.body }, {}, {});
		brush.attach();
		await vi.advanceTimersByTimeAsync(1);
		return { brush, ctrl };
	}

	it('hides its entry and never submits when the texture worker is unavailable', async () => {
		const { brush, ctrl } = await attachBrush({ texture: { available: false } });
		expect(ctrl.hide).toHaveBeenCalled();

		// Even if reached (keyboard shortcut), Apply refuses with an honest note
		// instead of sending the visitor's work to an endpoint that cannot run it.
		brush.targetMesh = {};
		brush.painted = true;
		brush.prompt = 'make it gold';
		await brush._apply();
		const posts = global.fetch.mock.calls.filter(([u]) => String(u).startsWith('/api/studio/retexture-region'));
		expect(posts).toHaveLength(0);
		expect(brush.status?.kind).toBe('err');
		expect(brush.status?.text).toMatch(/not available/i);
		expect(brush.status?.text).not.toMatch(/GCP_|_URL/);
	});

	it('keeps its entry when the texture worker is available', async () => {
		const { brush, ctrl } = await attachBrush({ texture: { available: true } });
		expect(ctrl.hide).not.toHaveBeenCalled();
		expect(brush.unavailable).toBe(false);
	});
});
