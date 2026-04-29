// KOL leaderboard — static seed scoring.
//
// Data source: src/kol/seed.json — a curated static snapshot of top-trader
// stats derived from kol-quest (https://github.com/nirholas/kol-quest)
// leaderboard methodology (pnlUsd, winRate, trades per window). A live
// implementation would replace this with an indexer query (e.g. GMGN or
// KolScan API) but the scoring shape is identical.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(join(__dirname, 'seed.json'), 'utf8'));

const VALID_WINDOWS = new Set(['24h', '7d', '30d']);

/**
 * @param {{ window?: '24h'|'7d'|'30d', limit?: number }} opts
 * @returns {Promise<Array<{ wallet: string, pnlUsd: number, winRate: number, trades: number, rank: number }>>}
 */
export async function getLeaderboard({ window = '7d', limit = 25 } = {}) {
	if (!VALID_WINDOWS.has(window)) {
		const err = new Error(`invalid window "${window}": must be 24h, 7d, or 30d`);
		err.status = 400;
		err.code = 'invalid_window';
		throw err;
	}

	const cap = Math.min(Math.max(1, Math.floor(Number(limit) || 25)), 100);

	return seed
		.map((entry) => {
			const stats = entry.windows?.[window];
			if (!stats) return null;
			return {
				wallet: entry.wallet,
				pnlUsd: stats.pnlUsd,
				winRate: stats.winRate,
				trades: stats.trades,
			};
		})
		.filter(Boolean)
		.sort((a, b) => b.pnlUsd - a.pnlUsd)
		.slice(0, cap)
		.map((item, i) => ({ ...item, rank: i + 1 }));
}
