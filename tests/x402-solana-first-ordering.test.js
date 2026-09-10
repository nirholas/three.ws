// Solana leads every paid 402 challenge, and the live challenge agrees with the
// discovery catalog.
//
// The bug this locks in, found 2026-09-10 by auditing production against
// /.well-known/x402.json: fourteen routes under api/x402/ passed
// `networks: ['base', 'solana']` to paidEndpoint, overriding the platform's
// Solana-first default. Twelve of them were ALSO advertised Solana-first in the
// discovery catalog, so the catalog and the live 402 disagreed about which chain
// to settle on. An agent that reads the catalog picks Solana; the same agent
// calling the endpoint is handed Base as accepts[0], and a first-accept client
// settles on the chain we did not advertise.
//
// Not one of the fourteen carried a comment explaining the override, and
// paidEndpoint's own default documents itself as "Solana-first platform default
// ... unless a route explicitly overrides the network order", so these were
// copy-paste drift rather than a decision. CLAUDE.md's chain-priority rule makes
// Solana the home chain, so the fix was to delete the overrides and inherit.
//
// This is a source-level guard on purpose: the ordering is decided by a literal
// in each route file, so reading the files is what actually catches a regression,
// and it needs no network and no credentials.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const X402_DIR = join(ROOT, 'api/x402');

function routeFiles() {
	return readdirSync(X402_DIR)
		.filter((f) => f.endsWith('.js'))
		.map((f) => ({ name: f, source: readFileSync(join(X402_DIR, f), 'utf8') }));
}

describe('x402 paid routes lead with Solana', () => {
	it('no route under api/x402 puts Base ahead of Solana', () => {
		const offenders = routeFiles()
			.filter(({ source }) => /networks:\s*\[\s*'base'\s*,\s*'solana'\s*\]/.test(source))
			.map(({ name }) => name);

		expect(
			offenders,
			`these routes override the Solana-first default and would advertise Base as accepts[0], ` +
				`which contradicts the discovery catalog and CLAUDE.md's chain priority: ${offenders.join(', ')}`,
		).toEqual([]);
	});

	it('any route that does pin an order pins Solana first', () => {
		// Pinning the platform default explicitly is redundant but harmless. Pinning
		// anything that does not start with Solana is the regression.
		const wrong = [];
		for (const { name, source } of routeFiles()) {
			for (const m of source.matchAll(/networks:\s*\[([^\]]*)\]/g)) {
				const raw = m[1]
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean);
				// A route may choose its network at runtime: api/x402/service.js passes
				// `networks: [network]`, resolved per registered service from that
				// service's own payout address. Only a quoted literal pins an order
				// this source-level guard can judge, so anything else is skipped
				// rather than read as a chain named after the variable.
				if (!raw.length || !/^['"]/.test(raw[0])) continue;
				const list = raw.map((s) => s.replace(/^['"]|['"]$/g, ''));
				if (list[0] !== 'solana') wrong.push(`${name}: [${list.join(', ')}]`);
			}
		}
		expect(wrong, `a pinned network order must start with solana: ${wrong.join('; ')}`).toEqual([]);
	});

	it("paidEndpoint's default is still Solana-first, so inheriting is correct", () => {
		// The routes above were fixed by DELETING their override and inheriting this
		// default. If the default itself ever flips, deleting an override silently
		// becomes the wrong fix, so the two are asserted together.
		const source = readFileSync(join(ROOT, 'api/_lib/x402-paid-endpoint.js'), 'utf8');
		const match = source.match(/networks\s*=\s*\[([^\]]*)\]/);
		expect(match, 'paidEndpoint must declare a default network order').toBeTruthy();
		const list = match[1]
			.split(',')
			.map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
			.filter(Boolean);
		expect(list[0]).toBe('solana');
	});
});
