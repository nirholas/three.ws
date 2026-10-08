// Turns whatever a person pastes into the /dextools embed builder into the
// address it names, and whether that address is known to be a pair or a mint.
//
// People copy from wherever they were looking: a DEXTools pair page, a
// DexScreener or GeckoTerminal page, pump.fun, Birdeye, or the bare address.
// Each of those carries a different identifier in a different place, and only
// some of them say which kind it is:
//
//   dextools.io/app/[en/]solana/pair-explorer/<pair>    pair
//   geckoterminal.com/solana/pools/<pair>               pair
//   pump.fun/coin/<mint>, pump.fun/<mint>                mint
//   birdeye.so/token/<mint>                              mint
//   dexscreener.com/solana/<address>                     either (DexScreener accepts both)
//   <address>                                            either
//
// `kind: 'unknown'` is resolved by the caller against /api/coin/pair, which is
// the only honest way to tell a pool account from a mint on Solana.
//
// Dependency-free and DOM-free so it is unit-tested directly.

const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** @typedef {{ address: string, kind: 'pair'|'mint'|'unknown', source: string }} ParsedInput */

function hostOf(url) {
	return url.hostname.replace(/^www\./, '').toLowerCase();
}

/**
 * @param {string} raw
 * @returns {ParsedInput | { error: string }}
 */
export function parseTokenInput(raw) {
	const text = String(raw || '').trim();
	if (!text) return { error: 'Paste a DEXTools link, a pair address or a token address.' };
	if (SOL_RE.test(text)) return { address: text, kind: 'unknown', source: 'address' };

	let url;
	try {
		url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
	} catch {
		return { error: 'That is neither a link nor a Solana address.' };
	}
	const host = hostOf(url);
	const parts = url.pathname.split('/').filter(Boolean);
	const pick = (i, kind, source) => {
		const address = parts[i] || '';
		return SOL_RE.test(address) ? { address, kind, source } : { error: `That ${source} link does not end in a Solana address.` };
	};

	if (host === 'dextools.io') {
		// /app/<chain>/pair-explorer/<pair>, with an optional language segment.
		const i = parts.indexOf('pair-explorer');
		if (i < 1) return { error: 'Use the DEXTools pair page link, the one with pair-explorer in it.' };
		if (parts[i - 1] !== 'solana') return { error: 'That DEXTools pair is not on Solana. The 3D scene and boost card render Solana tokens.' };
		return pick(i + 1, 'pair', 'DEXTools');
	}
	if (host === 'geckoterminal.com') {
		if (parts[0] !== 'solana' || parts[1] !== 'pools') return { error: 'Use a Solana pool link from GeckoTerminal.' };
		return pick(2, 'pair', 'GeckoTerminal');
	}
	if (host === 'dexscreener.com') {
		if (parts[0] !== 'solana') return { error: 'That DexScreener market is not on Solana.' };
		return pick(1, 'unknown', 'DexScreener');
	}
	if (host === 'pump.fun') {
		return pick(parts[0] === 'coin' ? 1 : 0, 'mint', 'pump.fun');
	}
	if (host === 'birdeye.so') {
		return pick(parts.indexOf('token') + 1, 'mint', 'Birdeye');
	}
	if (host === 'three.ws') {
		const mint = url.searchParams.get('mint');
		if (mint && SOL_RE.test(mint)) return { address: mint, kind: 'mint', source: 'three.ws' };
		const pair = url.searchParams.get('pair');
		if (pair && SOL_RE.test(pair)) return { address: pair, kind: 'pair', source: 'three.ws' };
		const last = parts[parts.length - 1] || '';
		if (SOL_RE.test(last)) return { address: last, kind: 'mint', source: 'three.ws' };
	}
	return { error: 'Paste a DEXTools, DexScreener, GeckoTerminal, pump.fun or Birdeye link, or a bare address.' };
}

/**
 * The embed URLs and iframe snippets for one resolved token.
 *
 * @param {{ mint: string, pair?: string|null, theme?: 'dark'|'light', origin?: string }} p
 */
export function embedSnippets({ mint, pair = null, theme = 'dark', origin = 'https://three.ws' }) {
	const t = theme === 'light' ? 'light' : 'dark';
	// The 3D scene is keyed by pair when one is known: that is the identifier a
	// DEXTools page already has, so a snippet built here matches one written by hand there.
	const sceneQuery = new URLSearchParams(pair ? { pair, embed: '1' } : { mint, embed: '1' });
	const boostQuery = new URLSearchParams({ mint, ...(t === 'light' ? { theme: t } : {}) });
	const scene = `${origin}/coin3d?${sceneQuery}`;
	const boost = `${origin}/embed/dextools-boost?${boostQuery}`;
	const amp = (s) => s.replace(/&/g, '&amp;');
	return {
		scene,
		boost,
		sceneHtml: `<iframe src="${amp(scene)}"\n        width="420" height="560" style="border:0" loading="lazy"\n        title="Token in 3D by three.ws"></iframe>`,
		boostHtml: `<iframe src="${amp(boost)}"\n        width="380" height="400" style="border:0" loading="lazy"\n        title="Boost on DEXTools"></iframe>`,
	};
}
