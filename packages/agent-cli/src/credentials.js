// The three.ws credential the local agent uses for MCP tools, the agent APIs
// and (with the `inference` scope) model calls billed to the account's credits.
//
// It shares ~/.config/three-ws/credentials.json with the three-ws CLI. The
// agent keeps its own key in the `agent_key` slot so signing in here never
// replaces the credential the person's MCP clients use, and it reads the CLI's
// slots as a fallback so one `three-ws setup` is enough to start.
//
// Resolution order: THREE_WS_API_KEY env, agent_key, stdio_key, auth (an API
// key, or an OAuth access token that has not expired).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { credentialsPath, systemEnv } from './paths.js';
import { ApiError, request, requestJson, VERSION } from './http.js';

/** Scopes a local agent asks for at sign-in. Money-moving scopes are opt-in with --scope. */
export const DEFAULT_SCOPES = Object.freeze(['profile', 'agents:read', 'agents:write', 'memory:read', 'memory:write', 'wallet:read', 'inference']);

export function readStoreFile(env = systemEnv()) {
	const file = credentialsPath(env);
	try {
		return JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch (err) {
		if (err.code === 'ENOENT') return {};
		if (err instanceof SyntaxError) throw new Error(`${file} is not valid JSON. Delete it and sign in again.`);
		throw err;
	}
}

/** Merge into the shared store without touching slots other tools own. */
export function writeStoreFile(mutator, env = systemEnv()) {
	const file = credentialsPath(env);
	const current = readStoreFile(env);
	const next = mutator({ version: 1, ...current }) || current;
	fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
	const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
	fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
	fs.renameSync(tmp, file);
	if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
	return next;
}

/** Last four characters only. */
export function mask(secret) {
	return secret ? `...${String(secret).slice(-4)}` : '';
}

/**
 * @returns {{ token: string, source: string, scope: string, email: string|null } | null}
 */
export function resolveCredential(env = systemEnv(), { now = Date.now() } = {}) {
	if (env.vars.THREE_WS_API_KEY) {
		return { token: env.vars.THREE_WS_API_KEY, source: 'env THREE_WS_API_KEY', scope: '', email: null };
	}
	const store = readStoreFile(env);
	const email = store.account?.email || null;
	if (store.agent_key?.key) return { token: store.agent_key.key, source: 'agent key', scope: store.agent_key.scope || '', email };
	if (store.stdio_key?.key) return { token: store.stdio_key.key, source: 'three-ws stdio key', scope: store.stdio_key.scope || '', email };
	const auth = store.auth;
	if (auth?.type === 'apikey' && auth.key) return { token: auth.key, source: 'three-ws API key', scope: auth.scope || '', email };
	if (auth?.type === 'oauth' && auth.access_token) {
		const expires = auth.expires_at ? Date.parse(auth.expires_at) || Number(auth.expires_at) : 0;
		if (!expires || expires > now + 30_000) {
			return { token: auth.access_token, source: 'three-ws OAuth token', scope: auth.scope || '', email };
		}
	}
	return null;
}

export function hasScope(scope, wanted) {
	return String(scope || '').split(/\s+/).includes(wanted);
}

// ── Device link sign-in (api/cli/[action].js, RFC 8628 poll semantics) ─────

export async function startDeviceLink({ origin, scope }) {
	return requestJson(`${origin}/api/cli/link`, {
		method: 'POST',
		json: { client_name: `three-ws agent ${VERSION}`, hostname: os.hostname(), scope },
	});
}

export async function pollDeviceLink({ origin, link, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), signal }) {
	let interval = (Number(link.interval) || 3) * 1000;
	const deadline = Date.now() + (Number(link.expires_in) || 600) * 1000;
	while (Date.now() < deadline) {
		if (signal?.aborted) throw new ApiError('sign-in cancelled', { code: 'aborted' });
		await sleep(interval);
		const res = await request(`${origin}/api/cli/token`, { method: 'POST', json: { device_code: link.device_code } });
		const data = await res.json().catch(() => ({}));
		if (res.ok) return data;
		if (data.error === 'authorization_pending') continue;
		if (data.error === 'slow_down') {
			interval += 5000;
			continue;
		}
		if (data.error === 'access_denied') throw new ApiError('the sign-in was denied in the browser', { code: 'access_denied' });
		if (data.error === 'expired_token') break;
		throw new ApiError(`${res.status} ${data.error || ''}: ${data.error_description || 'unexpected response'}`, { status: res.status, code: data.error });
	}
	throw new ApiError('the code expired before it was approved. Run `three-ws-agent login` again.', { code: 'expired_token' });
}

/** Store a freshly granted key in the agent slot. */
export function saveAgentKey(granted, env = systemEnv()) {
	writeStoreFile((s) => ({
		...s,
		account: s.account || (granted.account?.email ? { email: granted.account.email } : null),
		agent_key: {
			key: granted.access_token,
			prefix: granted.key?.prefix || null,
			key_id: granted.key?.id || null,
			scope: granted.scope || '',
			created_at: new Date().toISOString(),
		},
	}), env);
}

export function clearAgentKey(env = systemEnv()) {
	writeStoreFile((s) => {
		const next = { ...s };
		delete next.agent_key;
		return next;
	}, env);
}
