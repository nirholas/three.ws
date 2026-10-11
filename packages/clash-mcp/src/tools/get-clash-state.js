// `get_clash_state` — the live Coin Clash battle board. Read-only.
//
// Wraps GET /api/clash/state. Returns the current round's bracket: which
// factions are matched, each army's accumulated rally power + live momentum,
// the tug-of-war share, who's leading, and how long is left on the clock.

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'get_clash_state',
	title: 'Coin Clash battle board',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Read the live Coin Clash board for the current round. Coin Clash is three.ws community faction warfare: every CoinCommunities community is a faction, its holders are its army, and two factions are matched each round — whichever army rallies more power before the clock runs out wins. Returns `epoch` (round index), `endsAt`/`msLeft`/`epochMs` (the clock), and `arena`: an array of battles, each with sides `a` and `b` (token, symbol, image, members, posts, priceUsd, live `momentum` multiplier, accumulated `power`, all-time `record`), `aShare` (side a\'s share of the round\'s combined power for a tug-of-war bar), and `leader` (the winning side\'s token, or null if tied). `bye` is the unmatched faction this round (odd roster), `factionCount` the active army count. Live data — power and standings move between calls. Use this to see who\'s fighting and who\'s winning before enlisting or rallying.',
	inputSchema: {},
	async handler() {
		const data = await apiRequest('/api/clash/state');
		const d = data?.data ?? {};
		return {
			ok: true,
			epoch: d.epoch ?? null,
			endsAt: d.endsAt ?? null,
			msLeft: d.msLeft ?? null,
			epochMs: d.epochMs ?? null,
			factionCount: d.factionCount ?? 0,
			arena: Array.isArray(d.arena) ? d.arena : [],
			bye: d.bye ?? null,
		};
	},
};
