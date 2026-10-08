// What a visitor pasted into the Chart Companion, turned into an address query.
//
// A DEXTools link names its chain and pair outright (both the app's
// pair-explorer URL and the widget-chart URL are accepted, with or without the
// locale segment). A bare base58 string could be a pair or a mint; the page
// settles which by asking /api/coin/pair first.

export const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const DEXTOOLS_URL_RE = /dextools\.io\/(?:app|widget-chart)\/(?:[a-z]{2}\/)?([a-z]+)\/(?:pair-explorer|pe-light)\/([1-9A-HJ-NP-Za-km-z]{32,44}|0x[0-9a-fA-F]{40})/i;

/**
 * @param {string} raw
 * @returns {{ pair: string } | { address: string } | { error: string }}
 */
export function parseTarget(raw) {
	const s = String(raw || '').trim();
	if (!s) return { error: 'Paste a DEXTools pair link, a pair address, or a token mint.' };
	const m = DEXTOOLS_URL_RE.exec(s);
	if (m) {
		if (m[1].toLowerCase() !== 'solana') {
			return { error: 'Live reactions run on Solana pairs. That link is for another chain.' };
		}
		return { pair: m[2] };
	}
	if (SOL_RE.test(s)) return { address: s };
	return { error: 'That does not look like a DEXTools link or a Solana address.' };
}
