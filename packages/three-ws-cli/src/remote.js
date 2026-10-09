// Remote clients: MCP clients whose configuration lives in someone else's
// cloud. Grok Bot runs on xAI's machines and keeps its connectors there, so
// there is no file on this machine to write. `setup` does everything else:
// picks the server, gets the credential the auth mode needs (a free install
// token, or a connector key that can never spend), prints the connector form's
// exact fields, copies the URL, and proves the public URL answers from outside.
//
// What to connect comes from the live directory (/.well-known/mcp.json): its
// `clients` block names each client's recommended server and install endpoint,
// and a deployment that predates the block falls back to the client's
// preferred paths among the servers the directory lists.

import os from 'node:os';
import { requestJson, request, ApiError, VERSION } from './http.js';
import { listTools, PROTOCOL_VERSION } from './mcp-http.js';
import { readStore, updateStore } from './store.js';
import { bearerFor } from './oauth.js';
import { whoami } from './auth.js';
import { systemEnv } from './paths.js';

/** none: anonymous. install: anonymous with a free install token. key: a connector API key. oauth: sign in from the client. */
export const AUTH_MODES = ['none', 'install', 'key', 'oauth'];

export const AUTH_LABELS = {
	none: 'None',
	install: 'None',
	key: 'API key',
	oauth: 'OAuth 2.1',
};

// A connector key is held unattended by a cloud agent, so it must never carry
// a scope that moves funds (api/_lib/spend-scope.js).
const SPEND_SCOPES = ['wallet:write', 'services:write'];
const CONNECTOR_MARKER = 'connector';

// The query parameter that makes a studio surface answer anonymous callers 401
// so a connector set to OAuth 2.1 starts sign-in (api/_mcp-studio/handler.js).
const SIGN_IN_PARAM = 'auth';

/** The directory's `clients` entry for a remote client, or null. */
export function directoryEntry(client, directory) {
	const entry = directory?.clients?.[client.directoryKey];
	return entry && typeof entry === 'object' ? entry : null;
}

function pathOf(url) {
	try {
		return new URL(url).pathname;
	} catch {
		return null;
	}
}

/**
 * The server a remote client is pointed at when the person names none: the
 * directory's recommendation, else the first of the client's preferred paths
 * the directory lists, else the first server that needs no account.
 */
export function recommendedServer(client, directory, servers) {
	const entry = directoryEntry(client, directory);
	const byPath = (p) => servers.find((s) => s.path === p);
	return (entry?.server && byPath(pathOf(entry.server))) || client.preferredPaths.map(byPath).find(Boolean) || servers.find((s) => s.keyless) || servers[0] || null;
}

/** The auth modes a server supports as a connector. */
export function modesFor(server) {
	if (server.auth === 'none') return ['none', 'install'];
	if (server.keyless) return ['none', 'install', 'key', 'oauth'];
	return ['key', 'oauth'];
}

/** The default mode for a server: the directory's, when it applies, else the first supported one. */
export function defaultMode(client, directory, server) {
	const entry = directoryEntry(client, directory);
	const fromDirectory = { none: 'none', 'api-key': 'key', oauth: 'oauth' }[entry?.auth];
	const supported = modesFor(server);
	if (fromDirectory && pathOf(entry.server) === server.path && supported.includes(fromDirectory)) return fromDirectory;
	return supported[0];
}

export function parseMode(value) {
	const v = String(value || '').trim().toLowerCase();
	const alias = { 'api-key': 'key', apikey: 'key', token: 'install', anonymous: 'none' }[v] || v;
	if (!AUTH_MODES.includes(alias)) throw new ApiError(`unknown --auth "${value}". Use one of: ${AUTH_MODES.join(', ')}`);
	return alias;
}

/** The install endpoint: the directory's, rebased onto this origin, else the platform default. */
export function installEndpoint(client, directory, origin) {
	const alt = directoryEntry(client, directory)?.alternatives?.find?.((a) => a?.install);
	const p = alt ? pathOf(alt.install) : null;
	return `${origin}${p || '/api/mcp-studio/install'}`;
}

/**
 * The connector URL carrying a free install token for `server`. A token this
 * machine already minted for the origin is reused, so running setup again
 * prints the same URL and the connector keeps its budget.
 */
export async function installUrl({ client, directory, server, origin, env = systemEnv() }) {
	const pick = (urls) => Object.values(urls || {}).find((u) => pathOf(u) === server.path) || null;
	const saved = readStore(env).install_tokens?.[origin];
	if (saved && pick(saved.connector_urls)) return { url: pick(saved.connector_urls), reused: true };
	let minted;
	try {
		minted = await requestJson(installEndpoint(client, directory, origin), { method: 'POST' });
	} catch (err) {
		if (err.status === 404) throw new ApiError(`${origin} cannot mint install tokens yet; connect with --auth none, or try again after it updates`, { status: 404 });
		throw err;
	}
	const url = pick(minted?.connector_urls) || (pathOf(minted?.connector_url) === server.path ? minted.connector_url : null);
	if (!url) throw new ApiError(`${server.path} does not take install tokens; use --auth none, key or oauth`);
	updateStore((s) => {
		s.install_tokens = { ...(s.install_tokens || {}), [origin]: { token: minted.token, connector_urls: minted.connector_urls || { [server.path]: url }, created_at: minted.created_at || null } };
		return s;
	}, env);
	return { url, reused: false, limits: minted.limits || null };
}

function scopeList(scope) {
	return String(scope || '').split(/\s+/).filter(Boolean);
}

/** Why a key must not be handed to an unattended connector, or null when it may. */
export function connectorKeyProblem(scope) {
	const spend = scopeList(scope).filter((s) => SPEND_SCOPES.includes(s));
	if (spend.length) return `this key carries ${spend.join(' and ')}, which moves funds; a cloud agent holds a connector key unattended. Make one with "For an AI agent" at /dashboard/api, or let setup mint one`;
	return null;
}

/** Check a key someone brought: it must verify and must not be able to spend. */
export async function checkConnectorKey({ origin, key }) {
	let me;
	try {
		me = await whoami(origin, key);
	} catch (err) {
		if (err.status === 401) throw new ApiError('three.ws does not recognize that key; it may be revoked or expired', { status: 401 });
		throw err;
	}
	const scope = me.credential?.scope || '';
	const problem = connectorKeyProblem(scope);
	if (problem) throw new ApiError(problem);
	return { key, scope, connector: scopeList(scope).includes(CONNECTOR_MARKER), reused: true };
}

/**
 * A connector key for the signed-in account: the one this machine minted
 * before when it still verifies, else a new one from the `connector` preset,
 * which reads, generates and edits agent data and never spends.
 */
export async function connectorKey({ origin, label, env = systemEnv() }) {
	const saved = readStore(env).connector_keys?.[origin];
	if (saved?.key) {
		try {
			return await checkConnectorKey({ origin, key: saved.key });
		} catch (err) {
			if (err.status !== 401) throw err;
		}
	}
	const bearer = await bearerFor(env, { origin });
	if (!bearer) throw new ApiError('sign in first so setup can mint a connector key: `npx three-ws login`, or pass --connector-key sk_live_...');
	const res = await requestJson(`${origin}/api/api-keys`, {
		method: 'POST',
		headers: { authorization: `Bearer ${bearer}` },
		// The preset fixes the scopes server side. `scope` names the marker too,
		// so a deployment that predates the preset refuses the request with 400
		// instead of minting a standard key in its place.
		json: { name: `${label} (three-ws CLI on ${os.hostname()})`.slice(0, 80), preset: CONNECTOR_MARKER, scope: `avatars:read ${CONNECTOR_MARKER}` },
	}).catch((err) => {
		if (err.status === 400) throw new ApiError(`${origin} cannot mint connector keys from the CLI yet. Make one at ${origin}/dashboard/api ("For an AI agent") and pass it with --connector-key`, { status: 400 });
		throw err;
	});
	const minted = res.data;
	if (!scopeList(minted.scope).includes(CONNECTOR_MARKER) || connectorKeyProblem(minted.scope)) {
		throw new ApiError(`the key ${origin} minted is not a connector key (scope: ${minted.scope}); revoke ${minted.prefix} at ${origin}/dashboard/api`);
	}
	updateStore((s) => {
		s.connector_keys = { ...(s.connector_keys || {}), [origin]: { key: minted.token, prefix: minted.prefix, key_id: minted.id, scope: minted.scope } };
		return s;
	}, env);
	return { key: minted.token, scope: minted.scope, connector: true, reused: false };
}

/** The URL the connector form takes for this server and mode. */
export function connectorUrl(server, mode, { install = null } = {}) {
	if (mode === 'install') return install;
	if (mode === 'oauth' && server.keyless) {
		const u = new URL(server.url);
		u.searchParams.set(SIGN_IN_PARAM, 'oauth');
		return u.toString();
	}
	return server.url;
}

/** The fields the client's connector form asks for, in its order. */
export function connectorFields({ client, server, mode, url, key = null }) {
	const fields = [
		['Name', server.slug],
		['Transport', client.transport],
		['Server URL', url],
		['Authentication', AUTH_LABELS[mode]],
	];
	if (mode === 'key') fields.push(['Header', 'Authorization'], ['Value', `Bearer ${key}`]);
	if (mode === 'oauth') fields.push(['Client ID', 'leave empty: the connector registers itself']);
	return fields;
}

/** The sentence to paste into the client's chat instead of filling the form. A key never goes in chat. */
export function sayLine({ server, mode, url }) {
	if (mode === 'key') return null;
	return `Add a custom MCP server called ${server.slug} at ${url}${mode === 'oauth' ? ' with OAuth authentication' : ''}`;
}

const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|0\.0\.0\.0|\[?::1\]?|\[?f[cd][0-9a-f]{2}:.*)$/i;

/** True when a cloud client can reach the URL: https on a public host name. */
export function isPublicUrl(url) {
	try {
		const u = new URL(url);
		return u.protocol === 'https:' && !PRIVATE_HOST.test(u.hostname);
	} catch {
		return false;
	}
}

async function oauthChecks(url) {
	const checks = [];
	const res = await request(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': PROTOCOL_VERSION },
		json: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'three-ws-cli', version: VERSION } } },
	});
	await res.text();
	const challenge = res.headers.get('www-authenticate') || '';
	const metadata = /resource_metadata="([^"]+)"/.exec(challenge)?.[1] || null;
	const asks = res.status === 401 && Boolean(metadata);
	checks.push({ id: 'oauth-challenge', label: 'asks an anonymous client to sign in', ok: asks, detail: asks ? `401, ${new URL(metadata).pathname}` : `answered ${res.status}${challenge ? '' : ' with no www-authenticate'}` });
	if (!asks) return checks;
	try {
		const doc = await requestJson(metadata);
		const servers = Array.isArray(doc?.authorization_servers) ? doc.authorization_servers : [];
		checks.push({ id: 'oauth-metadata', label: 'publishes its authorization server', ok: servers.length > 0, detail: servers[0] || 'no authorization_servers' });
	} catch (err) {
		checks.push({ id: 'oauth-metadata', label: 'publishes its authorization server', ok: false, detail: err.message });
	}
	return checks;
}

/**
 * The live check, made from this machine exactly as the cloud client will
 * call: the public URL, the connector's own credential, a real initialize and
 * tools/list. Never throws; each check carries its own result.
 */
export async function verifyConnector({ url, mode, key = null }) {
	const checks = [];
	const reachable = isPublicUrl(url);
	checks.push({ id: 'public', label: 'public https URL a cloud agent can reach', ok: reachable, detail: reachable ? new URL(url).host : `${new URL(url).host} is not reachable from the internet; use the public deployment` });
	try {
		const { tools, serverInfo } = await listTools(url, { bearer: mode === 'key' ? key : null });
		const name = serverInfo?.name ? ` from ${serverInfo.name}${serverInfo.version ? ` ${serverInfo.version}` : ''}` : '';
		if (mode === 'oauth') {
			// A client only starts OAuth on a 401, so a URL that serves anonymous
			// callers would leave the connector signed out forever.
			checks.push({ id: 'oauth-challenge', label: 'asks an anonymous client to sign in', ok: false, detail: `answered anonymously with ${tools.length} tools, so sign-in never starts` });
		} else {
			checks.push({ id: 'tools', label: 'initialize + tools/list', ok: tools.length > 0, detail: `${tools.length} tools${name}`, tools: tools.length });
		}
	} catch (err) {
		if (mode === 'oauth' && err.status === 401) checks.push(...(await oauthChecks(url).catch((e) => [{ id: 'oauth-challenge', label: 'asks an anonymous client to sign in', ok: false, detail: e.message }])));
		else checks.push({ id: 'tools', label: 'initialize + tools/list', ok: false, detail: err.message });
	}
	return checks;
}
