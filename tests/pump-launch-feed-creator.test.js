// The sniper's serial-launcher gate reads a creator's launch history through
// enrichCreatorStats. pump.fun retired GET /coins/user-created-coins/<creator>
// on 2026-11-25 (404), so every candidate came back with creator_launches null
// and the gate could not tell a first-time creator from a serial rugger. The
// history now comes from the listing route's `creator` filter, paged.

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../api/_lib/sol-price.js', () => ({ solPriceUsd: async () => 150 }));

const { enrichCreatorStats } = await import('../api/_lib/pump-launch-feed.js');

const CREATOR = 'THREEsyntheticCreator111111111111111111111';

afterEach(() => vi.unstubAllGlobals());

describe('enrichCreatorStats', () => {
	it('counts every launch and graduation from the creator listing, across pages', async () => {
		const total = 73;
		vi.stubGlobal('fetch', vi.fn(async (url) => {
			const u = new URL(String(url));
			if (u.pathname !== '/coins' || u.searchParams.get('creator') !== CREATOR) {
				return new Response(JSON.stringify({ statusCode: 404 }), { status: 404 });
			}
			const offset = Number(u.searchParams.get('offset'));
			const limit = Number(u.searchParams.get('limit'));
			const rows = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => ({
				mint: `THREEsynthetic${offset + i}`, creator: CREATOR, complete: (offset + i) % 10 === 0,
			}));
			return new Response(JSON.stringify(rows), { status: 200 });
		}));

		const launch = await enrichCreatorStats({ mint: 'THREEsynthetic11111111111111111111111111pump', creator: CREATOR });

		expect(launch.creator_launches).toBe(73);
		expect(launch.creator_graduated).toBe(8);
	});
});
