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
import { authenticateBearer, extractBearer, hasScope } from './_lib/auth.js';
import { cors, readJson, wrap } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { recordEvent, logger } from './_lib/usage.js';
import { listAvatars, getAvatar, getAvatarBySlug, searchPublicAvatars, resolveAvatarUrl, deleteAvatar } from './_lib/avatars.js';
import { fetchModel, FetchModelError } from './_lib/fetch-model.js';
import { inspectModel, suggestOptimizations } from './_lib/model-inspect.js';
import { validateBytes } from 'gltf-validator';

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: '3d-agent-mcp', version: '1.0.0' };
const log = logger('mcp');

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,DELETE,OPTIONS' })) return;

	// Unauthenticated discovery surface — DELETE and GET without bearer are OK to reject quickly.
	if (req.method === 'GET')    return handleSse(req, res);
	if (req.method === 'DELETE') return handleTerminate(req, res);
	if (req.method !== 'POST')   return send401(res, 'method not supported');

	const bearer = extractBearer(req);
	const auth = await authenticateBearer(bearer, { audience: env.MCP_RESOURCE });
	if (!auth) return send401(res, 'missing or invalid access token');

	const ipRl = await limits.mcpIp(clientIp(req));
	if (!ipRl.success) return sendJsonRpcError(res, null, -32000, 'rate_limited', { retry_after: Math.ceil((ipRl.reset - Date.now()) / 1000) });
	const userRl = await limits.mcpUser(auth.userId);
	if (!userRl.success) return sendJsonRpcError(res, null, -32000, 'rate_limited', { retry_after: Math.ceil((userRl.reset - Date.now()) / 1000) });

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
	res.statusCode = 200;
	res.setHeader('content-type', 'application/json; charset=utf-8');
	res.setHeader('mcp-protocol-version', PROTOCOL_VERSION);
	res.end(JSON.stringify(Array.isArray(body) ? responses : responses[0] ?? null));
});

// ── JSON-RPC dispatch ────────────────────────────────────────────────────────
async function dispatch(msg, auth, req) {
	const started = Date.now();
	const id = msg.id;
	const isNotification = id === undefined;

	try {
		if (msg.jsonrpc !== '2.0') throw rpcError(-32600, 'invalid Request');
		const method = msg.method;

		if (method === 'initialize')              return ok(id, await onInitialize(msg.params, auth));
		if (method === 'ping')                    return ok(id, {});
		if (method === 'notifications/initialized') return null;
		if (method === 'tools/list')              return ok(id, { tools: TOOL_CATALOG });
		if (method === 'tools/call')              return ok(id, await onToolCall(msg.params, auth, started));
		if (method === 'resources/list')          return ok(id, { resources: [] });
		if (method === 'resources/templates/list') return ok(id, { resourceTemplates: [] });
		if (method === 'prompts/list')            return ok(id, { prompts: [] });
		if (method === 'logging/setLevel')        return ok(id, {});

		throw rpcError(-32601, `method not found: ${method}`);
	} catch (err) {
		log.warn('rpc_error', { method: msg.method, code: err.code, message: err.message });
		if (isNotification) return null;
		return {
			jsonrpc: '2.0',
			id,
			error: { code: err.code || -32603, message: err.message || 'internal error', data: err.data },
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
			'Render 3D avatars stored on 3dagent.vercel.app as <model-viewer> HTML artifacts.',
			'Use list_my_avatars to see the user\'s avatars and render_avatar to get embeddable viewer HTML.',
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
		if (err.code) throw err;
		// Framework convention: tool errors go in result.isError, not rpc error.
		return {
			content: [{ type: 'text', text: `Error: ${err.message}` }],
			isError: true,
		};
	}
}

// ── tool catalog ─────────────────────────────────────────────────────────────
const TOOL_CATALOG = [
	{
		name: 'list_my_avatars',
		title: 'List my avatars',
		description: 'List the authenticated user\'s avatars. Returns id, name, slug, size, visibility, and direct model_url (when visibility permits).',
		inputSchema: {
			type: 'object',
			properties: {
				limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
				cursor: { type: 'string', description: 'Opaque pagination cursor from previous response.' },
				visibility: { type: 'string', enum: ['private', 'unlisted', 'public'] },
			},
			additionalProperties: false,
		},
	},
	{
		name: 'get_avatar',
		title: 'Get avatar',
		description: 'Fetch a single avatar by id or by owner+slug. Returns metadata and a model_url (public/unlisted) or short-lived signed URL (private).',
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
		description: 'Search the public avatar gallery. Useful for finding characters to render without prior knowledge of an id.',
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
				background: { type: 'string', description: 'CSS background color or gradient.', default: 'transparent' },
				height: { type: 'string', default: '480px' },
				width: { type: 'string', default: '100%' },
				camera_orbit: { type: 'string', description: 'model-viewer camera-orbit value, e.g. "0deg 80deg 2m".' },
				poster: { type: 'string', description: 'Optional poster image URL shown while loading.' },
				ar: { type: 'boolean', default: true, description: 'Include AR button for mobile.' },
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
			properties: { id: { type: 'string', format: 'uuid' } },
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
				url: { type: 'string', format: 'uri', description: 'Public https URL of a .glb or .gltf file.' },
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
				url: { type: 'string', format: 'uri', description: 'Public https URL of a .glb or .gltf file.' },
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
				url: { type: 'string', format: 'uri', description: 'Public https URL of a .glb or .gltf file.' },
			},
			required: ['url'],
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
				? await getAvatarBySlug({ ownerId: auth.userId, slug: args.slug, requesterId: auth.userId })
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
		async handler(args) {
			const result = await searchPublicAvatars({
				q: args.q,
				tag: args.tag,
				limit: args.limit || 12,
			});
			return {
				content: [{ type: 'text', text: formatAvatarList(result.avatars, { public: true }) }],
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
				? await getAvatarBySlug({ ownerId: auth.userId, slug: args.slug, requesterId: auth.userId })
				: null;
			if (!avatar) throw new Error('avatar not found');
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
			return {
				content: [
					{ type: 'text', text: html },
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
			const ok = await deleteAvatar({ id: args.id, userId: auth.userId });
			if (!ok) throw new Error('avatar not found or not yours');
			return { content: [{ type: 'text', text: `Deleted avatar ${args.id}.` }] };
		},
	},

	validate_model: {
		async handler(args, auth) {
			const rl = await limits.mcpValidate(auth.userId);
			if (!rl.success) throw rpcError(-32000, 'rate_limited', { retry_after: Math.ceil((rl.reset - Date.now()) / 1000) });
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
				content: [{ type: 'text', text: formatValidationSummary(summary, issues.messages || []) }],
				structuredContent: { ...summary, messages: issues.messages || [], info: report?.info || null },
			};
		},
	},

	inspect_model: {
		async handler(args, auth) {
			const rl = await limits.mcpInspect(auth.userId);
			if (!rl.success) throw rpcError(-32000, 'rate_limited', { retry_after: Math.ceil((rl.reset - Date.now()) / 1000) });
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
			const rl = await limits.mcpOptimize(auth.userId);
			if (!rl.success) throw rpcError(-32000, 'rate_limited', { retry_after: Math.ceil((rl.reset - Date.now()) / 1000) });
			const { bytes, url, filename } = await safeFetchModel(args.url);
			const info = await inspectModel(bytes, { fileSize: bytes.byteLength });
			const suggestions = suggestOptimizations(info);
			return {
				content: [{ type: 'text', text: formatSuggestions(suggestions) }],
				structuredContent: { url, filename, suggestions, info },
			};
		},
	},
};

async function safeFetchModel(url) {
	try {
		return await fetchModel(url);
	} catch (e) {
		if (e instanceof FetchModelError) throw new Error(`fetch failed: ${e.message} (${e.code})`);
		throw e;
	}
}

function formatValidationSummary(s, messages) {
	const head = `glTF-Validator report for ${s.filename} (${(s.fileSize / 1024).toFixed(1)} KB)\n` +
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
		? info.textures.map((t) => `  • ${t.name || '(unnamed)'} — ${t.mimeType} ${t.width}×${t.height}, ${(t.byteSize / 1024).toFixed(1)} KB`).join('\n')
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
	return suggestions.map((s) => {
		const tag = { info: 'INFO', warn: 'WARN', critical: 'CRIT' }[s.severity] || s.severity.toUpperCase();
		const est = s.estimate ? ` — ${s.estimate}` : '';
		return `[${tag}] ${s.id}: ${s.message}${est}`;
	}).join('\n');
}

// ── <model-viewer> artifact builder ─────────────────────────────────────────
function renderModelViewerHtml({ src, name, poster, background, height, width, autoRotate, ar, cameraOrbit }) {
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
	].filter(Boolean).join(' ');
	return [
		'<!doctype html>',
		'<html><head><meta charset="utf-8"><title>' + esc(name || 'Avatar') + '</title>',
		'<script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js"></script>',
		'<style>html,body{margin:0;height:100%;background:' + attr(background) + '}',
		'model-viewer{width:' + attr(width) + ';height:' + attr(height) + ';--progress-bar-color:#6a5cff}</style>',
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
function send401(res, msg) {
	const resource = env.MCP_RESOURCE;
	res.statusCode = 401;
	res.setHeader(
		'www-authenticate',
		`Bearer resource_metadata="${env.APP_ORIGIN}/.well-known/oauth-protected-resource", resource="${resource}"`
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
	return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
function attr(s) {
	return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
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
	} catch { return undefined; }
}
