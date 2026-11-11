// The review stage (/microsoft/teams-stage) across two real browsers sharing
// one Live Share session. The stage runs in its local mode: TestLiveShareHost
// against a real Fluid service (@fluidframework/azure-local-service) that this
// spec starts on a free port, so every update travels through the same
// container and ops pipeline a Teams meeting uses. Each check runs in both
// directions: camera follow, presence, laser pointers, comment pins and
// animation sync.

import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import path from 'node:path';

const require = createRequire(import.meta.url);
// A real first-party avatar (CC-BY Mixamo rig with baked clips) that the
// public library serves with CORS, so both browsers can load it.
const MODEL_ID = '13f259c7-7024-4d68-b1f0-dbbf52c06209';

const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const VIEWPORT = { width: 1200, height: 760 };
test.use({ viewport: VIEWPORT, launchOptions: { args: GL_ARGS } });
test.describe.configure({ mode: 'serial', timeout: 300_000 });

let fluid;
let fluidUrl;

function freePort() {
	return new Promise((resolve, reject) => {
		const srv = createServer();
		srv.unref();
		srv.on('error', reject);
		srv.listen(0, '127.0.0.1', () => {
			const { port } = srv.address();
			srv.close(() => resolve(port));
		});
	});
}

test.beforeAll(async () => {
	const port = await freePort();
	const entry = path.join(path.dirname(require.resolve('@fluidframework/azure-local-service/package.json')), 'dist', 'index.js');
	fluid = spawn(process.execPath, [entry], { env: { ...process.env, PORT: String(port) }, stdio: 'pipe' });
	fluidUrl = `http://localhost:${port}`;
	const deadline = Date.now() + 60_000;
	for (;;) {
		try {
			const res = await fetch(fluidUrl);
			if (res.ok) break;
		} catch {
			// Not listening yet.
		}
		if (Date.now() > deadline) throw new Error(`local Fluid service did not start on ${fluidUrl}`);
		await new Promise((r) => setTimeout(r, 250));
	}
});

const extraBrowsers = [];
test.afterAll(async () => {
	await Promise.all(extraBrowsers.map((br) => br.close()));
	fluid?.kill();
});

function stageUrl({ user, name, hash = '' }) {
	const q = new URLSearchParams({ liveshare: 'local', fluid: fluidUrl, user, name, model: MODEL_ID, model_name: 'Michelle' });
	return `/microsoft/teams-stage?${q}${hash}`;
}

function watchConsole(page, label, errors) {
	page.on('pageerror', (e) => errors.push(`[${label}] ${e.message}`));
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(`[${label}] ${m.text()}`);
	});
}

async function waitLoaded(page) {
	await expect(page.getByTestId('model-name')).toHaveText('Michelle', { timeout: 180_000 });
	await page.waitForFunction(() => window.threewsReviewStage?.loaded(), null, { timeout: 180_000 });
	await expect(page.getByTestId('anim-bar')).toBeVisible();
}

const pose = (page) => page.evaluate(() => window.threewsReviewStage.pose());

function poseGap(a, b) {
	return Math.max(...a.p.map((v, i) => Math.abs(v - b.p[i])), ...a.t.map((v, i) => Math.abs(v - b.t[i])));
}

async function orbit(page, dx) {
	const box = await page.getByTestId('stage-canvas').boundingBox();
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	for (let i = 1; i <= 10; i++) await page.mouse.move(x + (dx * i) / 10, y + (dx * i) / 30);
	await page.mouse.up();
}

async function expectFollows(follower, leader) {
	await expect
		.poll(async () => poseGap(await pose(follower), await pose(leader)), { timeout: 20_000, message: 'follower camera matches the presenter' })
		.toBeLessThan(0.01);
}

async function placePin(page, text, offsetY) {
	await page.getByTestId('pin-mode').click();
	await expect(page.getByTestId('pin-mode')).toHaveAttribute('aria-pressed', 'true');
	const box = await page.getByTestId('stage-canvas').boundingBox();
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 + offsetY);
	await expect(page.getByTestId('pin-composer')).toBeVisible();
	await page.getByTestId('pin-text').fill(text);
	await page.getByTestId('pin-text').press('Enter');
	await expect(page.getByTestId('pin-composer')).toBeHidden();
}

// A clip long enough to scrub around in, other than the one playing now.
function pickLongClip(sel) {
	return [...sel.options].find((o) => o.value && o.value !== sel.value && Number(o.dataset.duration) >= 2)?.value;
}

async function scrubTo(page, seconds) {
	await page.getByTestId('anim-scrub').evaluate((el, v) => {
		el.value = String(v);
		el.dispatchEvent(new Event('input', { bubbles: true }));
		el.dispatchEvent(new Event('change', { bubbles: true }));
	}, seconds);
}

test('two participants share camera follow, presence, pins and animation both ways', async ({ playwright, baseURL }) => {
	const errors = [];
	// One browser per participant, as in a real meeting. Two contexts in one
	// headless browser share a single software GL process, and one stage
	// rendering continuously starves the other's synchronous WebGL calls.
	const [browserA, browserB] = await Promise.all([playwright.chromium.launch({ args: GL_ARGS }), playwright.chromium.launch({ args: GL_ARGS })]);
	extraBrowsers.push(browserA, browserB);
	const ctxA = await browserA.newContext({ baseURL, viewport: VIEWPORT });
	const ctxB = await browserB.newContext({ baseURL, viewport: VIEWPORT });
	const a = await ctxA.newPage();
	const b = await ctxB.newPage();
	watchConsole(a, 'Ada', errors);
	watchConsole(b, 'Bo', errors);

	await a.goto(stageUrl({ user: 'ada', name: 'Ada Lovelace' }));
	await expect(a).toHaveURL(/#[0-9a-f-]{36}$/, { timeout: 180_000 });
	await waitLoaded(a);
	const hash = new URL(a.url()).hash;

	// Bo opens the same session without a model param and gets Ada's model.
	await b.goto(`/microsoft/teams-stage?${new URLSearchParams({ liveshare: 'local', fluid: fluidUrl, user: 'bo', name: 'Bo Chen' })}${hash}`);
	await waitLoaded(b);

	// Presence: each side sees both people, with initials.
	for (const page of [a, b]) {
		await expect(page.getByTestId('presence-chip')).toHaveCount(2, { timeout: 30_000 });
		await expect(page.locator('[data-testid="presence-chip"][data-name="Ada Lovelace"]')).toHaveText('AL');
		await expect(page.locator('[data-testid="presence-chip"][data-name="Bo Chen"]')).toHaveText('BC');
		await expect(page.getByTestId('connection')).toHaveAttribute('data-state', 'connected');
		await expect(page.getByTestId('solo-note')).toBeHidden();
	}

	// Comment pins, Ada to Bo, then Bo to Ada.
	await placePin(a, 'Tighten the jacket seam here', -40);
	await expect(b.getByTestId('pin-count')).toHaveText('1', { timeout: 20_000 });
	await b.getByTestId('pins-toggle').click();
	await expect(b.getByTestId('pin-item')).toContainText('Tighten the jacket seam here');
	await expect(b.getByTestId('pin-item')).toContainText('Ada Lovelace');
	await b.getByTestId('pins-toggle').click();

	await placePin(b, 'Shoes read too bright', 120);
	await expect(a.getByTestId('pin-count')).toHaveText('2', { timeout: 20_000 });
	await a.getByTestId('pins-toggle').click();
	await expect(a.getByTestId('pin-item').filter({ hasText: 'Shoes read too bright' })).toContainText('Bo Chen');
	await a.getByTestId('pins-toggle').click();
	await expect(a.getByTestId('pin-marker')).toHaveCount(2);
	await expect(b.getByTestId('pin-marker')).toHaveCount(2);

	// Animation sync, Ada to Bo: pick another clip, pause, scrub to 1.0s.
	const clipA = await a.getByTestId('anim-clip').evaluate(pickLongClip);
	await a.getByTestId('anim-clip').selectOption(clipA);
	await expect(b.getByTestId('anim-clip')).toHaveValue(clipA, { timeout: 20_000 });
	await a.getByTestId('anim-play').click();
	await expect(a.getByTestId('anim-play')).toHaveAttribute('aria-label', 'Play');
	await expect(b.getByTestId('anim-play')).toHaveAttribute('aria-label', 'Play', { timeout: 20_000 });
	await scrubTo(a, 1);
	await expect.poll(() => b.evaluate(() => window.threewsReviewStage.time()), { timeout: 20_000 }).toBeCloseTo(1, 1);
	await expect(b.getByTestId('anim-time')).toHaveText('1.0s');

	// Animation sync, Bo to Ada: another clip, scrub to 0.5s, then play.
	const clipB = await b.getByTestId('anim-clip').evaluate(pickLongClip);
	await b.getByTestId('anim-clip').selectOption(clipB);
	await expect(a.getByTestId('anim-clip')).toHaveValue(clipB, { timeout: 20_000 });
	await b.getByTestId('anim-play').click();
	await expect(b.getByTestId('anim-play')).toHaveAttribute('aria-label', 'Play');
	await scrubTo(b, 0.5);
	await expect.poll(() => a.evaluate(() => window.threewsReviewStage.time()), { timeout: 20_000 }).toBeCloseTo(0.5, 1);
	await b.getByTestId('anim-play').click();
	await expect(a.getByTestId('anim-play')).toHaveAttribute('aria-label', 'Pause', { timeout: 20_000 });

	// Camera follow, Ada presents: Bo follows, then breaks away and jumps back.
	await a.getByTestId('follow-primary').click();
	await expect(a.getByTestId('follow-status')).toContainText('You are presenting', { timeout: 20_000 });
	await expect(b.getByTestId('follow-status')).toHaveText('Following Ada Lovelace', { timeout: 20_000 });
	await orbit(a, 220);
	await expectFollows(b, a);
	// While Ada presents, Bo's playback controls are hers.
	await expect(b.getByTestId('anim-clip')).toBeDisabled();

	await orbit(b, -160);
	await expect(b.getByTestId('follow-primary')).toHaveText('Jump back to Ada Lovelace', { timeout: 20_000 });
	expect(poseGap(await pose(b), await pose(a))).toBeGreaterThan(0.05);
	await b.getByTestId('follow-primary').click();
	await expect(b.getByTestId('follow-status')).toHaveText('Following Ada Lovelace', { timeout: 20_000 });
	await expectFollows(b, a);

	// Laser pointer, Ada to Bo.
	const boxA = await a.getByTestId('stage-canvas').boundingBox();
	await a.mouse.move(boxA.x + boxA.width / 2, boxA.y + boxA.height / 2 - 20);
	await a.mouse.move(boxA.x + boxA.width / 2 + 4, boxA.y + boxA.height / 2 - 10);
	await expect(b.locator('[data-testid="laser"][data-name="Ada Lovelace"]')).toBeVisible({ timeout: 20_000 });

	// Camera follow, Bo takes control: Ada follows Bo.
	await b.getByTestId('follow-primary').click();
	await expect(b.getByTestId('follow-status')).toContainText('You are presenting', { timeout: 20_000 });
	await expect(a.getByTestId('follow-status')).toHaveText('Following Bo Chen', { timeout: 20_000 });
	await orbit(b, -240);
	await expectFollows(a, b);

	// Laser pointer, Bo to Ada.
	const boxB = await b.getByTestId('stage-canvas').boundingBox();
	await b.mouse.move(boxB.x + boxB.width / 2, boxB.y + boxB.height / 2);
	await b.mouse.move(boxB.x + boxB.width / 2 + 4, boxB.y + boxB.height / 2 + 6);
	await expect(a.locator('[data-testid="laser"][data-name="Bo Chen"]')).toBeVisible({ timeout: 20_000 });

	// Export: the markdown carries both pins with their authors.
	await a.getByTestId('pins-toggle').click();
	await ctxA.grantPermissions(['clipboard-read', 'clipboard-write']);
	await a.getByTestId('copy-md').click();
	await expect(a.getByTestId('copy-md')).toHaveText('Copied');
	const md = await a.evaluate(() => navigator.clipboard.readText());
	expect(md).toContain('Tighten the jacket seam here');
	expect(md).toContain('Shoes read too bright');
	expect(md).toContain('Ada Lovelace');
	expect(md).toContain('Bo Chen');

	expect(errors).toEqual([]);
});

test('outside Teams the stage runs single-user and says why', async ({ page }) => {
	const errors = [];
	watchConsole(page, 'solo', errors);
	await page.goto(`/microsoft/teams-stage?model=${MODEL_ID}`);
	await expect(page.getByTestId('solo-note')).toBeVisible({ timeout: 180_000 });
	await expect(page.getByTestId('solo-note')).toContainText('Open this stage from a Microsoft Teams meeting');
	await expect(page.getByTestId('connection')).toHaveText('Single user');
	await expect(page.getByTestId('follow-bar')).toBeHidden();
	await expect(page.getByTestId('model-name')).toHaveText('Michelle', { timeout: 180_000 });
	expect(errors).toEqual([]);
});
