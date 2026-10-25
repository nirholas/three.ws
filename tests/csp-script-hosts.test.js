// The script-src of every CSP in vercel.json must not trust a *.vercel.app
// host. The platform no longer deploys to Vercel, so a trusted vercel.app
// subdomain that lapses can be claimed by anyone and then serves script into
// every page that lists it.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

function cspValues() {
	const out = [];
	for (const route of config.routes || []) {
		const value = route.headers?.['content-security-policy'];
		if (typeof value === 'string') out.push(value);
	}
	return out;
}

describe('vercel.json CSP script hosts', () => {
	it('declares at least one CSP with a script-src', () => {
		expect(cspValues().some((v) => /script-src/.test(v))).toBe(true);
	});

	it('does not trust any vercel.app host in script-src', () => {
		const offenders = [];
		for (const value of cspValues()) {
			for (const directive of value.split(';')) {
				const d = directive.trim();
				if (/^script-src(-elem|-attr)?\s/.test(d) && /vercel\.app/.test(d)) offenders.push(d);
			}
		}
		expect(offenders).toEqual([]);
	});
});
