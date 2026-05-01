import { cors, json, method, wrap } from '../_lib/http.js';
import { env } from '../_lib/env.js';

const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	return json(res, 200, {
		vault_address: env.RIDER_VAULT_ADDRESS ?? null,
		token_mint: THREE_MINT,
		token_symbol: '$THREE',
		required_amount: 8000,
	});
});
