// Thin stub — routes to the consolidated wk.js dispatcher with name=x402.
import dispatcher from './wk.js';
export default function handler(req, res) {
	if (!req.query) req.query = {};
	req.query.name = 'x402';
	return dispatcher(req, res);
}
