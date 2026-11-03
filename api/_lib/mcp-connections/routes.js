// /api/v1/agents/:id/mcp routes: connect an agent to external MCP servers.
// Declared as defineRouter rows (api/_lib/agents-v1/http.js), so they share the
// v1 envelope, auth, scopes, CSRF and rate limits. Mounted by api/v1/agent-mcp.js.
// Guide: docs/integrations.md.
//
//   GET    /agents/:id/mcp                  connections with status, tool counts, last error
//   POST   /agents/:id/mcp                  { catalog_id } or { server_url, transport, label }, optional bearer_token
//   GET    /agents/:id/mcp/:conn            one connection with its tool list
//   PATCH  /agents/:id/mcp/:conn            { enabled_tools, tier_overrides, acknowledge, label, reviewed, disabled }
//   DELETE /agents/:id/mcp/:conn            remove the connection and its stored credentials
//   POST   /agents/:id/mcp/:conn/auth       { return_to } starts OAuth; { bearer_token } stores a token
//   POST   /agents/:id/mcp/:conn/refresh    list the server's tools again
//
// No response ever carries credentials: connections leave through
// presentConnection (store.js), an allowlist.

import { apiError, requireUuid, created, strParam } from '../agents-v1/http.js';
import { loadOwnedAgent } from '../agents-v1/agents.js';
import * as service from './service.js';
import * as store from './store.js';

async function ownedAgent({ params, principal }) {
	return loadOwnedAgent(requireUuid(params.id, 'agent'), principal.userId);
}

async function ownedConnection(ctx) {
	const agent = await ownedAgent(ctx);
	const row = await store.getOwned(agent.id, requireUuid(ctx.params.conn, 'connection'), ctx.principal.userId);
	if (!row) throw apiError(404, 'connection_not_found', 'No such connection on this agent.');
	return { agent, row };
}

async function list(ctx) {
	const agent = await ownedAgent(ctx);
	return service.listConnections(agent.id);
}

async function create(ctx) {
	const agent = await ownedAgent(ctx);
	const { body } = ctx;
	if (!body.catalog_id && !body.server_url) {
		throw apiError(400, 'bad_request', 'Send `catalog_id` for a catalog server, or `server_url` for a custom one.');
	}
	if (body.catalog_id && body.server_url) throw apiError(400, 'bad_request', 'Send `catalog_id` or `server_url`, not both.');
	const connection = await service.createConnection({
		agentId: agent.id,
		userId: ctx.principal.userId,
		catalogId: body.catalog_id ? strParam(body.catalog_id, { name: 'catalog_id', max: 60 }) : undefined,
		serverUrl: body.server_url ? strParam(body.server_url, { name: 'server_url', max: 2048 }) : undefined,
		transport: body.transport,
		label: body.label ? strParam(body.label, { name: 'label', max: 80 }) : undefined,
		bearerToken: body.bearer_token,
	});
	return created(connection);
}

async function get(ctx) {
	const { row } = await ownedConnection(ctx);
	return store.presentConnection(row);
}

async function patch(ctx) {
	const { row } = await ownedConnection(ctx);
	const b = ctx.body;
	if (!['enabled_tools', 'tier_overrides', 'acknowledge', 'label', 'reviewed', 'disabled'].some((k) => k in b)) {
		throw apiError(400, 'empty_patch', 'Send at least one of enabled_tools, tier_overrides, acknowledge, label, reviewed or disabled.');
	}
	return service.updateSelection(row, b);
}

async function remove(ctx) {
	const agent = await ownedAgent(ctx);
	return service.removeConnection(agent.id, requireUuid(ctx.params.conn, 'connection'), ctx.principal.userId);
}

async function auth(ctx) {
	const { row } = await ownedConnection(ctx);
	if (ctx.body.bearer_token != null) return { connection: await service.setBearerToken(row, ctx.body.bearer_token) };
	return service.startAuth(row, { returnTo: ctx.body.return_to });
}

async function refresh(ctx) {
	const { row } = await ownedConnection(ctx);
	return service.refreshConnection(row);
}

export const mcpConnectionRoutes = [
	{ method: 'GET', path: '/agents/:id/mcp', name: 'agents.mcp.list', auth: 'required', scope: 'agents:read', handler: list },
	{ method: 'POST', path: '/agents/:id/mcp', name: 'agents.mcp.create', auth: 'required', scope: 'agents:write', handler: create },
	{ method: 'GET', path: '/agents/:id/mcp/:conn', name: 'agents.mcp.get', auth: 'required', scope: 'agents:read', handler: get },
	{ method: 'PATCH', path: '/agents/:id/mcp/:conn', name: 'agents.mcp.update', auth: 'required', scope: 'agents:write', handler: patch },
	{ method: 'DELETE', path: '/agents/:id/mcp/:conn', name: 'agents.mcp.remove', auth: 'required', scope: 'agents:write', handler: remove },
	{ method: 'POST', path: '/agents/:id/mcp/:conn/auth', name: 'agents.mcp.auth', auth: 'required', scope: 'agents:write', handler: auth },
	{ method: 'POST', path: '/agents/:id/mcp/:conn/refresh', name: 'agents.mcp.refresh', auth: 'required', scope: 'agents:write', handler: refresh },
];
