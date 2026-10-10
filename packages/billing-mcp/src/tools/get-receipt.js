// `get_receipt` — a single itemized receipt, by charge or by skill purchase.
// Account-scoped (session). Read-only.
//
// Wraps GET /api/billing/receipts. Two receipt forms, both owner-gated:
//   • event_id   — a per-CHARGE receipt from the usage ledger: action, units,
//                  price, fee, holder discount, the settlement tx (+ explorer
//                  link), and the timestamp.
//   • purchase_id — the signed receipt JSON for a confirmed skill purchase.
// Exactly one of the two must be supplied.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'get_receipt',
	title: 'Get one receipt (per-charge or per-purchase)',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Fetch a single itemized receipt you own, in one of two forms. Pass `event_id` (numeric, from a usage ' +
		'line item) for a per-CHARGE receipt: action, label, units, gross_usd / fee_usd / net (with USDC atomics), ' +
		'discount_bps + discount_percent, and a `settlement` block (kind, ref, tx_signature, network, explorer_url, ' +
		'token_price_usd) plus issued_at. Pass `purchase_id` (UUID) instead for the cryptographically SIGNED receipt ' +
		'JSON of a confirmed skill purchase (receipt + signature + issued_at). Supply exactly one. Returns the ' +
		'`receipt` object and which `kind` ("charge" | "purchase") it is. Requires THREE_WS_SESSION. Read-only. ' +
		'Use this to prove or itemize one specific charge or purchase; for a whole period\'s charges call query_usage.',
	inputSchema: {
		event_id: z
			.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/, 'event_id must be numeric')])
			.optional()
			.describe('Numeric usage-event id for a per-charge receipt (from a query_usage line item). Mutually exclusive with purchase_id.'),
		purchase_id: z
			.string()
			.uuid('purchase_id must be a UUID')
			.optional()
			.describe('UUID of a confirmed skill purchase for its signed receipt JSON. Mutually exclusive with event_id.'),
	},
	async handler(args) {
		const eventId = args?.event_id;
		const purchaseId = args?.purchase_id;

		const hasEvent = eventId !== undefined && eventId !== null && String(eventId) !== '';
		const hasPurchase = !!purchaseId;

		if (hasEvent === hasPurchase) {
			throw Object.assign(
				new Error('Provide exactly one of `event_id` (per-charge receipt) or `purchase_id` (per-purchase receipt).'),
				{ code: 'bad_request', status: 400 },
			);
		}

		const query = hasEvent ? { event_id: String(eventId) } : { purchase_id: purchaseId };
		const data = await apiRequest('/api/billing/receipts', { auth: true, query });

		return {
			ok: true,
			kind: hasEvent ? 'charge' : 'purchase',
			receipt: data?.data ?? null,
		};
	},
};
