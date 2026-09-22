// Where the CLI keeps its own state, and where every supported MCP client keeps
// its config. Each resolver takes an explicit `env` (home, platform, env vars)
// so tests exercise the real resolution logic against a temporary home.

import os from 'node:os';
import path from 'node:path';

/** The resolution context: override any field in tests. */
export function systemEnv(overrides = {}) {
	return {
		home: os.homedir(),
		platform: process.platform,
		cwd: process.cwd(),
		vars: process.env,
		...overrides,
	};
}

/** `$XDG_CONFIG_HOME/three-ws`, else `~/.config/three-ws` (all platforms, one place to look). */
export function configDir(env = systemEnv()) {
	const xdg = env.vars.XDG_CONFIG_HOME;
	return path.join(xdg && path.isAbsolute(xdg) ? xdg : path.join(env.home, '.config'), 'three-ws');
}

export function credentialsPath(env = systemEnv()) {
	return env.vars.THREE_WS_CREDENTIALS || path.join(configDir(env), 'credentials.json');
}

// The per-user application data root on each OS, where desktop apps (Claude
// Desktop, VS Code) keep their settings.
export function appDataDir(env = systemEnv()) {
	if (env.platform === 'darwin') return path.join(env.home, 'Library', 'Application Support');
	if (env.platform === 'win32') return env.vars.APPDATA || path.join(env.home, 'AppData', 'Roaming');
	const xdg = env.vars.XDG_CONFIG_HOME;
	return xdg && path.isAbsolute(xdg) ? xdg : path.join(env.home, '.config');
}
