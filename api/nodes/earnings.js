// GET /api/nodes/earnings: an operator reads what their node has earned.
//
// Signed like the poll endpoint: sig = ed25519 over `threews-node-earnings:{node}:{ts}`,
// valid for five minutes. Returns accrued and paid totals (USDC atomics, 6
// decimals) and per-day totals for the last 30 days.
//
// Query: node=<base58 pubkey>&ts=<ms>&sig=<base64>

import { cors, error, json, method, wrap, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { getNodeEarnings, verifyNodeSignature } from '../_lib/inference-nodes.js';

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export default wrap(async (req, res) => {
	cors(req, res);
	if (!method(req, res, ['GET'])) return;
	const rl = await limits.nodeJobIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const url = new URL(req.url, 'http://localhost');
	const node = url.searchParams.get('node');
	const ts = Number(url.searchParams.get('ts'));
	const sig = url.searchParams.get('sig');
	if (!node || !ts || !sig) return error(res, 400, 'missing_params', 'node, ts and sig are required');
	if (Math.abs(Date.now() - ts) > MAX_CLOCK_SKEW_MS) return error(res, 401, 'stale_signature', 'ts is too far from server time');
	if (!verifyNodeSignature(node, `threews-node-earnings:${node}:${ts}`, sig)) {
		return error(res, 401, 'bad_signature', 'earnings signature does not verify against node');
	}
	try {
		return json(res, 200, { node, asset: 'USDC', decimals: 6, ...(await getNodeEarnings(node)) });
	} catch (err) {
		console.error('[nodes/earnings]', err.message);
		return error(res, 503, 'ledger_unavailable', 'The earnings ledger is unreachable. Retry shortly.');
	}
});
