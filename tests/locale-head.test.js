import { describe, expect, it } from 'vitest';
import { rewriteLocaleHead } from '../server/locale-head.mjs';

const catalog = { codes: new Set(['en', 'ja', 'ar', 'pt-BR']), paths: new Set(['/pricing', '/']) };
const page =
	'<!doctype html><html lang="en"><head><link rel="canonical" href="https://three.ws/pricing"></head><body>x</body></html>';

describe('rewriteLocaleHead', () => {
	it('declares the language and alternates for ?lang=ja', () => {
		const out = rewriteLocaleHead(page, '/pricing', 'ja', catalog);
		expect(out).toContain('<html lang="ja" dir="ltr">');
		expect(out).toContain('hreflang="pt-BR" href="https://three.ws/pricing?lang=pt-BR"');
		expect(out).toContain('hreflang="x-default" href="https://three.ws/pricing"');
		expect(out.match(/rel="canonical"/g)).toHaveLength(1);
		expect(out).toContain('rel="canonical" href="https://three.ws/pricing"');
	});
	it('sets rtl for Arabic', () => {
		expect(rewriteLocaleHead(page, '/pricing', 'ar', catalog)).toContain('lang="ar" dir="rtl"');
	});
	it('leaves unsupported locales, English and unlocalized paths alone', () => {
		expect(rewriteLocaleHead(page, '/pricing', 'xx', catalog)).toBeNull();
		expect(rewriteLocaleHead(page, '/pricing', 'en', catalog)).toBeNull();
		expect(rewriteLocaleHead(page, '/other', 'ja', catalog)).toBeNull();
		expect(rewriteLocaleHead(page, '/pricing', '', catalog)).toBeNull();
	});
	it('adds a canonical when the page has none', () => {
		const out = rewriteLocaleHead('<html><head></head></html>', '/', 'ja', catalog);
		expect(out).toContain('rel="canonical" href="https://three.ws/"');
	});
});
