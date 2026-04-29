// Refresh: paste the latest gmgn radar JSON over src/kol/radar-fixture.json.
// Each entry must have: { mint, name, symbol, signalType, score, ts }.

import fixtureData from './radar-fixture.json' with { type: 'json' };

const MAX_LIMIT = 100;
const VALID_CATEGORIES = new Set(['pump-fun', 'new-mints', 'volume-spike']);

/**
 * @param {{ category?: string, limit?: number }} opts
 * @returns {{ mint: string, name: string, symbol: string, signalType: string, score: number, ts: number }[]}
 */
export async function getRadarSignals({ category = 'pump-fun', limit = 20 } = {}) {
	if (!VALID_CATEGORIES.has(category)) {
		throw new Error(`Unknown category "${category}". Valid: ${[...VALID_CATEGORIES].join(', ')}`);
	}

	const cap = Math.min(Math.max(1, limit), MAX_LIMIT);

	return fixtureData
		.filter((entry) => entry.signalType === category)
		.sort((a, b) => b.score - a.score)
		.slice(0, cap);
}
