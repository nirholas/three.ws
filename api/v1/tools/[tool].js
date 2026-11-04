// POST /api/v1/tools/{tool}: run one gateway tool, billed to account credits.
//
// Tools: web_search, web_fetch, parse_document, tts, transcribe, image_generate.
// Auth is a browser session, a three.ws API key (`Authorization: Bearer
// sk_live_...`) or an OAuth token with the `inference` scope. The charge is taken
// before the tool runs, settled to what it produced, and refunded in full when
// it fails (api/_lib/tool-gateway/meter.js). Send `Idempotency-Key` to make a
// retry free: the same key never charges twice.
//
// Anonymous callers get a 401 that names the keyless pay-per-call twins on the
// x402 rail (speech, transcription and images), which settle in USDC.

import { defineEndpoint, fail } from '../../_lib/gateway.js';
import { callGatewayTool, GATEWAY_TOOLS } from '../../_lib/tool-gateway/index.js';
import { gatewayAction } from '../../_lib/tool-gateway/pricing.js';

export const maxDuration = 120;

const X402_TWINS = {
	tts: '/api/v1/ai/tts',
	transcribe: '/api/v1/ai/asr',
	image_generate: '/api/v1/ai/image',
};

function toolFromReq(req) {
	const fromQuery = req.query?.tool;
	if (fromQuery) return String(fromQuery);
	const path = new URL(req.url, 'http://internal').pathname.replace(/\/+$/, '');
	return decodeURIComponent(path.split('/').pop() || '');
}

export default defineEndpoint({
	name: 'v1.tools.call',
	method: 'POST',
	auth: 'optional',
	scope: 'inference',
	handler: async ({ req, principal, body }) => {
		const tool = toolFromReq(req);
		if (!Object.hasOwn(GATEWAY_TOOLS, tool)) {
			fail(404, 'unknown_tool', `No gateway tool named "${tool}". Tools: ${Object.keys(GATEWAY_TOOLS).join(', ')}.`);
		}
		if (!principal) {
			const twin = X402_TWINS[tool];
			fail(
				401,
				'unauthorized',
				`${gatewayAction(tool)} is billed to a three.ws account: send an API key (\`Authorization: Bearer sk_live_...\`) or sign in.` +
					(twin ? ` For keyless pay-per-call in USDC over x402, use POST ${twin}.` : ''),
			);
		}
		const idem = String(req.headers['idempotency-key'] || '').trim().slice(0, 120);
		const out = await callGatewayTool({
			principal: { userId: principal.userId, apiKeyId: principal.apiKeyId ?? null, clientId: principal.clientId ?? null, surface: 'rest' },
			tool,
			args: body && typeof body === 'object' ? body : {},
			...(idem ? { callId: `${principal.userId}:${tool}:${idem}` } : {}),
		});
		return { tool, ...out };
	},
});
