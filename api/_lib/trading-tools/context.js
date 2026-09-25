// Shared plumbing for the trading tool registry (api/_lib/trading-tools/registry.js).
//
// A trading tool runs the same way whether it is called over MCP
// (api/_mcpagent/trading-tools.js) or REST (/api/v1/trading/*): it receives its
// arguments and a context `{ principal, req }`, and either returns a plain JSON
// result or throws a ToolInputError that both surfaces render as a designed
// refusal (a tool result with isError over MCP, a typed error envelope over
// REST). Nothing here formats output for one surface.
//
// principal: { userId, source: 'session'|'apikey'|'oauth'|..., scope, apiKeyId?, clientId? }
// req:       the caller's HTTP request. Tools that reuse an existing owner-gated
//            handler forward to it with the caller's own headers, so that
//            handler resolves the same account and runs its full guard chain.

import { sql } from '../db.js';
import { hasScope } from '../auth.js';
import { currentSignatureFor, agreementRequirement } from '../real-funds-agreement.js';
import { ToolInputError } from './market.js';
import { PreviewError } from './preview.js';

/** A designed refusal with the HTTP status the REST surface answers with. */
export function refuse(status, code, message, detail = null) {
	const e = new ToolInputError(code, message, detail);
	e.status = status;
	return e;
}

const PREVIEW_STATUS = {
	preview_required: 400,
	preview_invalid: 400,
	preview_mismatch: 409,
	preview_stale: 410,
	preview_used: 409,
};

/**
 * Normalize anything a tool can throw into `{ status, code, message, detail }`
 * when it is a designed refusal, or null when it is an unexpected failure the
 * surface should redact.
 */
export function describeToolError(err) {
	if (!err || typeof err !== 'object') return null;
	if (err instanceof PreviewError) {
		return { status: PREVIEW_STATUS[err.code] || 400, code: err.code, message: err.message, detail: null };
	}
	if (err.isToolError) {
		return { status: Number(err.status) || 422, code: err.code, message: err.message, detail: err.detail ?? null };
	}
	// ApiError from the v1 route helpers, SpendLimitError and friends: a 4xx
	// with a string code is a message written for the caller.
	const status = Number(err.status);
	if (status >= 400 && status < 500 && typeof err.code === 'string') {
		return { status, code: err.code, message: String(err.message || err.code), detail: err.details ?? err.detail ?? null };
	}
	return null;
}

/** The signed-in account, or a 401 refusal. */
export function requireUser(ctx) {
	const userId = ctx?.principal?.userId;
	if (!userId) {
		throw refuse(401, 'auth_required', 'Sign in to three.ws (or use an API key) to act on your agents. Market reads work without an account.');
	}
	return userId;
}

/**
 * Require a token scope. A browser session carries the whole account; a
 * wallet:write grant satisfies wallet:read, since a caller allowed to spend may
 * read what it is spending.
 */
export function requireScope(ctx, scope) {
	const p = ctx?.principal;
	if (!p || p.source === 'session') return;
	if (hasScope(p.scope, scope)) return;
	if (scope === 'wallet:read' && hasScope(p.scope, 'wallet:write')) return;
	throw refuse(403, 'insufficient_scope', `This action needs the "${scope}" scope. Re-authorize (or create an API key) with it granted.`, { required: scope });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuidArg(value, name) {
	if (typeof value !== 'string' || !UUID_RE.test(value)) {
		throw refuse(400, 'invalid_parameter', `${name} must be a UUID.`, { parameter: name });
	}
	return value;
}

/** Load an agent the caller owns. 404 for an unknown id, 403 for someone else's. */
export async function loadOwnedAgent(ctx, agentId) {
	const userId = requireUser(ctx);
	requireUuidArg(agentId, 'agent_id');
	const [row] = await sql`
		SELECT id, user_id, name, meta FROM agent_identities
		WHERE id = ${agentId} AND deleted_at IS NULL
	`;
	if (!row) throw refuse(404, 'not_found', 'No agent with that id.');
	if (row.user_id !== userId) throw refuse(403, 'forbidden', "That agent isn't on your account.");
	return { ...row, meta: row.meta || {} };
}

/**
 * Anything that trades or schedules trades from a mainnet wallet needs the
 * owner's signed real-funds agreements, the same gate every dashboard path runs.
 */
export async function requireAgreement(ctx, network = 'mainnet') {
	if (network === 'devnet') return;
	const userId = requireUser(ctx);
	let signed;
	try {
		signed = await currentSignatureFor(userId);
	} catch {
		throw refuse(503, 'agreement_check_unavailable', 'Could not verify your signed real-funds agreements, so nothing was done. Try again in a moment.');
	}
	if (!signed) {
		const r = agreementRequirement();
		throw refuse(403, 'risk_ack_required', `Sign the real-funds agreements before trading from an agent wallet. Nothing was done. Sign at ${r.sign_url}`, r);
	}
}

/** A confirm flag must be literally true, and the refusal names the preview step. */
export function requireConfirm(args, flag, previewTool, tool) {
	if (args?.[flag] === true) return;
	throw refuse(
		400,
		'confirmation_required',
		`${tool} moves funds or changes where they can go, so it needs ${flag}: true. Call ${previewTool} first, show the user its result, and call ${tool} only after they clearly say yes.`,
		{ confirm_flag: flag, preview_tool: previewTool },
	);
}

/**
 * Run one route from an agents-v1 route table in-process, as if it had been
 * requested, reusing its validation, forwarding and quote signing. Errors it
 * throws (ApiError) propagate to the caller unchanged.
 */
export async function invokeRoute(routes, method, path, ctx, { params = {}, query = {}, body = {} } = {}) {
	const route = routes.find((r) => r.method === method && r.path === path);
	if (!route) throw new Error(`trading-tools: no ${method} ${path} route`);
	return route.handler({
		requestId: ctx.requestId || null,
		req: ctx.req,
		res: null,
		principal: ctx.principal,
		params,
		query,
		body,
	});
}

/** Solana network argument: mainnet unless devnet is asked for by name. */
export function networkArg(v) {
	if (v == null || v === '' || v === 'mainnet') return 'mainnet';
	if (v === 'devnet') return 'devnet';
	throw refuse(400, 'invalid_parameter', 'network must be "mainnet" or "devnet".', { parameter: 'network' });
}
