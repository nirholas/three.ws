#!/usr/bin/env node
/**
 * Measure the live 3D home against a real house.
 *
 * `/smart-home/:id` makes four performance claims: it paints quickly from cold,
 * it holds a frame rate on a desktop and on a phone, it reflects a real device
 * within a frame of hearing about it, and it does not leak while it runs for
 * hours on a wall display. Those numbers are quoted in
 * [docs/home-scene.md](../docs/home-scene.md), and a quoted number nobody can
 * re-derive rots into folklore. This script re-derives all of them.
 *
 * Nothing here is simulated. The house is a real Home Assistant, every state
 * change is a real service call against a real device, the page is the shipped
 * page, and the heap is read out of V8 through the DevTools protocol after a
 * forced collection, so a sample is the memory that survived rather than the
 * memory that had not been swept yet.
 *
 * Bring a stack up first (a house, the API, the frontend). The home e2e config
 * builds exactly that stack and leaves its details in `.ha-config-e2e-stack.json`,
 * which is the default input here:
 *
 *   node scripts/home-test-instance.mjs --name scene06 --up --onboard --seed --json
 *   node --env-file=.env.local server/index.mjs &            # API  on 8098
 *   DEV_API_PROXY=http://127.0.0.1:8098 npx vite --port 3021 &
 *   node scripts/measure-home-scene.mjs --origin http://localhost:3021 --minutes 10
 *
 * Output is a JSON report on stdout and, with `--out`, a PNG per state.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
	usage();
	process.exit(0);
}

const stack = readStack(opts.stack);
const ORIGIN = opts.origin || stack.origin || 'http://localhost:3021';
const HOUSE = stack.home;
const ACCOUNT = stack.accounts?.owner;
if (!HOUSE?.baseUrl || !HOUSE?.token) fail('the stack file has no house. Run the home e2e config once, or pass --stack.');
if (!ACCOUNT?.email) fail('the stack file has no owner account.');

/** How long the heap trace runs. Ten minutes is the documented claim. */
const MINUTES = Number(opts.minutes ?? 10);
/** Round trips measured for the end to end latency figure. */
const LATENCY_TRIALS = Number(opts.trials ?? 8);

const report = { measuredAt: new Date().toISOString(), origin: ORIGIN, house: { version: HOUSE.version || null } };

await main();

async function main() {
	const browser = await chromium.launch({ args: ['--enable-precise-memory-info', '--use-gl=swiftshader'] });
	try {
		const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
		await signIn(context);
		const homeId = await connectHouse(context);
		report.homeId = homeId;

		const page = await context.newPage();
		const errors = [];
		page.on('console', (msg) => {
			if (msg.type() === 'error' || msg.type() === 'warning') errors.push(`${msg.type()}: ${msg.text()}`);
		});
		page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

		report.coldPaint = await measureColdPaint(page, homeId);
		report.desktop = await measureFrameRate(page, 'desktop');
		report.latency = await measureLatency(page);
		report.heap = await measureHeap(page, MINUTES);
		report.mobile = await measureMobile(context, homeId);
		report.console = errors;

		if (opts.out) report.screenshots = await captureStates(context, page, homeId);
	} finally {
		await browser.close();
	}
	process.stdout.write(`${JSON.stringify(report, null, '\t')}\n`);
}

// ---------------------------------------------------------------- the stack

async function signIn(context) {
	const res = await context.request.post(`${ORIGIN}/api/auth/login`, {
		data: { email: ACCOUNT.email, password: ACCOUNT.password },
		headers: { 'content-type': 'application/json' },
		timeout: 60_000,
	});
	if (!res.ok()) fail(`login returned ${res.status()}: ${(await res.text()).slice(0, 200)}`);
}

/**
 * Connect the house through the real endpoint, reusing one this account already
 * has. Reuse matters: connecting verifies the instance and writes an encrypted
 * token every time, and a fresh row per run would leave a pile of houses behind
 * on an account that is reused across runs.
 */
async function connectHouse(context) {
	const label = opts.label || 'Scene measurement';
	const list = await context.request.get(`${ORIGIN}/api/home`, { timeout: 60_000 });
	if (list.ok()) {
		const body = await list.json().catch(() => null);
		const homes = Array.isArray(body?.homes) ? body.homes : Array.isArray(body) ? body : [];
		const found = homes.find((h) => h.label === label);
		if (found) return found.id;
	}

	const token = await csrf(context);
	const res = await context.request.post(`${ORIGIN}/api/home`, {
		data: { label, baseUrl: HOUSE.baseUrl, token: HOUSE.token },
		headers: { 'content-type': 'application/json', 'x-csrf-token': token },
		timeout: 120_000,
	});
	if (!res.ok()) fail(`connecting the house returned ${res.status()}: ${(await res.text()).slice(0, 300)}`);
	const body = await res.json();
	const id = body?.home?.id || body?.data?.home?.id || body?.id;
	if (!id) fail(`the connect response carried no home id: ${JSON.stringify(body).slice(0, 200)}`);
	return id;
}

async function csrf(context) {
	const res = await context.request.get(`${ORIGIN}/api/csrf-token`, { timeout: 30_000 });
	if (!res.ok()) fail(`csrf token returned ${res.status()}`);
	const body = await res.json();
	return (body.data || body).token;
}

/** Open the scene and wait until the renderer has drawn a frame of the house. */
async function openScene(page, homeId, { view = '3d' } = {}) {
	await page.goto(`${ORIGIN}/smart-home/${homeId}?view=${view}`, { waitUntil: 'domcontentloaded' });
	if (view === '3d') {
		await page.waitForFunction(() => window.__homeScene?.stats()?.drawCalls > 0, null, { timeout: 240_000 });
	} else {
		await page.waitForSelector('.hs-card', { timeout: 240_000 });
	}
}

// ---------------------------------------------------------------- the numbers

/**
 * Cold paint: a context with no cache, no session storage and no warm module
 * graph, timed from navigation start to the first frame that actually drew the
 * house. Reloading a warm page would measure the cache, not the product.
 */
async function measureColdPaint(page, homeId) {
	const started = Date.now();
	await openScene(page, homeId);
	const wall = Date.now() - started;
	const marks = await page.evaluate(() => {
		const nav = performance.getEntriesByType('navigation')[0];
		const paint = performance.getEntriesByName('first-contentful-paint')[0];
		return {
			firstContentfulPaintMs: paint ? Math.round(paint.startTime) : null,
			domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
		};
	});
	const model = await page.evaluate(() => ({
		rooms: window.__homeScene.model.rooms.length,
		floors: window.__homeScene.model.floors.length,
		entities: window.__homeScene.model.stats.entities,
		drawn: window.__homeScene.model.stats.drawn,
	}));
	return { navigationToDrawnHouseMs: wall, ...marks, model, stats: await page.evaluate(() => window.__homeScene.stats()) };
}

/**
 * Frame rate, sampled from the renderer's own counter over a real window of
 * wall-clock time with the tab visible and the house live.
 */
async function measureFrameRate(page, label, seconds = 20) {
	const samples = [];
	for (let i = 0; i < seconds; i += 1) {
		await page.waitForTimeout(1000);
		const stats = await page.evaluate(() => window.__homeScene.stats());
		samples.push(stats.fps);
	}
	const stats = await page.evaluate(() => window.__homeScene.stats());
	return { label, samples, median: median(samples), min: Math.min(...samples), updateMs: stats.updateMs, renderMs: stats.renderMs, drawCalls: stats.drawCalls, objects: stats.objects };
}

/**
 * End to end: from the instant the service call leaves this process to the
 * animation frame in the page that first carries the new state.
 *
 * The page side is a requestAnimationFrame loop reading the same model the
 * renderer draws, so the timestamp is the frame that shows the change and not
 * the socket message that preceded it. Both clocks are `Date.now()` in the same
 * machine, and the page's own `__homeScene.latency` (SSE frame to painted
 * frame) is reported beside it so the network leg can be told from ours.
 */
async function measureLatency(page) {
	const light = await anyLight();
	const samples = [];

	for (let i = 0; i < LATENCY_TRIALS; i += 1) {
		const before = await readState(light.entityId);
		const wanted = before === 'on' ? 'off' : 'on';

		await page.evaluate(
			({ id, want }) => {
				window.__sceneWatch = { at: null };
				const tick = () => {
					for (const room of window.__homeScene.model.rooms) {
						const found = room.objects.find((o) => o.entityId === id);
						if (found && found.state === want) {
							window.__sceneWatch.at = Date.now();
							return;
						}
					}
					requestAnimationFrame(tick);
				};
				requestAnimationFrame(tick);
			},
			{ id: light.entityId, want: wanted },
		);

		const sent = Date.now();
		await callService(`light/turn_${wanted}`, light.entityId);
		const seenAt = await page.waitForFunction(() => window.__sceneWatch?.at, null, { timeout: 60_000 }).then((h) => h.jsonValue());
		samples.push(seenAt - sent);
		await page.waitForTimeout(400);
	}

	const inPage = await page.evaluate(() => window.__homeScene.latency);
	return {
		entityId: light.entityId,
		callToPaintedFrameMs: { samples, median: median(samples), worst: Math.max(...samples) },
		sseFrameToPaintedFrameMs: { samples: inPage.samples.slice(-LATENCY_TRIALS), median: median(inPage.samples.slice(-LATENCY_TRIALS)) },
	};
}

/**
 * The heap, over a run of real device changes.
 *
 * Every sample is taken after `HeapProfiler.collectGarbage`, so what is
 * reported is retained memory rather than garbage that had not been swept.
 * That is the only reading that can distinguish a leak from a sawtooth, and a
 * leak here is a wall display that dies overnight.
 */
async function measureHeap(page, minutes) {
	const client = await page.context().newCDPSession(page);
	await client.send('HeapProfiler.enable');
	await client.send('Performance.enable');

	const lights = await allLights();
	const samples = [];
	const sample = async (t) => {
		await client.send('HeapProfiler.collectGarbage');
		const metrics = await client.send('Performance.getMetrics');
		const used = metrics.metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0;
		const stats = await page.evaluate(() => window.__homeScene.stats());
		samples.push({ minute: t, heapMB: round2(used / 1024 / 1024), objects: stats.objects, geometries: stats.geometries, textures: stats.textures, fps: stats.fps });
	};

	await sample(0);
	let changes = 0;
	for (let minute = 1; minute <= minutes; minute += 1) {
		const until = Date.now() + 60_000;
		while (Date.now() < until) {
			const light = lights[changes % lights.length];
			await callService(`light/turn_${changes % 2 ? 'on' : 'off'}`, light);
			changes += 1;
			await page.waitForTimeout(4000);
		}
		await sample(minute);
	}

	const first = samples[0];
	const last = samples[samples.length - 1];
	return {
		minutes,
		realDeviceChanges: changes,
		samples,
		growthMB: round2(last.heapMB - first.heapMB),
		objectsHeld: last.objects === first.objects && last.geometries === first.geometries && last.textures === first.textures,
	};
}

/**
 * A phone, as closely as a headless desktop can honestly be one: a phone
 * viewport, a touch device, and the CPU throttled through the DevTools
 * protocol. The GPU is still this machine's, which is why the number reported
 * is labelled as CPU throttled rather than as a phone measurement.
 */
async function measureMobile(context, homeId) {
	const page = await context.newPage();
	await page.setViewportSize({ width: 390, height: 844 });
	const client = await context.newCDPSession(page);
	await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
	try {
		await openScene(page, homeId);
		const result = await measureFrameRate(page, 'cpu-throttled-4x-390px', 15);
		result.routedToFallback = await page.evaluate(() => window.__homeScene.status.view === '2d');
		return result;
	} finally {
		await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
		await page.close();
	}
}

// ---------------------------------------------------------------- the states

/** One PNG per state, into --out. */
async function captureStates(context, page, homeId) {
	const dir = path.resolve(ROOT, opts.out);
	fs.mkdirSync(dir, { recursive: true });
	const shot = async (target, name) => {
		const file = path.join(dir, `${name}.png`);
		await target.screenshot({ path: file });
		return path.relative(ROOT, file);
	};
	const shots = {};

	// 1. loading: a context with nothing cached, caught before the graph lands.
	const cold = await context.newPage();
	await cold.setViewportSize({ width: 1440, height: 900 });
	await cold.goto(`${ORIGIN}/smart-home/${homeId}`, { waitUntil: 'commit' });
	await cold.waitForSelector('.hs-skeleton', { timeout: 30_000 });
	shots.loading = await shot(cold, '01-loading');
	await cold.close();

	// 4. live, and 7. acting, and 8. confirmation pending: the running house.
	await openScene(page, homeId);
	await page.waitForTimeout(1500);
	shots.live = await shot(page, '04-live');

	shots.acting = await captureActing(page);
	shots.confirmation = await captureConfirmation(page);

	// 9. the 2D house, which is also the no-WebGL path.
	const flat = await context.newPage();
	await flat.setViewportSize({ width: 1440, height: 900 });
	await flat.addInitScript(() => {
		const original = HTMLCanvasElement.prototype.getContext;
		HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
			if (String(type).startsWith('webgl')) return null;
			return original.call(this, type, ...rest);
		};
	});
	await flat.goto(`${ORIGIN}/smart-home/${homeId}`, { waitUntil: 'domcontentloaded' });
	await flat.waitForSelector('.hs-card', { timeout: 120_000 });
	shots.noWebgl = await shot(flat, '09-no-webgl');
	await flat.close();

	// 10. error: the house is gone from under the page.
	const missing = await context.newPage();
	await missing.setViewportSize({ width: 1440, height: 900 });
	await missing.goto(`${ORIGIN}/smart-home/00000000-0000-4000-8000-000000000000`, { waitUntil: 'domcontentloaded' });
	await missing.waitForSelector('.hs-overlay', { timeout: 60_000 });
	shots.error = await shot(missing, '10-error');
	await missing.close();

	shots.dir = path.relative(ROOT, dir);
	return shots;
}

/**
 * Select a real object by clicking the canvas where that object actually is.
 *
 * The page raycasts from the pointer, so this is the user's own gesture rather
 * than a synthetic selection. An object can be behind a wall from the current
 * camera, which is why the caller passes candidates and the inspector is read
 * back to confirm which one was actually hit.
 */
async function clickEntity(page, entityId) {
	const at = await page.evaluate((id) => window.__homeScene.project(id), entityId);
	if (!at?.visible) return false;
	const box = await page.locator('#hs-stage canvas').boundingBox();
	if (!box) return false;
	await page.mouse.click(box.x + at.x, box.y + at.y);
	const shown = await page
		.locator('.hs-entity-id')
		.textContent({ timeout: 5000 })
		.catch(() => null);
	return shown?.trim() === entityId;
}

/** Every drawn object of a domain, room by room. */
async function objectsOfDomain(page, domain) {
	return page.evaluate(
		(want) => window.__homeScene.model.rooms.flatMap((room) => room.objects.filter((o) => o.domain === want).map((o) => o.entityId)),
		domain,
	);
}

/** Act on a real unguarded device and catch the beat where its room lights up. */
async function captureActing(page) {
	for (const entityId of await objectsOfDomain(page, 'light')) {
		if (!(await clickEntity(page, entityId))) continue;
		const button = page.locator('#hs-inspector').getByRole('button', { name: /^Turn (on|off)$/ }).first();
		if (!(await button.count())) continue;
		await button.click();
		// Inside setActing's hold, so the highlighted room is on screen.
		await page.waitForTimeout(600);
		const file = path.join(path.resolve(ROOT, opts.out), '07-acting.png');
		await page.screenshot({ path: file });
		return path.relative(ROOT, file);
	}
	return null;
}

/** Ask a real lock to open, which the gate answers with a question. */
async function captureConfirmation(page) {
	for (const entityId of await objectsOfDomain(page, 'lock')) {
		if (!(await clickEntity(page, entityId))) continue;
		const button = page.locator('#hs-inspector').getByRole('button', { name: /^(Unlock|Lock)$/ }).first();
		if (!(await button.count())) continue;
		const risky = (await button.textContent())?.trim() === 'Unlock';
		if (!risky) continue;
		await button.click();
		await page.waitForSelector('.hs-confirm', { timeout: 30_000 });
		const file = path.join(path.resolve(ROOT, opts.out), '08-confirmation.png');
		await page.screenshot({ path: file });
		return path.relative(ROOT, file);
	}
	return null;
}

// ---------------------------------------------------------------- the house

async function haFetch(pathname, init = {}) {
	const res = await fetch(`${HOUSE.baseUrl}${pathname}`, {
		...init,
		headers: { authorization: `Bearer ${HOUSE.token}`, 'content-type': 'application/json', ...(init.headers || {}) },
	});
	if (!res.ok) throw new Error(`Home Assistant ${pathname} answered ${res.status}`);
	return res.json();
}

async function callService(service, entityId) {
	return haFetch(`/api/services/${service}`, { method: 'POST', body: JSON.stringify({ entity_id: entityId }) });
}

async function readState(entityId) {
	const body = await haFetch(`/api/states/${entityId}`);
	return body.state;
}

async function allLights() {
	const states = await haFetch('/api/states');
	const lights = states.filter((s) => s.entity_id.startsWith('light.')).map((s) => s.entity_id);
	if (!lights.length) throw new Error('the house has no lights to drive');
	return lights;
}

async function anyLight() {
	const [entityId] = await allLights();
	return { entityId };
}

// ---------------------------------------------------------------- plumbing

function readStack(file) {
	const target = path.resolve(ROOT, file || '.ha-config-e2e-stack.json');
	if (!fs.existsSync(target)) fail(`no stack at ${path.relative(ROOT, target)}. Bring one up first; see the header of this file.`);
	return JSON.parse(fs.readFileSync(target, 'utf8'));
}

function parseArgs(argv) {
	const out = {};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (!arg.startsWith('--')) continue;
		const key = arg.slice(2);
		if (key === 'help') out.help = true;
		else out[key] = argv[i + 1]?.startsWith('--') ? true : argv[++i];
	}
	return out;
}

function usage() {
	process.stdout.write(
		[
			'Measure the live 3D home against a real house.',
			'',
			'  --origin <url>     where the frontend is served (default: the stack file)',
			'  --stack <file>     the stack description (default: .ha-config-e2e-stack.json)',
			'  --minutes <n>      length of the heap trace (default: 10)',
			'  --trials <n>       latency round trips (default: 8)',
			'  --label <text>     the home label to reuse or create',
			'  --out <dir>        write one PNG per state into this directory',
			'',
		].join('\n'),
	);
}

function median(values) {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return round2(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
}

function round2(value) {
	return Math.round(value * 100) / 100;
}

function fail(message) {
	console.error(`measure-home-scene: ${message}`);
	process.exit(1);
}
