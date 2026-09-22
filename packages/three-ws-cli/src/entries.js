// Build the config entry one client gets for one server.
//
// Direct HTTP when the client supports remote servers in its config AND the
// credential is static (an API key, or a keyless server). Everything else goes
// through `three-ws proxy`, a stdio process that forwards to the hosted server:
//   - OAuth access tokens live an hour; the proxy refreshes them from the
//     credential store, so a client config never holds a token that dies.
//   - Clients with stdio-only configs (Claude Desktop, Codex) reach remote
//     servers this way.
//   - `--proxy` forces it everywhere, which also enforces the tool picker
//     locally for every client.

import { fileURLToPath } from 'node:url';
import { DEFAULT_ORIGIN } from './store.js';
import { TOOLS_HEADER, isDefaultSelection, headerValue, filterTools } from './policy.js';

/** How to launch this same CLI later, from inside a client. */
export function proxyInvocation({ platform = process.platform, cliPath = fileURLToPath(new URL('./cli.js', import.meta.url)), nodePath = process.execPath } = {}) {
	// Run from the npm cache or an install: every launch resolves the published
	// package. Run from a source checkout: pin this checkout, so a developer
	// testing unreleased changes gets exactly them.
	if (/[\\/](_npx|node_modules)[\\/]/.test(cliPath)) return npxInvocation(['three-ws'], platform);
	return { command: nodePath, args: [cliPath] };
}

// Windows resolves `npx` to npx.cmd, which child_process cannot spawn without a
// shell, and several clients spawn without one. `cmd /c` is the portable form.
export function npxInvocation(pkgArgs, platform = process.platform) {
	return platform === 'win32'
		? { command: 'cmd', args: ['/c', 'npx', '-y', ...pkgArgs] }
		: { command: 'npx', args: ['-y', ...pkgArgs] };
}

export function usesProxy({ client, server, mode, forceProxy = false }) {
	if (forceProxy || !client.http) return true;
	return server.auth === 'required' && mode !== 'apikey';
}

export function buildEntry({ client, server, mode, apiKey = null, selection = null, liveTools = null, forceProxy = false, proxy = proxyInvocation() }) {
	const needsAuth = server.auth === 'required';
	if (needsAuth && mode === 'apikey' && !apiKey) throw new Error(`an API key is required to configure ${server.slug}`);

	if (!usesProxy({ client, server, mode, forceProxy })) {
		const headers = {};
		if (needsAuth) headers.Authorization = `Bearer ${apiKey}`;
		let includeTools;
		if (liveTools && selection && !isDefaultSelection(selection)) {
			headers[TOOLS_HEADER] = headerValue(liveTools, selection);
			if (client.allowList) includeTools = filterTools(liveTools, selection).map((t) => t.name).sort();
		}
		return client.http({ url: server.url, headers, includeTools });
	}

	const env = {};
	if (needsAuth && mode === 'apikey') env.THREE_WS_API_KEY = apiKey;
	return client.stdio({
		command: proxy.command,
		args: [...proxy.args, 'proxy', server.url, '--server', server.slug],
		env,
	});
}

/** A stdio @three-ws/*-mcp package: launched with npx, the key in its env block. */
export function buildPackageEntry({ client, pkg, apiKey, origin = DEFAULT_ORIGIN, platform = process.platform }) {
	const run = npxInvocation([pkg.package], platform);
	const env = {};
	if (apiKey) env.THREE_WS_API_KEY = apiKey;
	if (origin !== DEFAULT_ORIGIN) env.THREE_WS_BASE = origin;
	return client.stdio({ ...run, env });
}
