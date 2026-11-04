// A framework-neutral Node request handler over a facilitator. Mount it on
// node:http, Express, or anything that hands you (req, res). Routes:
//   GET  /            service document
//   GET  /supported   scheme and network capability probe
//   GET  /healthz     liveness plus sponsor-floor state
//   GET  /metrics     settles, verifies, refusals by reason, sponsor lamports burned
//   POST /verify      x402 verify
//   POST /settle      x402 settle

import { SETTLEMENT_PENDING_REASON } from './store.js';

const MAX_BODY_BYTES = 256 * 1024;

function send(res, status, body) {
	const text = JSON.stringify(body);
	res.statusCode = status;
	res.setHeader('content-type', 'application/json; charset=utf-8');
	res.setHeader('access-control-allow-origin', '*');
	res.end(text);
}

async function readBody(req) {
	if (req.body && typeof req.body === 'object') return req.body;
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > MAX_BODY_BYTES) throw Object.assign(new Error('body_too_large'), { code: 'body_too_large' });
		chunks.push(chunk);
	}
	return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
}

/**
 * @param {ReturnType<import('./core.js').createFacilitator>} facilitator
 * @param {{ network: string, name?: string, version?: string, basePath?: string }} opts
 */
export function createFacilitatorHandler(facilitator, { network, name = 'x402 facilitator', version = null, basePath = '' } = {}) {
	if (!network) throw new Error('createFacilitatorHandler: network is required');
	const kinds = [{ x402Version: 2, scheme: 'exact', network }];

	return async function handle(req, res) {
		if (req.method === 'OPTIONS') {
			res.statusCode = 204;
			res.setHeader('access-control-allow-origin', '*');
			res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
			res.setHeader('access-control-allow-headers', 'content-type,idempotency-key');
			return res.end();
		}
		const path = String(req.url || '/').split('?')[0].slice(basePath.length).replace(/\/+$/, '') || '/';

		if (req.method === 'GET') {
			if (path === '/') {
				return send(res, 200, {
					service: name,
					version,
					x402Version: 2,
					kinds,
					settleStatuses: ['success', SETTLEMENT_PENDING_REASON, 'failure'],
					feePayer: facilitator.sponsorAddress(),
					payTo: Array.from(facilitator.payToAllowlist()),
					mints: Array.from(facilitator.settleableMints()),
					endpoints: { supported: 'GET /supported', verify: 'POST /verify', settle: 'POST /settle', metrics: 'GET /metrics' },
				});
			}
			if (path === '/supported') return send(res, 200, { kinds });
			if (path === '/healthz') {
				return send(res, 200, { ok: true, sponsorBelowFloor: facilitator.sponsorKnownBelowFloor(), feePayer: facilitator.sponsorAddress() });
			}
			if (path === '/metrics') {
				const summary = facilitator.decisionLog?.summary?.() || null;
				return send(res, 200, {
					...summary,
					feeBudget: facilitator.feeBudget
						? { limitLamports: facilitator.feeBudget.lamports, windowMs: facilitator.feeBudget.windowMs, usedLamports: facilitator.feeBudget.used() }
						: null,
					sponsorBelowFloor: facilitator.sponsorKnownBelowFloor(),
				});
			}
			return send(res, 404, { error: `unknown_route:${path}` });
		}

		if (req.method !== 'POST' || (path !== '/verify' && path !== '/settle')) {
			return send(res, 404, { error: `unknown_route:${path}` });
		}

		let body;
		try {
			body = await readBody(req);
		} catch (err) {
			return send(res, err.code === 'body_too_large' ? 413 : 400, { isValid: false, success: false, errorReason: err.code || 'invalid_json', invalidReason: err.code || 'invalid_json' });
		}
		const paymentPayload = body?.paymentPayload;
		const requirement = body?.paymentRequirements;
		if (!paymentPayload || !requirement) {
			return send(res, 400, { isValid: false, success: false, errorReason: 'missing paymentPayload/paymentRequirements', invalidReason: 'missing paymentPayload/paymentRequirements' });
		}
		if (requirement.network !== network) {
			const reason = `unsupported_network:${requirement.network}`;
			return send(res, 400, { isValid: false, success: false, errorReason: reason, invalidReason: reason });
		}

		try {
			if (path === '/verify') {
				return send(res, 200, await facilitator.verifyRingPayment({ paymentPayload, requirement }));
			}
			const result = await facilitator.settleRingPayment({
				paymentPayload,
				requirement,
				idempotencyKey: req.headers?.['idempotency-key'] || null,
			});
			if (result.success) {
				return send(res, 200, { success: true, transaction: result.transaction, network: result.network, payer: result.payer });
			}
			if (result.pending) {
				return send(res, 200, { success: false, errorReason: SETTLEMENT_PENDING_REASON, transaction: result.transaction, network: result.network || requirement.network, payer: result.payer || null });
			}
			return send(res, 200, { success: false, errorReason: result.reason });
		} catch (err) {
			return send(res, 502, { isValid: false, success: false, errorReason: 'facilitator_error', invalidReason: 'facilitator_error', detail: String(err?.message || err).slice(0, 200) });
		}
	};
}
