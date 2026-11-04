// The sandbox bridge: the one way a sandboxed script reaches anything outside
// its workspace. A program has no network interface of its own; the three_ws
// client (clients/python, clients/node) sends one JSON message per call over
// the bridge socket, and this module decides it under the same policy a tool
// call from the model gets.
//
//   { op: 'tools' }                         the tools the run may call
//   { op: 'tool', name, args }              call one of them
//   { op: 'fetch', url, method, headers, body_base64 }
//                                           HTTP to a host the owner allowed
//
// Rules, in order, for every call:
//   1. The execution must still be running and its run active. A script that
//      outlives its execution (a forked child, a late runner) gets nothing.
//   2. The call is counted against the execution's bridge cap atomically
//      before it runs (store.recordBridgeCall), and logged.
//   3. A financial tool is refused outright, whatever the run allows: it needs
//      its preview shown to the user and the user's yes in the conversation,
//      and a script has no conversation. The refusal names the preview tool so
//      the model can ask the user properly.
//   4. Tools come from the server registry (api/_lib/agent-tools.js) and are
//      narrowed by the run's tools_allowed when it has one.
//   5. fetch is refused when the plan's egress is 'none'; otherwise the host
//      must be on the owner's allowlist (exact, or `*.example.com` for any
//      subdomain), every redirect hop is re-checked against it, and the request
//      goes through the SSRF guard pinned to the address it validated.
//
// Everything a tool or a host returns is untrusted data. The bridge passes it
// back to the script as data; the execution result the model sees is marked
// untrusted (agent-tools.js).
//
// Runner backends do not hold database credentials, so they forward each
// message to POST /api/sandbox/bridge with a token minted here for the one
// execution (signBridgeToken / verifyBridgeToken).

import crypto from 'node:crypto';

import { AGENT_TOOLS } from '../agent-tools.js';
import { fetchSafePublicUrlPinned } from '../ssrf-guard.js';
import { sandboxConfig } from './config.js';
import { SandboxError, getExecution, getSandboxRun, getSandboxSettings, recordBridgeCall } from './store.js';
import { toolTier } from './tiers.js';

const TOOL_TIMEOUT_MS = 30_000;
const FETCH_TIMEOUT_MS = 20_000;
const FETCH_MAX_BYTES = 5 * 1024 * 1024;
const FETCH_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
// Headers a script may not set: they would let it pose as the platform or
// smuggle a second request.
const FORBIDDEN_HEADERS = new Set([
	'host',
	'connection',
	'content-length',
	'transfer-encoding',
	'upgrade',
	'proxy-authorization',
	'te',
	'trailer',
	'keep-alive',
	'x-forwarded-for',
	'x-forwarded-host',
	'x-real-ip',
]);
const TOKEN_VERSION = 'v1';

class BridgeRefusal extends Error {
	constructor(code, message, detail = {}) {
		super(message);
		this.code = code;
		this.detail = detail;
	}
}

function refusal(code, message, detail = {}) {
	return { ok: false, error: { code, message, ...detail } };
}

// ── tokens ───────────────────────────────────────────────────────────────────

function secret() {
	const s = sandboxConfig.bridgeSecret;
	if (!s) throw new SandboxError(503, 'bridge_unconfigured', 'SANDBOX_BRIDGE_SECRET (or JWT_SECRET) is not set');
	return s;
}

function mac(payload) {
	return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

/**
 * A token that lets a runner speak the bridge for one execution until it
 * expires. The execution must still be running when the token is used.
 * @param {string} execId
 * @param {number} ttlSeconds
 */
export function signBridgeToken(execId, ttlSeconds) {
	const exp = Math.floor(Date.now() / 1000) + Math.max(1, Math.ceil(ttlSeconds));
	const payload = `${TOKEN_VERSION}.${execId}.${exp}`;
	return `${payload}.${mac(payload)}`;
}

/** The execution id a token was minted for, or null when it is forged, malformed or expired. */
export function verifyBridgeToken(token) {
	if (typeof token !== 'string' || token.length > 300) return null;
	const parts = token.split('.');
	if (parts.length !== 4 || parts[0] !== TOKEN_VERSION) return null;
	const [, execId, expStr, sig] = parts;
	if (!/^[0-9a-f-]{36}$/i.test(execId) || !/^\d{1,12}$/.test(expStr)) return null;
	const want = Buffer.from(mac(`${TOKEN_VERSION}.${execId}.${expStr}`));
	const got = Buffer.from(sig);
	if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
	if (Number(expStr) < Math.floor(Date.now() / 1000)) return null;
	return execId;
}

// ── hosts ────────────────────────────────────────────────────────────────────

/** Normalize one allowlist entry: a hostname, or `*.` plus a hostname. Null when invalid. */
export function normalizeHostPattern(input) {
	const raw = String(input || '').trim().toLowerCase().replace(/\.$/, '');
	if (!raw || raw.length > 253) return null;
	const wildcard = raw.startsWith('*.');
	const host = wildcard ? raw.slice(2) : raw;
	if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host)) return null;
	return wildcard ? `*.${host}` : host;
}

/** Whether `host` is allowed by any pattern: exact, or a strict subdomain of a `*.` pattern. */
export function hostAllowed(host, patterns) {
	const h = String(host || '').toLowerCase().replace(/\.$/, '');
	if (!h) return false;
	for (const p of patterns || []) {
		const n = normalizeHostPattern(p);
		if (!n) continue;
		if (n.startsWith('*.')) {
			if (h.endsWith(n.slice(1))) return true;
		} else if (h === n) {
			return true;
		}
	}
	return false;
}

// ── context ──────────────────────────────────────────────────────────────────

/**
 * Everything the bridge needs to decide calls for one execution. Throws a
 * SandboxError when the execution cannot speak the bridge any more.
 * @param {string} execId
 */
export async function bridgeContext(execId) {
	const exec = await getExecution(execId);
	if (!exec) throw new SandboxError(404, 'not_found', 'no such execution');
	if (exec.status !== 'running') throw new SandboxError(410, 'execution_finished', 'this execution has finished');
	const run = await getSandboxRun(exec.run_id);
	if (!run || run.status !== 'active') {
		throw new SandboxError(409, 'run_killed', `This run's sandbox was stopped: ${run?.killed_reason || 'killed'}.`);
	}
	const settings = await getSandboxSettings(exec.user_id);
	const limits = typeof exec.limits === 'string' ? JSON.parse(exec.limits) : exec.limits || {};
	return {
		execId: exec.id,
		runId: run.run_id,
		userId: exec.user_id,
		agentId: run.agent_id,
		limits,
		toolsAllowed: Array.isArray(run.tools_allowed) ? run.tools_allowed : null,
		allowHosts: Array.isArray(settings?.allow_hosts) ? settings.allow_hosts : [],
	};
}

/** The tools a script in this context may call. */
export function bridgeTools(ctx) {
	return Object.entries(AGENT_TOOLS)
		.filter(([name]) => !ctx.toolsAllowed || ctx.toolsAllowed.includes(name))
		.filter(([name]) => toolTier(name).tier !== 'financial')
		.map(([name, t]) => ({ name, description: t.description, tier: toolTier(name).tier, parameters: t.parameters }));
}

// ── calls ────────────────────────────────────────────────────────────────────

/** The policy decision for a call, before it is counted or run. */
function decide(ctx, msg) {
	const op = msg?.op;
	if (op === 'tools') return { op, entry: { op } };
	if (op === 'tool') {
		const name = typeof msg.name === 'string' ? msg.name.trim().slice(0, 100) : '';
		if (!name) throw new BridgeRefusal('bad_request', 'tool needs a name');
		const tier = toolTier(name);
		if (tier.tier === 'financial') {
			const preview = tier.previewTool ? ` Ask the user in the conversation; the model must call ${tier.previewTool} first and show them the preview.` : ' Ask the user in the conversation instead.';
			throw new BridgeRefusal(
				'financial_tool',
				`${name} moves funds, and a script cannot call a fund-moving tool: it needs a preview and the user's confirmation.${preview}`,
				{ tool: name, previewTool: tier.previewTool, financial: true },
			);
		}
		if (!Object.hasOwn(AGENT_TOOLS, name)) {
			throw new BridgeRefusal('unknown_tool', `No tool named ${name} is available to scripts. Call three_ws.tools() for the list.`, { tool: name });
		}
		if (ctx.toolsAllowed && !ctx.toolsAllowed.includes(name)) {
			throw new BridgeRefusal('tool_not_allowed', `This run does not allow ${name}.`, { tool: name });
		}
		const args = msg.args && typeof msg.args === 'object' && !Array.isArray(msg.args) ? msg.args : {};
		return { op, name, args, entry: { op, tool: name } };
	}
	if (op === 'fetch') {
		let url;
		try {
			url = new URL(String(msg.url || ''));
		} catch {
			throw new BridgeRefusal('bad_url', 'fetch needs an absolute http(s) URL');
		}
		if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new BridgeRefusal('bad_url', 'only http and https URLs can be fetched');
		if (url.username || url.password) throw new BridgeRefusal('bad_url', 'URLs with credentials are not allowed');
		const entry = { op, host: url.hostname, method: String(msg.method || 'GET').toUpperCase() };
		if (ctx.limits.egress !== 'allowlist') {
			throw new BridgeRefusal(
				'egress_off',
				`Network access is off on the ${ctx.limits.plan || 'free'} plan. Upgrade at ${sandboxConfig.publicOrigin}/pricing to let scripts fetch from hosts you allow.`,
				{ host: url.hostname, plan: ctx.limits.plan || 'free' },
			);
		}
		if (!hostAllowed(url.hostname, ctx.allowHosts)) {
			throw new BridgeRefusal(
				'host_not_allowed',
				`${url.hostname} is not on this account's sandbox allowlist. Add it at ${sandboxConfig.publicOrigin}/settings/sandbox.`,
				{ host: url.hostname },
			);
		}
		const method = entry.method;
		if (!FETCH_METHODS.has(method)) throw new BridgeRefusal('bad_request', `method ${method} is not supported`);
		const headers = {};
		for (const [k, v] of Object.entries(msg.headers && typeof msg.headers === 'object' ? msg.headers : {})) {
			const key = String(k).toLowerCase().trim();
			if (!key || FORBIDDEN_HEADERS.has(key) || /[\r\n]/.test(key) || /[\r\n]/.test(String(v))) continue;
			headers[key] = String(v).slice(0, 4096);
		}
		const body = msg.body_base64 ? Buffer.from(String(msg.body_base64), 'base64') : null;
		if (body && body.length > FETCH_MAX_BYTES) throw new BridgeRefusal('too_large', 'request body larger than 5 MB');
		if (body && (method === 'GET' || method === 'HEAD')) throw new BridgeRefusal('bad_request', `${method} cannot carry a body`);
		return { op, url, method, headers, body, entry };
	}
	throw new BridgeRefusal('bad_op', `unknown bridge op: ${String(op).slice(0, 40)}`);
}

function withTimeout(promise, ms, what) {
	let t;
	return Promise.race([
		promise,
		new Promise((_, reject) => {
			t = setTimeout(() => reject(new BridgeRefusal('timeout', `${what} took longer than ${Math.round(ms / 1000)}s`)), ms);
		}),
	]).finally(() => clearTimeout(t));
}

async function perform(ctx, d, { fetchImpl }) {
	if (d.op === 'tools') return bridgeTools(ctx);
	if (d.op === 'tool') return withTimeout(Promise.resolve(AGENT_TOOLS[d.name].handler(d.args)), TOOL_TIMEOUT_MS, d.name);
	const res = await fetchImpl(
		d.url.toString(),
		{ method: d.method, headers: d.headers, body: d.body || undefined, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
		{
			maxBytes: FETCH_MAX_BYTES,
			onRedirect: async (next) => {
				if (!hostAllowed(next.hostname, ctx.allowHosts)) {
					throw new BridgeRefusal('host_not_allowed', `redirected to ${next.hostname}, which is not on the allowlist`, { host: next.hostname });
				}
			},
		},
	);
	const buf = Buffer.from(await res.arrayBuffer());
	const headers = {};
	res.headers.forEach((v, k) => {
		if (k !== 'set-cookie') headers[k] = v;
	});
	return { status: res.status, headers, url: d.url.toString(), body_base64: buf.toString('base64') };
}

/**
 * Decide and run one bridge message. Always resolves to the wire response:
 * `{ ok: true, result }` or `{ ok: false, error: { code, message, ... } }`.
 * @param {Awaited<ReturnType<typeof bridgeContext>>} ctx
 * @param {object} msg
 * @param {{ fetchImpl?: typeof fetchSafePublicUrlPinned }} [deps]
 */
export async function handleBridge(ctx, msg, { fetchImpl = fetchSafePublicUrlPinned } = {}) {
	const at = new Date().toISOString();
	let decision;
	try {
		decision = decide(ctx, msg);
	} catch (err) {
		if (!(err instanceof BridgeRefusal)) throw err;
		const counted = await recordBridgeCall(
			ctx.execId,
			{ at, op: msg?.op ?? null, tool: err.detail.tool, host: err.detail.host, ok: false, code: err.code, financial: Boolean(err.detail.financial) },
			{ cap: ctx.limits.bridgeCallsPerExecution },
		);
		if (counted.refused === 'finished') return refusal('execution_finished', 'this execution has finished');
		const { financial, ...detail } = err.detail;
		return refusal(err.code, err.message, detail);
	}

	const counted = await recordBridgeCall(ctx.execId, { at, ...decision.entry, ok: true }, { cap: ctx.limits.bridgeCallsPerExecution });
	if (counted.refused === 'finished') return refusal('execution_finished', 'this execution has finished');
	if (counted.refused === 'limit') {
		return refusal('bridge_limit', `This execution has made all ${ctx.limits.bridgeCallsPerExecution} bridge calls its plan allows.`, {
			limit: ctx.limits.bridgeCallsPerExecution,
		});
	}

	try {
		return { ok: true, result: await perform(ctx, decision, { fetchImpl }) };
	} catch (err) {
		if (err instanceof BridgeRefusal) return refusal(err.code, err.message, err.detail);
		const code = err?.name === 'SsrfBlockedError' ? 'blocked_address' : err?.name === 'MaxBytesExceededError' ? 'too_large' : decision.op === 'fetch' ? 'fetch_failed' : 'tool_error';
		return refusal(code, String(err?.message || err).slice(0, 500));
	}
}
