// Noisy-OR combiner: independent signals of confidence c1..cn combine into one
// probability that two addresses share a controller as 1 - product(1 - ci).
// This is how wallet-sleuth folds several weak-to-strong signals into one
// score without letting any single signal dominate by itself, and it stays
// chain-agnostic: it only ever sees `{ id, weight, evidence }`, never a chain.

const BANDS = [
	{ min: 85, band: 'confirmed' },
	{ min: 65, band: 'strong' },
	{ min: 40, band: 'moderate' },
	{ min: 20, band: 'weak' },
	{ min: 0, band: 'none' },
];

export function bandFor(score) {
	for (const b of BANDS) if (score >= b.min) return b.band;
	return 'none';
}

function clamp01(n) {
	return Math.min(1, Math.max(0, n));
}

/**
 * @param {Array<{id:string, weight:number, evidence:Array}>} signalResults
 * @returns {{ score: number, band: string, topSignal: string|null, signals: string[] }}
 */
export function scorePair(signalResults) {
	if (!signalResults.length) {
		return { score: 0, band: 'none', topSignal: null, signals: [] };
	}
	let q = 1;
	for (const r of signalResults) q *= 1 - clamp01(r.weight);
	const score = Math.round(clamp01(1 - q) * 100);
	const top = signalResults.slice().sort((x, y) => y.weight - x.weight)[0];
	return {
		score,
		band: bandFor(score),
		topSignal: top?.id ?? null,
		signals: signalResults.map((r) => r.id),
	};
}
