// Guard test for the /open-source credits page.
//
// buildCredits() is pure: it reads package.json and node_modules at call
// time and returns a deterministic object (sorted, no timestamp). This test
// re-runs it and deep-equals the result against the committed
// data/open-source-credits.json. A dependency added to package.json without
// running `node scripts/build-open-source-credits.mjs` and committing the
// regenerated file fails here, so the page can never silently drift out of
// sync with what three.ws actually ships.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildCredits, AREAS, ROOT } from '../scripts/lib/open-source-credits.mjs';

describe('open-source-credits dataset', () => {
	it('matches the committed data/open-source-credits.json exactly', () => {
		const fresh = buildCredits();
		const committed = JSON.parse(
			readFileSync(resolve(ROOT, 'data/open-source-credits.json'), 'utf8'),
		);
		expect(fresh).toEqual(committed);
	});

	it('every entry has an area that exists in AREAS', () => {
		const { entries } = buildCredits();
		const areaIds = new Set(AREAS.map((a) => a.id));
		for (const entry of entries) {
			expect(areaIds.has(entry.area), `${entry.id} has unknown area "${entry.area}"`).toBe(true);
		}
	});

	it('every entry has a name, license, and id', () => {
		const { entries } = buildCredits();
		for (const entry of entries) {
			expect(entry.id, 'missing id').toBeTruthy();
			expect(entry.name, `${entry.id} missing name`).toBeTruthy();
			expect(entry.license, `${entry.id} missing license`).toBeTruthy();
		}
	});

	it('includes every direct npm dependency from package.json', () => {
		const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
		const names = [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})];
		const { entries } = buildCredits();
		const npmIds = new Set(entries.filter((e) => e.kind === 'npm').map((e) => e.id));
		for (const name of names) {
			expect(npmIds.has(`npm:${name}`), `package.json dependency "${name}" has no credits entry`).toBe(
				true,
			);
		}
	});

	it('contains no em dash or en dash characters anywhere in the dataset', () => {
		const text = JSON.stringify(buildCredits());
		const emDash = String.fromCharCode(8212);
		const enDash = String.fromCharCode(8211);
		expect(text.includes(emDash)).toBe(false);
		expect(text.includes(enDash)).toBe(false);
	});
});
