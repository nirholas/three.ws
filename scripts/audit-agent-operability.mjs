#!/usr/bin/env node
/**
 * Computer-use operability audit (x-grok 18).
 *
 * Grok Bot, and any other computer-use agent, drives a page the same way a
 * screen-reader user does: it enumerates the accessibility tree and acts on
 * roles and labels, never CSS selectors, hover reveals, or raw coordinates.
 * This script drives the primary task on five real surfaces that way, using
 * only Playwright's getByRole()/getByLabel() locators, and records any step
 * that needed something else, or that sat on a long wait with no visible
 * status text to read.
 *
 * Surfaces: /create -> /create/prompt, /forge, /connect, an agent profile
 * chat, and /launch (read-only: it reaches the signing confirmation and
 * stops, exactly like a person who closes the tab before approving a spend).
 *
 * Usage:
 *   BASE_URL=http://localhost:3107 node scripts/audit-agent-operability.mjs
 *   node scripts/audit-agent-operability.mjs --out prompts/x-grok/_generated/operability.json
 *
 * Needs a signed-in session for avatar-limited parts of /create and for
 * /launch's agent list:
 *   BASE_URL=http://localhost:3107 npm run audit:web:login
 *
 * A browser logs "Failed to load resource: ... 503" for ANY non-2xx HTTP
 * response, regardless of how gracefully the page's own JS handles it; that
 * is intrinsic browser behaviour, not a page defect, so it is recorded
 * separately from the operability findings instead of failing the run.
 *
 * Exit 0 when every surface completes with role/label locators only and no
 * step reports a silent wait. Exit 1 otherwise, with the findings printed.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = (process.env.BASE_URL || 'http://localhost:3107').replace(/\/$/, '');
const AUTH_STATE = resolve(ROOT, '.auth/audit-state.json');

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
	const i = argv.indexOf(`--${name}`);
	return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const OUT = resolve(ROOT, opt('out', 'prompts/x-grok/_generated/operability.json'));

const hasAuth = existsSync(AUTH_STATE);

/** One surface's findings: steps that needed a non-role/label escape hatch,
 * or that waited without visible status text. Empty means the primary task
 * completed clean. */
function newSurface(name, task) {
	return { name, task, consoleErrors: [], findings: [], completed: false };
}

function note(surface, kind, detail) {
	surface.findings.push({ kind, detail });
}

function isResourceLoadError(text) {
	return /Failed to load resource/.test(text);
}

/** Waits for the combined visible text of every element `locator` matches to
 * change away from `baseline`. Aggregating across matches (not just the
 * first) avoids a false "silent wait" when a page has several status
 * regions and only one of them is the one that actually updates. */
async function waitForStatusChange(page, locator, { timeoutMs = 20000, pollMs = 200, baseline = '' } = {}) {
	const start = Date.now();
	const base = baseline.trim();
	while (Date.now() - start < timeoutMs) {
		const texts = await locator.allTextContents().catch(() => []);
		const joined = texts.join(' | ').replace(/\s+/g, ' ').trim();
		if (joined && joined !== base) return { text: joined, sawStatus: true };
		await page.waitForTimeout(pollMs);
	}
	return { text: '', sawStatus: false };
}

async function auditCreate(context, results) {
	const surface = newSurface('create', 'Describe an avatar in words and generate it in 3D (/create -> /create/prompt).');
	results.push(surface);
	const page = await context.newPage();
	page.on('console', (m) => { if (m.type() === 'error') surface.consoleErrors.push(m.text()); });
	try {
		await page.goto(`${BASE_URL}/create`, { waitUntil: 'domcontentloaded' });
		const promptCard = page.getByRole('button', { name: /Describe an avatar in words/i });
		await promptCard.waitFor({ state: 'visible', timeout: 15000 });
		await promptCard.click();

		const landedOnComposer = await page.waitForURL(/\/create\/prompt/, { timeout: 8000 }).then(() => true).catch(() => false);
		if (!landedOnComposer) {
			// A real account-state rule (plan avatar limit) can legitimately stop
			// this navigation. It must still surface through an accessible,
			// visible status element, not fail silently. #status-toast is
			// create.html's own role=status region (see showStatus()); scoping
			// to it avoids the site-wide walk-companion widget's unrelated
			// role=status bubble.
			const toast = page.locator('#status-toast');
			const { sawStatus, text } = await waitForStatusChange(page, toast, { timeoutMs: 5000 });
			if (sawStatus) {
				note(surface, 'blocked-with-status', `Card click did not navigate to /create/prompt, but an accessible status region explained why: "${text}".`);
				surface.completed = true;
				return;
			}
			note(surface, 'silent-wait', 'Clicking the "Describe an avatar in words" card neither navigated to /create/prompt nor showed an accessible status explaining why.');
			return;
		}

		const promptBox = page.getByLabel('Describe the avatar you want to generate');
		await promptBox.waitFor({ state: 'visible', timeout: 15000 });
		await promptBox.fill('a cheerful astronaut with a glossy white suit and a blue visor');

		const generateBtn = page.getByRole('button', { name: /Generate avatar/i });
		await generateBtn.waitFor({ state: 'visible' });
		if (await generateBtn.isDisabled()) note(surface, 'blocked', 'Generate avatar button stayed disabled after a role/label fill().');

		if (!hasAuth) {
			note(surface, 'skipped', 'No signed-in session (.auth/audit-state.json missing); generation requires sign-in, so the flow stops at the composer.');
			surface.completed = true;
			return;
		}

		await generateBtn.click();
		const nextOrBlocked = await Promise.race([
			page.waitForURL(/\/login/, { timeout: 5000 }).then(() => 'login').catch(() => null),
			page.waitForSelector('.step.active[data-step="build"]', { timeout: 20000 }).then(() => 'build').catch(() => null),
		]);
		if (nextOrBlocked === 'login') {
			note(surface, 'skipped', 'Generate avatar redirected to /login; the QA session did not count as signed in for this route.');
			surface.completed = true;
			return;
		}
		if (nextOrBlocked !== 'build') {
			const toast = page.locator('#status-toast');
			const { sawStatus, text } = await waitForStatusChange(page, toast, { timeoutMs: 5000 });
			if (sawStatus) {
				note(surface, 'blocked-with-status', `Generate avatar did not advance to the build step, but an accessible status region explained why: "${text}".`);
				surface.completed = true;
				return;
			}
			note(surface, 'silent-wait', 'Clicking Generate avatar never advanced to the build step within 20s, with no accessible status explaining why.');
			return;
		}
		const buildStatus = page.locator('#build-status');
		const { sawStatus, text } = await waitForStatusChange(page, buildStatus, { timeoutMs: 45000 });
		if (!sawStatus) note(surface, 'silent-wait', 'Build step showed no changing visible status text while generating.');
		else surface.lastStatus = text;
		surface.completed = true;
	} catch (err) {
		note(surface, 'error', String(err?.message || err));
	} finally {
		await page.close();
	}
}

async function auditForge(context, results) {
	const surface = newSurface('forge', 'Generate a 3D model from a text prompt (/forge).');
	results.push(surface);
	const page = await context.newPage();
	page.on('console', (m) => { if (m.type() === 'error') surface.consoleErrors.push(m.text()); });
	try {
		await page.goto(`${BASE_URL}/forge`, { waitUntil: 'domcontentloaded' });
		const promptBox = page.getByLabel('Describe the object to generate');
		await promptBox.waitFor({ state: 'visible', timeout: 15000 });
		await promptBox.fill('a low-poly red fox sitting upright, matte fur, soft studio light');

		const generateBtn = page.getByRole('button', { name: /^Generate/i });
		await generateBtn.waitFor({ state: 'visible' });
		if (await generateBtn.isDisabled()) note(surface, 'blocked', 'Generate button stayed disabled after a role/label fill().');
		await generateBtn.click();

		// #gen-warming / #gen-note / #gen-stages are the three live progress
		// regions; aggregating all of them avoids pinning on whichever one
		// happens to stay static while another one is doing the updating.
		// #gen-meta is the per-second elapsed-time ticker (src/forge.js
		// startElapsed()): one stage's own copy says it reports no sub-steps
		// and the elapsed meter is "the real signal" during it, so it has to
		// be in the aggregate or a long, legitimate no-substep stage reads as
		// a silent wait. It is deliberately not aria-live (a per-second
		// announcement would spam a screen reader), so it is read here, not
		// asserted as an accessible status on its own.
		const progress = page.locator('#gen-warming, #gen-note, #gen-stages, #gen-meta');
		const { sawStatus } = await waitForStatusChange(page, progress, { timeoutMs: 30000 });
		if (!sawStatus) note(surface, 'silent-wait', 'Forge gave no changing visible status text while generating (checked #gen-warming/#gen-note/#gen-stages).');

		// Completion is the result label (now a role=status region) gaining
		// text, or the alert-role load-error region appearing. A real GPU
		// worker can cold-start and queue for minutes (observed 20s-220s+
		// across runs on this machine), so a hard completion timeout tests
		// backend throughput, not operability. Instead poll until done,
		// tracking whether the progress text is still changing; it is only
		// a real defect (silent wait) if that text goes static for a long
		// stretch, not merely if the whole job runs long.
		const resultLabel = page.locator('#result-label');
		const loadError = page.locator('#viewer-load-error');
		const maxWaitMs = 240000;
		const silentThresholdMs = 60000;
		const pollMs = 3000;
		const start = Date.now();
		let lastProgressText = '';
		let lastChangeAt = start;
		let outcome = null;
		while (Date.now() - start < maxWaitMs) {
			if (await resultLabel.filter({ hasText: /./ }).isVisible().catch(() => false)) { outcome = 'result'; break; }
			if (await loadError.isVisible().catch(() => false)) { outcome = 'error'; break; }
			const texts = await progress.allTextContents().catch(() => []);
			const joined = texts.join(' | ').replace(/\s+/g, ' ').trim();
			if (joined !== lastProgressText) { lastProgressText = joined; lastChangeAt = Date.now(); }
			if (Date.now() - lastChangeAt > silentThresholdMs) break;
			await page.waitForTimeout(pollMs);
		}
		if (!outcome) {
			const wentSilent = Date.now() - lastChangeAt > silentThresholdMs;
			if (wentSilent) note(surface, 'stalled', `Forge's progress status stopped updating for over ${silentThresholdMs / 1000}s with no result or error.`);
			else note(surface, 'slow-backend', `Forge did not finish within ${maxWaitMs / 1000}s, but its progress status kept changing throughout (GPU queue/cold-start variance, not a silent wait).`);
		}
		surface.completed = true;
	} catch (err) {
		note(surface, 'error', String(err?.message || err));
	} finally {
		await page.close();
	}
}

async function auditConnect(context, results) {
	const surface = newSurface('connect', 'Pick the three.ws MCP server and copy its connector URL (/connect).');
	results.push(surface);
	const page = await context.newPage();
	page.on('console', (m) => { if (m.type() === 'error') surface.consoleErrors.push(m.text()); });
	try {
		await page.goto(`${BASE_URL}/connect`, { waitUntil: 'domcontentloaded' });
		const serverGroup = page.getByRole('radiogroup', { name: 'Hosted MCP servers' });
		await serverGroup.waitFor({ state: 'visible', timeout: 15000 });
		const firstServer = serverGroup.getByRole('radio').first();
		await firstServer.waitFor({ state: 'visible', timeout: 15000 });
		await firstServer.click();

		const copyBtn = page.getByRole('button', { name: /Copy URL/i });
		await copyBtn.waitFor({ state: 'visible' });
		await copyBtn.click();

		// The button's own accessible name flips to Copied for about 1.6s.
		// Its own name is what changes, so a locator still filtered on the
		// original name stops matching the instant the change happens;
		// verify through #cn-copy-url directly instead, the same ID-scoped
		// pattern used for every other surface's status checks in this file.
		const copyBtnById = page.locator('#cn-copy-url');
		const { sawStatus } = await waitForStatusChange(page, copyBtnById, { timeoutMs: 3000, pollMs: 100, baseline: 'Copy URL' });
		if (!sawStatus) note(surface, 'silent-action', 'Copy URL gave no visible confirmation text on the button after the click.');

		const tabs = page.getByRole('tablist', { name: 'AI clients' });
		await tabs.waitFor({ state: 'visible' });
		const claudeTab = page.getByRole('tab', { name: 'Claude', exact: true });
		await claudeTab.click();
		surface.completed = true;
	} catch (err) {
		note(surface, 'error', String(err?.message || err));
	} finally {
		await page.close();
	}
}

async function auditAgentChat(context, results, agentId) {
	const surface = newSurface('agent-chat', `Open an agent profile and chat with it (/agents/${agentId}).`);
	results.push(surface);
	const page = await context.newPage();
	page.on('console', (m) => { if (m.type() === 'error') surface.consoleErrors.push(m.text()); });
	try {
		await page.goto(`${BASE_URL}/agents/${agentId}`, { waitUntil: 'domcontentloaded' });
		const chatTab = page.getByRole('tab', { name: 'Chat' });
		await chatTab.waitFor({ state: 'visible', timeout: 15000 });
		await chatTab.click();

		const chatInput = page.getByLabel(/Message/i);
		await chatInput.waitFor({ state: 'visible', timeout: 10000 });
		await chatInput.fill('What can you help me with?');

		const sendBtn = page.getByRole('button', { name: 'Send' });
		await sendBtn.click();

		// Scoped to the chat log's own assistant bubble (see appendChatMessage() /
		// sendChatMessage() in src/avatar-page.js), not a generic role=status
		// query, which would also pick up the site-wide walk-companion widget's
		// unrelated status bubble.
		const assistantStatus = page.locator('#av-chat-log .av-chat-msg.assistant').last();
		const immediate = await waitForStatusChange(page, assistantStatus, { timeoutMs: 3000 });
		if (!immediate.sawStatus) {
			note(surface, 'silent-wait', 'No accessible status appeared immediately after sending a chat message.');
		} else {
			const resolved = await waitForStatusChange(page, assistantStatus, { timeoutMs: 40000, baseline: immediate.text });
			if (!resolved.sawStatus) note(surface, 'silent-wait', 'The chat status region never updated past "Thinking..." within 40s.');
			else surface.lastReply = resolved.text.slice(0, 200);
		}
		surface.completed = true;
	} catch (err) {
		note(surface, 'error', String(err?.message || err));
	} finally {
		await page.close();
	}
}

async function auditLaunch(context, results, agentName) {
	const surface = newSurface('launch', 'Fill in a coin launch for an agent and reach the signing confirmation, read-only (/launch). Never signs.');
	results.push(surface);
	const page = await context.newPage();
	page.on('console', (m) => { if (m.type() === 'error') surface.consoleErrors.push(m.text()); });
	try {
		await page.goto(`${BASE_URL}/launch`, { waitUntil: 'domcontentloaded' });
		if (!hasAuth) {
			note(surface, 'skipped', 'No signed-in session (.auth/audit-state.json missing); /launch needs a wallet-linked account to list agents.');
			surface.completed = true;
			return;
		}
		const agentsGroup = page.getByRole('radiogroup', { name: 'Your agents' });
		await agentsGroup.waitFor({ state: 'visible', timeout: 15000 });
		const agentRadio = agentName
			? agentsGroup.getByRole('radio', { name: new RegExp(agentName, 'i') })
			: agentsGroup.getByRole('radio').first();
		await agentRadio.waitFor({ state: 'visible', timeout: 10000 });
		await agentRadio.click();

		await page.getByLabel(/Coin name/i).fill('Operability Test Coin');
		await page.getByLabel(/Ticker/i).fill('OPTEST');
		await page.getByLabel(/Description/i).fill('A read-only probe coin, never launched.');

		// The primary action button's accessible name tracks exactly what the
		// signer needs to do next ("Sign in to launch", "Install a Solana
		// wallet", "Connect wallet to launch", "Launch $SYMBOL"...), so it is
		// located by its landmark and a name pattern covering those states
		// rather than position: the same landmark also holds model-viewer's
		// own aria-hidden loading-poster button (#default-poster), and that
		// vendor element sorts last in DOM order. Read only, never clicked:
		// clicking it can end in a real on-chain spend.
		const preview = page.getByRole('complementary', { name: 'Launch preview' });
		const launchBtn = preview.getByRole('button', { name: /launch|wallet|sign in/i });
		await launchBtn.waitFor({ state: 'visible', timeout: 15000 });
		const label = (await launchBtn.textContent())?.trim() || '';
		surface.launchButtonLabel = label;
		if (!label) note(surface, 'blocked', 'The launch action button rendered with no accessible name.');
		// Reached the signing confirmation surface. Stop here: never click it.
		surface.completed = true;
	} catch (err) {
		note(surface, 'error', String(err?.message || err));
	} finally {
		await page.close();
	}
}

async function main() {
	const browser = await chromium.launch({
		headless: true,
		args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
	});
	const contextOpts = {
		viewport: { width: 1280, height: 900 },
		permissions: ['clipboard-read', 'clipboard-write'],
	};
	if (hasAuth) contextOpts.storageState = AUTH_STATE;
	const context = await browser.newContext(contextOpts);

	let agentId = process.env.AUDIT_AGENT_ID || null;
	let agentName = null;
	if (hasAuth && !agentId) {
		try {
			const cookies = JSON.parse(readFileSync(AUTH_STATE, 'utf8')).cookies
				.map((c) => `${c.name}=${c.value}`).join('; ');
			const r = await fetch(`${BASE_URL}/api/agents`, { headers: { cookie: cookies } });
			const j = await r.json();
			agentId = j?.agents?.[0]?.id || null;
			agentName = j?.agents?.[0]?.name || null;
		} catch {}
	}

	const results = [];
	await auditCreate(context, results);
	await auditForge(context, results);
	await auditConnect(context, results);
	if (agentId) await auditAgentChat(context, results, agentId);
	else results.push({ ...newSurface('agent-chat', 'Open an agent profile and chat with it.'), findings: [{ kind: 'skipped', detail: 'No agent id available (no signed-in session with an agent).' }], completed: true });
	await auditLaunch(context, results, agentName);

	await browser.close();

	const report = {
		generatedAt: new Date().toISOString(),
		baseUrl: BASE_URL,
		authed: hasAuth,
		surfaces: results,
	};

	mkdirSync(dirname(OUT), { recursive: true });
	writeFileSync(OUT, JSON.stringify(report, null, '\t') + '\n');

	let failed = false;
	for (const s of results) {
		const hard = s.findings.filter((f) => !['skipped', 'info', 'blocked-with-status', 'slow-backend'].includes(f.kind));
		const tag = hard.length ? 'FAIL' : 'PASS';
		if (hard.length) failed = true;
		console.log(`${tag}  ${s.name}: ${s.task}`);
		for (const f of s.findings) console.log(`    [${f.kind}] ${f.detail}`);
		const resourceErrors = s.consoleErrors.filter((e) => isResourceLoadError(e));
		const otherErrors = s.consoleErrors.filter((e) => !isResourceLoadError(e));
		if (resourceErrors.length) console.log(`    [network] ${resourceErrors.length} HTTP error response(s) logged by the browser (not a page defect by itself).`);
		if (otherErrors.length) {
			failed = true;
			console.log(`    [console-error] ${otherErrors.length} error(s): ${otherErrors[0]}`);
		}
	}
	console.log(`\nWrote ${OUT}`);
	process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('audit-agent-operability crashed:', e); process.exit(1); });
