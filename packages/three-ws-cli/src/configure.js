// The work `setup` and `mcp add` share: run a real tools/list against each
// server with the stored credential, then write the entries into each client.

import { listTools } from './mcp-http.js';
import { bearerFor } from './oauth.js';
import { readStore, updateStore } from './store.js';
import { systemEnv } from './paths.js';
import { buildEntry, buildPackageEntry } from './entries.js';
import { writeServer } from './clients/index.js';
import { filterTools, groupByTier, normalizeSelection, defaultSelection } from './policy.js';

/** tools/list per server. Never throws; each result carries its own error. */
export async function verifyServers({ servers, env = systemEnv(), origin }) {
	const store = readStore(env);
	let bearer = null;
	let bearerError = null;
	try {
		bearer = await bearerFor(env, { origin });
	} catch (err) {
		bearerError = err.message;
	}
	return Promise.all(servers.map(async (server) => {
		const selection = normalizeSelection(store.tools?.[server.slug]);
		if (server.auth === 'required' && bearerError) return { server, ok: false, error: bearerError };
		try {
			const { tools } = await listTools(server.url, { bearer: server.auth === 'required' ? bearer : null });
			const enabled = filterTools(tools, selection);
			const byTier = groupByTier(tools);
			const hidden = tools.length - enabled.length;
			return { server, ok: true, tools, total: tools.length, enabled: enabled.length, hidden, financial: byTier.financial.length };
		} catch (err) {
			return { server, ok: false, error: err.message };
		}
	}));
}

/** Give every server a stored selection, keeping any the person already chose. */
export function ensureSelections(servers, { financial = false, env = systemEnv() } = {}) {
	return updateStore((store) => {
		store.tools = store.tools || {};
		for (const s of servers) {
			if (store.tools[s.slug]) continue;
			const sel = defaultSelection();
			if (financial) sel.tiers.push('financial');
			store.tools[s.slug] = sel;
		}
		return store;
	}, env);
}

/**
 * Write each server (and stdio package) into each client. Returns one result
 * per client: { client, file, servers: [slug], error }.
 */
export function applyToClients({ clients, servers, packages = [], mode, apiKey = null, stdioKey = null, liveTools = {}, forceProxy = false, project = false, origin, env = systemEnv() }) {
	const store = readStore(env);
	return clients.map((client) => {
		const written = [];
		let file = null;
		try {
			const opts = { project: project && client.scopes?.includes('project') };
			for (const server of servers) {
				const entry = buildEntry({
					client,
					server,
					mode,
					apiKey,
					selection: store.tools?.[server.slug] || null,
					liveTools: liveTools[server.slug] || null,
					forceProxy,
				});
				file = writeServer(client, server.slug, entry, env, opts);
				written.push(server.slug);
			}
			for (const pkg of packages) {
				const entry = buildPackageEntry({ client, pkg, apiKey: pkg.auth === 'key' ? stdioKey : null, origin });
				file = writeServer(client, pkg.slug, entry, env, opts);
				written.push(pkg.slug);
			}
			return { client, file, servers: written, error: null };
		} catch (err) {
			return { client, file, servers: written, error: err.message };
		}
	});
}
