/**
 * Short legal URLs.
 *
 * Marketplace and directory reviewers (and people typing from memory) try
 * /privacy, /terms and /tos before the canonical /legal/* paths. Production
 * answered all three with a 404 on 2026-11-20. These routes 301 them to the
 * live pages, asserted against the production resolver itself.
 */

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadRouteTable, resolvePhase1 } from '../server/route-resolve.mjs';

const { phase1Routes } = loadRouteTable(fileURLToPath(new URL('../vercel.json', import.meta.url)));

function resolve(target) {
	const url = new URL(`https://three.ws${target}`);
	const r = resolvePhase1(phase1Routes, { headers: {} }, url);
	return { status: r.status || null, location: r.headers?.Location || r.headers?.location || null };
}

describe('short legal URLs redirect to the canonical legal pages', () => {
	it.each([
		['/privacy', '/legal/privacy'],
		['/privacy/', '/legal/privacy'],
		['/terms', '/legal/tos'],
		['/terms/', '/legal/tos'],
		['/tos', '/legal/tos'],
		['/tos/', '/legal/tos'],
	])('%s 301s to %s', (from, to) => {
		const r = resolve(from);
		expect(r.status).toBe(301);
		expect(r.location).toBe(to);
	});

	it('the canonical legal pages themselves are not redirected', () => {
		expect(resolve('/legal/privacy').status).not.toBe(301);
		expect(resolve('/legal/tos').status).not.toBe(301);
	});
});
