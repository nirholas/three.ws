import { describe, it, expect } from 'vitest';
import surfaces from '../data/microsoft-surfaces.json';
import {
	SURFACE_STATUSES,
	ageLabel,
	filterByLane,
	forgeLink,
	laneFor,
	marketplaceLine,
	stripCreations,
	tryItLane,
	validateSurfaces,
	viewerLink,
} from '../src/microsoft-hub-model.js';

const row = (id, backend, extra = {}) => ({
	id,
	backend,
	prompt: `p-${id}`,
	glb_url: `https://three.ws/cdn/${id}.glb`,
	preview_image_url: `https://three.ws/cdn/${id}.png`,
	created_at: '2026-11-11T10:00:00Z',
	...extra,
});

describe('data/microsoft-surfaces.json', () => {
	it('validates: known statuses, real links, every field filled', () => {
		expect(validateSurfaces(surfaces)).toEqual([]);
	});

	it('covers every Microsoft surface the hub promises', () => {
		expect(surfaces.surfaces.map((s) => s.id)).toEqual(
			expect.arrayContaining(['marketplace', 'teams', 'power-platform', 'store', 'edge', 'vscode', 'mcp']),
		);
	});

	it('only calls a surface live when its action points at a public listing or page', () => {
		for (const s of surfaces.surfaces.filter((x) => x.status === 'live')) {
			expect(s.action.url).toMatch(/^https:\/\/(marketplace\.microsoft\.com|marketplace\.visualstudio\.com)\//);
		}
	});
});

describe('validateSurfaces', () => {
	const good = {
		id: 'x',
		name: 'X',
		kind: 'App',
		status: 'live',
		today: 't',
		built: 'b',
		action: { label: 'a', url: '/x' },
		evidence: { label: 'e', url: 'https://example.com/x' },
	};

	it('rejects an unknown status, a missing field, a bad link and a duplicate id', () => {
		const errors = validateSurfaces({
			surfaces: [
				{ ...good, status: 'coming soon' },
				{ ...good, id: 'y', today: '' },
				{ ...good, id: 'z', evidence: { label: 'e', url: 'javascript:alert(1)' } },
				{ ...good, id: 'z' },
			],
		});
		expect(errors.join('\n')).toMatch(/status "coming soon"/);
		expect(errors.join('\n')).toMatch(/today is required/);
		expect(errors.join('\n')).toMatch(/evidence needs/);
		expect(errors.join('\n')).toMatch(/duplicate id/);
	});

	it('rejects an empty list', () => {
		expect(validateSurfaces({ surfaces: [] })).toHaveLength(1);
	});

	it('knows exactly the three statuses the work order allows', () => {
		expect(SURFACE_STATUSES).toEqual(['live', 'pending review', 'built, awaiting publish']);
	});
});

describe('stripCreations', () => {
	it('puts TRELLIS.2 creations first, then TRELLIS, keeping feed order', () => {
		const out = stripCreations({
			trellis2: [row('a', 'trellis2')],
			trellis_selfhost: [row('b', 'trellis_selfhost'), row('c', 'trellis_selfhost')],
		});
		expect(out.map((r) => r.id)).toEqual(['a', 'b', 'c']);
	});

	it('drops rows from other lanes even when the feed ignored ?backend=', () => {
		const out = stripCreations({ trellis2: [row('n', 'nvidia'), row('a', 'trellis2')], trellis_selfhost: [row('m', 'meshy')] });
		expect(out.map((r) => r.id)).toEqual(['a']);
	});

	it('drops rows without a preview or a model, and duplicates', () => {
		const out = stripCreations({
			trellis2: [row('a', 'trellis2', { preview_image_url: null }), row('b', 'trellis2', { glb_url: null }), row('c', 'trellis2')],
			trellis_selfhost: [row('c', 'trellis_selfhost')],
		});
		expect(out.map((r) => r.id)).toEqual(['c']);
	});

	it('caps at the limit and survives missing feeds', () => {
		expect(stripCreations({ trellis_selfhost: [row('a', 'trellis_selfhost'), row('b', 'trellis_selfhost')] }, 1)).toHaveLength(1);
		expect(stripCreations({})).toEqual([]);
		expect(stripCreations(null)).toEqual([]);
	});
});

describe('lanes and links', () => {
	it('labels each lane with the model that made it', () => {
		expect(laneFor('trellis2').label).toBe('TRELLIS.2');
		expect(laneFor('trellis_selfhost').label).toBe('TRELLIS');
		expect(laneFor('nvidia')).toBeNull();
	});

	it('filters by lane, with all meaning every Microsoft lane', () => {
		const rows = [row('a', 'trellis2'), row('b', 'trellis_selfhost')];
		expect(filterByLane(rows, 'all')).toHaveLength(2);
		expect(filterByLane(rows, 'trellis2').map((r) => r.id)).toEqual(['a']);
	});

	it('sends Try it to TRELLIS.2 when it is up, else the newest lane that is', () => {
		expect(tryItLane({ backends: { trellis2: { status: 'ok' }, trellis_selfhost: { status: 'ok' } } }).backend).toBe('trellis2');
		expect(tryItLane({ backends: { trellis2: { status: 'unconfigured' }, trellis_selfhost: { status: 'ok' } } }).backend).toBe('trellis_selfhost');
		expect(tryItLane(null).backend).toBe('trellis2');
	});

	it('builds the Forge and viewer links', () => {
		expect(forgeLink('trellis2')).toBe('/forge?mode=image&engine=trellis2');
		expect(viewerLink('6f1c2d3e-0000-4000-8000-000000000000')).toBe('/m/6f1c2d3e-0000-4000-8000-000000000000');
	});
});

describe('marketplaceLine', () => {
	it('says plainly when purchase is not switched on', () => {
		expect(marketplaceLine({ ready: false, sso: false, missing: ['MS_MARKETPLACE_TENANT_ID'] })).toEqual({
			tone: 'pending',
			text: 'In-Marketplace purchase is built and not switched on yet.',
		});
	});

	it('distinguishes purchase only from purchase plus sign-in', () => {
		expect(marketplaceLine({ ready: true, sso: false }).text).toMatch(/sign-in is not yet/);
		expect(marketplaceLine({ ready: true, sso: true }).tone).toBe('ok');
	});

	it('never guesses when the probe failed', () => {
		expect(marketplaceLine(null).tone).toBe('unknown');
		expect(marketplaceLine({ error: 'x' }).tone).toBe('unknown');
	});
});

describe('ageLabel', () => {
	const now = Date.parse('2026-11-11T12:00:00Z');
	it('reads as a short relative age', () => {
		expect(ageLabel('2026-11-11T11:59:30Z', now)).toBe('just now');
		expect(ageLabel('2026-11-11T11:15:00Z', now)).toBe('45m ago');
		expect(ageLabel('2026-11-11T09:00:00Z', now)).toBe('3h ago');
		expect(ageLabel('2026-11-08T12:00:00Z', now)).toBe('3d ago');
		expect(ageLabel('nope', now)).toBe('');
	});
});
