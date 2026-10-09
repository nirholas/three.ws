// Best-effort copy to the system clipboard. Returns the tool that took the text,
// or null when none is available (a headless box, an SSH session): callers print
// the text either way, so a missing clipboard is never an error.

import { spawnSync } from 'node:child_process';

const TOOLS = {
	darwin: [['pbcopy', []]],
	win32: [['clip', []]],
	linux: [
		['wl-copy', []],
		['xclip', ['-selection', 'clipboard']],
		['xsel', ['--clipboard', '--input']],
	],
};

export function copyText(text, { platform = process.platform, run = spawnSync } = {}) {
	for (const [cmd, args] of TOOLS[platform] || TOOLS.linux) {
		const res = run(cmd, args, { input: String(text), stdio: ['pipe', 'ignore', 'ignore'], timeout: 3000 });
		if (!res.error && res.status === 0) return cmd;
	}
	return null;
}
