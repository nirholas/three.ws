// Sponsorship status on the /open-source credits page.
//
// data/sponsorships.json records the owner's decision per upstream project
// (work order 937). Only a row the owner approved AND started shows on the
// page: it lands in the dataset's top-level `sponsorships` list and stamps
// `sponsoredSince` on every credit card it names. A pending, declined or
// ended row shows nothing, so the page never claims a sponsorship that is
// not live.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { applySponsorships, buildCredits, ROOT } from '../scripts/lib/open-source-credits.mjs';

const credits = () => ({
	areas: [{ id: 'rendering', label: 'Rendering' }],
	entries: [
		{ id: 'npm:three', name: 'three', area: 'rendering' },
		{ id: 'npm:other', name: 'other', area: 'rendering' },
	],
});

const row = (over = {}) => ({
	id: 'threejs',
	name: 'three.js',
	url: 'https://threejs.org',
	route: 'https://github.com/sponsors/mrdoob',
	recommendedUsdMonthly: 50,
	creditIds: ['npm:three'],
	decision: 'pending',
	decidedOn: null,
	startedOn: null,
	endedOn: null,
	...over,
});

describe('applySponsorships', () => {
	it('lists a started sponsorship and stamps sponsoredSince on the cards it names', () => {
		const out = applySponsorships(credits(), {
			projects: [row({ decision: 'approved', decidedOn: '2026-11-20', startedOn: '2026-11-21' })],
		});
		expect(out.sponsorships).toEqual([
			{ id: 'threejs', name: 'three.js', url: 'https://threejs.org', since: '2026-11-21' },
		]);
		expect(out.entries.find((e) => e.id === 'npm:three').sponsoredSince).toBe('2026-11-21');
		expect('sponsoredSince' in out.entries.find((e) => e.id === 'npm:other')).toBe(false);
	});

	it('shows nothing for a pending row or an approved row that has not started', () => {
		for (const r of [row(), row({ decision: 'approved', decidedOn: '2026-11-20' })]) {
			const out = applySponsorships(credits(), { projects: [r] });
			expect(out.sponsorships).toEqual([]);
			expect(out.entries.some((e) => 'sponsoredSince' in e)).toBe(false);
		}
	});

	it('drops a sponsorship once it has ended', () => {
		const out = applySponsorships(credits(), {
			projects: [
				row({ decision: 'approved', decidedOn: '2026-11-20', startedOn: '2026-11-21', endedOn: '2027-02-01' }),
			],
		});
		expect(out.sponsorships).toEqual([]);
	});

	it('lists a started sponsorship that has no credit card of its own', () => {
		const out = applySponsorships(credits(), {
			projects: [row({ id: 'pmndrs', name: 'pmndrs', creditIds: [], decision: 'approved', decidedOn: '2026-11-20', startedOn: '2026-11-21' })],
		});
		expect(out.sponsorships.map((s) => s.id)).toEqual(['pmndrs']);
	});

	it('rejects a creditId that names no credit entry', () => {
		expect(() => applySponsorships(credits(), { projects: [row({ creditIds: ['npm:missing'] })] })).toThrow(
			/npm:missing/,
		);
	});

	it('rejects a start date on a row the owner has not approved', () => {
		expect(() => applySponsorships(credits(), { projects: [row({ startedOn: '2026-11-21' })] })).toThrow(
			/approved/,
		);
	});

	it('rejects an unknown decision value', () => {
		expect(() => applySponsorships(credits(), { projects: [row({ decision: 'maybe' })] })).toThrow(/decision/);
	});
});

describe('committed data/sponsorships.json', () => {
	const doc = JSON.parse(readFileSync(resolve(ROOT, 'data/sponsorships.json'), 'utf8'));

	it('validates against the real credits dataset', () => {
		expect(() => buildCredits()).not.toThrow();
		expect(Array.isArray(buildCredits().sponsorships)).toBe(true);
	});

	it('names every project the work order starts from', () => {
		const ids = doc.projects.map((p) => p.id);
		for (const id of ['threejs', 'gltf-transform', 'three-vrm', 'meshoptimizer', 'polyhaven', 'blender-fund', 'orcaslicer', 'mesh2motion', 'quaternius', 'pmndrs']) {
			expect(ids).toContain(id);
		}
	});

	it('gives every project with a payment route an https route', () => {
		for (const p of doc.projects) {
			if (p.decision === 'no-route') expect(p.route).toBe(null);
			else expect(p.route, p.id).toMatch(/^https:\/\//);
		}
	});
});
