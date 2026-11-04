// /.well-known/http-message-signatures-directory: the Web Bot Auth key directory.
//
// A site that receives a request signed by a three.ws agent (Signature-Agent:
// "https://three.ws") fetches this JWKS to verify the signature. The response is
// itself signed with the directory tag so a verifier can check it came from the
// key holder. 404 until WEB_BOT_AUTH_PRIVATE_KEY is configured, so an
// unconfigured deploy never advertises a key it cannot sign with.

import { cors, error, method, wrap } from './_lib/http.js';
import {
	DIRECTORY_CONTENT_TYPE,
	configuredKey,
	directoryBody,
	signDirectoryResponse,
} from './_lib/web-bot-auth.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET', 'HEAD'])) return;
	const key = configuredKey();
	const body = key ? directoryBody(key) : null;
	if (!body) return error(res, 404, 'not_configured', 'Web Bot Auth signing is not configured on this deployment.');
	const authority = String(req.headers?.host || 'three.ws');
	const sig = signDirectoryResponse({ authority, key });
	res.statusCode = 200;
	res.setHeader('content-type', DIRECTORY_CONTENT_TYPE);
	res.setHeader('cache-control', 'public, max-age=3600');
	res.setHeader('signature-input', sig['Signature-Input']);
	res.setHeader('signature', sig.Signature);
	res.end(req.method === 'HEAD' ? undefined : JSON.stringify(body));
});
