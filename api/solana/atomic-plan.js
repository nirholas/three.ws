// Solana Transaction V1 size and budget planner: offline, exact byte math.
//
// POST /api/solana/atomic-plan
//   { instructions, feePayer, version, budgetConfig?, blockhash? }
//   -> { plan } for one version ("legacy" | 0 | 1)
//
// POST /api/solana/atomic-plan { instructions, feePayer, diff: true, budgetConfig?, blockhash? }
//   -> { diff } with legacy, v0, and v1 compiled side by side
//
// No RPC round trip: the same instruction set is compiled with @solana/kit's
// own encoder, the library three.ws ships to real callers, so every reported
// byte is the exact wire size that version would produce, never an estimate.
// Nothing is signed or broadcast.

import { cors, error, json, method, readJson, wrap } from '../_lib/http.js';
import { clientIp, limits } from '../_lib/rate-limit.js';
import { diffTransactionVersions, planTransactionSize } from '../_lib/solana/transaction-v1.js';

function normalizeVersion(value) {
	if (value === 'legacy') return 'legacy';
	if (value === 0 || value === '0') return 0;
	if (value === 1 || value === '1') return 1;
	return undefined;
}

export default wrap(async function atomicPlanHandler(req, res) {
	if (cors(req, res, { origins: '*', methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	const [ipLimit, globalLimit] = await Promise.all([
		limits.cryptoDataIp(clientIp(req)),
		limits.cryptoDataGlobal(),
	]);
	if (!ipLimit.success || !globalLimit.success) {
		return error(res, 429, 'rate_limited', 'too many requests - retry shortly');
	}

	let body;
	try {
		body = await readJson(req, 65_536);
	} catch (err) {
		return error(res, err.status || 400, 'invalid_json', err.message);
	}

	const { instructions, feePayer, budgetConfig, blockhash } = body;
	res.setHeader('cache-control', 'no-store');

	try {
		if (body.diff) {
			const diff = diffTransactionVersions({ instructions, feePayer, blockhash, budgetConfig });
			return json(res, 200, { diff });
		}
		const version = normalizeVersion(body.version);
		if (version === undefined) {
			return error(res, 400, 'invalid_version', 'version must be "legacy", 0, or 1');
		}
		const plan = planTransactionSize({ instructions, feePayer, blockhash, version, budgetConfig });
		return json(res, 200, { plan });
	} catch (err) {
		return error(res, 400, 'invalid_plan_input', err.message);
	}
});
