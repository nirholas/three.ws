// POST /api/sandbox/bridge: the runner's way back into the platform.
//
// A program on the Cloud Run runner speaks the bridge over a unix socket that
// only the runner can see. The runner forwards each message here with the
// bearer token the API minted for that one execution. The token expires with
// the execution's wall-clock limit, and bridgeContext refuses it once the
// execution has finished or the run was stopped, so a leaked token is useless
// as soon as the execution ends. The decision and the work are handleBridge's:
// the same function the in-process backends call.

import { error, json, method, readJson, wrap } from '../_lib/http.js';
import { bridgeContext, handleBridge, verifyBridgeToken } from '../_lib/sandbox/bridge.js';
import { SandboxError } from '../_lib/sandbox/store.js';

const MAX_MESSAGE_BYTES = 1_000_000;

export default wrap(async function handler(req, res) {
	if (!method(req, res, ['POST'])) return;
	const header = String(req.headers.authorization || '');
	const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
	const execId = verifyBridgeToken(token);
	if (!execId) return error(res, 401, 'unauthorized', 'a valid bridge token is required');

	let msg;
	try {
		msg = await readJson(req, MAX_MESSAGE_BYTES);
	} catch (err) {
		return error(res, err.status || 400, err.code || 'bad_request', 'the bridge message must be JSON');
	}
	if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return error(res, 400, 'bad_request', 'the bridge message must be a JSON object');

	let ctx;
	try {
		ctx = await bridgeContext(execId);
	} catch (err) {
		if (err instanceof SandboxError) {
			res.setHeader('cache-control', 'no-store');
			return json(res, 200, { ok: false, error: { code: err.code, message: err.message } });
		}
		throw err;
	}
	res.setHeader('cache-control', 'no-store');
	return json(res, 200, await handleBridge(ctx, msg));
});
