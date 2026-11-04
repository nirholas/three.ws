// `three-ws mcp list | add <server> | remove <server>`: the non-interactive
// equivalents of setup, for scripts, dotfiles and CI.
//
// `three-ws mcp install <name|url> --agent <id>`, `mcp installed --agent <id>`
// and `mcp uninstall <name|id> --agent <id>` manage the other direction: the
// third-party MCP servers one of your agents can call (GitHub, documentation
// servers, Linear and the rest of data/mcp-catalog.json). They are thin callers
// of /api/v1/agents/:id/mcp, so the server's safety rules apply unchanged: a
// catalog server starts with only its read tools on, a custom URL starts with
// nothing on until the owner reviews it, and write tools are switched on only
// from /mcp-integrations.

import { c, line, sym, printJson, tildify } from '../ui.js';
import { readStore } from '../store.js';
import { loadDirectory, hostedServers } from '../servers.js';
import { detectClients, getClient, removeServer, isRemote } from '../clients/index.js';
import { verifyServers, ensureSelections, applyToClients } from '../configure.js';
import { scanClients } from './account.js';
import { requireBearer } from './agent.js';
import { resolveAgent } from './automation.js';
import { requestJson } from '../http.js';
import { openBrowser } from '../browser.js';
import { CliError, EXIT_CODES } from '../automation.js';

function clientsFrom(flags, env) {
	if (flags.clients) {
		const clients = String(flags.clients).split(',').map((s) => getClient(s.trim()));
		const remote = clients.find(isRemote);
		if (remote) throw new Error(`${remote.label} keeps its connectors in its own cloud, so there is no file to edit. Run \`three-ws setup --client ${remote.id}\` to print its fields and verify them.`);
		return clients;
	}
	const detected = detectClients(env);
	if (!detected.length) throw new Error('no MCP clients detected; name one with --clients (e.g. --clients cursor)');
	return detected;
}

function findServer(all, name) {
	const s = all.find((x) => x.slug === name || x.path === name || x.name === name);
	if (!s) throw new Error(`unknown server "${name}". Available: ${all.map((x) => x.slug).join(', ')}`);
	return s;
}

async function listCmd(ctx) {
	const { flags, env, origin } = ctx;
	if (flags.available) {
		const all = hostedServers(await loadDirectory(origin), origin);
		if (flags.json) printJson(all);
		else for (const s of all) line(`  ${s.slug.padEnd(22)} ${s.url} ${c.dim(s.auth === 'none' ? 'no account needed' : 'sign-in required')}`);
		return 0;
	}
	const scan = scanClients(env, origin);
	if (flags.json) {
		printJson(scan.map((x) => ({ id: x.client.id, detected: x.detected, files: x.files, servers: x.entries.map((e) => e.name), error: x.error })));
		return 0;
	}
	let any = false;
	for (const x of scan) {
		if (x.error) line(`${c.red(sym.fail)} ${x.client.label}: ${x.error}`);
		if (!x.entries.length) continue;
		any = true;
		line(`${c.bold(x.client.label)} ${c.dim(x.files.map(tildify).join(', '))}`);
		for (const e of x.entries) line(`  ${e.name}${e.project ? c.dim(' [project]') : ''}`);
	}
	if (!any) line('No three.ws servers configured in any client. Run `three-ws setup`, or `three-ws mcp list --available` to see them.');
	return 0;
}

async function addCmd(ctx, name) {
	const { flags, env, origin } = ctx;
	if (!name) throw new Error('usage: three-ws mcp add <server> [--clients a,b] [--project] [--proxy]');
	const store = readStore(env);
	const clients = clientsFrom(flags, env);
	const server = findServer(hostedServers(await loadDirectory(origin), origin), name);
	if (server.auth === 'required' && !store.auth) throw new Error('sign in first: `three-ws login` (or `three-ws login --key sk_live_...` in CI)');
	const mode = store.auth?.type === 'apikey' ? 'apikey' : 'oauth';
	ensureSelections([server], { financial: /\bwallet:write\b/.test(store.auth?.scope || ''), env });
	const [result] = await verifyServers({ servers: [server], env, origin });
	const writes = applyToClients({
		clients,
		servers: [server],
		mode,
		apiKey: mode === 'apikey' ? store.auth.key : null,
		liveTools: result.ok ? { [server.slug]: result.tools } : {},
		forceProxy: Boolean(flags.proxy),
		project: Boolean(flags.project),
		origin,
		env,
	});
	if (flags.json) {
		printJson({ server: server.slug, verified: result.ok, tools: result.ok ? result.enabled : null, error: result.error || null, clients: writes.map((w) => ({ id: w.client.id, file: w.file, error: w.error })) });
	} else {
		line(result.ok ? `${c.green(sym.ok)} ${server.slug}: ${result.enabled} tools` : `${c.red(sym.fail)} ${server.slug}: ${result.error}`);
		for (const w of writes) line(w.error ? `  ${c.red(sym.fail)} ${w.client.label}: ${w.error}` : `  ${c.green(sym.ok)} ${w.client.label} ${c.dim(tildify(w.file))}`);
	}
	return result.ok && writes.every((w) => !w.error) ? 0 : 1;
}

function removeCmd(ctx, name) {
	const { flags, env, origin } = ctx;
	if (!name) throw new Error('usage: three-ws mcp remove <server> [--clients a,b]');
	const targets = flags.clients ? String(flags.clients).split(',').map((s) => s.trim()) : null;
	const removed = [];
	for (const x of scanClients(env, origin)) {
		if (targets && !targets.includes(x.client.id)) continue;
		for (const e of x.entries) {
			if (e.name !== name) continue;
			if (removeServer(x.client, name, env, { project: e.project })) removed.push({ client: x.client.id, project: e.project });
		}
	}
	if (flags.json) printJson({ server: name, removed });
	else if (!removed.length) line(`No client has an entry named ${name}. \`three-ws mcp list\` shows what is configured.`);
	else line(`${c.green(sym.ok)} Removed ${name} from ${removed.map((r) => getClient(r.client).label).join(', ')}.`);
	return 0;
}

const INTEGRATIONS_PAGE = '/mcp-integrations';

async function agentScope(ctx) {
	const headers = { authorization: `Bearer ${await requireBearer(ctx)}` };
	const agent = await resolveAgent(ctx, headers, ctx.flags.agent);
	const base = `${ctx.origin}/api/v1/agents/${encodeURIComponent(agent.id)}/mcp`;
	return { headers, agent, base };
}

/** Match a catalog entry by id, id without `-mcp`, or display name. */
export function findCatalogEntry(servers, name) {
	const k = String(name).trim().toLowerCase();
	return servers.find((s) => s.id === k || s.id === `${k}-mcp` || s.id.replace(/-mcp$/, '') === k || s.name.toLowerCase() === k) || null;
}

function suggestions(servers, name) {
	const k = String(name).toLowerCase();
	return servers.filter((s) => s.id.includes(k) || s.name.toLowerCase().includes(k) || s.category === k).slice(0, 6).map((s) => s.id);
}

function connectionView(conn) {
	return {
		id: conn.id,
		name: conn.name,
		label: conn.label,
		status: conn.status,
		tool_prefix: conn.tool_prefix,
		auth_type: conn.auth_type,
		tools: conn.tool_counts,
		enabled_tools: conn.tools.filter((t) => t.enabled).map((t) => t.name),
		last_error: conn.last_error,
	};
}

function printConnection(conn) {
	const t = conn.tool_counts;
	const state = conn.status === 'active' ? c.green('connected') : c.yellow(conn.status.replace(/_/g, ' '));
	line(`${c.bold(conn.label)} ${c.dim(conn.id)} ${state}`);
	line(`  ${t.enabled} of ${t.total} tools on (${t.read} read, ${t.write} write, ${t.financial} financial), named ${conn.tool_prefix}<tool>`);
	if (conn.last_error) line(`  ${c.red(sym.fail)} ${conn.last_error}`);
}

async function installCmd(ctx, name) {
	const { flags, origin } = ctx;
	if (!name) throw new CliError(EXIT_CODES.USAGE, 'usage', 'usage: three-ws mcp install <catalog-name|https-url> --agent <id|name> [--token <access-token>] [--label <name>] [--transport sse]');
	const custom = /^https:\/\//i.test(name);
	const body = {};
	let entry = null;
	if (custom) {
		body.server_url = name;
		if (flags.transport) body.transport = String(flags.transport);
		if (flags.label) body.label = String(flags.label);
	} else {
		const { servers = [] } = await requestJson(`${origin}/api/mcp-connections/catalog`);
		entry = findCatalogEntry(servers, name);
		if (!entry) {
			const near = suggestions(servers, name);
			throw new CliError(EXIT_CODES.USAGE, 'unknown_integration', `no catalog server named "${name}".${near.length ? ` Did you mean: ${near.join(', ')}?` : ''} Browse them at ${origin}${INTEGRATIONS_PAGE}.`);
		}
		if (entry.runtime === 'local') {
			throw new CliError(EXIT_CODES.USAGE, 'stdio_not_hosted', `${entry.name} runs on your own machine, not on three.ws. Install it locally: ${entry.docs}`);
		}
		body.catalog_id = entry.id;
	}
	if (flags.token) body.bearer_token = String(flags.token);

	const { headers, agent, base } = await agentScope(ctx);
	const { data: conn } = await requestJson(base, { method: 'POST', headers, json: body, timeoutMs: 45_000 });

	let authorizationUrl = null;
	if (conn.status === 'pending_auth' && conn.auth_type === 'oauth') {
		const { data } = await requestJson(`${base}/${conn.id}/auth`, { method: 'POST', headers, json: { return_to: INTEGRATIONS_PAGE }, timeoutMs: 45_000 });
		authorizationUrl = data.authorization_url || null;
	}
	const page = `${origin}${INTEGRATIONS_PAGE}?agent=${encodeURIComponent(agent.id)}`;

	if (flags.json) {
		printJson({ agent: agent.id, connection: connectionView(conn), authorization_url: authorizationUrl, manage: page });
		return EXIT_CODES.OK;
	}
	printConnection(conn);
	if (authorizationUrl) {
		const opened = await openBrowser(authorizationUrl, { env: ctx.env.vars });
		line(opened ? '  Finish signing in in the browser window that just opened.' : `  Finish signing in: ${authorizationUrl}`);
		line(c.dim('  Sign-in links must be opened in a browser signed in to the same three.ws account.'));
	} else if (conn.status === 'pending_auth') {
		line(`  This server needs an access token. ${entry?.auth?.tokenHelp || ''}`.trimEnd());
		line(`  Re-run with --token <token>, or paste it at ${page}`);
	} else if (conn.status === 'pending_review') {
		line(`  Custom server: nothing is switched on until you review its tools at ${page}`);
	}
	if (conn.tool_counts.write + conn.tool_counts.financial > 0) {
		line(c.dim(`  Write and financial tools stay off until you acknowledge and enable them at ${page}`));
	}
	return EXIT_CODES.OK;
}

async function installedCmd(ctx) {
	const { headers, agent, base } = await agentScope(ctx);
	const { data = [] } = await requestJson(base, { headers });
	if (ctx.flags.json) {
		printJson({ agent: agent.id, connections: data.map(connectionView) });
		return EXIT_CODES.OK;
	}
	if (!data.length) {
		line(`${agent.name || agent.id} has no integrations yet. Add one: three-ws mcp install deepwiki --agent ${agent.id.slice(0, 8)}`);
		return EXIT_CODES.OK;
	}
	for (const conn of data) printConnection(conn);
	return EXIT_CODES.OK;
}

async function uninstallCmd(ctx, key) {
	if (!key) throw new CliError(EXIT_CODES.USAGE, 'usage', 'usage: three-ws mcp uninstall <connection-name|id> --agent <id|name>');
	const { headers, agent, base } = await agentScope(ctx);
	const { data = [] } = await requestJson(base, { headers });
	const k = String(key).toLowerCase();
	const conn = data.find((x) => x.id === key || x.name === k || x.catalog_id === k || String(x.label).toLowerCase() === k);
	if (!conn) {
		throw new CliError(EXIT_CODES.USAGE, 'connection_not_found', `${agent.name || agent.id} has no integration "${key}". \`three-ws mcp installed --agent ${agent.id.slice(0, 8)}\` lists them.`);
	}
	await requestJson(`${base}/${conn.id}`, { method: 'DELETE', headers });
	if (ctx.flags.json) printJson({ agent: agent.id, removed: conn.id, name: conn.name });
	else line(`${c.green(sym.ok)} Removed ${conn.label} from ${agent.name || agent.id}. Its stored credentials were deleted.`);
	return EXIT_CODES.OK;
}

export async function mcp(ctx) {
	const [sub = 'list', name] = ctx.positionals;
	if (sub === 'list') return listCmd(ctx);
	if (sub === 'add') return addCmd(ctx, name);
	if (sub === 'remove' || sub === 'rm') return removeCmd(ctx, name);
	if (sub === 'install') return installCmd(ctx, name);
	if (sub === 'installed') return installedCmd(ctx);
	if (sub === 'uninstall') return uninstallCmd(ctx, name);
	throw new Error(`unknown mcp subcommand "${sub}". Use list, add, remove, install, installed or uninstall.`);
}
