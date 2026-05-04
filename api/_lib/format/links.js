// Solana / Pump link & format helpers. Ported from pumpkit
// @pumpkit/core/src/formatter/links.ts.
//
// Two flavours of output:
//   - HTML: anchor tags suitable for Telegram-style bots and our own
//     <span class="rich-text"> renderers.
//   - Plain: same data, without markup, for SMS / logs / JSON payloads.

const SOLSCAN_TX = (sig) => `https://solscan.io/tx/${sig}`;
const SOLSCAN_ACCOUNT = (addr) => `https://solscan.io/account/${addr}`;
const PUMPFUN_TOKEN = (mint) => `https://pump.fun/coin/${mint}`;
const DEXSCREENER_TOKEN = (mint, chain = 'solana') => `https://dexscreener.com/${chain}/${mint}`;

function escapeHtml(s) {
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

// ── HTML helpers ────────────────────────────────────────────────────────
export function link(label, url) {
	return `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
}
export function bold(text) { return `<b>${escapeHtml(text)}</b>`; }
export function code(text) { return `<code>${escapeHtml(text)}</code>`; }
export function italic(text) { return `<i>${escapeHtml(text)}</i>`; }

export function solscanTx(signature) { return link('View TX', SOLSCAN_TX(signature)); }
export function solscanAccount(address) { return link(shortenAddress(address), SOLSCAN_ACCOUNT(address)); }
export function pumpFunToken(mint) { return link('View on PumpFun', PUMPFUN_TOKEN(mint)); }
export function dexScreenerToken(mint, chain = 'solana') { return link('DexScreener', DEXSCREENER_TOKEN(mint, chain)); }

// ── Plain-string helpers ────────────────────────────────────────────────
export const urls = {
	solscanTx: SOLSCAN_TX,
	solscanAccount: SOLSCAN_ACCOUNT,
	pumpFunToken: PUMPFUN_TOKEN,
	dexScreenerToken: DEXSCREENER_TOKEN,
};

export function shortenAddress(address, chars = 4) {
	const s = String(address || '');
	if (s.length <= chars * 2 + 3) return s;
	return `${s.slice(0, chars)}...${s.slice(-chars)}`;
}

// Lamports → SOL string. Accepts number, bigint, or numeric string.
export function formatSol(lamports) {
	const n = typeof lamports === 'bigint' ? Number(lamports) : Number(lamports || 0);
	const sol = n / 1_000_000_000;
	const decimals = sol === 0 ? 2 : sol < 1 ? 4 : 2;
	return `${sol.toFixed(decimals)} SOL`;
}

// USDC base-units (6 decimals) → "$1,234.56".
export function formatUsdc(baseUnits) {
	const n = typeof baseUnits === 'bigint' ? Number(baseUnits) : Number(baseUnits || 0);
	const usdc = n / 1_000_000;
	return `$${usdc.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatNumber(n) {
	return Number(n || 0).toLocaleString('en-US');
}

// Compact form: 1_234_567 → "1.23M". Useful for token supply / market cap.
export function formatCompact(n) {
	const x = Number(n || 0);
	if (!isFinite(x)) return '—';
	const abs = Math.abs(x);
	if (abs >= 1e12) return (x / 1e12).toFixed(2) + 'T';
	if (abs >= 1e9) return (x / 1e9).toFixed(2) + 'B';
	if (abs >= 1e6) return (x / 1e6).toFixed(2) + 'M';
	if (abs >= 1e3) return (x / 1e3).toFixed(2) + 'K';
	return x.toFixed(2);
}
