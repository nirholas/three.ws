/**
 * POST /api/agents/sas-issue-credential
 *
 * Admin-only. Issues a credentialed SAS attestation under the three.ws
 * credential authority, then caches it in solana_credentials so the
 * reputation weighting can use it without an RPC roundtrip.
 *
 * Body:
 *   { kind: 'threews.verified-client.v1' | 'threews.audited-validation.v1',
 *     subject: <base58 pubkey>,
 *     data:    { ...schema fields },
 *     expiry?: <unix seconds>,
 *     network?: 'devnet' | 'mainnet' }
 */

import { z } from 'zod';
import { sql } from '../_lib/db.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { parse } from '../_lib/validate.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { requireAdmin } from '../_lib/admin.js';
import { sasIssue, SAS_CONFIG } from '../_lib/sas.js';

const SCHEMAS = Object.keys(SAS_CONFIG.schemas);

const bodySchema = z.object({
	kind:    z.enum(SCHEMAS),
	subject: z.string().min(32).max(44),
	data:    z.record(z.any()).default({}),
	expiry:  z.number().int().nonnegative().default(0),
	network: z.enum(['devnet', 'mainnet']).default('devnet'),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const admin = await requireAdmin(req, res);
	if (!admin) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(bodySchema, await readJson(req));

	// Validate required fields are present and types are right.
	const def = SAS_CONFIG.schemas[body.kind];
	for (let i = 0; i < def.fieldNames.length; i++) {
		const fname = def.fieldNames[i];
		const v = body.data[fname];
		if (v === undefined) return error(res, 400, 'validation_error', `missing field: ${fname}`);
		const t = def.layout[i];
		if (t === 12 && typeof v !== 'string') return error(res, 400, 'validation_error', `${fname} must be string`);
		if (t === 10 && typeof v !== 'boolean') return error(res, 400, 'validation_error', `${fname} must be bool`);
		if (t === 0  && (!Number.isInteger(v) || v < 0 || v > 255)) return error(res, 400, 'validation_error', `${fname} must be u8`);
	}

	let result;
	try {
		result = await sasIssue({
			kind:    body.kind,
			subject: body.subject,
			data:    body.data,
			expiry:  body.expiry,
			network: body.network,
		});
	} catch (e) {
		return error(res, 500, 'sas_issue_failed', e.message || String(e));
	}

	const expiryDate = body.expiry > 0 ? new Date(body.expiry * 1000) : null;
	await sql`
		insert into solana_credentials
			(attestation_pda, network, schema_pda, credential_pda, kind, subject,
			 issuer_signature, data, expiry)
		values (
			${result.attestation_pda}, ${body.network}, ${result.schema_pda},
			${result.credential_pda}, ${body.kind}, ${body.subject},
			${result.signature}, ${JSON.stringify(body.data)}::jsonb, ${expiryDate}
		)
		on conflict (attestation_pda) do update set
			data             = excluded.data,
			expiry           = excluded.expiry,
			issuer_signature = excluded.issuer_signature,
			closed           = false,
			closed_at        = null
	`;

	return json(res, 201, {
		signature:        result.signature,
		attestation_pda:  result.attestation_pda,
		schema_pda:       result.schema_pda,
		credential_pda:   result.credential_pda,
		kind:             body.kind,
		subject:          body.subject,
	});
});
