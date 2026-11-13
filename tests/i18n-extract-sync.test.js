// i18n:extract used to keep an existing en.json value whenever the key was
// already in the catalog. The i18n runtime renders en.json even in English, so
// every page edited after it was annotated kept serving its old copy, and every
// locale stayed translated from that stale English. By 2026-11-13, 342 values
// had drifted from their HTML: a connect.html sentence cut off mid-link, the
// assistant page still linking 3D embeds to /embed after the page moved it to
// /studio, a sitemap empty state with a span the page no longer has.
//
// The extractor now syncs values from the HTML, reports what changed, and
// invalidates the translations of keys whose copy really changed so the next
// `i18n:translate` refills them from the current English.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { glob } from 'glob';
import {
	extractFromHtml,
	syncCatalog,
	isSubstantiveChange,
	invalidateKeys,
} from '../scripts/i18n-extract.mjs';
import { flatten } from '../scripts/lib/i18n-shared.mjs';

const ROOT = resolve(import.meta.dirname, '..');

describe('syncCatalog', () => {
	it('takes the current HTML over a stale catalog value and reports the change', () => {
		const existing = {
			connect: { note: 'Every client appears under <a href="/dashboard/settings">Settings' },
		};
		const pairs = [
			[
				'pages/connect.html',
				new Map([['connect.note', 'Every client appears under <a href="/dashboard/settings">Settings</a>.']]),
			],
		];
		const { catalog, changed, added } = syncCatalog(existing, pairs);
		expect(catalog.connect.note).toBe('Every client appears under <a href="/dashboard/settings">Settings</a>.');
		expect(added).toBe(0);
		expect(changed).toEqual([
			{
				key: 'connect.note',
				from: 'Every client appears under <a href="/dashboard/settings">Settings',
				to: 'Every client appears under <a href="/dashboard/settings">Settings</a>.',
				substantive: true,
				file: 'pages/connect.html',
			},
		]);
	});

	it('counts new keys, leaves identical values alone, and keeps catalog-only keys unless pruning', () => {
		const existing = { a: { same: 'Same copy', js_only: 'Built in JS' } };
		const pairs = [
			['pages/a.html', new Map([['a.same', 'Same copy'], ['a.fresh', 'New copy']])],
		];
		const kept = syncCatalog(existing, pairs);
		expect(kept.added).toBe(1);
		expect(kept.unchanged).toBe(1);
		expect(kept.changed).toEqual([]);
		expect(kept.catalog.a).toEqual({ fresh: 'New copy', js_only: 'Built in JS', same: 'Same copy' });

		const pruned = syncCatalog(existing, pairs, { prune: true });
		expect(pruned.catalog.a).toEqual({ fresh: 'New copy', same: 'Same copy' });
	});

	it('lets the first file win a collision and reports the second', () => {
		const pairs = [
			['pages/one.html', new Map([['k.v', 'One']])],
			['pages/two.html', new Map([['k.v', 'Two']])],
		];
		const { catalog, collisions } = syncCatalog({}, pairs);
		expect(catalog.k.v).toBe('One');
		expect(collisions).toHaveLength(1);
		expect(collisions[0]).toContain('pages/two.html');
	});
});

describe('isSubstantiveChange', () => {
	it('ignores punctuation normalisation the pages went through', () => {
		expect(isSubstantiveChange('Docs \u2014 the guide', 'Docs - the guide')).toBe(false);
		expect(isSubstantiveChange('No match &ldquo;x&rdquo;', 'No match “x”')).toBe(false);
		expect(isSubstantiveChange('Solana network ', 'Solana network')).toBe(false);
		expect(isSubstantiveChange('It&rsquo;s live', 'It’s live')).toBe(false);
	});

	it('flags wording and markup changes', () => {
		expect(isSubstantiveChange('Upload GLB', 'Upload')).toBe(true);
		expect(isSubstantiveChange('<a href="/embed">3D embeds</a>', '<a href="/studio">3D embeds</a>')).toBe(true);
	});
});

describe('invalidateKeys', () => {
	it('removes the named nested keys and reports how many it dropped', () => {
		const locale = { connect: { note: 'Ancienne', keep: 'Garder' }, other: { x: 'y' } };
		expect(invalidateKeys(locale, ['connect.note', 'missing.key', 'other.absent'])).toBe(1);
		expect(locale).toEqual({ connect: { keep: 'Garder' }, other: { x: 'y' } });
	});
});

describe('en.json matches the annotated HTML', () => {
	it('has no value that differs from the page copy it was extracted from', async () => {
		const cfg = JSON.parse(readFileSync(resolve(ROOT, '.i18nrc.json'), 'utf8'));
		const en = flatten(JSON.parse(readFileSync(resolve(ROOT, cfg.entry), 'utf8')));
		const files = (
			await glob(cfg.htmlExtract?.entry || ['pages/**/*.html', 'public/**/*.html'], {
				cwd: ROOT,
				ignore: cfg.htmlExtract?.exclude || [],
				absolute: true,
				nodir: true,
			})
		).sort();
		const seen = new Set();
		const drift = [];
		for (const file of files) {
			for (const [key, value] of extractFromHtml(readFileSync(file, 'utf8'))) {
				if (seen.has(key)) continue;
				seen.add(key);
				if (en[key] !== undefined && en[key] !== value) drift.push(`${key} (${relative(ROOT, file)})`);
			}
		}
		// Fix with `npm run i18n:extract`, then `npm run i18n:translate`.
		expect(drift).toEqual([]);
	}, 60_000);
});
