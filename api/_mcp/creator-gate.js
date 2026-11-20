// The MCP side of "making a 3D model needs an account" (../_lib/creator-account.js).
//
// /api/forge refuses an anonymous creation with HTTP 401, but an MCP tool call
// rides one JSON-RPC request whose transport already succeeded, so a refused
// tool answers with an isError result the model can read and relay instead.
// That result also carries the OpenAI Apps SDK auth hint: a
// `_meta["mcp/www_authenticate"]` challenge naming this server's protected
// resource metadata, which a host such as ChatGPT turns into a "Connect your
// account" prompt that runs OAuth and retries the call. Hosts without that
// support read the text, which names both ways in: OAuth sign-in on the
// connector, or a three.ws API key sent as `Authorization: Bearer <key>`.
//
// Tool descriptors declare the same requirement up front with
// `securitySchemes` (the Apps SDK field): oauth2 on the tools that create or
// rig a model, noauth on the reads that stay open (job status, viewers, search).

import { env } from '../_lib/env.js';
import { API_KEYS_URL, SIGN_IN_REQUIRED, forwardCreatorAuth, platformAuthHeaders } from '../_lib/creator-account.js';
import { mcpResourceFor, protectedResourceMetadataUrl } from '../_lib/mcp-resources.js';

// The scope a connector asks for to make models. No studio tool checks it (the
// account itself is the requirement); it names what the grant is for on the
// consent screen.
export const CREATOR_SCOPES = Object.freeze(['avatars:write']);

export const CREATOR_SECURITY_SCHEMES = Object.freeze([Object.freeze({ type: 'oauth2', scopes: CREATOR_SCOPES })]);
export const OPEN_SECURITY_SCHEMES = Object.freeze([Object.freeze({ type: 'noauth' })]);

// The studio surfaces start OAuth off `?auth=oauth` on the connector URL
// (api/_mcp-studio/handler.js). The other hosted servers challenge on their own.
const SIGN_IN_PARAM_PATHS = new Set(['/api/mcp-studio', '/api/mcp-chatgpt', '/api/mcp-grok']);

function quote(s) {
	return `"${String(s).replace(/[\\"]/g, '\\$&')}"`;
}

function pathOf(req, resourcePath) {
	if (resourcePath) return resourcePath;
	try {
		return new URL(req?.url || '/', 'http://localhost').pathname;
	} catch {
		return '/';
	}
}

/**
 * The WWW-Authenticate value for a tool refused for want of an account: the
 * RFC 9728 challenge this server's 401 sends, plus the RFC 6750 error fields
 * the Apps SDK example carries.
 */
export function creatorChallenge(req, { resourcePath, action = 'make a 3D model' } = {}) {
	const resource = mcpResourceFor(pathOf(req, resourcePath));
	return [
		`Bearer resource_metadata=${quote(protectedResourceMetadataUrl(resource))}`,
		`resource=${quote(resource)}`,
		'error="insufficient_scope"',
		`error_description=${quote(`Sign in to three.ws to ${action}`)}`,
	].join(', ');
}

/**
 * The tool result an MCP server answers an anonymous creation call with.
 * @param {object} req the MCP HTTP request (its path picks the resource)
 * @param {{ action?: string, resourcePath?: string }} [opts]
 */
export function signInToolResult(req, { action = 'make a 3D model', resourcePath } = {}) {
	const origin = env.APP_ORIGIN;
	const path = pathOf(req, resourcePath);
	const apiKeysUrl = `${origin}${API_KEYS_URL}`;
	const signInUrl = SIGN_IN_PARAM_PATHS.has(path) ? `${origin}${path}?auth=oauth` : null;
	const message =
		`Sign in to ${action}. A three.ws account is free. ` +
		(signInUrl
			? `Connect this connector to your three.ws account (OAuth sign-in at ${signInUrl}), or create an API key at ${apiKeysUrl} and send it as "Authorization: Bearer <key>".`
			: `Create an API key at ${apiKeysUrl} and send it as "Authorization: Bearer <key>", or sign in to this server with OAuth.`);
	return {
		content: [{ type: 'text', text: message }],
		structuredContent: {
			error: true,
			status: SIGN_IN_REQUIRED,
			reason: SIGN_IN_REQUIRED,
			message,
			api_keys_url: apiKeysUrl,
			...(signInUrl ? { sign_in_url: signInUrl } : {}),
		},
		isError: true,
		_meta: { 'mcp/www_authenticate': [creatorChallenge(req, { resourcePath: path, action })] },
	};
}

/**
 * The credential an MCP server forwards to the forge for a signed-in caller.
 * The caller's OAuth token is bound to the MCP audience, which the forge does
 * not accept, so the server vouches for the account it already verified: the
 * platform secret plus `x-forge-on-behalf-user`, which makes the model that
 * account's own (born unlisted). Without the platform secret (a local server
 * with no CRON_SECRET) the caller's own bearer goes instead, which the forge
 * accepts when it is a three.ws API key.
 * @param {{ userId?: string } | null} account the verified MCP principal
 * @param {object} req the MCP HTTP request
 */
export function creatorForgeAuth(account, req) {
	const platform = platformAuthHeaders({ userId: account?.userId ?? null });
	if (platform['x-forge-on-behalf-user']) return platform;
	return forwardCreatorAuth(req);
}
