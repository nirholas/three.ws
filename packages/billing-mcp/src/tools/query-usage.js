// `query_usage` — your metered usage rolled up into an invoice statement for a
// billing period. Account-scoped (session). Read-only.
//
// Wraps GET /api/billing/invoices. The route sums your usage_events ledger over
// the period into per-action line items (count, units, gross/fee/net in USDC) and
// statement totals, each line tracing to a real settlement, plus a reconciliation
// summary (do all charges map to a real on-chain settlement?). Defaults to the
// current UTC calendar month; accepts a `period=YYYY-MM` or an explicit from/to.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'query_usage',
	title: 'My metered usage / invoice statement for a period',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Your metered usage rolled up into an invoice statement for a billing period — what you were charged for, ' +
		'broken down by action. Returns `period_label` + `period` ({from,to} ISO), `line_items` (one per billed ' +
		'action: action id, human label, count, units, gross_usd, fee_usd, gross/fee/net atomics in USDC 6dp, ' +
		'discount_bps holder-tier discount applied), `totals` (charge_count, gross_usd, fee_usd, net_usd, currency), ' +
		'and `reconciliation` (total / reconciled / unreconciled / all_reconciled — whether every charge maps to a ' +
		'real settlement). Defaults to the current UTC calendar month. Pass `period` (YYYY-MM) for a calendar month, ' +
		'or `from`/`to` (ISO-8601) for an explicit window — `period` wins if both are given. For a downloadable CSV ' +
		'of the same line items use export_billing_history. Requires THREE_WS_SESSION. Read-only. ' +
		'Use this to explain what a period\'s charges were for; for one charge\'s itemized receipt call get_receipt.',
	inputSchema: {
		period: z
			.string()
			.regex(/^\d{4}-\d{2}$/, 'period must be YYYY-MM')
			.optional()
			.describe('A calendar month as YYYY-MM (e.g. 2026-06). Takes precedence over from/to. Omit for the current month.'),
		from: z
			.string()
			.optional()
			.describe('Window start, ISO-8601 (e.g. 2026-06-01T00:00:00Z). Ignored when `period` is set.'),
		to: z
			.string()
			.optional()
			.describe('Window end (exclusive), ISO-8601. Ignored when `period` is set.'),
	},
	async handler(args) {
		const query = {};
		if (args?.period) query.period = args.period;
		else {
			if (args?.from) query.from = args.from;
			if (args?.to) query.to = args.to;
		}

		const data = await apiRequest('/api/billing/invoices', { auth: true, query });
		const invoice = data?.invoice ?? {};
		const lineItems = Array.isArray(invoice.line_items) ? invoice.line_items : [];

		return {
			ok: true,
			period_label: invoice.period_label ?? null,
			period: invoice.period ?? null,
			line_item_count: lineItems.length,
			line_items: lineItems,
			totals: invoice.totals ?? null,
			reconciliation: invoice.reconciliation ?? null,
		};
	},
};
