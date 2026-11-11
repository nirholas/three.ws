// Runs the extension inside a real VS Code extension host (downloaded by
// @vscode/test-electron) and checks the Copilot surface there: the five
// language model tools are visible to vscode.lm with their schemas, the
// read-only catalog tool runs through vscode.lm.invokeTool against the live
// studio, and the sign-in commands exist. Linux CI without a display: wrap in
// xvfb-run (npm run test:vscode does).

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';

const root = fileURLToPath(new URL('../..', import.meta.url));
const workspace = mkdtempSync(join(tmpdir(), 'threews-vscode-'));
writeFileSync(join(workspace, 'index.html'), '<!doctype html>\n<title>three.ws host test</title>\n');

try {
	await runTests({
		version: process.env.VSCODE_TEST_VERSION || 'stable',
		extensionDevelopmentPath: root,
		extensionTestsPath: join(root, 'test', 'electron', 'suite.cjs'),
		launchArgs: [workspace, '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
		extensionTestsEnv: { THREEWS_ORIGIN: process.env.THREEWS_ORIGIN || 'https://three.ws' },
	});
} catch (err) {
	console.error(`VS Code host tests failed: ${err?.message || err}`);
	process.exit(1);
}
