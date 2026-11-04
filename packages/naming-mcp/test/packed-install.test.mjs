// Proves the published tarball installs and runs outside this monorepo.
//
// naming-mcp once declared `"@three-ws/tool-sdk": "file:../tool-sdk"`, a private
// package npm cannot resolve for an outside consumer, so the next publish would
// have shipped an uninstallable package while every in-repo test stayed green.
// This test does what a consumer does: `npm pack`, install the tarball into an
// empty directory with no workspace in sight, spawn the installed bin over stdio
// and list its tools through the MCP client SDK it installed alongside.
//
// It needs the npm registry (or a warm npm cache) for the two runtime
// dependencies. It makes no call to the three.ws API: listing tools is local.
//
// Run: node --test packages/naming-mcp/test/packed-install.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

test('the packed tarball installs with no workspace and serves its tools over stdio', { timeout: 300_000 }, async () => {
	const work = mkdtempSync(path.join(tmpdir(), 'naming-mcp-packed-'));
	try {
		const packOut = execFileSync(NPM, ['pack', '--json', '--pack-destination', work], {
			cwd: PKG_DIR,
			encoding: 'utf8',
		});
		const [packed] = JSON.parse(packOut);
		const tarball = path.join(work, packed.filename);
		assert.ok(existsSync(tarball), 'npm pack produced no tarball');

		const shipped = packed.files.map((f) => f.path);
		assert.ok(shipped.includes('src/vendor/tool-sdk/index.js'), 'the vendored tool-sdk must ship in the tarball');
		assert.ok(!shipped.some((f) => f.startsWith('scripts/')), 'the vendor script is repo tooling and must not ship');

		const consumer = path.join(work, 'consumer');
		mkdirSync(consumer);
		writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module' }));
		execFileSync(NPM, ['install', '--no-workspaces', '--no-audit', '--no-fund', '--prefer-offline', tarball], {
			cwd: consumer,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		const installed = path.join(consumer, 'node_modules/@three-ws/naming-mcp');
		const manifest = JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8'));
		for (const [name, spec] of Object.entries(manifest.dependencies || {})) {
			assert.doesNotMatch(String(spec), /^(file:|link:|workspace:)/, `${name} resolves outside the registry`);
		}
		assert.ok(!existsSync(path.join(consumer, 'node_modules/@three-ws/tool-sdk')), 'tool-sdk must not be needed');

		const sdk = path.join(consumer, 'node_modules/@modelcontextprotocol/sdk/dist/esm');
		const { Client } = await import(pathToFileURL(path.join(sdk, 'client/index.js')).href);
		const { StdioClientTransport } = await import(pathToFileURL(path.join(sdk, 'client/stdio.js')).href);

		const transport = new StdioClientTransport({
			command: process.execPath,
			args: [path.join(installed, manifest.bin['naming-mcp'])],
			cwd: consumer,
			stderr: 'pipe',
		});
		const client = new Client({ name: 'packed-install-test', version: '1.0.0' });
		await client.connect(transport);
		try {
			const { tools } = await client.listTools();
			assert.deepEqual(tools.map((t) => t.name).sort(), ['sns_resolve', 'sns_reverse', 'threews_availability']);
			const resolve = tools.find((t) => t.name === 'sns_resolve');
			assert.equal(resolve.annotations.readOnlyHint, true);
			assert.ok(resolve.inputSchema.properties.name, 'sns_resolve keeps its required name input');
		} finally {
			await client.close();
		}
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
});
