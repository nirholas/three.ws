// threews-agent MCP: connect an agent to third-party MCP servers.
//
// Thin adapters over api/_lib/mcp-connections/ (the same service the REST
// routes under /api/v1/agents/:id/mcp use), so the SSRF guard, the tier rules
// and the "nothing risky starts enabled" default hold on every surface.
//
// Tool policy (docs/prompts/03):
//   read   list_integrations     the catalog and an agent's connections
//   write  install_integration   connect a catalog server (read tools only on)
//          remove_integration    disconnect one and delete its stored credentials
//                                (financial tier: needs confirm_delete after list_integrations)
//
// install_integration never enables a write or financial tool and never accepts
// a custom URL: those need the owner's review on /mcp-integrations.

import { hasScope } from '../_lib/auth.js';
import { limits } from '../_lib/rate-limit.js';
import { loadCatalog, presentEntry } from '../_lib/mcp-connections/catalog.js';
import * as service from '../_lib/mcp-connections/service.js';
import * as store from '../_lib/mcp-connections/store.js';
import { loadOwnedAgent } from '../_lib/agents-v1/agents.js';
import { env } from '../_lib/env.js';

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };

const agentIdProp = { type: 'string', format: 'uuid', description: 'The agent to connect. three://agents lists yours.' };

function result(text, structuredContent, isError = false) {
	return { content: [{ type: 'text', text }], structuredContent, ...(isError ? { isError: true } : {}) };
}

const refusal = (text, reason, extra = {}) => result(text, { ok: false, reason, ...extra }, true);

async function guard(auth, scope, fn) {
	const rl = await limits.mcpAgent(auth.userId || auth.rateKey || 'anon');
	if (!rl.success) {
		throw Object.assign(new Error('rate_limited'), { code: -32000, data: { retry_after: Math.ceil((rl.reset - Date.now()) / 1000) } });
	}
	if (!auth.userId) return refusal('Sign in to three.ws to manage your agent integrations.', 'auth_required', { signed_in: false });
	if (!hasScope(auth.scope, scope)) {
		return refusal(`This action needs the ${scope} scope. Re-authorize with it granted.`, 'insufficient_scope', { required: scope });
	}
	try {
		return await fn();
	} catch (err) {
		if (err?.name === 'ConnectionError' || err?.code === 'not_found' || err?.status === 403 || err?.status === 404) {
			return refusal(err.message, err.code || 'refused', err.detail ? { detail: err.detail } : {});
		}
		throw err;
	}
}

function connectionLine(c) {
	const t = c.tool_counts;
	const state = c.status === 'active' ? 'connected' : c.status.replace(/_/g, ' ');
	return `${c.label} [${c.id}] ${state}: ${t.enabled} of ${t.total} tools on (${t.read} read, ${t.write} write, ${t.financial} financial). Tools start with ${c.tool_prefix}`;
}

export const integrationToolDefs = [
	{
		name: 'list_integrations',
		title: 'List agent integrations',
		group: 'integrations',
		tier: 'read',
		annotations: READ,
		description: 'List the third-party MCP servers an agent can connect (the vetted catalog: GitHub, docs and search servers and more) and, with agent_id, the ones already connected with their status and how many tools are on. Use this when the user asks what an agent can connect or what it is already connected to. Use the catalog id with install_integration.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: { ...agentIdProp, description: 'Include this agent\'s connections. Omit to list only the catalog.' },
				query: { type: 'string', maxLength: 80, description: 'Filter the catalog by name or category.' },
			},
			additionalProperties: false,
		},
		handler: (args, auth) => guard(auth, 'agents:read', async () => {
			const q = String(args.query || '').trim().toLowerCase();
			const servers = loadCatalog().servers
				.map((s) => presentEntry(s))
				.filter((s) => !q || `${s.id} ${s.name} ${s.category} ${s.description || ''}`.toLowerCase().includes(q))
				.map((s) => ({ id: s.id, name: s.name, category: s.category, auth: s.auth.type, connectable: s.connectable, runtime: s.runtime, summary: s.description || null }));
			let connections = null;
			if (args.agent_id) {
				const agent = await loadOwnedAgent(args.agent_id, auth.userId);
				connections = await service.listConnections(agent.id);
			}
			const lines = [
				`${servers.length} integration${servers.length === 1 ? '' : 's'} available:`,
				...servers.map((s) => `- ${s.id}: ${s.name} (${s.category}, ${s.auth === 'none' ? 'no sign-in' : `${s.auth} sign-in`}${s.connectable ? '' : ', not connectable here'})`),
			];
			if (connections) {
				lines.push('', connections.length ? 'Connected to this agent:' : 'Nothing is connected to this agent yet.', ...connections.map((c) => `- ${connectionLine(c)}`));
			}
			return result(lines.join('\n'), { ok: true, catalog: servers, connections });
		}),
	},
	{
		name: 'install_integration',
		title: 'Connect an integration to an agent',
		group: 'integrations',
		tier: 'write',
		annotations: WRITE,
		description: 'Connect a catalog MCP server to an agent. Only its read tools are turned on; write and financial tools stay off until the owner enables and acknowledges each one on /mcp-integrations. A server that signs in with OAuth comes back with a sign_in_url the owner must open. Custom URLs are not accepted here; use the page. Use this when the user wants to add a catalog integration to an agent.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: agentIdProp,
				catalog_id: { type: 'string', maxLength: 60, description: 'A catalog id from list_integrations, e.g. "github".' },
				bearer_token: { type: 'string', maxLength: 4096, description: 'An access token, for servers that take one instead of OAuth sign-in.' },
			},
			required: ['agent_id', 'catalog_id'],
			additionalProperties: false,
		},
		handler: (args, auth) => guard(auth, 'agents:write', async () => {
			const agent = await loadOwnedAgent(args.agent_id, auth.userId);
			let conn = await service.createConnection({ agentId: agent.id, userId: auth.userId, catalogId: args.catalog_id, bearerToken: args.bearer_token });
			let signInUrl = null;
			if (conn.status === 'pending_auth' && conn.auth_type === 'oauth') {
				const row = await store.getOwned(agent.id, conn.id, auth.userId);
				const started = await service.startAuth(row, { returnTo: '/mcp-integrations' });
				signInUrl = started.authorization_url || null;
				conn = store.presentConnection(await store.getOwned(agent.id, conn.id, auth.userId));
			}
			const text = signInUrl
				? `${conn.label} is added but needs the owner to sign in. Open this link: ${signInUrl}`
				: `${connectionLine(conn)}. Write and financial tools are off; the owner enables them on ${env.APP_ORIGIN}/mcp-integrations.`;
			return result(text, { ok: true, connection: conn, sign_in_url: signInUrl });
		}),
	},
	{
		name: 'remove_integration',
		title: 'Remove an integration from an agent',
		group: 'integrations',
		tier: 'financial',
		confirmFlag: 'confirm_delete',
		previewTool: 'list_integrations',
		annotations: DESTRUCTIVE,
		description: 'Disconnect an MCP server from an agent and delete the credentials stored for it. The credentials cannot be recovered, so the owner must sign in to the server again to reconnect. The agent loses its ext_ tools immediately. Call list_integrations with the agent_id first and show the user the connection. Use this when the user no longer wants an agent connected to an integration.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: agentIdProp,
				connection_id: { type: 'string', format: 'uuid', description: 'The connection id from list_integrations.' },
			},
			required: ['agent_id', 'connection_id'],
			additionalProperties: false,
		},
		handler: (args, auth) => guard(auth, 'agents:write', async () => {
			const agent = await loadOwnedAgent(args.agent_id, auth.userId);
			await service.removeConnection(agent.id, args.connection_id, auth.userId);
			return result('Integration removed and its stored credentials deleted.', { ok: true, removed: args.connection_id });
		}),
	},
];
