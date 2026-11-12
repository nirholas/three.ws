import { describe, it, expect } from 'vitest';
import { parityReport } from '../scripts/lib/i18n-shared.mjs';

// 100 source keys so percentages read cleanly.
const source = { s: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, `Key ${i}`])) };
const translated = (n) => ({ s: Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, `Clave ${i}`])) });

const cfg = {
	entryLocale: 'en',
	outputLocales: ['es', 'fr', 'ar'],
	localeNames: { es: 'Español', fr: 'Français', ar: 'العربية' },
	rtlLocales: ['ar'],
};
const manifestOf = (...codes) => ({
	default: 'en',
	locales: ['en', ...codes].map((code) => ({
		code,
		name: code === 'en' ? 'en' : cfg.localeNames[code],
		dir: code === 'ar' ? 'rtl' : 'ltr',
	})),
});

describe('parityReport', () => {
	it('passes when every locale is complete and the committed manifest lists them all', () => {
		const catalogs = { es: translated(100), fr: translated(100), ar: translated(100) };
		const r = parityReport({
			cfg,
			source,
			readCatalog: (c) => catalogs[c] ?? null,
			committedManifest: manifestOf('es', 'fr', 'ar'),
		});
		expect(r.failures).toEqual([]);
		expect(r.rows.map((x) => [x.code, x.behind])).toEqual([
			['es', 0],
			['fr', 0],
			['ar', 0],
		]);
	});

	it('tolerates drift inside the threshold, because the runtime falls back to English per key', () => {
		const catalogs = { es: translated(99), fr: translated(100), ar: translated(100) };
		const r = parityReport({
			cfg,
			source,
			readCatalog: (c) => catalogs[c] ?? null,
			threshold: 0.99,
			committedManifest: manifestOf('es', 'fr', 'ar'),
		});
		expect(r.failures).toEqual([]);
		expect(r.rows.find((x) => x.code === 'es').behind).toBe(1);
	});

	it('fails a locale that has fallen far enough behind to drop out of the language picker', () => {
		const catalogs = { es: translated(90), fr: translated(100), ar: translated(100) };
		const r = parityReport({
			cfg,
			source,
			readCatalog: (c) => catalogs[c] ?? null,
			threshold: 0.99,
			committedManifest: manifestOf('fr', 'ar'),
		});
		expect(r.failures).toHaveLength(1);
		expect(r.failures[0]).toMatch(/^es: 10 keys behind/);
	});

	it('fails a configured locale whose catalog file is missing or unreadable', () => {
		const r = parityReport({
			cfg,
			source,
			readCatalog: (c) => {
				if (c === 'fr') throw new Error('bad json');
				return c === 'es' ? translated(100) : null;
			},
			committedManifest: manifestOf('es'),
		});
		expect(r.failures).toContain('ar: no catalog at all (configured in .i18nrc.json outputLocales)');
		expect(r.failures).toContain('fr: catalog is unreadable');
	});

	it('fails when the committed manifest is stale against the catalogs', () => {
		const catalogs = { es: translated(100), fr: translated(100), ar: translated(100) };
		const r = parityReport({
			cfg,
			source,
			readCatalog: (c) => catalogs[c] ?? null,
			committedManifest: manifestOf(),
		});
		expect(r.failures).toHaveLength(1);
		expect(r.failures[0]).toMatch(/manifest\.json is stale: missing es, fr, ar/);
	});

	it('fails when the committed manifest is absent', () => {
		const catalogs = { es: translated(100), fr: translated(100), ar: translated(100) };
		const r = parityReport({ cfg, source, readCatalog: (c) => catalogs[c] ?? null, committedManifest: null });
		expect(r.failures[0]).toMatch(/manifest\.json is missing/);
	});
});
