// ─────────────────────────────────────────────────────────────────────────────
// MCP server — Streamable HTTP transport
// Spec: https://modelcontextprotocol.io/specification/2025-06-18/basic
//
// Endpoints at this path:
//   POST   /api/mcp           JSON-RPC request(s); response is JSON (or SSE for streaming)
//   GET    /api/mcp           (optional) SSE stream for server→client notifications
//   DELETE /api/mcp           terminate session
//
// Auth: Bearer access token (OAuth 2.1) OR Bearer API key.
// On 401, return WWW-Authenticate pointing to protected-resource metadata (RFC 9728).
// ─────────────────────────────────────────────────────────────────────────────

import { env } from './_lib/env.js';
import { sql } from './_lib/db.js';
import { authenticateBearer, extractBearer, hasScope } from './_lib/auth.js';
import { cors, readJson, wrap } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { recordEvent, logger } from './_lib/usage.js';
import {
	listAvatars,
	getAvatar,
	getAvatarBySlug,
	searchPublicAvatars,
	resolveAvatarUrl,
	deleteAvatar,
} from './_lib/avatars.js';
import { fetchModel, FetchModelError } from './_lib/fetch-model.js';
import { crawlAgentAttestations, KIND_MAP } from './_lib/solana-attestations.js';
import { pumpfunMcp, pumpfunBotEnabled } from './_lib/pumpfun-mcp.js';
import { inspectModel, suggestOptimizations } from './_lib/model-inspect.js';
import { validateBytes } from 'gltf-validator';
import {
	X402Error,
	paymentRequirements,
	verifyPayment,
	settlePayment,
	encodePaymentResponseHeader,
	send402,
	resolveResourceUrl,
} from './_lib/x402-spec.js';
import {
	priceFor,
	findActiveSubscription,
	resolveBillingMint,
} from './_lib/pump-pricing.js';
import { normalizeLegacyPolicy } from './_lib/embed-policy.js';

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: '3d-agent-mcp', version: '1.0.0' };
const log = logger('mcp');

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,DELETE,OPTIONS' })) return;

	// Unauthenticated discovery surface — DELETE and GET without bearer are OK to reject quickly.
	if (req.method === 'GET') return handleSse(req, res);
	if (req.method === 'DELETE') return handleTerminate(req, res);
	if (req.method !== 'POST') return send401(res, 'method not supported');

	// Auth: either a Bearer token (OAuth/API key) OR an x402 X-PAYMENT header.
	const bearer = extractBearer(req);
	const paymentHeader = req.headers['x-payment'];
	let auth = null;
	let x402Ctx = null;

	if (bearer) {
		auth = await authenticateBearer(bearer, { audience: env.MCP_RESOURCE });
		if (!auth) return send401(res, 'missing or invalid access token');
	} else if (paymentHeader) {
		const requirements = paymentRequirements({
			resource: resolveResourceUrl(req, '/api/mcp'),
			description: 'MCP tool call',
		});
		try {
			const verified = await verifyPayment({ paymentHeader, requirements });
			x402Ctx = {
				requirements,
				requirement: verified.requirement,
				paymentPayload: verified.paymentPayload,
				payer: verified.payer,
			};
		} catch (err) {
			return sendX402Error(res, requirements, err);
		}
		// Anonymous paid caller — synthesize an auth principal scoped to public-read tools.
		// userId is null because usage_events.user_id is a UUID FK; the payer wallet is
		// kept on the auth object so handlers and rate limits can key off of it.
		auth = {
			userId: null,
			rateKey: `x402:${x402Ctx.payer || 'anon'}`,
			// Pay-per-call callers have no user account, so they cannot read or
			// write account-scoped data. They get only the no-scope public tools
			// (search_public_avatars, validate/inspect/optimize_model, solana_*).
			scope: '',
			source: 'x402',
			payer: x402Ctx.payer,
		};
	} else {
		return send402(
			res,
			paymentRequirements({
				resource: resolveResourceUrl(req, '/api/mcp'),
				description: 'MCP tool call',
			}),
		);
	}

	const ipRl = await limits.mcpIp(clientIp(req));
	if (!ipRl.success)
		return sendJsonRpcError(res, null, -32000, 'rate_limited', {
			retry_after: Math.ceil((ipRl.reset - Date.now()) / 1000),
		});
	const userRl = await limits.mcpUser(auth.userId || auth.rateKey || clientIp(req));
	if (!userRl.success)
		return sendJsonRpcError(res, null, -32000, 'rate_limited', {
			retry_after: Math.ceil((userRl.reset - Date.now()) / 1000),
		});

	const body = await readJson(req, 2_000_000);
	const batch = Array.isArray(body) ? body : [body];
	// Per-request batch cap — each message can trigger DB queries, so an
	// unbounded batch multiplies rate-limited work by N against the user's budget.
	if (batch.length > 32) {
		return sendJsonRpcError(res, null, -32600, 'batch too large (max 32)');
	}
	const responses = [];
	for (const msg of batch) {
		const r = await dispatch(msg, auth, req);
		if (r !== null) responses.push(r);
	}

	// Settle the x402 payment AFTER the work succeeded — atomic from the caller's
	// perspective: if settle fails, the payer's signed payload is not broadcast
	// and they get a 502 instead of having paid for nothing.
	if (x402Ctx) {
		try {
			const settled = await settlePayment({
				paymentPayload: x402Ctx.paymentPayload,
				requirement: x402Ctx.requirement,
			});
			res.setHeader('x-payment-response', encodePaymentResponseHeader(settled));
		} catch (err) {
			return sendX402Error(res, x402Ctx.requirements, err);
		}
	}

	res.statusCode = 200;
	res.setHeader('content-type', 'application/json; charset=utf-8');
	res.setHeader('mcp-protocol-version', PROTOCOL_VERSION);
	res.end(JSON.stringify(Array.isArray(body) ? responses : (responses[0] ?? null)));
});

function sendX402Error(res, requirements, err) {
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

// ── JSON-RPC dispatch ────────────────────────────────────────────────────────
async function dispatch(msg, auth, req) {
	const started = Date.now();
	const id = msg.id;
	const isNotification = id === undefined;

	try {
		if (msg.jsonrpc !== '2.0') throw rpcError(-32600, 'invalid Request');
		const method = msg.method;

		if (method === 'initialize') return ok(id, await onInitialize(msg.params, auth));
		if (method === 'ping') return ok(id, {});
		if (method === 'notifications/initialized') return null;
		if (method === 'tools/list')
			return ok(id, {
				tools: TOOL_CATALOG.map((t) => {
					const price = priceFor(t.name);
					return price
						? {
								...t,
								pricing: {
									amount_usdc: price.amount_usdc,
									currency: 'USDC',
									description: price.description,
									scheme: 'pump-agent-payments',
									prep_endpoint: '/api/pump/accept-payment-prep',
									confirm_endpoint: '/api/pump/accept-payment-confirm',
									recipient_mint: resolveBillingMint(),
								},
							}
						: t;
				}),
			});
		if (method === 'tools/call') return ok(id, await onToolCall(msg.params, auth, started));
		if (method === 'resources/list') return ok(id, { resources: [] });
		if (method === 'resources/templates/list') return ok(id, { resourceTemplates: [] });
		if (method === 'prompts/list') return ok(id, { prompts: [] });
		if (method === 'logging/setLevel') return ok(id, {});

		throw rpcError(-32601, `method not found: ${method}`);
	} catch (err) {
		log.warn('rpc_error', { method: msg.method, code: err.code, message: err.message });
		if (isNotification) return null;
		return {
			jsonrpc: '2.0',
			id,
			error: {
				code: err.code || -32603,
				message: err.message || 'internal error',
				data: err.data,
			},
		};
	}
}

function ok(id, result) {
	return { jsonrpc: '2.0', id, result };
}

function rpcError(code, message, data) {
	const e = new Error(message);
	e.code = code;
	e.data = data;
	return e;
}

// ── MCP: initialize ──────────────────────────────────────────────────────────
async function onInitialize(_params, _auth) {
	return {
		protocolVersion: PROTOCOL_VERSION,
		serverInfo: SERVER_INFO,
		capabilities: {
			tools: { listChanged: false },
			resources: { listChanged: false, subscribe: false },
			logging: {},
		},
		instructions: [
			'Render 3D avatars stored on three.ws as <model-viewer> HTML artifacts.',
			"Use list_my_avatars to see the user's avatars and render_avatar to get embeddable viewer HTML.",
			'Public avatars can be discovered via search_public_avatars.',
		].join(' '),
	};
}

// ── MCP: tools/call ──────────────────────────────────────────────────────────
async function onToolCall(params, auth, started) {
	const { name, arguments: args = {} } = params || {};
	const tool = TOOLS[name];
	if (!tool) throw rpcError(-32602, `unknown tool: ${name}`);
	if (tool.scope && !hasScope(auth.scope, tool.scope)) {
		throw rpcError(-32002, `insufficient scope, requires ${tool.scope}`);
	}

	// Pump-agent-payments gate. Free tools and paid-bearer-authenticated users
	// (existing subscription plans) bypass. x402 callers and anonymous payers
	// must either supply X-PAYMENT (handled at the HTTP layer above) or have
	// an active pump-agent-payments subscription window for this tool.
	const price = priceFor(name);
	if (price && auth.source === 'x402') {
		const billingMint = resolveBillingMint();
		const payerWallet = args.payer_wallet || auth.payer || null;
		if (billingMint && payerWallet) {
			const sub = await findActiveSubscription({
				mint: billingMint,
				network: process.env.PUMP_DEFAULT_NETWORK || 'mainnet',
				payerWallet,
				toolName: name,
			});
			if (!sub) {
				throw rpcError(-32402, 'payment required for this tool', {
					scheme: 'pump-agent-payments',
					tool: name,
					amount_usdc: price.amount_usdc,
					recipient_mint: billingMint,
					prep_endpoint: '/api/pump/accept-payment-prep',
					hint:
						'POST a confirmed acceptPayment whose end_time > now() and tool_name matches this tool, then retry.',
				});
			}
			auth.subscription = sub;
		}
	}

	try {
		const result = await tool.handler(args, auth);
		recordEvent({
			userId: auth.userId,
			apiKeyId: auth.apiKeyId,
			clientId: auth.clientId,
			kind: 'tool_call',
			tool: name,
			latencyMs: Date.now() - started,
			meta: { args_summary: summarize(args) },
		});
		return result;
	} catch (err) {
		recordEvent({
			userId: auth.userId,
			apiKeyId: auth.apiKeyId,
			clientId: auth.clientId,
			kind: 'tool_call',
			tool: name,
			status: 'error',
			latencyMs: Date.now() - started,
			meta: { error: err.message },
		});
		// Only re-throw intentional JSON-RPC errors (integer codes); string codes are
		// postgres SQL states (e.g. '42P01') — sanitize those rather than leaking them.
		if (err.code && typeof err.code === 'number') throw err;
		// Framework convention: tool errors go in result.isError, not rpc error.
		// Detect postgres driver errors by their severity field and suppress internals.
		if (err.severity !== undefined || err.schema !== undefined) {
			log.error('tool_db_error', { tool: name, pg_code: err.code });
			return { content: [{ type: 'text', text: 'Error: internal error' }], isError: true };
		}
		return {
			content: [{ type: 'text', text: `Error: ${err.message || 'tool call failed'}` }],
			isError: true,
		};
	}
}

// ── inline embed-policy helpers (prompt 02 / api/_lib/embed-policy.js not yet shipped) ──

function _mcpDefaultPolicy() {
	return {
		version: 1,
		origins: { mode: 'allowlist', hosts: [] },
		surfaces: { script: true, iframe: true, widget: true, mcp: true },
	};
}

function _mcpParsePolicy(p) {
	if (!p) return null;
	if (!('version' in p) && ('mode' in p || 'hosts' in p)) {
		// Old flat shape — only origins were configured; all surfaces (incl. mcp) allowed.
		return {
			..._mcpDefaultPolicy(),
			origins: { mode: p.mode || 'allowlist', hosts: p.hosts ?? [] },
		};
	}
	return { ..._mcpDefaultPolicy(), ...p };
}

async function _readMcpPolicyByAvatar(avatarId) {
	try {
		const [row] = await sql`
			SELECT embed_policy FROM agent_identities
			WHERE avatar_id = ${avatarId} AND deleted_at IS NULL
			LIMIT 1
		`;
		if (!row) return null;
		return _mcpParsePolicy(row.embed_policy);
	} catch (err) {
		if (/column .* does not exist/i.test(String(err?.message))) return null;
		throw err;
	}
}

// ── tool catalog ─────────────────────────────────────────────────────────────
const TOOL_CATALOG = [
	{
		name: 'list_my_avatars',
		title: 'List my avatars',
		description:
			"List the authenticated user's avatars. Returns id, name, slug, size, visibility, and direct model_url (when visibility permits).",
		inputSchema: {
			type: 'object',
			properties: {
				limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
				cursor: {
					type: 'string',
					description: 'Opaque pagination cursor from previous response.',
				},
				visibility: { type: 'string', enum: ['private', 'unlisted', 'public'] },
			},
			additionalProperties: false,
		},
	},
	{
		name: 'get_avatar',
		title: 'Get avatar',
		description:
			'Fetch a single avatar by id or by owner+slug. Returns metadata and a model_url (public/unlisted) or short-lived signed URL (private).',
		inputSchema: {
			type: 'object',
			properties: {
				id: { type: 'string', format: 'uuid' },
				slug: { type: 'string' },
			},
			additionalProperties: false,
		},
	},
	{
		name: 'search_public_avatars',
		title: 'Search public avatars',
		description:
			'Search the public avatar gallery. Useful for finding characters to render without prior knowledge of an id.',
		inputSchema: {
			type: 'object',
			properties: {
				q: { type: 'string', description: 'Free-text search over name and description.' },
				tag: { type: 'string', description: 'Filter to one tag.' },
				limit: { type: 'integer', minimum: 1, maximum: 50, default: 12 },
			},
			additionalProperties: false,
		},
	},
	{
		name: 'render_avatar',
		title: 'Render avatar',
		description:
			'Produce an HTML <model-viewer> snippet that renders the given avatar. ' +
			'Return this text as an inline HTML artifact to display an interactive 3D avatar.',
		inputSchema: {
			type: 'object',
			properties: {
				id: { type: 'string', format: 'uuid' },
				slug: { type: 'string' },
				auto_rotate: { type: 'boolean', default: true },
				background: {
					type: 'string',
					description: 'CSS background color or gradient.',
					default: 'transparent',
				},
				height: { type: 'string', default: '480px' },
				width: { type: 'string', default: '100%' },
				camera_orbit: {
					type: 'string',
					description: 'model-viewer camera-orbit value, e.g. "0deg 80deg 2m".',
				},
				poster: {
					type: 'string',
					description: 'Optional poster image URL shown while loading.',
				},
				ar: {
					type: 'boolean',
					default: true,
					description: 'Include AR button for mobile.',
				},
			},
			additionalProperties: false,
		},
	},
	{
		name: 'delete_avatar',
		title: 'Delete avatar',
		description: 'Soft-delete an avatar you own. Requires avatars:delete scope.',
		inputSchema: {
			type: 'object',
			properties: {
				id: { type: 'string', format: 'uuid' },
				confirm: {
					type: 'boolean',
					description: 'Must be true to confirm permanent deletion.',
				},
			},
			required: ['id'],
			additionalProperties: false,
		},
	},
	{
		name: 'validate_model',
		title: 'Validate glTF/GLB model',
		description:
			'Run the Khronos glTF-Validator against a remote GLB or glTF URL. Returns a structured report of errors, warnings, infos, and hints — the authoritative answer to "is this file spec-compliant?". SSRF-hardened: only public https URLs are fetched.',
		inputSchema: {
			type: 'object',
			properties: {
				url: {
					type: 'string',
					format: 'uri',
					description: 'Public https URL of a .glb or .gltf file.',
				},
				max_issues: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
			},
			required: ['url'],
			additionalProperties: false,
		},
	},
	{
		name: 'inspect_model',
		title: 'Inspect glTF/GLB model',
		description:
			'Parse a remote GLB or glTF and return structural stats: scene/node/mesh counts, vertex and triangle totals, material and texture summaries, extensions used. Pure inspection — no optimization advice.',
		inputSchema: {
			type: 'object',
			properties: {
				url: {
					type: 'string',
					format: 'uri',
					description: 'Public https URL of a .glb or .gltf file.',
				},
			},
			required: ['url'],
			additionalProperties: false,
		},
	},
	{
		name: 'optimize_model',
		title: 'Suggest optimizations for a glTF/GLB model',
		description:
			'Inspect the model and return actionable suggestions for reducing size and draw-call overhead: triangle budget, Draco/Meshopt compression, oversized textures, KTX2 transcoding, non-indexed primitives, redundant materials, and more.',
		inputSchema: {
			type: 'object',
			properties: {
				url: {
					type: 'string',
					format: 'uri',
					description: 'Public https URL of a .glb or .gltf file.',
				},
			},
			required: ['url'],
			additionalProperties: false,
		},
	},
	{
		name: 'solana_agent_reputation',
		title: 'Get Solana agent reputation',
		description:
			'Computed reputation summary for a Solana-registered three.ws agent. Returns total/verified feedback counts, score averages (raw + verified-only), validation pass/fail, task acceptance, and dispute counts. Verified score only includes feedback whose task was acknowledged on-chain by the agent owner. Public; no auth required.',
		inputSchema: {
			type: 'object',
			properties: {
				asset: { type: 'string', description: 'Metaplex Core asset pubkey (the agent ID)' },
				network: { type: 'string', enum: ['mainnet', 'devnet'], default: 'devnet' },
			},
			required: ['asset'],
			additionalProperties: false,
		},
	},
	{
		name: 'solana_agent_attestations',
		title: 'List Solana agent attestations',
		description:
			'List recent on-chain attestations about a Solana-registered agent (feedback, validation, task offers, acceptances, disputes). Backed by the three.ws indexer for sub-100ms reads. Each row includes verified/disputed/revoked flags. Public; no auth required.',
		inputSchema: {
			type: 'object',
			properties: {
				asset: { type: 'string' },
				kind: {
					type: 'string',
					enum: ['feedback', 'validation', 'task', 'accept', 'revoke', 'dispute', 'all'],
					default: 'all',
				},
				network: { type: 'string', enum: ['mainnet', 'devnet'], default: 'devnet' },
				limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
			},
			required: ['asset'],
			additionalProperties: false,
		},
	},
	{
		name: 'solana_agent_passport',
		title: 'Get Solana agent passport',
		description:
			'Full discovery card for a Solana agent: identity (Metaplex Core asset), owner wallet, reputation summary, latest validation result, and attestation schema endpoint. Equivalent to an ERC-8004 passport — use this when one tool call should answer "who is this agent and can I trust them?".',
		inputSchema: {
			type: 'object',
			properties: {
				asset: { type: 'string' },
				network: { type: 'string', enum: ['mainnet', 'devnet'], default: 'devnet' },
			},
			required: ['asset'],
			additionalProperties: false,
		},
	},
	{
		name: 'pumpfun_recent_claims',
		title: 'Recent pump.fun claims',
		description:
			"Fetch the most recent pump.fun GitHub social-fee claim events with full enrichment: GitHub profile, X/Twitter follower data, influencer tier, first-time-claim flag, fake-claim detection, and AI summary. Use to answer 'what's happening on pump.fun right now?'.",
		inputSchema: {
			type: 'object',
			properties: {
				limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
			},
			additionalProperties: false,
		},
	},
	{
		name: 'pumpfun_token_intel',
		title: 'Pump.fun token intel',
		description:
			'Full intel on a pump.fun token: graduation status, bonding-curve progress, creator profile, top holders, volume, bundle detection, and trust signals.',
		inputSchema: {
			type: 'object',
			properties: {
				mint: { type: 'string', description: 'SPL mint pubkey (base58).' },
			},
			required: ['mint'],
			additionalProperties: false,
		},
	},
	{
		name: 'pumpfun_creator_intel',
		title: 'Pump.fun creator intel',
		description:
			'Reputation profile for a pump.fun creator wallet: prior launches, graduation rate, claim activity, and behavioural trust signals.',
		inputSchema: {
			type: 'object',
			properties: {
				wallet: { type: 'string', description: 'Solana wallet pubkey (base58).' },
			},
			required: ['wallet'],
			additionalProperties: false,
		},
	},
	{
		name: 'pumpfun_recent_graduations',
		title: 'Recent pump.fun graduations',
		description:
			'Tokens that recently graduated from the bonding curve to PumpAMM, with creator + holder analysis.',
		inputSchema: {
			type: 'object',
			properties: {
				limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
			},
			additionalProperties: false,
		},
	},
	{
		name: 'call_agent',
		title: 'Call agent',
		description:
			'Send a message to another three.ws agent and get its response. Use this to delegate specialized tasks.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: { type: 'string', description: "The agent's ID" },
				message: { type: 'string', description: 'The message to send' },
			},
			required: ['agent_id', 'message'],
			additionalProperties: false,
		},
	},
];

const TOOLS = {
	list_my_avatars: {
		scope: 'avatars:read',
		async handler(args, auth) {
			const result = await listAvatars({
				userId: auth.userId,
				limit: args.limit || 25,
				cursor: args.cursor,
				visibility: args.visibility,
			});
			return {
				content: [{ type: 'text', text: formatAvatarList(result.avatars) }],
				structuredContent: result,
			};
		},
	},

	get_avatar: {
		scope: 'avatars:read',
		async handler(args, auth) {
			const avatar = args.id
				? await getAvatar({ id: args.id, requesterId: auth.userId })
				: args.slug
					? await getAvatarBySlug({
							ownerId: auth.userId,
							slug: args.slug,
							requesterId: auth.userId,
						})
					: null;
			if (!avatar) throw new Error('avatar not found');
			const urlInfo = await resolveAvatarUrl(avatar);
			const merged = { ...avatar, ...urlInfo };
			return {
				content: [{ type: 'text', text: JSON.stringify(merged, null, 2) }],
				structuredContent: merged,
			};
		},
	},

	search_public_avatars: {
		async handler(args, auth) {
			// Unauthenticated callers (x402/anonymous) are capped at 10 to prevent bulk enumeration.
			const maxLimit = auth.userId ? 50 : 10;
			const result = await searchPublicAvatars({
				q: args.q,
				tag: args.tag,
				limit: Math.min(args.limit || 12, maxLimit),
			});
			return {
				content: [
					{ type: 'text', text: formatAvatarList(result.avatars, { public: true }) },
				],
				structuredContent: result,
			};
		},
	},

	render_avatar: {
		scope: 'avatars:read',
		async handler(args, auth) {
			const avatar = args.id
				? await getAvatar({ id: args.id, requesterId: auth.userId })
				: args.slug
					? await getAvatarBySlug({
							ownerId: auth.userId,
							slug: args.slug,
							requesterId: auth.userId,
						})
					: null;
			if (!avatar) throw new Error('avatar not found');
			// surfaces.mcp gate — check if a registered agent owns this avatar
			const _mcpPolicy = await _readMcpPolicyByAvatar(avatar.id);
			if (_mcpPolicy && _mcpPolicy.surfaces?.mcp === false) {
				throw rpcError(
					-32000,
					'embed_denied_surface',
					'This agent disallows the MCP surface.',
				);
			}
			const urlInfo = await resolveAvatarUrl(avatar, { expiresIn: 3600 });
			const html = renderModelViewerHtml({
				src: urlInfo.url,
				name: avatar.name,
				poster: safeHttpsUrl(args.poster),
				background: safeCssValue(args.background, 'transparent'),
				height: safeCssLength(args.height, '480px'),
				width: safeCssLength(args.width, '100%'),
				autoRotate: args.auto_rotate !== false,
				ar: args.ar !== false,
				cameraOrbit: safeCssValue(args.camera_orbit, ''),
			});
			// Keep chat text short so claude.ai doesn't dump the full HTML into the
			// transcript. The HTML goes in the resource entry, which clients render
			// as an inline artifact when mimeType is text/html.
			const summary = `Rendered avatar "${avatar.name}". Display the attached text/html resource as an inline HTML artifact.`;
			return {
				content: [
					{ type: 'text', text: summary },
					{
						type: 'resource',
						resource: {
							uri: `avatar://${avatar.id}`,
							mimeType: 'text/html',
							text: html,
						},
					},
				],
				structuredContent: { html, avatar: { ...avatar, ...urlInfo } },
			};
		},
	},

	delete_avatar: {
		scope: 'avatars:delete',
		async handler(args, auth) {
			if (!args.confirm) {
				return {
					content: [
						{
							type: 'text',
							text: 'Set confirm: true to permanently delete this avatar.',
						},
					],
					isError: true,
				};
			}
			const ok = await deleteAvatar({ id: args.id, userId: auth.userId });
			if (!ok) throw new Error('avatar not found or not yours');
			// TODO: audit_log table needed — INSERT (user_id, action='delete_avatar', resource_id, created_at)
			return { content: [{ type: 'text', text: `Deleted avatar ${args.id}.` }] };
		},
	},

	validate_model: {
		async handler(args, auth) {
			const rl = await limits.mcpValidate(auth.userId || auth.rateKey);
			if (!rl.success)
				throw rpcError(-32000, 'rate_limited', {
					retry_after: Math.ceil((rl.reset - Date.now()) / 1000),
				});
			const { bytes, url, filename } = await safeFetchModel(args.url);
			const max = Math.min(Math.max(args.max_issues || 100, 1), 500);
			const report = await validateBytes(bytes, { maxIssues: max, uri: filename });
			const issues = report?.issues || {};
			const summary = {
				url,
				filename,
				fileSize: bytes.byteLength,
				validatorVersion: report?.validatorVersion,
				mimeType: report?.mimeType,
				numErrors: issues.numErrors ?? 0,
				numWarnings: issues.numWarnings ?? 0,
				numInfos: issues.numInfos ?? 0,
				numHints: issues.numHints ?? 0,
				truncated: !!issues.truncated,
			};
			return {
				content: [
					{ type: 'text', text: formatValidationSummary(summary, issues.messages || []) },
				],
				structuredContent: {
					...summary,
					messages: issues.messages || [],
					info: report?.info || null,
				},
			};
		},
	},

	inspect_model: {
		async handler(args, auth) {
			const rl = await limits.mcpInspect(auth.userId || auth.rateKey);
			if (!rl.success)
				throw rpcError(-32000, 'rate_limited', {
					retry_after: Math.ceil((rl.reset - Date.now()) / 1000),
				});
			const { bytes, url, filename } = await safeFetchModel(args.url);
			const info = await inspectModel(bytes, { fileSize: bytes.byteLength });
			return {
				content: [{ type: 'text', text: formatInspection({ url, filename, ...info }) }],
				structuredContent: { url, filename, ...info },
			};
		},
	},

	optimize_model: {
		async handler(args, auth) {
			const rl = await limits.mcpOptimize(auth.userId || auth.rateKey);
			if (!rl.success)
				throw rpcError(-32000, 'rate_limited', {
					retry_after: Math.ceil((rl.reset - Date.now()) / 1000),
				});
			const { bytes, url, filename } = await safeFetchModel(args.url);
			const info = await inspectModel(bytes, { fileSize: bytes.byteLength });
			const suggestions = suggestOptimizations(info);
			return {
				content: [{ type: 'text', text: formatSuggestions(suggestions) }],
				structuredContent: { url, filename, suggestions, info },
			};
		},
	},

	solana_agent_reputation: {
		async handler(args) {
			const data = await solanaReputation(args.asset, args.network || 'devnet');
			return {
				content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
				structuredContent: data,
			};
		},
	},

	solana_agent_attestations: {
		async handler(args) {
			const data = await solanaAttestations({
				asset:   args.asset,
				kind:    args.kind || 'all',
				network: args.network || 'devnet',
				limit:   args.limit || 50,
			});
			return {
				content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
				structuredContent: data,
			};
		},
	},

	solana_agent_passport: {
		async handler(args) {
			const data = await solanaPassport(args.asset, args.network || 'devnet');
			return {
				content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
				structuredContent: data,
			};
		},
	},

	pumpfun_recent_claims: {
		async handler(args) {
			return pumpfunToolResult(
				await pumpfunMcp.recentClaims({ limit: clamp(args?.limit, 1, 50, 10) }),
			);
		},
	},

	pumpfun_token_intel: {
		async handler(args) {
			if (!args?.mint) throw Object.assign(new Error('mint required'), { status: 400 });
			return pumpfunToolResult(await pumpfunMcp.tokenIntel({ mint: args.mint }));
		},
	},

	pumpfun_creator_intel: {
		async handler(args) {
			if (!args?.wallet) throw Object.assign(new Error('wallet required'), { status: 400 });
			return pumpfunToolResult(await pumpfunMcp.creatorIntel({ wallet: args.wallet }));
		},
	},

	pumpfun_recent_graduations: {
		async handler(args) {
			return pumpfunToolResult(
				await pumpfunMcp.graduations({ limit: clamp(args?.limit, 1, 50, 10) }),
			);
		},
	},

	call_agent: {
		scope: 'avatars:read',
		async handler(args, auth) {
			if (!args?.agent_id) throw new Error('agent_id required');
			if (!args?.message) throw new Error('message required');

			const rl = await limits.agentDelegate(auth.userId || auth.rateKey || 'anon');
			if (!rl.success)
				throw rpcError(-32000, 'rate_limited', {
					retry_after: Math.ceil((rl.reset - Date.now()) / 1000),
				});

			const [agent] = await sql`
				SELECT id, name, description, embed_policy, meta
				FROM agent_identities
				WHERE id = ${args.agent_id} AND deleted_at IS NULL
			`;
			if (!agent) throw new Error('agent not found');

			const policy = normalizeLegacyPolicy(agent.embed_policy);
			const model = policy?.brain?.model || 'claude-haiku-4-5-20251001';
			const systemPrompt =
				agent.meta?.brain?.instructions ||
				`You are ${agent.name}. ${agent.description || ''}`.trim();

			const upstream = await fetch('https://api.anthropic.com/v1/messages', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'anthropic-version': '2023-06-01',
					'x-api-key': env.ANTHROPIC_API_KEY,
				},
				body: JSON.stringify({
					model,
					max_tokens: 1024,
					system: systemPrompt,
					messages: [{ role: 'user', content: args.message }],
				}),
			});

			if (!upstream.ok) throw new Error(`LLM call failed: ${upstream.status}`);

			const data = await upstream.json();
			const response = data?.content?.[0]?.text || '';
			return {
				content: [{ type: 'text', text: response }],
				structuredContent: { agentId: args.agent_id, response },
			};
		},
	},
};

function pumpfunToolResult(r) {
	if (!pumpfunBotEnabled()) {
		return {
			content: [{ type: 'text', text: 'pump.fun feed is not configured on this server.' }],
			isError: true,
		};
	}
	if (!r.ok) {
		return {
			content: [{ type: 'text', text: `pump.fun upstream error: ${r.error}` }],
			isError: true,
		};
	}
	const payload = Array.isArray(r.data) ? { items: r.data } : r.data;
	return {
		content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
		structuredContent: payload,
	};
}

function clamp(n, lo, hi, fallback) {
	const x = Number(n);
	if (!Number.isFinite(x)) return fallback;
	return Math.max(lo, Math.min(hi, x));
}

// ─── Solana attestation tool helpers ────────────────────────────────────────

async function ensureWarm({ asset, network }) {
	const [c] = await sql`select 1 from solana_attestations_cursor where agent_asset = ${asset} limit 1`;
	if (c) return;
	const [agent] = await sql`
		select wallet_address as owner from agent_identities
		where meta->>'sol_mint_address' = ${asset} and deleted_at is null limit 1
	`;
	try { await crawlAgentAttestations({ agentAsset: asset, network, ownerWallet: agent?.owner || null }); }
	catch { /* return cached (empty) */ }
}

async function solanaReputation(asset, network) {
	await ensureWarm({ asset, network });
	const [fb] = await sql`
		with feedback as (
			select
				f.disputed, (f.payload->>'score')::int as score,
				exists (
					select 1 from solana_attestations a
					where a.agent_asset = f.agent_asset and a.kind='threews.accept.v1'
					  and a.payload->>'task_id' = f.payload->>'task_id'
					  and a.verified = true and f.payload->>'task_id' is not null
				) as task_accepted
			from solana_attestations f
			where f.agent_asset=${asset} and f.network=${network}
			  and f.kind='threews.feedback.v1' and f.revoked=false
		)
		select count(*)::int total,
			count(*) filter (where task_accepted)::int verified,
			count(*) filter (where disputed)::int disputed,
			coalesce(avg(score),0)::float score_avg,
			coalesce(avg(score) filter (where task_accepted),0)::float score_avg_verified
		from feedback
	`;
	const [val] = await sql`
		select count(*) filter (where (payload->>'passed')::bool)::int passed,
			count(*) filter (where not (payload->>'passed')::bool)::int failed
		from solana_attestations
		where agent_asset=${asset} and network=${network}
		  and kind='threews.validation.v1' and revoked=false
	`;
	return {
		agent: asset, network,
		feedback: { ...fb,
			score_avg: Number(fb.score_avg.toFixed(3)),
			score_avg_verified: Number(fb.score_avg_verified.toFixed(3)) },
		validation: val,
	};
}

async function solanaAttestations({ asset, kind, network, limit }) {
	await ensureWarm({ asset, network });
	const wantKind = kind === 'all' ? null : KIND_MAP[kind];
	const rows = wantKind
		? await sql`
			select signature, slot, block_time, attester, kind, payload, verified, revoked, disputed
			from solana_attestations
			where agent_asset=${asset} and network=${network} and kind=${wantKind} and revoked=false
			order by slot desc limit ${limit}
		`
		: await sql`
			select signature, slot, block_time, attester, kind, payload, verified, revoked, disputed
			from solana_attestations
			where agent_asset=${asset} and network=${network} and revoked=false
			order by slot desc limit ${limit}
		`;
	return { agent: asset, network, kind, count: rows.length, data: rows };
}

async function solanaPassport(asset, network) {
	const [agent] = await sql`
		select id, name, description, wallet_address as owner, meta
		from agent_identities
		where meta->>'sol_mint_address' = ${asset} and deleted_at is null limit 1
	`;
	const reputation = await solanaReputation(asset, network);
	const recent = await solanaAttestations({ asset, kind: 'all', network, limit: 10 });
	return {
		agent: asset,
		identity: agent ? {
			id: agent.id, name: agent.name, description: agent.description,
			owner: agent.owner, asset_pubkey: asset,
			network: agent.meta?.network || network,
		} : { agent_off_index: true, asset_pubkey: asset, network },
		reputation: reputation.feedback,
		validation: reputation.validation,
		recent_attestations: recent.data,
		schemas_url: `${env.APP_ORIGIN}/.well-known/agent-attestation-schemas`,
	};
}

async function safeFetchModel(url) {
	try {
		return await fetchModel(url);
	} catch (e) {
		if (e instanceof FetchModelError) throw new Error(`fetch failed: ${e.message} (${e.code})`);
		throw e;
	}
}

function formatValidationSummary(s, messages) {
	const head =
		`glTF-Validator report for ${s.filename} (${(s.fileSize / 1024).toFixed(1)} KB)\n` +
		`Errors: ${s.numErrors}, Warnings: ${s.numWarnings}, Infos: ${s.numInfos}, Hints: ${s.numHints}` +
		(s.truncated ? ' (truncated)' : '');
	if (!messages.length) return head;
	const lines = messages.slice(0, 40).map((m) => {
		const sev = ['ERR', 'WRN', 'INF', 'HNT'][m.severity] || '?';
		const ptr = m.pointer ? ` @ ${m.pointer}` : '';
		return `  [${sev}] ${m.code}: ${m.message}${ptr}`;
	});
	const more = messages.length > 40 ? `\n  … ${messages.length - 40} more` : '';
	return `${head}\n${lines.join('\n')}${more}`;
}

function formatInspection(info) {
	const c = info.counts;
	const tex = info.textures.length
		? info.textures
				.map(
					(t) =>
						`  • ${t.name || '(unnamed)'} — ${t.mimeType} ${t.width}×${t.height}, ${(t.byteSize / 1024).toFixed(1)} KB`,
				)
				.join('\n')
		: '  (none)';
	return [
		`Model: ${info.filename} (${(info.fileSize / 1024 / 1024).toFixed(2)} MB, ${info.container})`,
		`Generator: ${info.generator || 'unknown'} · glTF ${info.version || '?'}`,
		`Scenes: ${c.scenes}, Nodes: ${c.nodes}, Meshes: ${c.meshes}, Materials: ${c.materials}, Textures: ${c.textures}`,
		`Animations: ${c.animations}, Skins: ${c.skins}`,
		`Vertices: ${c.totalVertices.toLocaleString()}, Triangles: ${c.totalTriangles.toLocaleString()}`,
		`Indexed primitives: ${c.indexedPrimitives}, Non-indexed: ${c.nonIndexedPrimitives}`,
		`Extensions used: ${info.extensionsUsed.join(', ') || '(none)'}`,
		`Textures:\n${tex}`,
	].join('\n');
}

function formatSuggestions(suggestions) {
	if (!suggestions.length) return 'No suggestions.';
	return suggestions
		.map((s) => {
			const tag =
				{ info: 'INFO', warn: 'WARN', critical: 'CRIT' }[s.severity] ||
				s.severity.toUpperCase();
			const est = s.estimate ? ` — ${s.estimate}` : '';
			return `[${tag}] ${s.id}: ${s.message}${est}`;
		})
		.join('\n');
}

// ── <model-viewer> artifact builder ─────────────────────────────────────────
function renderModelViewerHtml({
	src,
	name,
	poster,
	background,
	height,
	width,
	autoRotate,
	ar,
	cameraOrbit,
}) {
	const attrs = [
		`src="${attr(src)}"`,
		'camera-controls',
		'shadow-intensity="1"',
		'exposure="1"',
		'tone-mapping="aces"',
		autoRotate ? 'auto-rotate' : '',
		ar ? 'ar ar-modes="webxr scene-viewer quick-look"' : '',
		poster ? `poster="${attr(poster)}"` : '',
		cameraOrbit ? `camera-orbit="${attr(cameraOrbit)}"` : '',
		`alt="${attr(name || 'Avatar')}"`,
	]
		.filter(Boolean)
		.join(' ');
	return [
		'<!doctype html>',
		'<html><head><meta charset="utf-8"><title>' + esc(name || 'Avatar') + '</title>',
		'<script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js"></script>',
		'<style>html,body{margin:0;height:100%;background:' + attr(background) + '}',
		'model-viewer{width:' +
			attr(width) +
			';height:' +
			attr(height) +
			';--progress-bar-color:#6a5cff}</style>',
		'</head><body>',
		'<model-viewer ' + attrs + '></model-viewer>',
		'</body></html>',
	].join('\n');
}

function formatAvatarList(avatars, { public: isPublic = false } = {}) {
	if (!avatars.length) return 'No avatars found.';
	return avatars
		.map((a) => {
			const url = a.model_url ? ` — ${a.model_url}` : '';
			const vis = isPublic ? '' : ` [${a.visibility}]`;
			return `• ${a.name} (slug: ${a.slug}, id: ${a.id})${vis}${url}`;
		})
		.join('\n');
}

// ── SSE / DELETE (session lifecycle) ────────────────────────────────────────
async function handleSse(req, res) {
	// We don't hold long-lived server→client subscriptions yet; respond politely.
	const bearer = extractBearer(req);
	// Unauthenticated callers without an X-PAYMENT header get an x402 challenge
	// so x402scan / x402 clients can discover the price. Invalid bearers still
	// get 401 with WWW-Authenticate so OAuth clients can re-auth correctly.
	if (!bearer && !req.headers['x-payment']) {
		return send402(
			res,
			paymentRequirements({
				resource: resolveResourceUrl(req, '/api/mcp'),
				description: 'MCP tool call',
			}),
		);
	}
	const auth = await authenticateBearer(bearer, { audience: env.MCP_RESOURCE });
	if (!auth) return send401(res, 'missing or invalid access token');
	res.statusCode = 405;
	res.setHeader('allow', 'POST, DELETE');
	res.end();
}

async function handleTerminate(_req, res) {
	// Stateless per-request server — nothing to tear down.
	res.statusCode = 204;
	res.end();
}

// ── error helpers ────────────────────────────────────────────────────────────
function quoteString(s) {
	return `"${String(s).replace(/[\\"]/g, '\\$&')}"`;
}

function send401(res, msg) {
	const resource = env.MCP_RESOURCE;
	res.statusCode = 401;
	res.setHeader(
		'www-authenticate',
		`Bearer resource_metadata=${quoteString(`${env.APP_ORIGIN}/.well-known/oauth-protected-resource`)}, resource=${quoteString(resource)}`,
	);
	res.setHeader('content-type', 'application/json; charset=utf-8');
	res.end(JSON.stringify({ error: 'unauthorized', error_description: msg }));
}

function sendJsonRpcError(res, id, code, message, data) {
	res.statusCode = 200;
	res.setHeader('content-type', 'application/json; charset=utf-8');
	res.end(JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message, data } }));
}

// ── misc ─────────────────────────────────────────────────────────────────────
function summarize(args) {
	const o = {};
	for (const [k, v] of Object.entries(args || {})) {
		o[k] = typeof v === 'string' && v.length > 64 ? v.slice(0, 64) + '…' : v;
	}
	return o;
}

function esc(s) {
	return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}
function attr(s) {
	return String(s).replace(
		/[&<>"]/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
	);
}

// CSS inputs land inside a <style> declaration (`background: <value>`), where
// HTML attribute-escaping does not defend against `;}body{…}` breakouts. Only
// allow a strict character class that cannot terminate the declaration/rule.
function safeCssValue(s, fallback) {
	if (!s) return fallback;
	const str = String(s).trim();
	if (!/^[a-zA-Z0-9 .,%#()\-_/+]+$/.test(str)) return fallback;
	if (str.length > 120) return fallback;
	return str;
}

function safeCssLength(s, fallback) {
	if (!s) return fallback;
	const str = String(s).trim();
	if (!/^[0-9]+(?:\.[0-9]+)?(?:px|em|rem|vh|vw|%)$|^auto$|^100%$/.test(str)) return fallback;
	return str;
}

// Posters are rendered as an attribute value that the browser fetches; restrict
// to https(:) to block `javascript:` and `data:` URLs that could execute code.
function safeHttpsUrl(s) {
	if (!s) return undefined;
	try {
		const u = new URL(String(s));
		return u.protocol === 'https:' ? u.toString() : undefined;
	} catch {
		return undefined;
	}
}
