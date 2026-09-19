// Feature trial for the `assistant` X post (data/x-content/trials/assistant.json).
//
//   node scripts/x-content-trials/assistant.mjs <check>
//
// Checks, each one a reader journey run against production:
//   embed        the one-tag script on a third-party page mounts a launcher; clicking
//                it opens a panel whose frame renders the animated 3D avatar
//   chat-free    chat mode answers a question from the free model lane, grounded in
//                the site context the embed was given
//   chat-groq    chat mode answers through a visitor's own Groq key (browser to Groq)
//   chat-openrouter  the same through a visitor's own OpenRouter key
//   speak        speak mode says exactly what the visitor typed (bubble + speech events)
//   npm          the published @three-ws/assistant package mounts a working widget
//   mcp          the published @three-ws/assistant-mcp server returns a snippet that,
//                pasted into a page, mounts a working widget
//   builder      the /assistant builder's live preview re-mounts as an option changes
//
// BYOK checks need a real provider key. They use GROQ_API_KEY / OPENROUTER_API_KEY
// from the environment, or read the platform's own from the Cloud Run service
// (scripts/read-service-env.mjs); the key is only ever placed in the headless
// browser's storage for the three.ws frame, exactly where a visitor's key lives.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASE, HOST_ORIGIN, fail, hostPage, launch, runCheck, waitFor } from './lib.mjs';

const FACT = 'The Atelier Pro plan costs 41 dollars per month.';

const hostHtml = (scriptTag, body = '') => `<!doctype html><html><head><meta charset="utf-8"><title>Atelier</title></head>
<body><h1>Atelier</h1><p>A design studio for 3D artists.</p>${body}
<script>window.__events=[];window.addEventListener('three-assistant',(e)=>window.__events.push({type:e.detail.type,payload:e.detail.payload}));</script>
${scriptTag}</body></html>`;

const embedTag = (extra = '') =>
	`<script src="${BASE}/assistant/v1.js" async data-name="Atelier AI" data-context="${FACT}" data-voice="false" ${extra}></script>`;

const events = (page) => page.evaluate(() => window.__events);
const frameOf = (page) => waitFor(() => page.frames().find((frame) => frame.url().includes('/assistant-frame')), { timeoutMs: 30_000, what: 'the assistant frame' });

async function waitReady(page) {
	const ready = await waitFor(async () => (await events(page)).find((e) => e.type === 'ready' || e.type === 'error'), { timeoutMs: 90_000, what: 'the widget to report ready' });
	if (ready.type === 'error') throw new Error(`widget reported error: ${JSON.stringify(ready.payload)}`);
	if (ready.payload?.fallback) throw new Error('the frame fell back from the configured avatar');
	return ready;
}

// The avatar is really on screen and animating: two screenshots of the frame's
// canvas, taken 1.5s apart, differ (a WebGL canvas cannot be read back with
// toDataURL, so the compositor's pixels are what is compared).
async function assertAnimatedAvatar(frame) {
	const canvas = frame.locator('#assistant-canvas');
	await canvas.waitFor({ state: 'visible', timeout: 30_000 });
	const first = await canvas.screenshot();
	await new Promise((resolveWait) => setTimeout(resolveWait, 1500));
	const second = await canvas.screenshot();
	if (first.equals(second)) throw new Error('the avatar canvas did not change over 1.5s (not animating)');
	return first.length;
}

async function openEmbed(browser, extra = '') {
	const { page } = await hostPage(browser, hostHtml(embedTag(extra)));
	await page.locator('.three-assistant-launcher').click({ timeout: 30_000 });
	await waitReady(page);
	return { page, frame: await frameOf(page) };
}

async function ask(page, frame, question) {
	const before = (await events(page)).length;
	await frame.locator('#assistant-input').fill(question);
	await frame.locator('#assistant-send').click();
	const reply = await waitFor(
		async () => (await events(page)).slice(before).find((e) => e.type === 'message' && e.payload?.role === 'assistant'),
		{ timeoutMs: 90_000, intervalMs: 1000, what: 'an assistant reply' },
	).catch(async (err) => {
		const bubble = await frame.locator('#assistant-bubble').innerText().catch(() => '');
		throw new Error(`${err.message}; bubble shows "${bubble.slice(0, 200)}"`);
	});
	return reply.payload.content;
}

function providerKey(name) {
	if (process.env[name]) return process.env[name];
	try {
		return execFileSync('node', ['scripts/read-service-env.mjs', `^${name}$`, '--raw'], { encoding: 'utf8' }).trim();
	} catch {
		return '';
	}
}

async function byok(lane, envName) {
	const key = providerKey(envName);
	if (!key) throw new Error(`no ${envName} available to act as a visitor's own ${lane} key`);
	const browser = await launch();
	try {
		const { page, frame } = await openEmbed(browser);
		const providerCalls = [];
		page.on('request', (req) => {
			if (req.url().startsWith(lane === 'groq' ? 'https://api.groq.com/' : 'https://openrouter.ai/')) providerCalls.push(req.url());
		});
		await frame.locator('#assistant-settings-btn').click();
		await frame.locator(`input[name="assistant-lane"][value="${lane}"]`).check();
		await frame.locator('#assistant-byok-key').fill(key);
		await frame.locator('#assistant-settings-close').click();
		const pill = await frame.locator('#assistant-lane-pill').textContent();
		if (!pill.includes(lane)) throw new Error(`lane pill reads "${pill}", not byok:${lane}`);
		const answer = await ask(page, frame, 'How much does the Atelier Pro plan cost per month? Answer in one short sentence.');
		if (!providerCalls.length) throw new Error(`the reply did not come from ${lane} (no request to the provider)`);
		if (!/41/.test(answer)) throw new Error(`the ${lane} reply does not state the plan price: "${answer.slice(0, 200)}"`);
		return `${lane} key answered in-widget: "${answer.slice(0, 120)}"`;
	} finally {
		await browser.close();
	}
}

async function mountFromPackage(browser, moduleSource) {
	const html = hostHtml('<script type="module">import ThreeAssistant from "/assistant.mjs"; ThreeAssistant.init({ name: "Atelier AI", context: "' + FACT + '", voice: false }); ThreeAssistant.open();</script>');
	const context = await browser.newContext();
	await context.route(`${HOST_ORIGIN}/**`, (route) => {
		const isModule = route.request().url().endsWith('/assistant.mjs');
		return route.fulfill({ status: 200, contentType: isModule ? 'text/javascript' : 'text/html; charset=utf-8', body: isModule ? moduleSource : html });
	});
	const page = await context.newPage();
	await page.goto(`${HOST_ORIGIN}/`, { waitUntil: 'domcontentloaded' });
	await waitReady(page);
	return { page, frame: await frameOf(page) };
}

const checks = {
	async embed() {
		const browser = await launch();
		try {
			const { page, frame } = await openEmbed(browser);
			const bytes = await assertAnimatedAvatar(frame);
			const title = await frame.locator('#assistant-title .label').innerText();
			const opened = (await events(page)).some((e) => e.type === 'open');
			if (!opened) throw new Error('the launcher click never opened the panel');
			return `launcher opened the panel on ${HOST_ORIGIN}; frame "${title}" renders an animated avatar (${bytes} byte frame)`;
		} finally {
			await browser.close();
		}
	},

	async 'chat-free'() {
		const browser = await launch();
		try {
			const { page, frame } = await openEmbed(browser);
			const pill = await frame.locator('#assistant-lane-pill').textContent();
			if (pill.trim() !== 'free') throw new Error(`lane pill reads "${pill}", expected the free lane`);
			const answer = await ask(page, frame, 'How much does the Atelier Pro plan cost per month? Answer in one short sentence.');
			if (!/41/.test(answer)) throw new Error(`free-lane reply does not state the plan price: "${answer.slice(0, 200)}"`);
			return `free lane answered: "${answer.slice(0, 120)}"`;
		} finally {
			await browser.close();
		}
	},

	'chat-groq': () => byok('groq', 'GROQ_API_KEY'),
	'chat-openrouter': () => byok('openrouter', 'OPENROUTER_API_KEY'),

	async speak() {
		const browser = await launch();
		try {
			const { page, frame } = await openEmbed(browser);
			const line = 'Welcome to the Atelier spring sale.';
			await frame.locator('#assistant-modes .mode-btn[data-mode="speak"]').click();
			const before = (await events(page)).length;
			await frame.locator('#assistant-input').fill(line);
			await frame.locator('#assistant-send').click();
			const start = await waitFor(async () => (await events(page)).slice(before).find((e) => e.type === 'speak:start'), { timeoutMs: 20_000, what: 'speak:start' });
			if (start.payload?.text !== line) throw new Error(`speak mode said "${start.payload?.text}", not what was typed`);
			const bubble = await frame.locator('#assistant-bubble').innerText();
			if (!bubble.includes(line)) throw new Error(`speech bubble shows "${bubble}"`);
			await waitFor(async () => (await events(page)).slice(before).some((e) => e.type === 'speak:end'), { timeoutMs: 30_000, what: 'speak:end' });
			const asked = (await events(page)).slice(before).some((e) => e.type === 'message' && e.payload?.role === 'assistant');
			if (asked) throw new Error('speak mode sent the line to a model instead of reading it');
			return `speak mode read the typed line verbatim with no model call: "${line}"`;
		} finally {
			await browser.close();
		}
	},

	async npm() {
		const dir = mkdtempSync(join(tmpdir(), 'assistant-npm-'));
		const browser = await launch();
		try {
			const file = execFileSync('npm', ['pack', '@three-ws/assistant@latest', '--pack-destination', dir, '--silent'], { encoding: 'utf8' }).trim().split('\n').pop();
			execFileSync('tar', ['-xzf', join(dir, file), '-C', dir]);
			const pkg = JSON.parse(readFileSync(join(dir, 'package', 'package.json'), 'utf8'));
			const source = readFileSync(join(dir, 'package', pkg.module || pkg.main), 'utf8');
			const { frame } = await mountFromPackage(browser, source);
			await assertAnimatedAvatar(frame);
			return `${pkg.name}@${pkg.version} from the npm registry mounted a widget that rendered the avatar`;
		} finally {
			await browser.close();
			rmSync(dir, { recursive: true, force: true });
		}
	},

	async mcp() {
		const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
		const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
		const transport = new StdioClientTransport({ command: 'npx', args: ['-y', '@three-ws/assistant-mcp@latest'], stderr: 'ignore' });
		const client = new Client({ name: 'x-content-trial', version: '1.0.0' });
		await client.connect(transport);
		let text;
		try {
			const { tools } = await client.listTools();
			if (!tools.some((tool) => tool.name === 'build_assistant_widget')) throw new Error(`no build_assistant_widget tool; got ${tools.map((t) => t.name).join(', ')}`);
			const result = await client.callTool({ name: 'build_assistant_widget', arguments: { name: 'Aria', bg: 'ocean', context: FACT } });
			text = (result.content || []).map((part) => part.text || '').join('\n');
		} finally {
			await client.close();
		}
		const tag = text.match(/<script[^>]*assistant\/v1\.js[^>]*><\/script>/)?.[0];
		if (!tag) throw new Error(`the MCP result has no paste-ready script tag: ${text.slice(0, 300)}`);
		const browser = await launch();
		try {
			const { page } = await hostPage(browser, hostHtml(tag.replace('<script', '<script data-voice="false"')));
			await page.locator('.three-assistant-launcher').click({ timeout: 30_000 });
			await waitReady(page);
			const frame = await frameOf(page);
			const title = await frame.locator('#assistant-title .label').innerText();
			if (!/aria/i.test(title)) throw new Error(`the pasted MCP snippet mounted "${title}", not the configured name`);
			return `@three-ws/assistant-mcp returned a snippet that mounted a working "${title}" widget`;
		} finally {
			await browser.close();
		}
	},

	async builder() {
		const browser = await launch();
		try {
			const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
			await page.goto(`${BASE}/assistant`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
			await page.locator('.three-assistant-launcher').click({ timeout: 45_000 });
			await waitFor(() => page.frames().find((frame) => frame.url().includes('/assistant-frame')), { timeoutMs: 45_000, what: 'the preview frame' });
			await page.locator('#preview-status[data-state="ready"]').waitFor({ timeout: 60_000 });
			await page.locator('#cfg-name').fill('Trial Concierge');
			const frame = await waitFor(() => page.frames().find((f) => f.url().includes('/assistant-frame') && f.url().includes('Trial')), { timeoutMs: 20_000, what: 'the preview to re-mount with the new name' });
			await frame.locator('#assistant-title .label', { hasText: 'Trial Concierge' }).waitFor({ timeout: 45_000 });
			const snippet = await page.locator('#snippet').innerText();
			if (!snippet.includes('Trial Concierge')) throw new Error('the copyable snippet did not pick up the edit');
			return 'editing the name re-mounted the live preview frame with the new name and updated the snippet';
		} finally {
			await browser.close();
		}
	},
};

await runCheck(checks, process.argv[2]).catch((err) => fail(err.message));
