// Open a URL in the user's default browser with the OS's own launcher. No
// dependency: `open` on macOS, `xdg-open` on Linux, `start` via cmd on Windows.
// Returns false (never throws) when no launcher exists, e.g. over SSH, so the
// caller prints the URL instead.

import { spawn } from 'node:child_process';

export function openBrowser(url, { platform = process.platform, env = process.env } = {}) {
	if (env.THREE_WS_NO_BROWSER === '1') return Promise.resolve(false);
	// A remote shell has no display to open anything on.
	if (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY && !env.BROWSER) return Promise.resolve(false);
	const [cmd, args] =
		platform === 'darwin' ? ['open', [url]]
		: platform === 'win32' ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]]
		: [env.BROWSER || 'xdg-open', [url]];
	return new Promise((resolve) => {
		let child;
		try {
			child = spawn(cmd, args, { stdio: 'ignore', detached: true });
		} catch {
			return resolve(false);
		}
		child.once('error', () => resolve(false));
		child.once('spawn', () => {
			child.unref();
			resolve(true);
		});
	});
}
