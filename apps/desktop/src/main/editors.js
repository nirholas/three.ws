// "Connect your editor": writes the three.ws hosted MCP servers into every
// coding client on this machine, in each client's own config format.
//
// No credential is ever written. Each client runs the MCP OAuth flow itself
// the first time it calls a server (the 401 from /api/mcp points it at
// /.well-known/oauth-protected-resource), so the person approves each editor
// by name on the three.ws consent screen and can revoke it from
// /dashboard/settings#connected-apps without touching this app's own session.
//
// Clients that speak Streamable HTTP get the URL directly. The ones whose
// config only launches a local process (Claude Desktop, Codex) get the
// `mcp-remote` stdio bridge, which does the same OAuth dance.
//
// Electron-free: `home`, `platform`, `env` and the fs are injected so the
// tests can run every client format against a temp directory.

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, renameSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';

export function mcpServers(apiBase = 'https://three.ws') {
	return [
		{ key: 'three-ws', name: 'three.ws', url: `${apiBase}/api/mcp`, auth: 'oauth', about: 'Avatars, agents, memory and glTF tools' },
		{ key: 'three-ws-agent', name: 'Agent wallet', url: `${apiBase}/api/mcp-agent`, auth: 'oauth', about: 'Your agent wallet: balances, services, payments' },
		{ key: 'three-ws-3d', name: '3D Studio', url: `${apiBase}/api/mcp-3d`, auth: 'oauth', about: 'Text and image to 3D, rigging, optimization' },
		{ key: 'three-ws-studio', name: '3D Studio (free)', url: `${apiBase}/api/mcp-studio`, auth: 'none', about: 'Free text to 3D and rigged avatars, no sign-in' },
	];
}

const remoteBridge = (url) => ({ command: 'npx', args: ['-y', 'mcp-remote', url] });

function appData({ home, platform, env }) {
	if (platform === 'darwin') return join(home, 'Library', 'Application Support');
	if (platform === 'win32') return env.APPDATA || join(home, 'AppData', 'Roaming');
	return env.XDG_CONFIG_HOME || join(home, '.config');
}

// Each client: where its config lives, how to tell it is installed, and how to
// write (and remove) one server entry in its format.
export function editorClients(ctx) {
	const { home } = ctx;
	const ad = appData(ctx);
	const jsonMap = (file, rootKey, entryFor) => ({ file, format: 'json', rootKey, entryFor });
	return [
		{
			id: 'claude-code',
			name: 'Claude Code',
			detect: [join(home, '.claude.json'), join(home, '.claude')],
			...jsonMap(join(home, '.claude.json'), 'mcpServers', (s) => ({ type: 'http', url: s.url })),
		},
		{
			id: 'claude-desktop',
			name: 'Claude Desktop',
			detect: [join(ad, 'Claude')],
			...jsonMap(join(ad, 'Claude', 'claude_desktop_config.json'), 'mcpServers', (s) => remoteBridge(s.url)),
		},
		{
			id: 'cursor',
			name: 'Cursor',
			detect: [join(home, '.cursor')],
			...jsonMap(join(home, '.cursor', 'mcp.json'), 'mcpServers', (s) => ({ url: s.url })),
		},
		{
			id: 'windsurf',
			name: 'Windsurf',
			detect: [join(home, '.codeium', 'windsurf')],
			...jsonMap(join(home, '.codeium', 'windsurf', 'mcp_config.json'), 'mcpServers', (s) => ({ serverUrl: s.url })),
		},
		{
			id: 'vscode',
			name: 'VS Code',
			detect: [join(ad, 'Code', 'User')],
			...jsonMap(join(ad, 'Code', 'User', 'mcp.json'), 'servers', (s) => ({ type: 'http', url: s.url })),
		},
		{
			id: 'gemini',
			name: 'Gemini CLI',
			detect: [join(home, '.gemini')],
			...jsonMap(join(home, '.gemini', 'settings.json'), 'mcpServers', (s) => ({ httpUrl: s.url })),
		},
		{
			id: 'codex',
			name: 'Codex',
			detect: [join(home, '.codex')],
			file: join(home, '.codex', 'config.toml'),
			format: 'toml',
			rootKey: 'mcp_servers',
			entryFor: (s) => remoteBridge(s.url),
		},
	];
}

function readConfig(client) {
	if (!existsSync(client.file)) return {};
	const raw = readFileSync(client.file, 'utf8');
	if (!raw.trim()) return {};
	try {
		return client.format === 'toml' ? parseToml(raw) : JSON.parse(raw);
	} catch (err) {
		const e = new Error(`${client.name}'s config at ${client.file} is not valid ${client.format.toUpperCase()}, so it was left untouched. Fix it and try again. (${err.message})`);
		e.code = 'invalid_config';
		throw e;
	}
}

function writeConfig(client, data) {
	mkdirSync(dirname(client.file), { recursive: true });
	// One backup, taken the first time this app edits the file, so the
	// person's original is always recoverable.
	const backup = `${client.file}.three-ws.bak`;
	if (existsSync(client.file) && !existsSync(backup)) copyFileSync(client.file, backup);
	const text = client.format === 'toml' ? `${stringifyToml(data)}\n` : `${JSON.stringify(data, null, 2)}\n`;
	let mode;
	try {
		mode = statSync(client.file).mode & 0o777;
	} catch {
		mode = 0o600;
	}
	const tmp = `${client.file}.${process.pid}.tmp`;
	writeFileSync(tmp, text, { mode });
	renameSync(tmp, client.file);
}

function installed(client) {
	return client.detect.some((p) => existsSync(p));
}

export function detectEditors(ctx, apiBase) {
	const servers = mcpServers(apiBase);
	return editorClients(ctx).map((client) => {
		let configured = [];
		let error = null;
		try {
			const root = readConfig(client)[client.rootKey] || {};
			configured = servers.filter((s) => root[s.key]).map((s) => s.key);
		} catch (err) {
			error = err.message;
		}
		return {
			id: client.id,
			name: client.name,
			installed: installed(client),
			configPath: client.file,
			configured,
			total: servers.length,
			error,
		};
	});
}

// Claude Code rewrites ~/.claude.json constantly while it runs, so when its
// CLI is on the PATH (`ctx.claudeCli` runs it) the entry goes in through
// `claude mcp add`, which owns that file. Editing the file is the fallback.
async function connectViaClaudeCli(ctx, client, servers) {
	for (const s of servers) {
		await ctx.claudeCli(['mcp', 'remove', '--scope', 'user', s.key]).catch(() => {});
		await ctx.claudeCli(['mcp', 'add', '--transport', 'http', '--scope', 'user', s.key, s.url]);
	}
	return { id: client.id, name: client.name, configPath: client.file, added: servers.map((s) => s.key), via: 'claude mcp add' };
}

export async function connectEditor(ctx, clientId, apiBase, serverKeys) {
	const client = editorClients(ctx).find((c) => c.id === clientId);
	if (!client) throw new Error(`Unknown client: ${clientId}`);
	const servers = mcpServers(apiBase).filter((s) => !serverKeys || serverKeys.includes(s.key));
	if (client.id === 'claude-code' && ctx.claudeCli) {
		try {
			return await connectViaClaudeCli(ctx, client, servers);
		} catch {
			// The CLI is missing or refused; the file write below is equivalent.
		}
	}
	const data = readConfig(client);
	const root = { ...(data[client.rootKey] || {}) };
	for (const s of servers) root[s.key] = client.entryFor(s);
	writeConfig(client, { ...data, [client.rootKey]: root });
	return { id: client.id, name: client.name, configPath: client.file, added: servers.map((s) => s.key) };
}

export async function disconnectEditor(ctx, clientId, apiBase) {
	const client = editorClients(ctx).find((c) => c.id === clientId);
	if (!client) throw new Error(`Unknown client: ${clientId}`);
	if (client.id === 'claude-code' && ctx.claudeCli) {
		try {
			const removed = [];
			for (const s of mcpServers(apiBase)) {
				await ctx.claudeCli(['mcp', 'remove', '--scope', 'user', s.key]).then(() => removed.push(s.key), () => {});
			}
			if (removed.length) return { id: client.id, name: client.name, removed, via: 'claude mcp remove' };
		} catch {
			// Fall through to the file edit.
		}
	}
	if (!existsSync(client.file)) return { id: client.id, removed: [] };
	const data = readConfig(client);
	const root = { ...(data[client.rootKey] || {}) };
	const removed = [];
	for (const s of mcpServers(apiBase)) {
		if (root[s.key]) {
			delete root[s.key];
			removed.push(s.key);
		}
	}
	if (removed.length) writeConfig(client, { ...data, [client.rootKey]: root });
	return { id: client.id, name: client.name, removed };
}
