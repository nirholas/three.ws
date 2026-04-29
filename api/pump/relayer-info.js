// GET /api/pump/relayer-info
//
// Public endpoint: returns the server relayer pubkey so clients can build
// the SIWS authorization message. No auth — pubkey is non-sensitive.

import { cors, json, method, wrap, error } from '../_lib/http.js';
import { relayerPubkeyString } from '../_lib/pump-relayer.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	try {
		const pubkey = await relayerPubkeyString();
		return json(
			res,
			200,
			{
				relayer_pubkey: pubkey,
				siws_template: [
					`Authorize three.ws relayer ${pubkey} to trade pump.fun on my behalf.`,
					'max=<SOL>',
					'expires=<ISO8601>',
					'mint=<optional pubkey>',
					'direction=<buy|sell|both>',
				].join('\n'),
			},
			{ 'cache-control': 'public, max-age=60', 'access-control-allow-origin': '*' },
		);
	} catch (e) {
		return error(res, e.status || 503, e.code || 'not_configured', e.message);
	}
});
