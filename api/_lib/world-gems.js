// Pure rules for gem mining in the three.ws world. Kept free of I/O so the
// api/world/gems.js handler and the src/desktop/world/mine.js HUD agree on
// the table and the tests can pin it without a database.

/** Seconds a miner has to spend at a node before a dig can complete. */
export const DIG_SECONDS = 4;

/** Server-side floor between two completed digs for one miner, in ms. */
export const MIN_DIG_INTERVAL_MS = (DIG_SECONDS - 0.75) * 1000;

/** Most digs one miner can complete per UTC day. Keeps the ledger honest. */
export const DAILY_DIG_CAP = 300;

/**
 * Gem table. Weights sum to 1000 and are rolled server-side with crypto
 * randomness. `hex` is the in-world crystal colour, `points` the gem's value
 * on the miner's balance.
 */
export const GEMS = [
	{ id: 'quartz', label: 'Quartz', weight: 520, points: 1, hex: 0xe6e6f0 },
	{ id: 'amethyst', label: 'Amethyst', weight: 260, points: 3, hex: 0xc4b5fd },
	{ id: 'sapphire', label: 'Sapphire', weight: 130, points: 8, hex: 0x60a5fa },
	{ id: 'emerald', label: 'Emerald', weight: 60, points: 20, hex: 0x34d399 },
	{ id: 'ruby', label: 'Ruby', weight: 24, points: 50, hex: 0xf87171 },
	{ id: 'diamond', label: 'Diamond', weight: 6, points: 200, hex: 0xffffff },
];

export const GEM_BY_ID = Object.fromEntries(GEMS.map((g) => [g.id, g]));

/** Mining nodes in the world. Ids are the only thing the client may name. */
export const NODES = ['vein-a', 'vein-b', 'vein-c', 'vein-d', 'vein-e'];

const ANON_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function validAnonId(v) {
	return typeof v === 'string' && ANON_RE.test(v);
}

export function validNode(v) {
	return typeof v === 'string' && NODES.includes(v);
}

/**
 * Roll a gem. `r` is a uniform number in [0, 1); callers pass crypto
 * randomness, tests pass fixed values.
 */
export function rollGem(r) {
	const total = GEMS.reduce((n, g) => n + g.weight, 0);
	let pick = Math.max(0, Math.min(0.999999, Number(r) || 0)) * total;
	for (const g of GEMS) {
		if (pick < g.weight) return g;
		pick -= g.weight;
	}
	return GEMS[0];
}

/**
 * Whether a dig may complete now given the miner's last completed dig.
 * @param {number|null|undefined} lastMinedAtMs epoch ms of the last dig, or null
 * @param {number} nowMs
 */
export function digAllowed(lastMinedAtMs, nowMs = Date.now()) {
	if (lastMinedAtMs == null || !Number.isFinite(lastMinedAtMs)) return true;
	return nowMs - lastMinedAtMs >= MIN_DIG_INTERVAL_MS;
}

/** Total points for a list of { gem, amount } rows. */
export function totalPoints(rows) {
	let n = 0;
	for (const r of rows || []) {
		const g = GEM_BY_ID[r.gem];
		if (!g) continue;
		n += g.points * (Number(r.amount) || 0);
	}
	return n;
}

/**
 * Collapse ledger rows into the balance the HUD shows.
 * @param {Array<{gem:string, amount:number|string}>} rows
 */
export function summarize(rows) {
	const counts = {};
	for (const g of GEMS) counts[g.id] = 0;
	for (const r of rows || []) if (r.gem in counts) counts[r.gem] += Number(r.amount) || 0;
	return { gems: counts, points: totalPoints(rows), total: Object.values(counts).reduce((a, b) => a + b, 0) };
}
