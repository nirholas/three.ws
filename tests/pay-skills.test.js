// pay-skills projection (api/_lib/service-catalog/pay-skills.js): the three.ws
// providers for the Solana Foundation `pay` registry. These guards keep the
// committed listing in distributions/pay-skills/ honest:
//   - the committed files are exactly what the generator emits today, so a
//     service-catalog schema or price change cannot leave a stale listing,
//   - every listed paid service is live and payable on Solana,
//   - every listing passes the registry's copy rules (no violations thrown),
//   - prices match the functions the live 402 challenges quote from.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	PAY_PROVIDERS,
	buildPaySkills,
	buildOpenApi,
	listingProblems,
	toAscii,
} from '../api/_lib/service-catalog/pay-skills.js';
import { PAID_SERVICES } from '../api/_lib/service-catalog/services/index.js';
import { TIERS } from '../api/_lib/forge-tiers.js';

const ROOT = join(import.meta.dirname, '..', 'distributions', 'pay-skills');

describe('pay-skills projection', () => {
	const files = buildPaySkills();

	it('emits a PAY.md and an openapi.json for every provider', () => {
		for (const p of PAY_PROVIDERS) {
			expect(files[`providers/three-ws/${p.name}/PAY.md`]).toMatch(new RegExp(`^---\\nname: ${p.name}\\n`));
			expect(JSON.parse(files[`providers/three-ws/${p.name}/openapi.json`]).openapi).toBe('3.1.0');
		}
	});

	it('matches the committed files byte for byte (run npm run build:pay-skills)', () => {
		for (const [rel, body] of Object.entries(files)) {
			const p = join(ROOT, rel);
			expect(existsSync(p), rel).toBe(true);
			expect(readFileSync(p, 'utf8'), rel).toBe(body);
		}
	});

	it('lists only live, Solana-payable catalog services, each once', () => {
		const slugs = PAY_PROVIDERS.flatMap((p) => p.operations.filter((o) => o.slug).map((o) => o.slug));
		expect(new Set(slugs).size).toBe(slugs.length);
		for (const slug of slugs) {
			const s = PAID_SERVICES.find((x) => x.slug === slug);
			expect(s, slug).toBeDefined();
			expect(s.status).toBe('live');
			expect(['standard', 'cdp-bazaar']).toContain(s.acceptsBuilder);
		}
	});

	it('passes the registry copy rules for every provider', () => {
		for (const p of PAY_PROVIDERS) expect(listingProblems(p, buildOpenApi(p))).toEqual([]);
	});

	it('reports a too-short summary and an undescribed parameter as problems', () => {
		const p = PAY_PROVIDERS[0];
		const openapi = buildOpenApi(p);
		const [path, item] = Object.entries(openapi.paths).find(([, v]) => v.get?.parameters?.length);
		item.get.summary = 'Too short';
		item.get.parameters[0].description = '';
		const problems = listingProblems(p, openapi);
		expect(problems.some((m) => m.includes(path) && m.includes('summary'))).toBe(true);
		expect(problems.some((m) => m.includes('has no description'))).toBe(true);
	});

	it('quotes fixed prices from the catalog and Forge from its tier table', () => {
		const md = JSON.parse(files['providers/three-ws/market-data/openapi.json']);
		const global = PAID_SERVICES.find((s) => s.slug === 'market-global');
		expect(md.paths['/api/x402/market-global'].get['x-payment-info'].price).toEqual({
			mode: 'fixed',
			currency: 'USD',
			amount: String(Number(global.priceAtomics) / 1e6),
		});
		const forge = JSON.parse(files['providers/three-ws/3d/openapi.json']).paths['/api/x402/forge'].post;
		const tierPrices = Object.values(TIERS).map((t) => t.priceUsdcAtomics / 1e6);
		expect(forge['x-payment-info'].price).toEqual({
			mode: 'dynamic',
			currency: 'USD',
			min: String(Math.min(...tierPrices)),
			max: String(Math.max(...tierPrices)),
		});
	});

	it('maps typographic characters to ASCII', () => {
		expect(toAscii('text\u21923D \u2014 fast\u2026 \u22651')).toBe('text->3D, fast... >=1');
	});
});
