// Formatting helpers shared by the agent commerce pages (the public invoice
// page and the /commerce console). Kept free of side effects so either page
// can import it without mounting anything else.

/** HTML-escape a value before it goes into innerHTML or an attribute. */
export function esc(v) {
	return String(v == null ? '' : v)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

const RTF = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const UNITS = [
	['day', 86_400_000],
	['hour', 3_600_000],
	['minute', 60_000],
];

/** "3 hours ago" for a past timestamp, "in 2 days" for a future one. */
export function relTime(iso) {
	const diff = new Date(iso).getTime() - Date.now();
	if (!Number.isFinite(diff)) return '';
	for (const [unit, ms] of UNITS) {
		if (Math.abs(diff) >= ms || unit === 'minute') return RTF.format(Math.round(diff / ms), unit);
	}
	return '';
}
