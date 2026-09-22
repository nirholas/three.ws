// Where the local agent keeps its files. Every resolver takes an explicit `env`
// (home, platform, env vars) so tests exercise the real logic against a
// temporary home instead of the developer's own.
//
//   config   ~/.config/three-ws/agent.json       (shared dir with the three-ws CLI)
//   creds    ~/.config/three-ws/credentials.json (written by `three-ws login` or `three-ws-agent login`)
//   data     ~/.local/share/three-ws/agent/      (sessions database, scheduler log)
//            %LOCALAPPDATA%\three-ws\agent on Windows

import os from 'node:os';
import path from 'node:path';

export function systemEnv(overrides = {}) {
	return {
		home: os.homedir(),
		platform: process.platform,
		cwd: process.cwd(),
		vars: process.env,
		...overrides,
	};
}

function absOr(value, fallback) {
	return value && path.isAbsolute(value) ? value : fallback;
}

/** `$XDG_CONFIG_HOME/three-ws`, else `~/.config/three-ws`: the same place the three-ws CLI uses. */
export function configDir(env = systemEnv()) {
	return path.join(absOr(env.vars.XDG_CONFIG_HOME, path.join(env.home, '.config')), 'three-ws');
}

export function configPath(env = systemEnv()) {
	return env.vars.THREE_WS_AGENT_CONFIG || path.join(configDir(env), 'agent.json');
}

export function credentialsPath(env = systemEnv()) {
	return env.vars.THREE_WS_CREDENTIALS || path.join(configDir(env), 'credentials.json');
}

/** Sessions, cron state and logs. `THREE_WS_AGENT_HOME` overrides everything (Docker, tests). */
export function dataDir(env = systemEnv()) {
	if (env.vars.THREE_WS_AGENT_HOME) return env.vars.THREE_WS_AGENT_HOME;
	if (env.platform === 'win32') {
		return path.join(env.vars.LOCALAPPDATA || path.join(env.home, 'AppData', 'Local'), 'three-ws', 'agent');
	}
	return path.join(absOr(env.vars.XDG_DATA_HOME, path.join(env.home, '.local', 'share')), 'three-ws', 'agent');
}

export function databasePath(env = systemEnv()) {
	return path.join(dataDir(env), 'agent.db');
}
