// Shared helpers for the paired-coin pages: /markets/robinhood/paired (hub),
// /markets/robinhood/paired/:address (coin page) and /launch/paired (launch).

export const esc = (v) =>
	String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');

export const CLASS_LABELS = {
	'rwa-equity': 'Stock',
	stablecoin: 'Stablecoin',
	'crypto-major': 'Major',
	'crypto-native': 'Chain coin',
	unlisted: 'Unlisted',
};

/** Dollar amount, compact above $10k. */
export function usd(n, { compact = true } = {}) {
	const v = Number(n);
	if (n == null || !Number.isFinite(v)) return '-';
	if (compact && Math.abs(v) >= 10_000) {
		return `$${v.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 2 })}`;
	}
	if (Math.abs(v) > 0 && Math.abs(v) < 0.01) return `$${v.toPrecision(3)}`;
	return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A quote-denominated amount: tiny prices keep four significant digits instead of rounding to zero. */
export function amount(n, digits = 6) {
	const v = Number(n);
	if (n == null || !Number.isFinite(v)) return '-';
	if (v === 0) return '0';
	if (Math.abs(v) < 0.0001) return v.toPrecision(4);
	if (Math.abs(v) >= 1_000_000) return v.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 2 });
	return v.toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) >= 1 ? Math.min(digits, 4) : digits });
}

export const pct = (bps) => `${Number((bps / 100).toFixed(2))}%`;

export function ago(seconds) {
	if (!seconds) return '';
	const d = Math.max(0, Date.now() / 1000 - seconds);
	if (d < 60) return `${Math.floor(d)}s ago`;
	if (d < 3600) return `${Math.floor(d / 60)}m ago`;
	if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
	return `${Math.floor(d / 86400)}d ago`;
}

export async function getJson(url, init) {
	const res = await fetch(url, { headers: { accept: 'application/json' }, credentials: 'include', ...init });
	const body = await res.json().catch(() => null);
	if (!res.ok) {
		throw Object.assign(new Error(body?.error_description || body?.error || `Request failed (${res.status})`), {
			status: res.status,
			code: body?.error,
			detail: body?.detail,
		});
	}
	return body?.data ?? body;
}

/** A readable error line for a failed load, with the network case named plainly. */
export function explainLoad(err) {
	if (/failed to fetch|network/i.test(err?.message || '')) return 'three.ws could not be reached. Check your connection and try again.';
	if (err?.status === 429) return 'Too many requests right now. Wait a few seconds and try again.';
	return err?.message || 'Something went wrong loading this.';
}

export function classChip(assetClass) {
	const key = CLASS_LABELS[assetClass] ? assetClass : 'unlisted';
	return `<span class="pc-class pc-class-${esc(key)}">${esc(CLASS_LABELS[key])}</span>`;
}

/** The initial-letter disc shown when a coin has no logo. */
export function coinLogo(coin, size = 44) {
	const img = coin.descriptor?.image;
	if (img) return `<img class="pc-logo" src="${esc(img)}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async" data-no-dark-filter />`;
	return `<span class="pc-logo pc-logo-fallback" style="width:${size}px;height:${size}px" aria-hidden="true">${esc((coin.symbol || '?').slice(0, 1))}</span>`;
}
