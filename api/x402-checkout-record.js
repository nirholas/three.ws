// Records a successful paid checkout call against a SKU.
//
// The hosted checkout page (/pay/c/<slug>) calls this after the drop-in
// modal returns a settled payment. The endpoint is public — anyone can record
// a call against any SKU — so we authenticate the entry by verifying the
// X-PAYMENT-RESPONSE blob from the facilitator's /settle response.
//
// In v1 we trust the client-reported payment header (the facilitator already
// gated settlement; spoofing means lying to yourself about analytics). Future
// hardening: verify the tx on-chain before recording.

import { z } from 'zod';
import { sql } from './_lib/db.js';
import { cors, json, readJson, wrap, error } from './_lib/http.js';
import { parse } from './_lib/validate.js';

const recordSchema = z.object({
	sku_id: z.string().uuid(),
	network: z.string().min(3).max(80),
	tx_signature: z.string().max(180).optional(),
	payer_address: z.string().max(64).optional(),
	amount_atomics: z.string().regex(/^\d+$/),
	asset: z.string().max(64),
	response_status: z.number().int().min(100).max(599),
	error_code: z.string().max(80).optional(),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { origins: '*', methods: 'POST,OPTIONS' })) return;
	if (req.method !== 'POST') return error(res, 405, 'method_not_allowed', 'use POST');

	const body = parse(recordSchema, await readJson(req));

	// Confirm the SKU exists (and is active) before inserting — keeps the table
	// clean of orphan rows pointing at archived SKUs.
	const [sku] = await sql`select id from x402_skus where id = ${body.sku_id} and archived_at is null limit 1`;
	if (!sku) return error(res, 404, 'sku_not_found', 'no active SKU with that id');

	const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim();
	const ipHash = ip ? simpleHash(ip) : null;
	const ua = (req.headers['user-agent'] || '').toString().slice(0, 240);

	const [row] = await sql`
		insert into x402_checkout_calls (
			sku_id, network, tx_signature, payer_address,
			amount_atomics, asset, response_status, error_code,
			buyer_ip_hash, user_agent
		) values (
			${body.sku_id}, ${body.network},
			${body.tx_signature ?? null}, ${body.payer_address ?? null},
			${body.amount_atomics}, ${body.asset},
			${body.response_status}, ${body.error_code ?? null},
			${ipHash}, ${ua}
		)
		returning id, paid_at
	`;
	return json(res, 201, { ok: true, id: row.id, paid_at: row.paid_at });
});

function simpleHash(s) {
	// Tiny FNV-1a — we just need a stable non-reversible bucket for abuse
	// detection. Not crypto. 32-bit hex output is enough granularity.
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
	}
	return h.toString(16).padStart(8, '0');
}
