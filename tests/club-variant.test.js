// Tests for src/club-variant.js: the URL path → walk-in variant rule behind the
// /club entrance. Pure data, so no renderer or DOM is needed.

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	CLUB_VARIANTS,
	DEFAULT_CLUB_VARIANT,
	resolveClubVariant,
	listClubEntrances,
} from '../src/club-variant.js';

const publicDir = resolve(__dirname, '../public');

describe('resolveClubVariant', () => {
	it('maps each entrance path to its own variant, and retired links to the default', () => {
		expect(resolveClubVariant('/club').key).toBe('club');
		expect(resolveClubVariant('/stripclub').key).toBe(DEFAULT_CLUB_VARIANT);
	});

	it('ignores trailing slashes and case', () => {
		expect(resolveClubVariant('/club/').key).toBe('club');
	});

	it('falls back to the default entrance for anything else', () => {
		for (const path of ['', '/', '/club.html', '/stripclub/extra', undefined]) {
			expect(resolveClubVariant(path).key).toBe(DEFAULT_CLUB_VARIANT);
		}
	});
});

describe('CLUB_VARIANTS', () => {
	it('gives every entrance exactly one cover door, on the first venue', () => {
		for (const variant of Object.values(CLUB_VARIANTS)) {
			const covers = variant.sequence.filter((v) => v.cover);
			expect(covers).toHaveLength(1);
			expect(variant.sequence[0].cover).toBe(true);
		}
	});

	it('keeps the journey the same length as the four-step HUD expects', () => {
		for (const variant of Object.values(CLUB_VARIANTS)) {
			expect(variant.sequence).toHaveLength(3);
		}
	});

	it('names every venue for the minimap', () => {
		for (const variant of Object.values(CLUB_VARIANTS)) {
			for (const venue of variant.sequence) expect(venue.name).toBeTruthy();
		}
	});

	it('only mounts venues whose GLB ships in the repo', () => {
		for (const variant of Object.values(CLUB_VARIANTS)) {
			for (const venue of variant.sequence) {
				expect(existsSync(resolve(publicDir, `.${venue.url}`)), venue.url).toBe(true);
			}
		}
	});

	it('never mounts a venue whose licence forbids commercial use or derivatives', () => {
		for (const variant of Object.values(CLUB_VARIANTS)) {
			for (const venue of variant.sequence) {
				expect(venue.url).not.toMatch(/clubhouse/);
				if (venue.credit) expect(venue.credit.license).toBe('CC BY 4.0');
			}
		}
	});

	it('carries a complete credit for every CC BY venue', () => {
		const credited = CLUB_VARIANTS.club.sequence.filter((v) => v.credit);
		expect(credited.map((v) => v.name)).toEqual(['Alley', 'Gallery']);
		for (const { credit } of credited) {
			for (const field of ['title', 'author', 'authorUrl', 'sourceUrl', 'license', 'licenseUrl']) {
				expect(credit[field], field).toBeTruthy();
			}
		}
	});
});

describe('listClubEntrances', () => {
	it('lists every entrance with a unique path and a label', () => {
		const entrances = listClubEntrances();
		expect(entrances.map((e) => e.key).sort()).toEqual(Object.keys(CLUB_VARIANTS).sort());
		expect(new Set(entrances.map((e) => e.path)).size).toBe(entrances.length);
		for (const e of entrances) expect(e.label).toBeTruthy();
	});
});
