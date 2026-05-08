// Consolidated /.well-known/* handler.
// Dispatches on ?name= query param set by vercel.json rewrites.

import { cors, json, method, wrap, error } from './_lib/http.js';
import { env } from './_lib/env.js';
import { paymentRequirements, X402_VERSION } from './_lib/x402-spec.js';

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
	const mcpResource = `${env.APP_ORIGIN}/api/mcp`;
	const accepts = paymentRequirements({ resource: mcpResource, description: 'MCP tool call' });
	return json(res, 200, {
		x402Version: X402_VERSION,
		accepts,
		pump_agent_payments: { prep: '/api/pump/accept-payment-prep', confirm: '/api/pump/accept-payment-confirm', balances: '/api/pump/balances' },
	}, { 'cache-control': 'public, max-age=300' });
}

// ── x402 Bazaar discovery (/.well-known/x402.json) ───────────────────────────
// Crawled by agentic.market / Bazaar to index our paid endpoints.
// Schema: https://x402.org/schemas/discovery.json

const RAW_AMOUNT_TO_USDC = (raw) => {
	const n = Number(raw || 0) / 1_000_000;
	const decimals = n < 0.01 ? 4 : 2;
	const s = n.toFixed(decimals);
	const trimmed = s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
	return `$${trimmed}`;
};

function handleX402Discovery(req, res) {
	const origin = env.APP_ORIGIN;
	const mcpUrl = `${origin}/api/mcp`;
	const price = RAW_AMOUNT_TO_USDC(env.X402_MAX_AMOUNT_REQUIRED);

	const accepts = [];
	if (env.X402_PAY_TO_SOLANA) {
		accepts.push({
			scheme: 'exact',
			network: 'solana',
			network_label: 'solana-mainnet',
			price,
			payTo: env.X402_PAY_TO_SOLANA,
			asset: env.X402_ASSET_MINT_SOLANA,
			asset_symbol: 'USDC',
			extra: { name: 'USDC', decimals: 6, feePayer: env.X402_FEE_PAYER_SOLANA },
		});
	}
	if (env.X402_PAY_TO_BASE) {
		accepts.push({
			scheme: 'exact',
			network: 'base',
			network_label: 'base-mainnet',
			price,
			payTo: env.X402_PAY_TO_BASE,
			asset: env.X402_ASSET_ADDRESS_BASE,
			asset_symbol: 'USDC',
			extra: { name: 'USDC', version: '2', decimals: 6 },
		});
	}

	return json(res, 200, {
		$schema: 'https://x402.org/schemas/discovery.json',
		service: {
			name: 'three.ws',
			legal_name: 'three.ws',
			tagline: 'AI-powered 3D model viewer and validation agent.',
			description: 'three.ws is an agent-first 3D model platform. Drag-and-drop glTF/GLB preview, model validation/inspection/optimization, plus Solana agent data — all reachable as MCP tool calls behind a single x402 v1 endpoint. USDC on Solana mainnet and Base mainnet.',
			operator: 'three.ws',
			mission: 'Make 3D model tooling and Solana agent data machine-native so any AI agent can transact with the HTTP 402 protocol.',
			website: origin,
			docs: `${origin}/docs/mcp`,
			repository: 'https://github.com/overstepping/3D-Agent',
			contact: `${origin}/`,
			tags: ['x402', 'x402-v1', 'mcp', 'agent-first', '3d', 'gltf', 'glb', 'three-js', 'solana', 'base', 'usdc'],
			environment: 'apex',
			origin,
		},
		resources: [
			{
				path: '/api/mcp',
				url: mcpUrl,
				method: 'POST',
				description: 'MCP 2025-06-18 Streamable HTTP transport — 3D avatar viewer, glTF model validation/inspection/optimization, and Solana agent data exposed as MCP tools. JSON-RPC 2.0 batch-aware. Currency: USDC.',
				mimeType: 'application/json',
				accepts,
				links: {
					openapi: `${origin}/openapi.json`,
					docs: `${origin}/docs/mcp`,
					agent_card: `${origin}/.well-known/agent-card.json`,
					payment_config: `${origin}/.well-known/x402`,
				},
			},
		],
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
	'x402-discovery':             handleX402Discovery,
};

// Public discovery docs (x402, x402-discovery, chat-plugin, agent-attestation-schemas)
// must be readable cross-origin so browser-based validators (agentic.market,
// x402scan, bazaar) can fetch them. OAuth metadata stays restricted.
const PUBLIC_DISCOVERY = new Set([
	'x402',
	'x402-discovery',
	'chat-plugin',
	'agent-attestation-schemas',
]);

export default wrap(async (req, res) => {
	const name = req.query?.name ?? new URL(req.url, 'http://x').searchParams.get('name');
	const corsOpts = PUBLIC_DISCOVERY.has(name)
		? { methods: 'GET,OPTIONS', origins: '*' }
		: { methods: 'GET,OPTIONS' };
	if (cors(req, res, corsOpts)) return;
	if (!method(req, res, ['GET'])) return;
	const fn = DISPATCH[name];
	if (!fn) return error(res, 404, 'not_found', `unknown well-known resource: ${name}`);
	return fn(req, res);
});
