// `export_billing_history` — the same invoice line items as query_usage, but as a
// ready-to-save CSV payload. Account-scoped (session). Read-only.
//
// Wraps GET /api/billing/invoices?format=csv. The route streams the period's line
// items plus a TOTAL row as text/csv with a download filename. We return the raw
// CSV string (so the agent can write it to disk or attach it) alongside the
// suggested filename and a small parsed preview of the rows. Same period
// selection as query_usage (period=YYYY-MM, or from/to ISO; default current month).

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

// Parse the CSV header + rows into objects for a structured preview. The API
// quotes the `label` field (which may contain commas), so split on commas that
// are not inside double quotes, then unescape doubled quotes.
function parseCsv(text) {
	const lines = String(text || '')
		.split('\n')
		.filter((l) => l.length > 0);
	if (lines.length === 0) return { header: [], rows: [] };
	const splitRow = (line) => {
		const cells = line.match(/("(?:[^"]|"")*"|[^,]*)(?:,|$)/g) || [];
		// The regex yields a trailing empty match for the line end — drop it.
		if (cells.length && cells[cells.length - 1] === '') cells.pop();
		return cells.map((c) => {
			let v = c.replace(/,$/, '');
			if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/""/g, '"');
			return v;
		});
	};
	const header = splitRow(lines[0]);
	const rows = lines.slice(1).map((l) => {
		const cells = splitRow(l);
		return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
	});
	return { header, rows };
}

export const def = {
	name: 'export_billing_history',
	title: 'Export my billing history as CSV',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Export a billing period\'s usage line items as a ready-to-save CSV — the same charges query_usage returns, ' +
		'in spreadsheet form. Returns `filename` (suggested download name, e.g. three-ws-invoice-2026-06.csv), ' +
		'`content_type` (text/csv), `csv` (the full CSV text, columns: action,label,count,units,gross_usd,fee_usd,' +
		'discount_bps with a trailing TOTAL row), `row_count`, and `preview` (the first few parsed rows as objects ' +
		'for a quick look). Same period selection as query_usage: pass `period` (YYYY-MM) or `from`/`to` (ISO-8601); ' +
		'defaults to the current UTC calendar month. Requires THREE_WS_SESSION. Read-only. ' +
		'Use this when the user wants a file for their records or accounting; to read the charges inline call query_usage.',
	inputSchema: {
		period: z
			.string()
			.regex(/^\d{4}-\d{2}$/, 'period must be YYYY-MM')
			.optional()
			.describe('A calendar month as YYYY-MM (e.g. 2026-06). Takes precedence over from/to. Omit for the current month.'),
		from: z
			.string()
			.optional()
			.describe('Window start, ISO-8601. Ignored when `period` is set.'),
		to: z
			.string()
			.optional()
			.describe('Window end (exclusive), ISO-8601. Ignored when `period` is set.'),
		preview_rows: z
			.number()
			.int()
			.min(0)
			.max(100)
			.default(5)
			.describe('How many parsed line-item rows to include in `preview` (0–100, default 5). The full CSV is always returned in `csv`.'),
	},
	async handler(args) {
		const query = { format: 'csv' };
		if (args?.period) query.period = args.period;
		else {
			if (args?.from) query.from = args.from;
			if (args?.to) query.to = args.to;
		}

		const { contentType, disposition, text } = await apiRequest('/api/billing/invoices', {
			auth: true,
			query,
			accept: 'text/csv',
			raw: true,
		});

		const { rows } = parseCsv(text);
		const previewN = args?.preview_rows ?? 5;
		// Prefer the authoritative download name from content-disposition; fall back
		// to a name derived from the requested period.
		const fromHeader = disposition?.match(/filename="?([^"]+)"?/i)?.[1];
		const label = args?.period || (args?.from || args?.to ? 'custom' : 'current');
		const filename = fromHeader || `three-ws-invoice-${label}.csv`;

		return {
			ok: true,
			filename,
			content_type: contentType || 'text/csv',
			row_count: rows.length,
			preview: rows.slice(0, previewN),
			csv: text,
		};
	},
};
