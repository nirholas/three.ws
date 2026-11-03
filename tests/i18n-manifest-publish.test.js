import { describe, it, expect } from 'vitest';
import { buildManifest } from '../scripts/lib/i18n-shared.mjs';

const source = { a: { one: 'One', two: 'Two', three: 'Three', four: 'Four' } };
const full = { a: { one: 'Uno', two: 'Dos', three: 'Tres', four: 'Cuatro' } };
const threeOfFour = { a: { one: 'Un', two: 'Deux', three: 'Trois' } };
const withBlank = { a: { one: 'Eins', two: '', three: 'Drei', four: 'Vier' } };

const cfg = {
	entryLocale: 'en',
	outputLocales: ['es', 'fr', 'de', 'ar', 'xx'],
	localeNames: { es: 'Español', fr: 'Français', de: 'Deutsch', ar: 'العربية' },
	rtlLocales: ['ar'],
};
const catalogs = { es: full, fr: threeOfFour, de: withBlank, ar: full };
const read = (code) => {
	if (!(code in catalogs)) return null;
	return catalogs[code];
};

describe('buildManifest', () => {
	it('lists complete locales and always the entry locale', () => {
		const { manifest } = buildManifest({ cfg, source, readCatalog: read });
		expect(manifest.locales.map((l) => l.code)).toEqual(['en', 'es', 'ar']);
	});

	it('holds back a locale with missing or blank keys and reports why', () => {
		const { skipped } = buildManifest({ cfg, source, readCatalog: read });
		expect(skipped).toContain('fr (1 untranslated key)');
		expect(skipped).toContain('de (1 untranslated key)');
	});

	it('skips locales with no catalog file without reporting them as gaps', () => {
		const { manifest, skipped } = buildManifest({ cfg, source, readCatalog: read });
		expect(manifest.locales.some((l) => l.code === 'xx')).toBe(false);
		expect(skipped.some((s) => s.startsWith('xx'))).toBe(false);
	});

	it('marks right-to-left locales and carries display names', () => {
		const { manifest } = buildManifest({ cfg, source, readCatalog: read });
		expect(manifest.locales.find((l) => l.code === 'ar')).toEqual({ code: 'ar', name: 'العربية', dir: 'rtl' });
		expect(manifest.locales.find((l) => l.code === 'es').dir).toBe('ltr');
	});

	it('lists a locale at or above a configurable completeness threshold', () => {
		const { manifest } = buildManifest({ cfg, source, readCatalog: read, threshold: 0.75 });
		expect(manifest.locales.map((l) => l.code)).toEqual(['en', 'es', 'fr', 'de', 'ar']);
		const strict = buildManifest({ cfg, source, readCatalog: read, threshold: 0.76 });
		expect(strict.manifest.locales.map((l) => l.code)).toEqual(['en', 'es', 'ar']);
	});

	it('defaults to 100 percent', () => {
		const a = buildManifest({ cfg, source, readCatalog: read });
		const b = buildManifest({ cfg, source, readCatalog: read, threshold: 1 });
		expect(a.manifest).toEqual(b.manifest);
	});

	it('holds back an unreadable catalog', () => {
		const boom = () => { throw new Error('bad json'); };
		const { manifest, skipped } = buildManifest({ cfg, source, readCatalog: (c) => (c === 'es' ? boom() : read(c)) });
		expect(manifest.locales.some((l) => l.code === 'es')).toBe(false);
		expect(skipped).toContain('es (unreadable)');
	});
});
