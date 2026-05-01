import { env } from '../_lib/env.js';
import { wrap, cors, error, json, readJson, method } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { Connection } from '@solana/web3.js';

export default wrap(async (req, res) => {
	if (cors(req, res)) return;
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = await readJson(req);
	const { signedTxBase64 } = body || {};

	if (!signedTxBase64 || typeof signedTxBase64 !== 'string')
		return error(res, 400, 'validation_error', 'signedTxBase64 required');

	const rpcUrl = env.SOLANA_RPC_URL;
	const connection = new Connection(rpcUrl, 'confirmed');

	let txBytes;
	try {
		txBytes = Buffer.from(signedTxBase64, 'base64');
	} catch {
		return error(res, 400, 'validation_error', 'signedTxBase64 is not valid base64');
	}

	let signature;
	try {
		signature = await connection.sendRawTransaction(txBytes, {
			skipPreflight: false,
			maxRetries: 3,
		});
	} catch (e) {
		return error(res, 422, 'tx_rejected', `Transaction rejected: ${e.message}`);
	}

	try {
		const latestBlockhash = await connection.getLatestBlockhash('confirmed');
		await connection.confirmTransaction(
			{ signature, ...latestBlockhash },
			'confirmed',
		);
	} catch (e) {
		// Return the signature even if confirmation polling times out — the tx may still land.
		return json(res, 200, { signature, warning: `Confirmation uncertain: ${e.message}` });
	}

	return json(res, 200, { signature });
});
