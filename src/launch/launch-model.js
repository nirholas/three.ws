// Pure logic behind /launch: form validation, the cost preview, and the small
// formatting rules the page shares with its tests. No DOM, no network.

export const NAME_MAX = 32;
export const SYMBOL_MAX = 10;
export const DESCRIPTION_MAX = 500;
export const MAX_SOL_BUY_IN = 50;
export const MAX_USDC_BUY_IN = 1_000_000;
// pump.fun create fee + mint and curve rent, the same estimate the server's
// agent-wallet preflight uses.
export const DEFAULT_CREATE_COST_SOL = 0.022;
export const DEV_BUY_PRESETS = Object.freeze({ sol: ['0.1', '0.5', '1', '2'], usdc: ['10', '50', '100', '250'] });

/** Tickers are uppercase ASCII letters and digits, the way every launchpad shows them. */
export function normalizeSymbol(raw) {
	return String(raw || '')
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, '')
		.slice(0, SYMBOL_MAX);
}

/** A ticker suggestion from a name: the first letters of each word, else the name itself. */
export function suggestSymbol(name) {
	const words = String(name || '').trim().split(/\s+/).filter(Boolean);
	if (!words.length) return '';
	const initials = normalizeSymbol(words.map((w) => w[0]).join(''));
	if (words.length > 1 && initials.length >= 2) return initials;
	return normalizeSymbol(words.join(''));
}

/** Parse the dev-buy input. Returns a finite, non-negative number or NaN. */
export function parseBuyIn(raw) {
	const s = String(raw ?? '').trim();
	if (s === '') return 0;
	if (!/^\d*\.?\d*$/.test(s)) return NaN;
	const n = Number(s);
	return Number.isFinite(n) && n >= 0 ? n : NaN;
}

/**
 * Everything that must be true before the Launch button arms, as a list of
 * human-readable problems (empty when ready). Order matches the form top-down
 * so the first item is the next thing to fix.
 */
export function launchProblems(form, { quote = 'sol' } = {}) {
	const problems = [];
	if (!form.agentId) problems.push({ field: 'agent', text: 'Pick the 3D agent this coin belongs to' });
	const name = String(form.name || '').trim();
	if (!name) problems.push({ field: 'name', text: 'Name your coin' });
	else if ([...name].length > NAME_MAX) problems.push({ field: 'name', text: `Name must be ${NAME_MAX} characters or fewer` });
	const symbol = normalizeSymbol(form.symbol);
	if (symbol.length < 2) problems.push({ field: 'symbol', text: 'Ticker needs at least two letters or digits' });
	if (String(form.description || '').length > DESCRIPTION_MAX) {
		problems.push({ field: 'description', text: `Description must be ${DESCRIPTION_MAX} characters or fewer` });
	}
	const buy = parseBuyIn(form.buyIn);
	const cap = quote === 'usdc' ? MAX_USDC_BUY_IN : MAX_SOL_BUY_IN;
	if (Number.isNaN(buy)) problems.push({ field: 'buyIn', text: 'Dev buy must be a number' });
	else if (buy > cap) problems.push({ field: 'buyIn', text: `Dev buy is capped at ${cap.toLocaleString('en-US')} ${quote.toUpperCase()}` });
	for (const key of ['website', 'twitter', 'telegram']) {
		const v = String(form[key] || '').trim();
		if (v && v.length > 200) problems.push({ field: key, text: `${key} link is too long` });
	}
	return problems;
}

/**
 * The launch cost preview. The fee is floored to the quote's base units exactly
 * as the server computes it, so the preview matches the signed transaction.
 * @returns {{ quote:'SOL'|'USDC', buyIn:number, fee:number, feeBps:number,
 *   createSol:number, totalSol:number, totalQuote:number }}
 */
export function launchCost({ buyIn, quote = 'sol', feeBps = 0, createCostSol = DEFAULT_CREATE_COST_SOL }) {
	const buy = Math.max(0, Number.isFinite(buyIn) ? buyIn : 0);
	const decimals = quote === 'usdc' ? 6 : 9;
	const scale = 10 ** decimals;
	const atomics = Math.floor(buy * scale);
	const feeAtomics = feeBps > 0 ? Math.floor((atomics * feeBps) / 10_000) : 0;
	const fee = feeAtomics / scale;
	const isUsdc = quote === 'usdc';
	return {
		quote: isUsdc ? 'USDC' : 'SOL',
		buyIn: buy,
		fee,
		feeBps,
		createSol: createCostSol,
		totalSol: isUsdc ? createCostSol : createCostSol + buy + fee,
		totalQuote: isUsdc ? buy + fee : 0,
	};
}

/** Trim trailing zeros for display without losing sub-cent precision. */
export function formatAmount(n, maxDecimals = 6) {
	if (!Number.isFinite(n)) return '0';
	if (n === 0) return '0';
	const fixed = n.toFixed(maxDecimals).replace(/\.?0+$/, '');
	return fixed === '0' || fixed === '-0' ? `<${(1 / 10 ** maxDecimals).toFixed(maxDecimals)}` : fixed;
}

/** "EPjF…Dt1v" */
export function shortAddress(a, head = 4, tail = 4) {
	const s = String(a || '');
	return s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;
}

/** A post announcing the launch, for the success screen's share button. */
export function shareText({ name, symbol, mint, agentName }) {
	const who = agentName ? ` for my 3D AI agent ${agentName}` : '';
	return `I just launched $${symbol} (${name})${who} on @trythreews\n\nhttps://three.ws/launches/${mint}`;
}

/** Map a server or wallet error to one sentence a launcher can act on. */
export function friendlyLaunchError(err) {
	const code = err?.code || '';
	const msg = String(err?.message || err || '');
	if (code === 'USER_REJECTED' || /reject|denied|cancel/i.test(msg)) return 'You cancelled the request in your wallet. Nothing was sent.';
	if (code === 'launch_payload_too_large') return msg.charAt(0).toUpperCase() + msg.slice(1) + '.';
	if (code === 'insufficient_funds' || code === 'insufficient_usdc' || /insufficient (funds|lamports)|0x1\b/i.test(msg)) {
		return 'Not enough balance to cover the dev buy, fee and network costs. Lower the dev buy or add funds.';
	}
	if (code === 'wallet not linked to your account' || /not linked/i.test(msg)) return 'Link this wallet to your three.ws account, then launch again.';
	if (code === 'unauthorized' || /sign in required/i.test(msg)) return 'Your session expired. Sign in again to launch.';
	if (code === 'rate_limited') return 'Too many attempts in a short time. Wait a moment and try again.';
	if (/blockhash not found|block height exceeded|expired/i.test(msg)) return 'The transaction expired before it was sent. Launch again to get a fresh one.';
	if (code === 'rpc_unavailable' || /failed to fetch|network/i.test(msg)) return 'Could not reach the Solana network. Check your connection and try again.';
	return msg ? msg.replace(/^Error:\s*/, '') : 'Something went wrong. Nothing was charged; try again.';
}
