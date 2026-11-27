// @vitest-environment jsdom
//
// What the engine picker tells a visitor whose region (or unresolved location)
// switches an engine off. The copy must give the reason, never accuse, never
// claim a region we did not resolve, and be readable without hovering: a
// disabled button shows no tooltip on touch or to a screen reader, so the same
// reason is also a visible note the buttons point at with aria-describedby.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
	parseTerritoryState,
	fetchTerritory,
	fetchRestrictedEngines,
	regionNoteText,
	regionButtonTitle,
	applyRegionNote,
} from '../src/forge-region.js';

describe('the territory answer', () => {
	it('keeps whether the country was resolved next to the restricted set', () => {
		expect(parseTerritoryState({ restricted_backends: ['hunyuan3d'], country_resolved: true })).toEqual({
			restricted: new Set(['hunyuan3d']),
			resolved: true,
		});
		expect(parseTerritoryState({ restricted_backends: ['hunyuan3d'], country_resolved: false }).resolved).toBe(false);
	});

	it('reports an unknown resolution as null when the server did not say', () => {
		expect(parseTerritoryState({ restricted_backends: [] }).resolved).toBeNull();
		expect(parseTerritoryState(null)).toEqual({ restricted: new Set(), resolved: null });
	});
});

describe('fetching it', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('fetchRestrictedEngines still returns a Set', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ restricted_backends: ['huggingface'], country_resolved: false }))));
		const set = await fetchRestrictedEngines({});
		expect(set).toBeInstanceOf(Set);
		expect([...set]).toEqual(['huggingface']);
	});

	it('fetchTerritory carries the resolution flag', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ restricted_backends: ['huggingface'], country_resolved: false }))));
		expect(await fetchTerritory({})).toEqual({ restricted: new Set(['huggingface']), resolved: false });
	});

	it('an unreachable answer restricts nothing and says nothing', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
		expect(await fetchTerritory({})).toEqual({ restricted: new Set(), resolved: null });
	});
});

describe('the copy', () => {
	it('names the reason for a resolved region without accusing the visitor', () => {
		const t = regionNoteText(['Hunyuan3D'], true);
		expect(t).toMatch(/Hunyuan3D is not offered in your region/);
		expect(t).toMatch(/model licence/);
		expect(t).not.toMatch(/you (are|cannot|can't|may not)/i);
	});

	it('does not assert a region when the location was not resolved', () => {
		const t = regionNoteText(['Hunyuan3D', 'Hunyuan3D / TRELLIS (free)'], false);
		expect(t).toMatch(/could not confirm your location/);
		expect(t).not.toMatch(/in your region/);
		expect(t).toMatch(/Hunyuan3D and Hunyuan3D \/ TRELLIS \(free\) are off/);
		expect(t).toMatch(/other engines are not affected/);
	});

	it('uses the same unresolved wording when the server did not say', () => {
		expect(regionNoteText(['Hunyuan3D'], null)).toBe(regionNoteText(['Hunyuan3D'], false));
	});

	it('lists three or more engines with commas', () => {
		expect(regionNoteText(['A', 'B', 'C'], true)).toMatch(/^A, B and C are not offered/);
	});

	it('writes no em or en dash', () => {
		for (const r of [true, false, null]) expect(regionNoteText(['A'], r)).not.toMatch(/[\u2013\u2014]/);
		expect(regionButtonTitle('A', false)).not.toMatch(/[\u2013\u2014]/);
	});

	it('gives the button a title with the same honesty about the location', () => {
		expect(regionButtonTitle('Hunyuan3D', true)).toMatch(/not offered in your region/);
		expect(regionButtonTitle('Hunyuan3D', false)).toMatch(/could not confirm your location/);
		expect(regionButtonTitle('Hunyuan3D', false)).not.toMatch(/in your region/);
	});
});

describe('applyRegionNote', () => {
	let note;
	let picker;
	const labelOf = (id) => ({ hunyuan3d: 'Hunyuan3D', huggingface: 'Hunyuan3D / TRELLIS (free)', trellis2: 'TRELLIS.2' })[id] || id;

	beforeEach(() => {
		document.body.innerHTML = `
			<div id="engine">
				<button data-backend="trellis2">TRELLIS.2</button>
				<button data-backend="hunyuan3d">Hunyuan3D</button>
				<button data-backend="huggingface">HF</button>
			</div>
			<p id="engine-region-note" role="note" hidden></p>`;
		note = document.getElementById('engine-region-note');
		picker = document.getElementById('engine');
	});

	it('shows the reason as visible text and links each restricted button to it', () => {
		applyRegionNote({ note, picker, restricted: new Set(['hunyuan3d', 'huggingface']), resolved: false, labelOf });
		expect(note.hidden).toBe(false);
		expect(note.textContent).toMatch(/could not confirm your location/);
		const byId = (id) => picker.querySelector(`[data-backend="${id}"]`);
		expect(byId('hunyuan3d').getAttribute('aria-describedby')).toBe('engine-region-note');
		expect(byId('huggingface').getAttribute('aria-describedby')).toBe('engine-region-note');
		expect(byId('trellis2').hasAttribute('aria-describedby')).toBe(false);
	});

	it('hides the note and unlinks the buttons when nothing is restricted', () => {
		applyRegionNote({ note, picker, restricted: new Set(['hunyuan3d']), resolved: true, labelOf });
		applyRegionNote({ note, picker, restricted: new Set(), resolved: true, labelOf });
		expect(note.hidden).toBe(true);
		expect(note.textContent).toBe('');
		expect(picker.querySelector('[data-backend="hunyuan3d"]').hasAttribute('aria-describedby')).toBe(false);
	});

	it('only names engines that are in the picker', () => {
		applyRegionNote({ note, picker, restricted: new Set(['hunyuan3d', 'modly_hunyuan']), resolved: true, labelOf });
		expect(note.textContent).toMatch(/^Hunyuan3D is not offered/);
		expect(note.textContent).not.toMatch(/modly/i);
	});

	it('names an engine by the label printed on its button and lists a shared label once', () => {
		picker.innerHTML = `
			<button data-backend="hunyuan3d"><span class="eng-label">Hunyuan3D</span></button>
			<button data-backend="modly_hunyuan"><span class="eng-label">Hunyuan3D</span></button>
			<button data-backend="huggingface"><span class="eng-label">Hunyuan3D / TRELLIS (free)</span></button>`;
		applyRegionNote({ note, picker, restricted: new Set(['hunyuan3d', 'modly_hunyuan', 'huggingface']), resolved: true });
		expect(note.textContent).toMatch(/^Hunyuan3D and Hunyuan3D \/ TRELLIS \(free\) are not offered/);
	});

	it('tolerates a missing note element', () => {
		expect(() => applyRegionNote({ note: null, picker, restricted: new Set(['hunyuan3d']), resolved: true, labelOf })).not.toThrow();
	});
});
