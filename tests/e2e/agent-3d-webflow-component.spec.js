import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Work order 094: proves integrations/webflow/src/Agent3DView.tsx (the
// Webflow-free component Agent3D.webflow.tsx wraps with declareComponent)
// actually renders a live <agent-3d> in a real browser. "@webflow/react" and
// "@webflow/data-types" only resolve inside Webflow's own devlink
// bundler/runtime, so this can't go through Webflow directly;
// Agent3DView.tsx has no Webflow import, so it mounts here with plain
// ReactDOM instead. `npx webflow devlink bundle --no-input` (run separately,
// documented in integrations/webflow/README.md) proves the real declareComponent
// wrapper itself compiles with the real Webflow CLI, no account needed.
//
// This package's own vite.config.mjs (not the repo root's, which sets a
// static-site "vhtml" JSX factory) runs a standalone dev server for
// integrations/webflow/harness/index.html. The harness loads the real pinned
// agent-3d CDN release from data/agent-3d-releases.json and a real
// production avatar GLB: no mocks, no interception.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEBFLOW_DIR = path.join(HERE, '..', '..', 'integrations', 'webflow');
const PORT = 3172;
const ORIGIN = `http://localhost:${PORT}`;

function spawnHarnessServer() {
	const child = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
		cwd: WEBFLOW_DIR,
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	let log = '';
	child.stdout.on('data', (d) => (log += d.toString()));
	child.stderr.on('data', (d) => (log += d.toString()));
	return { child, getLog: () => log };
}

async function waitForServer(url, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(url);
			if (res.ok) return;
		} catch {
			// not up yet
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`harness dev server never came up at ${url}`);
}

test.describe('agent-3d Webflow Code Component (real pinned CDN release)', () => {
	test.setTimeout(60_000);

	test('Agent3DView mounts a live, rendering <agent-3d> with the pinned release', async ({ page }) => {
		const server = spawnHarnessServer();
		try {
			await waitForServer(`${ORIGIN}/harness/index.html`, 30_000);

			const errors = [];
			page.on('pageerror', (err) => errors.push(String(err?.message || err)));

			await page.goto(`${ORIGIN}/harness/index.html`, { waitUntil: 'domcontentloaded' });

			await expect(page.locator('agent-3d')).toBeAttached();
			await expect(page.locator('agent-3d')).toHaveAttribute('body', 'https://three.ws/avatars/default.glb');
			await expect(page.locator('agent-3d')).toHaveAttribute('background', 'dark');

			// It really boots against the pinned CDN script: a WebGL canvas
			// renders inside the element's shadow DOM.
			await expect
				.poll(() => page.evaluate(() => document.querySelector('agent-3d')?.shadowRoot?.querySelector('canvas')))
				.toBeTruthy();

			expect(errors, `page errors: ${errors.join(' | ')}\nvite log:\n${server.getLog()}`).toEqual([]);
		} finally {
			server.child.kill('SIGTERM');
		}
	});
});
