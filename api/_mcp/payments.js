import { logger } from '../_lib/usage.js';
import { X402Error, send402 } from '../_lib/x402-spec.js';

const log = logger('mcp');

export function sendX402Error(res, requirements, err) {
	if (err instanceof X402Error) {
		if (err.status === 402) return send402(res, requirements, err.message);
		res.statusCode = err.status;
		res.setHeader('content-type', 'application/json; charset=utf-8');
		res.end(JSON.stringify({ error: err.code, error_description: err.message }));
		return;
	}
	log.error('x402_unexpected', { message: err?.message });
	res.statusCode = 500;
	res.setHeader('content-type', 'application/json; charset=utf-8');
	res.end(JSON.stringify({ error: 'internal', error_description: 'x402 processing failed' }));
}
