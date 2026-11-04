// Small text helpers the printers share.

export function ago(iso, now = Date.now()) {
	if (!iso) return 'never';
	const s = Math.round((now - Date.parse(iso)) / 1000);
	const future = s < 0;
	const a = Math.abs(s);
	const v = a < 60 ? `${a}s` : a < 3600 ? `${Math.round(a / 60)}m` : a < 86_400 ? `${Math.round(a / 3600)}h` : `${Math.round(a / 86_400)}d`;
	return future ? `in ${v}` : `${v} ago`;
}

export function truncate(text, max) {
	const s = String(text ?? '').replace(/\s+/g, ' ').trim();
	return s.length > max ? `${s.slice(0, Math.max(0, max - 3))}...` : s;
}

/** Left-aligned columns; the last column is not padded. */
export function table(rows, { gap = 2 } = {}) {
	if (!rows.length) return '';
	const widths = [];
	for (const r of rows) r.forEach((c, i) => (widths[i] = Math.max(widths[i] || 0, String(c ?? '').length)));
	return rows.map((r) => r.map((c, i) => (i === r.length - 1 ? String(c ?? '') : String(c ?? '').padEnd(widths[i] + gap))).join('')).join('\n');
}

export function usd(n) {
	const v = Number(n) || 0;
	return v === 0 ? '$0' : v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}

export function errorMessage(err) {
	return String(err?.message || err);
}
