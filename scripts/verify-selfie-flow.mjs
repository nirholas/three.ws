#!/usr/bin/env node
// Drives https://three.ws/create/selfie end to end in a real browser: uploads a
// real photograph into the frontal slot, submits it, and follows the job until
// the avatar engine returns a GLB or fails. Nothing here calls the API behind
// the page's back, so the client-side capture gates, the reconstruct call, the
// poll loop and the viewer all get exercised the way a visitor exercises them.
//
//   npm run verify:selfie                     # generates a portrait, runs it
//   npm run verify:selfie -- --photo=me.jpg   # uses a photo you already have
//   npm run verify:selfie -- --origin=http://localhost:3000
//   npm run verify:selfie -- --stall-vision   # regression: hang MediaPipe's
//                                             # runtime and prove the pipeline
//                                             # still submits without it
//
// The reconstruct endpoint requires a session, so the run replays the QA
// storage state at .auth/audit-state.json. Mint it first with
// `npm run audit:web:login`. Without a photo, one is generated through the
// platform's own free text-to-image lane (POST /api/v1/ai/image, five free
// images per day per IP, no payment), because the reconstruction worker's only
// hard rejection is a frame with no detectable face.
//
// Exit codes: 0 the avatar built, 1 the flow broke (the reason is printed and
// screenshots land in the output directory), 2 the run could not start.

import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUTH_STATE = path.join(ROOT, '.auth', 'audit-state.json');
const DEFAULT_ORIGIN = 'https://three.ws';
const PORTRAIT_PROMPT =
	'a photorealistic passport-style portrait photograph of a smiling adult person ' +
	'facing the camera directly, neutral grey background, even soft studio lighting, ' +
	'sharp focus, head and shoulders';

const args = new Map(
	process.argv.slice(2).map((raw) => {
		const [key, ...rest] = raw.replace(/^--/, '').split('=');
		return [key, rest.length ? rest.join('=') : 'true'];
	})
);

const origin = (args.get('origin') || DEFAULT_ORIGIN).replace(/\/$/, '');
const outDir = path.resolve(ROOT, args.get('out') || 'scripts/.selfie-verify');
const buildTimeoutMs = Number(args.get('timeout') || 10 * 60 * 1000);
const stallVision = args.get('stall-vision') === 'true';

const log = (msg) => console.log(`  ${msg}`);
function bail (code, msg) {
	console.error(`\n  ${msg}\n`);
	process.exit(code);
}

// A generated portrait is a real photograph as far as the pipeline is
// concerned: the same JPEG bytes a phone would hand it, through the same lane
// the platform already serves to agents.
async function generatePortrait () {
	log('no --photo given, generating one through /api/v1/ai/image');
	const res = await fetch(`${origin}/api/v1/ai/image`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ prompt: PORTRAIT_PROMPT, aspect_ratio: '1:1' }),
	});
	const payload = await res.json().catch(() => ({}));
	if (!res.ok || !payload.url) {
		bail(2, `the image lane returned ${res.status}: ${JSON.stringify(payload).slice(0, 300)}`);
	}
	const image = await fetch(payload.url);
	if (!image.ok) bail(2, `could not download the generated portrait: ${image.status}`);
	const file = path.join(outDir, 'portrait.jpg');
	await writeFile(file, Buffer.from(await image.arrayBuffer()));
	log(`portrait: ${payload.provider} / ${payload.model} -> ${file}`);
	return file;
}

await mkdir(outDir, { recursive: true });

const photo = args.get('photo') ? path.resolve(ROOT, args.get('photo')) : await generatePortrait();
if (!existsSync(photo)) bail(2, `no such photo: ${photo}`);
if (!existsSync(AUTH_STATE)) {
	bail(2, `no QA session at ${AUTH_STATE}. Run: npm run audit:web:login`);
}

const browser = await chromium.launch({ headless: args.get('headed') !== 'true' });
const context = await browser.newContext({
	storageState: AUTH_STATE,
	viewport: { width: 1280, height: 900 },
	permissions: [],
});

// The QA session is minted against production. Running the same flow against a
// dev server (which proxies /api to production) needs that cookie on the local
// origin too, or every call is anonymous and reconstruct answers 401.
if (!origin.includes('three.ws')) {
	const state = JSON.parse(await readFile(AUTH_STATE, 'utf8'));
	const session = (state.cookies || []).find((c) => c.name.endsWith('sid'));
	if (session) {
		const { hostname } = new URL(origin);
		await context.addCookies([{
			name: session.name,
			value: session.value,
			domain: hostname,
			path: '/',
			secure: true,
			httpOnly: true,
			sameSite: 'Lax',
		}]);
		log(`replayed ${session.name} onto ${origin}`);
	}
}

// Regression harness for the 2026-09-11 stall: with MediaPipe's runtime
// unreachable the capture gates and the refine pass lose their models, and the
// pipeline has to submit the unrefined frame instead of waiting forever.
if (stallVision) {
	await context.route('**/vision_wasm_internal.wasm', () => {});
	await context.route('**/*.tflite', () => {});
	log('vision runtime stalled on purpose (nothing will answer those requests)');
}
// The page tells its own story through selfie:* CustomEvents. Recording them
// from an init script means the run observes the real pipeline rather than
// guessing from DOM side effects (#build-model ships with a placeholder src,
// so "an element has a model" is not evidence that anything was built).
await context.addInitScript(() => {
	window.__selfieEvents = [];
	for (const name of ['selfie:photo', 'selfie:quality', 'selfie:preview', 'selfie:submit',
		'selfie:build', 'selfie:building', 'selfie:progress', 'selfie:done',
		'selfie:build-error', 'selfie:needs-byok']) {
		document.addEventListener(name, (ev) => {
			const detail = ev.detail || {};
			window.__selfieEvents.push({
				name,
				at: Date.now(),
				detail: {
					...detail,
					// A refined frame arrives as a multi-megabyte data URL. Keep the
					// fact, drop the payload.
					...(detail.dataUrl ? { dataUrl: `<${detail.dataUrl.length} bytes>` } : {}),
				},
			});
		});
	}
});

const page = await context.newPage();

const consoleErrors = [];
const failedRequests = [];
const apiCalls = [];
page.on('console', (msg) => {
	if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300));
});
page.on('requestfailed', (req) => {
	failedRequests.push(`${req.method()} ${req.url().slice(0, 160)}: ${req.failure()?.errorText}`);
});
// A refusal from the submit call itself is terminal: the job never starts, so
// no pipeline event will ever fire and waiting out the full build timeout only
// delays the answer. A full avatar library (402 plan_limit) cost one run ten
// minutes to report something the first response already said.
let submitRefusal = null;
page.on('response', async (res) => {
	const url = res.url();
	if (!url.includes('/api/avatars/')) return;
	const entry = { status: res.status(), url: url.replace(origin, '') };
	if (!res.ok()) entry.body = (await res.text().catch(() => '')).slice(0, 300);
	apiCalls.push(entry);
	log(`  ${entry.status} ${entry.url}${entry.body ? ` ${entry.body}` : ''}`);
	if (url.includes('/api/avatars/reconstruct') && res.status() >= 400) {
		let parsed = null;
		try { parsed = JSON.parse(entry.body || ''); } catch { parsed = null; }
		submitRefusal = {
			status: res.status(),
			code: parsed?.error || 'error',
			message: parsed?.error_description || entry.body || '(no body)',
		};
	}
});

const started = Date.now();
log(`opening ${origin}/create/selfie`);
await page.goto(`${origin}/create/selfie`, { waitUntil: 'domcontentloaded', timeout: 60_000 });

const signedIn = await page.evaluate(async () => {
	const res = await fetch('/api/auth/me', { credentials: 'include' });
	if (!res.ok) return null;
	const data = await res.json().catch(() => null);
	return data?.user?.email || data?.email || (data?.user ? 'session' : null);
});
if (!signedIn) {
	await browser.close();
	bail(2, 'the saved session is not authenticated at /api/auth/me. Re-run: npm run audit:web:login');
}
log(`signed in as ${signedIn}`);

const input = page.locator('input[data-slot-input="frontal"]');
await input.waitFor({ state: 'attached', timeout: 30_000 });
await input.setInputFiles(photo);
log('frontal photo attached, waiting for the capture gates');

const submit = page.locator('#submit-btn');
await submit.waitFor({ state: 'visible', timeout: 30_000 });
try {
	await page.waitForFunction(() => !document.getElementById('submit-btn')?.disabled, null, { timeout: 90_000 });
} catch {
	const notice = (await page.locator('#quality-notice .qn-text').textContent().catch(() => '')) || '';
	await page.screenshot({ path: path.join(outDir, 'gate-blocked.png'), fullPage: true });
	await browser.close();
	bail(1, `the capture gates never enabled the submit button. Quality notice: ${notice.trim() || '(none)'}`);
}
log('gates passed, submitting');
await submit.click();

// Wait on the pipeline's own terminal events. selfie:done carries the avatar
// id the job produced; selfie:build-error carries the message the user is
// shown. Anything else at the deadline is a stall, and the last progress label
// says where it stalled.
const outcome = await Promise.race([
	// The submit call was refused outright, so stop instead of waiting for a
	// pipeline that will never run.
	(async () => {
		while (!submitRefusal) await new Promise((r) => setTimeout(r, 250));
		return { state: 'refused', detail: `${submitRefusal.status} ${submitRefusal.code}: ${submitRefusal.message}`, ms: 0, events: [] };
	})(),
	page.evaluate(async (timeout) => {
	const started = Date.now();
	const events = () => window.__selfieEvents || [];
	const last = (name) => [...events()].reverse().find((e) => e.name === name);
	return await new Promise((resolve) => {
		const timer = setInterval(() => {
			const done = last('selfie:done');
			if (done) {
				clearInterval(timer);
				resolve({ state: 'built', detail: done.detail?.avatarId || '', ms: Date.now() - started, events: events() });
				return;
			}
			const failed = last('selfie:build-error') || last('selfie:needs-byok');
			if (failed) {
				clearInterval(timer);
				resolve({ state: 'error', detail: failed.detail?.message || failed.name, ms: Date.now() - started, events: events() });
				return;
			}
			if (Date.now() - started > timeout) {
				clearInterval(timer);
				// Read what the visitor can actually see. #build-status-text belongs
				// to the build view and holds "Processing your face..." from the
				// moment the page loads, so quoting it while the capture step is
				// still on screen invents a stage the flow never reached.
				const visibleStep = [...document.querySelectorAll('.step')]
					.find((el) => el.offsetParent !== null)?.dataset?.step || 'unknown';
				const onBuildView = visibleStep === 'building';
				const submitLabel = document.querySelector('#submit-btn .label')?.textContent?.trim()
					|| document.getElementById('submit-btn')?.textContent?.trim();
				const banner = document.querySelector('.unsupported.show')?.textContent?.trim();
				const status = onBuildView ? document.getElementById('build-status-text')?.textContent?.trim() : null;
				const progress = last('selfie:progress');
				resolve({
					state: 'timeout',
					detail: [
						`step=${visibleStep}`,
						progress?.detail?.label && `progress="${progress.detail.label}"`,
						status && `status="${status}"`,
						submitLabel && `button="${submitLabel}"`,
						banner && `banner="${banner}"`,
					].filter(Boolean).join(' '),
					ms: Date.now() - started,
					events: events(),
				});
			}
		}, 1000);
	});
}, buildTimeoutMs),
]);

const trail = (outcome.events || []).map((e) => e.name.replace('selfie:', '')).join(' -> ');
log(`pipeline: ${trail || '(no events fired)'}`);
const building = (outcome.events || []).find((e) => e.name === 'selfie:building');
if (building?.detail?.jobId) log(`job: ${building.detail.jobId}`);

const elapsed = ((Date.now() - started) / 1000).toFixed(0);
await page.screenshot({ path: path.join(outDir, `result-${outcome.state}.png`), fullPage: true });
await writeFile(
	path.join(outDir, 'run.json'),
	JSON.stringify({ origin, photo, outcome, apiCalls, consoleErrors, failedRequests, elapsedSeconds: Number(elapsed) }, null, '\t')
);
await browser.close();

console.log('')
if (consoleErrors.length) console.log(`  console errors: ${consoleErrors.length}\n    ${consoleErrors.slice(0, 5).join('\n    ')}`);
if (failedRequests.length) console.log(`  failed requests: ${failedRequests.length}\n    ${failedRequests.slice(0, 5).join('\n    ')}`);

if (outcome.state === 'built') {
	const avatar = outcome.detail ? `${origin}/avatars/${outcome.detail}` : '(no id in the event)';
	console.log(`\n  built in ${elapsed}s: ${avatar}\n  evidence in ${outDir}\n`);
	process.exit(0);
}
if (outcome.state === 'refused') {
	bail(1, `the reconstruct call was refused after ${elapsed}s: ${outcome.detail}\n  evidence in ${outDir}`);
}
if (outcome.state === 'error') bail(1, `the flow failed after ${elapsed}s: ${outcome.detail}\n  evidence in ${outDir}`);
bail(1, `no avatar after ${elapsed}s. Last status on screen: ${outcome.detail || '(blank)'}\n  evidence in ${outDir}`);
