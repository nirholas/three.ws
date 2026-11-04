/**
 * GET /api/admin/accounting-export?from=YYYY-MM-DD&to=YYYY-MM-DD&format=csv|json
 *
 * Admin-only accounting ledger across withdrawals, platform fee events and
 * bounty escrow/payout/refund (see api/_lib/accounting-export.js). `from` and
 * `to` are inclusive UTC dates, at most 366 days apart. 401 without a session,
 * 403 for a signed-in non-admin.
 */

import { cors, error, method, wrap } from '../_lib/http.js';
import { requireAdmin } from '../_lib/admin.js';
import { COLUMNS, collectAccountingRows, parseRange, toCsv } from '../_lib/accounting-export.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;
	if (!(await requireAdmin(req, res))) return;

	const url = new URL(req.url, 'http://internal');
	const format = (url.searchParams.get('format') || 'csv').toLowerCase();
	if (format !== 'csv' && format !== 'json') return error(res, 400, 'invalid_format', 'format must be csv or json');

	let range;
	try {
		range = parseRange(url.searchParams.get('from'), url.searchParams.get('to'));
	} catch (err) {
		return error(res, err.status || 400, err.code || 'invalid_range', err.message);
	}

	const rows = await collectAccountingRows(range);
	res.setHeader('cache-control', 'private, no-store');
	if (format === 'json') {
		res.statusCode = 200;
		res.setHeader('content-type', 'application/json; charset=utf-8');
		res.end(JSON.stringify({ from: range.from, to: range.to, count: rows.length, columns: COLUMNS, rows }));
		return;
	}
	res.statusCode = 200;
	res.setHeader('content-type', 'text/csv; charset=utf-8');
	res.setHeader('content-disposition', `attachment; filename="accounting-${range.from}_${range.to}.csv"`);
	res.end(toCsv(rows));
});
