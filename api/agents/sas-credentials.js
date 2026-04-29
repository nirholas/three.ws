/**
 * GET /api/agents/sas-credentials?subject=<pubkey>&network=devnet|mainnet&kind=...
 *
 * Read SAS credentials issued to a wallet or agent (subject = nonce).
 * Public; backed by solana_credentials cache.
 */

import { sql } from '../_lib/db.js';
import { cors, json, method, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: false })) return;
	if (!method(req, res, ['GET'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url = new URL(req.url, `http://${req.headers.host}`);
	const subject = url.searchParams.get('subject');
	const network = url.searchParams.get('network') === 'mainnet' ? 'mainnet' : 'devnet';
	const kind    = url.searchParams.get('kind') || null;
	const includeClosed = url.searchParams.get('include_closed') === '1';

	if (!subject) return error(res, 400, 'validation_error', 'subject required');

	const rows = kind
		? await sql`
			select attestation_pda, schema_pda, credential_pda, kind, subject,
				   issuer_signature, data, expiry, closed, issued_at
			from solana_credentials
			where subject = ${subject} and network = ${network} and kind = ${kind}
			  and (${includeClosed} or closed = false)
			  and (expiry is null or expiry > now())
			order by issued_at desc
		`
		: await sql`
			select attestation_pda, schema_pda, credential_pda, kind, subject,
				   issuer_signature, data, expiry, closed, issued_at
			from solana_credentials
			where subject = ${subject} and network = ${network}
			  and (${includeClosed} or closed = false)
			  and (expiry is null or expiry > now())
			order by issued_at desc
		`;

	return json(res, 200, {
		subject, network, kind, count: rows.length, data: rows,
	});
});
