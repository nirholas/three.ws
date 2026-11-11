// Capture the README screenshots from a real VS Code running this extension.
//
//   npm run screenshots            (needs a display; on Linux it wraps itself in xvfb-run)
//
// Launches the VS Code build @vscode/test-electron downloaded into .vscode-test/
// (run `npm run test:vscode` once first) with this folder as the extension under
// development, and drives the real workbench with Playwright's Electron
// launcher. Nothing is staged or composited: each PNG is the editor as it drew.
//
// Without a Copilot sign-in VS Code answers every chat turn with "Language
// model unavailable", so the screenshots that need a model reply (an @threews
// /forge turn, agent mode calling a tool) are taken by a signed-in human; see
// PUBLISHING.md. With THREEWS_SIGNED_IN_PROFILE pointing at a signed-in VS Code
// user-data folder this script captures those too.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'images');

if (process.platform === 'linux' && !process.env.DISPLAY) {
	const run = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1440x900x24', process.execPath, fileURLToPath(import.meta.url)], { stdio: 'inherit' });
	process.exit(run.status ?? 1);
}

const require = createRequire(join(root, '..', '..', 'package.json'));
const { _electron } = require('playwright-core');

const cache = join(root, '.vscode-test');
const build = existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith('vscode-')).sort().pop() : null;
if (!build) {
	console.error('No VS Code build in .vscode-test/. Run `npm run test:vscode` once to download it.');
	process.exit(1);
}
const executablePath = join(cache, build, process.platform === 'darwin' ? 'Visual Studio Code.app/Contents/MacOS/Electron' : 'code');

// The window title shows the folder name, so give the demo workspace a real one.
const workspace = join(mkdtempSync(join(tmpdir(), 'threews-')), 'my-site');
mkdirSync(workspace);
writeFileSync(join(workspace, 'index.html'), '<!doctype html>\n<html lang="en">\n<head>\n\t<title>My site</title>\n</head>\n<body>\n\t<h1>Welcome</h1>\n\n</body>\n</html>\n');
// IPC socket paths are capped near 107 characters, so keep the profile path short.
const userData = process.env.THREEWS_SIGNED_IN_PROFILE || mkdtempSync('/tmp/vsud-');

delete process.env.ELECTRON_RUN_AS_NODE;
mkdirSync(out, { recursive: true });

const app = await _electron.launch({
	executablePath,
	args: [workspace, `--extensionDevelopmentPath=${root}`, `--user-data-dir=${userData}`, '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--no-sandbox'],
	timeout: 120_000,
});
const win = await app.firstWindow();
await win.waitForSelector('.monaco-workbench', { timeout: 120_000 });
await win.waitForTimeout(5000);

const shot = async (name) => {
	await win.screenshot({ path: join(out, name) });
	console.log(`images/${name}`);
};
const palette = async (command) => {
	await win.keyboard.press('Control+Shift+KeyP');
	await win.waitForTimeout(500);
	await win.keyboard.type(command);
	await win.waitForTimeout(800);
	await win.keyboard.press('Enter');
	await win.waitForTimeout(2500);
};

const clearToasts = () => palette('Notifications: Clear All Notifications');

try {
	await clearToasts();
	// The participant and its slash commands in the chat input.
	await palette('Chat: Open Chat');
	const input = win.locator('.interactive-input-editor .monaco-editor').first();
	await input.click();
	await win.keyboard.type('@threews /');
	await win.waitForTimeout(1500);
	await shot('copilot-chat-commands.png');
	await win.keyboard.press('Escape');
	await win.keyboard.press('Control+KeyA');
	await win.keyboard.press('Backspace');

	await clearToasts();
	// The three.ws tools and MCP server in agent mode's tool picker.
	await win.locator('.chat-input-toolbars a[aria-label*="Configure Tools"], .chat-input-toolbars .codicon-tools, .chat-input-toolbars .codicon-settings').first().click();
	await win.waitForTimeout(1500);
	await win.keyboard.type('three.ws');
	await win.waitForTimeout(1500);
	await shot('copilot-agent-tools.png');
	await win.keyboard.press('Escape');

	// The MCP servers the provider registered.
	await palette('MCP: List Servers');
	await win.waitForTimeout(1500);
	await shot('copilot-mcp-servers.png');
	await win.keyboard.press('Escape');

	if (process.env.THREEWS_SIGNED_IN_PROFILE) {
		await input.click();
		await win.keyboard.type('@threews /forge a low-poly brass lantern with amber glass');
		await win.keyboard.press('Enter');
		await win.waitForSelector('.chat-response-button, .monaco-button:has-text("Save GLB to workspace")', { timeout: 12 * 60_000 });
		await win.waitForTimeout(1500);
		await shot('copilot-forge.png');
	}
} finally {
	await app.close();
}
