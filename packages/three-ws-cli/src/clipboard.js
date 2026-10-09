// Copy text to the system clipboard with the OS's own tool. No dependency:
// `pbcopy` on macOS, `clip` on Windows, then wl-copy, xclip, xsel and WSL's
// clip.exe on Linux. Best-effort by design: returns the tool that took the
// text, or null (never throws) when none exists, e.g. over SSH or in CI, and
// the caller has already printed the text anyway.

import { spawnSync } from 'node:child_process';

export function clipboardCommands({ platform = process.platform, env = process.env } = {}) {
	if (platform === 'darwin') return [['pbcopy', []]];
	if (platform === 'win32') return [['clip', []]];
	const cmds = [];
	if (env.WAYLAND_DISPLAY) cmds.push(['wl-copy', []]);
	if (env.DISPLAY) cmds.push(['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']]);
	// WSL: the Windows clipboard is reachable with no display at all.
	if (env.WSL_DISTRO_NAME) cmds.push(['clip.exe', []]);
	return cmds;
}

export function copyToClipboard(text, { platform = process.platform, env = process.env, run = spawnSync } = {}) {
	if (env.THREE_WS_NO_CLIPBOARD === '1') return null;
	for (const [cmd, args] of clipboardCommands({ platform, env })) {
		try {
			const res = run(cmd, args, { input: String(text), stdio: ['pipe', 'ignore', 'ignore'], timeout: 3000 });
			if (!res.error && res.status === 0) return cmd;
		} catch {
			// A missing tool is the normal case on most machines; try the next one.
		}
	}
	return null;
}
