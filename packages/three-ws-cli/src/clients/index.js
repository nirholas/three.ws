// Every MCP client the CLI knows how to configure: where its config lives on
// each OS, how to tell it is installed, and the exact entry shape it reads.
//
// An entry is built from one of two transports:
//   http   { url, headers }            the client talks to the hosted server directly
//   stdio  { command, args, env }      the client launches a local process
// A client that has no remote-server field in its config file (Claude Desktop)
// or whose remote support varies by version (Codex) only gets stdio, and the
// stdio process is the three-ws proxy, which forwards to the hosted server.

import fs from 'node:fs';
import path from 'node:path';
import { appDataDir, systemEnv } from '../paths.js';
import { FORMATS } from './formats.js';

const exists = (p) => {
	try { fs.accessSync(p); return true; } catch { return false; }
};

function stdioJson({ command, args, env }) {
	return { command, args, ...(env && Object.keys(env).length ? { env } : {}) };
}

export const CLIENTS = [
	{
		id: 'claude-code',
		label: 'Claude Code',
		format: 'json',
		rootKey: 'mcpServers',
		configPath: (env, { project } = {}) => (project ? path.join(env.cwd, '.mcp.json') : path.join(env.home, '.claude.json')),
		detect: (env) => exists(path.join(env.home, '.claude.json')) || exists(path.join(env.home, '.claude')),
		http: ({ url, headers }) => ({ type: 'http', url, ...(Object.keys(headers).length ? { headers } : {}) }),
		stdio: (s) => ({ type: 'stdio', ...stdioJson(s) }),
		scopes: ['user', 'project'],
	},
	{
		id: 'claude-desktop',
		label: 'Claude Desktop',
		format: 'json',
		rootKey: 'mcpServers',
		configPath: (env) => path.join(appDataDir(env), 'Claude', 'claude_desktop_config.json'),
		detect: (env) => exists(path.join(appDataDir(env), 'Claude')),
		http: null,
		stdio: stdioJson,
	},
	{
		id: 'cursor',
		label: 'Cursor',
		format: 'json',
		rootKey: 'mcpServers',
		configPath: (env, { project } = {}) => (project ? path.join(env.cwd, '.cursor', 'mcp.json') : path.join(env.home, '.cursor', 'mcp.json')),
		detect: (env) => exists(path.join(env.home, '.cursor')),
		http: ({ url, headers }) => ({ url, ...(Object.keys(headers).length ? { headers } : {}) }),
		stdio: stdioJson,
		scopes: ['user', 'project'],
	},
	{
		id: 'windsurf',
		label: 'Windsurf',
		format: 'json',
		rootKey: 'mcpServers',
		configPath: (env) => path.join(env.home, '.codeium', 'windsurf', 'mcp_config.json'),
		detect: (env) => exists(path.join(env.home, '.codeium', 'windsurf')),
		http: ({ url, headers }) => ({ serverUrl: url, ...(Object.keys(headers).length ? { headers } : {}) }),
		stdio: stdioJson,
	},
	{
		id: 'vscode',
		label: 'VS Code',
		format: 'json',
		rootKey: 'servers',
		configPath: (env, { project } = {}) => (project ? path.join(env.cwd, '.vscode', 'mcp.json') : path.join(appDataDir(env), 'Code', 'User', 'mcp.json')),
		detect: (env) => exists(path.join(appDataDir(env), 'Code', 'User')),
		http: ({ url, headers }) => ({ type: 'http', url, ...(Object.keys(headers).length ? { headers } : {}) }),
		stdio: (s) => ({ type: 'stdio', ...stdioJson(s) }),
		scopes: ['user', 'project'],
	},
	{
		id: 'codex',
		label: 'Codex',
		format: 'toml',
		rootKey: 'mcp_servers',
		configPath: (env) => path.join(env.vars.CODEX_HOME || path.join(env.home, '.codex'), 'config.toml'),
		detect: (env) => exists(env.vars.CODEX_HOME || path.join(env.home, '.codex')),
		http: null,
		stdio: stdioJson,
	},
	{
		id: 'gemini',
		label: 'Gemini CLI',
		format: 'json',
		rootKey: 'mcpServers',
		configPath: (env, { project } = {}) => (project ? path.join(env.cwd, '.gemini', 'settings.json') : path.join(env.home, '.gemini', 'settings.json')),
		detect: (env) => exists(path.join(env.home, '.gemini')),
		http: ({ url, headers, includeTools }) => ({
			httpUrl: url,
			...(Object.keys(headers).length ? { headers } : {}),
			...(includeTools ? { includeTools } : {}),
		}),
		stdio: stdioJson,
		// Gemini CLI enforces an allow list per server on its own side.
		allowList: true,
		scopes: ['user', 'project'],
	},
	{
		id: 'hermes',
		label: 'Hermes',
		format: 'yaml',
		rootKey: 'mcp_servers',
		configPath: (env) => path.join(env.vars.HERMES_HOME || path.join(env.home, '.hermes'), 'config.yaml'),
		detect: (env) => exists(env.vars.HERMES_HOME || path.join(env.home, '.hermes')),
		http: ({ url, headers }) => ({ url, ...(Object.keys(headers).length ? { headers } : {}) }),
		stdio: stdioJson,
	},
];

// Not a real client: the shape `setup` prints for any client it does not know.
export const PRINT_CLIENT = {
	id: 'print',
	label: 'Any MCP client',
	http: ({ url, headers }) => ({ type: 'http', url, ...(Object.keys(headers).length ? { headers } : {}) }),
	stdio: stdioJson,
};

export function getClient(id) {
	const c = CLIENTS.find((x) => x.id === id);
	if (!c) throw new Error(`unknown client "${id}". Known: ${CLIENTS.map((x) => x.id).join(', ')}`);
	return c;
}

export function detectClients(env = systemEnv()) {
	return CLIENTS.filter((c) => c.detect(env));
}

export function readServers(client, env = systemEnv(), opts = {}) {
	return FORMATS[client.format].read(client.configPath(env, opts), client.rootKey);
}

export function writeServer(client, name, entry, env = systemEnv(), opts = {}) {
	const file = client.configPath(env, opts);
	FORMATS[client.format].set(file, client.rootKey, name, entry);
	return file;
}

export function removeServer(client, name, env = systemEnv(), opts = {}) {
	return FORMATS[client.format].remove(client.configPath(env, opts), client.rootKey, name);
}
