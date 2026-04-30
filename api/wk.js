// Consolidated /.well-known/* handler.
// Dispatches on ?name= query param set by vercel.json rewrites.

import { cors, json, method, wrap, error } from './_lib/http.js';
import { env } from './_lib/env.js';

// ── agent-attestation-schemas ─────────────────────────────────────────────────

const COMMON = {
	v:     { type: 'integer', const: 1 },
	kind:  { type: 'string' },
	agent: { type: 'string', description: 'Metaplex Core asset pubkey (base58)' },
	ts:    { type: 'integer', description: 'Unix seconds when attestation was created' },
};

const SCHEMAS = {
	'threews.feedback.v1': { description: 'Client → agent feedback.', required: ['v', 'kind', 'agent', 'score'], properties: { ...COMMON, score: { type: 'integer', minimum: 1, maximum: 5 }, task_id: { type: 'string' }, uri: { type: 'string', format: 'uri' } } },
	'threews.validation.v1': { description: 'Validator attestation about an agent task result.', required: ['v', 'kind', 'agent', 'task_hash', 'passed'], properties: { ...COMMON, task_hash: { type: 'string' }, passed: { type: 'boolean' }, uri: { type: 'string', format: 'uri' } } },
	'threews.task.v1': { description: 'Client posts a task offer to an agent.', required: ['v', 'kind', 'agent', 'task_id', 'scope_hash'], properties: { ...COMMON, task_id: { type: 'string' }, scope_hash: { type: 'string' }, uri: { type: 'string', format: 'uri' } } },
	'threews.accept.v1': { description: 'Agent accepts a task.', required: ['v', 'kind', 'agent', 'task_id'], properties: { ...COMMON, task_id: { type: 'string' } } },
	'threews.revoke.v1': { description: 'Revoke a previous attestation.', required: ['v', 'kind', 'agent', 'target_signature'], properties: { ...COMMON, target_signature: { type: 'string' }, reason: { type: 'string' } } },
	'threews.dispute.v1': { description: 'Agent owner disputes a feedback or validation.', required: ['v', 'kind', 'agent', 'target_signature'], properties: { ...COMMON, target_signature: { type: 'string' }, reason: { type: 'string' }, uri: { type: 'string', format: 'uri' } } },
};

function handleAttestationSchemas(req, res) {
	return json(res, 200, {
		version: 1,
		transport: { type: 'spl-memo', program: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', note: 'Each attestation is a signed memo tx with the agent asset pubkey as a non-signer key.' },
		schemas: SCHEMAS,
		discovery: { list_endpoint: '/api/agents/solana-attestations?asset=<pubkey>&kind=...', reputation_endpoint: '/api/agents/solana-reputation?asset=<pubkey>' },
	}, { 'cache-control': 'public, max-age=300' });
}

// ── oauth-authorization-server ────────────────────────────────────────────────

function handleOauthAuthServer(req, res) {
	const base = env.APP_ORIGIN;
	return json(res, 200, {
		issuer: base,
		authorization_endpoint: `${base}/oauth/authorize`,
		token_endpoint: `${base}/api/oauth/token`,
		registration_endpoint: `${base}/api/oauth/register`,
		revocation_endpoint: `${base}/api/oauth/revoke`,
		introspection_endpoint: `${base}/api/oauth/introspect`,
		response_types_supported: ['code'],
		grant_types_supported: ['authorization_code', 'refresh_token'],
		code_challenge_methods_supported: ['S256'],
		token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
		scopes_supported: ['avatars:read', 'avatars:write', 'avatars:delete', 'profile', 'offline_access'],
		service_documentation: `${base}/docs/mcp`,
		ui_locales_supported: ['en'],
	}, { 'cache-control': 'public, max-age=300' });
}

// ── oauth-protected-resource ──────────────────────────────────────────────────

function handleOauthProtectedResource(req, res) {
	return json(res, 200, {
		resource: env.MCP_RESOURCE,
		authorization_servers: [env.APP_ORIGIN],
		bearer_methods_supported: ['header'],
		resource_documentation: `${env.APP_ORIGIN}/docs/mcp`,
		scopes_supported: ['avatars:read', 'avatars:write', 'avatars:delete', 'profile'],
	}, { 'cache-control': 'public, max-age=300' });
}

// ── x402 ─────────────────────────────────────────────────────────────────────

function handleX402(req, res) {
	return json(res, 200, {
		version: 1,
		resources: ['POST /api/mcp'],
		schemes: ['solana-pay', 'evm-erc20', 'pump-agent-payments'],
		pump_agent_payments: { prep: '/api/pump/accept-payment-prep', confirm: '/api/pump/accept-payment-confirm', balances: '/api/pump/balances' },
	}, { 'cache-control': 'public, max-age=300' });
}

// ── dispatcher ────────────────────────────────────────────────────────────────

function handleChatPlugin(req, res) {
	return json(res, 200, {
		identifier: '3dagent',
		schemaVersion: 1,
		meta: {
			title: 'three.ws',
			description: 'Render a 3D avatar that reacts to the chat.',
			avatar: 'https://three.ws/favicon.ico',
			tags: ['avatar', '3d', 'agent'],
		},
		ui: { position: 'right', size: { width: 320, height: 420 } },
		settings: [
			{ name: 'agentId', type: 'string', required: true, title: 'Agent ID' },
			{ name: 'apiOrigin', type: 'string', default: 'https://three.ws/', title: 'API Origin' },
		],
	}, { 'cache-control': 'public, max-age=3600' });
}

const DISPATCH = {
	'agent-attestation-schemas':  handleAttestationSchemas,
	'chat-plugin':                handleChatPlugin,
	'oauth-authorization-server': handleOauthAuthServer,
	'oauth-protected-resource':   handleOauthProtectedResource,
	'x402':                       handleX402,
};

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;
	const name = req.query?.name ?? new URL(req.url, 'http://x').searchParams.get('name');
	const fn = DISPATCH[name];
	if (!fn) return error(res, 404, 'not_found', `unknown well-known resource: ${name}`);
	return fn(req, res);
});
