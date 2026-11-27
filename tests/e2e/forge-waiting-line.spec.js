/**
 * Forge: the waiting line in front of the image step, on the page. Playwright e2e.
 *
 * When the shared text-to-image step is saturated, /api/forge answers a text
 * request with a place in line (429 forge_queued) or, past the line's depth,
 * with "full" (503 forge_full). The bodies below are exactly what
 * api/_lib/forge-line.js lineAnswer() and lineStatusBody() send. The page must
 * show the place and the wait, keep it by checking in at /api/forge?line=1,
 * resubmit on its turn, give the place up on Cancel, and never call "busy" a
 * "generation limit".
 *
 * Every /api/forge call is answered at the route layer, and every other
 * non-GET API call is swallowed, so nothing here reaches production and no
 * generation starts (the dev server proxies unrouted /api/* upstream).
 */

import { test, expect } from '@playwright/test';

const RESULT_GLB = '/avatars/default.glb';

const CATALOG = {
	backends: [
		{
			id: 'trellis_selfhost',
			label: 'TRELLIS',
			blurb: 'Free text-to-3D on our own GPU',
			configured: true,
			free: true,
			byok: null,
			paths: ['image'],
			poly_control: false,
			user_images: true,
			estimates: { image: [{ tier: 'draft', eta_seconds: 150, credits: 0 }] },
		},
	],
	tiers: [
		{ id: 'draft', label: 'Draft', polycount: 50000 },
		{ id: 'standard', label: 'Standard', polycount: 150000 },
		{ id: 'high', label: 'High', polycount: 500000 },
	],
	default_backend: { image: 'trellis_selfhost', geometry: 'trellis_selfhost' },
	default_backend_for_tier: {
		draft: { image: 'trellis_selfhost', geometry: 'trellis_selfhost' },
		standard: { image: 'trellis_selfhost', geometry: 'trellis_selfhost' },
		high: { image: 'trellis_selfhost', geometry: 'trellis_selfhost' },
	},
};

const HEALTH = { backends: { trellis_selfhost: { status: 'up', message: '' } } };

const DONE = {
	job_id: null,
	status: 'done',
	glb_url: RESULT_GLB,
	creation_id: 'e2e-line-1',
	backend: 'trellis_selfhost',
	tier: 'draft',
	path: 'image',
};

// A queued submit answer in the shape the server's lineAnswer helper returns.
function queued({ position, ahead, depth, eta, check = 1 }) {
	return {
		status: 429,
		headers: { 'retry-after': String(check) },
		json: {
			error: 'forge_queued',
			queued: true,
			position,
			ahead,
			depth,
			eta_seconds: eta,
			interval_seconds: 45,
			retry_after: check,
			check_again_seconds: check,
			line_url: '/api/forge?line=1',
			message:
				position === 1
					? `You're next. Your generation starts in about ${eta} seconds.`
					: `You're number ${position} in line. Your generation starts in about 2 minutes.`,
		},
	};
}

// lineStatusBody() for someone still waiting, or whose turn it is.
function status({ position, ahead, depth, eta, turn = false, check = 1 }) {
	return {
		in_line: true,
		your_turn: turn,
		position,
		ahead,
		depth,
		eta_seconds: turn ? 0 : eta,
		interval_seconds: 45,
		check_again_seconds: turn ? 0 : check,
	};
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ post: (n:number)=>{status?:number,headers?:object,json:object}, line?: (n:number)=>Promise<object>|object }} h
 */
async function installForge(page, h) {
	const calls = { posts: 0, lineGets: 0, lineDeletes: 0 };
	// Registered first so the specific routes below win: any other write the
	// page makes is answered here instead of reaching production.
	await page.route(
		(url) => url.pathname.startsWith('/api/'),
		(route) => (route.request().method() === 'GET' ? route.fallback() : route.fulfill({ json: { ok: true } })),
	);
	await page.route((url) => url.pathname === '/api/auth/me', (r) => r.fulfill({ json: { user: { id: 'e2e-line-user' } } }));
	await page.route(
		(url) => url.pathname === '/api/forge',
		async (route) => {
			const req = route.request();
			const url = new URL(req.url());
			if (url.searchParams.has('line')) {
				if (req.method() === 'DELETE') {
					calls.lineDeletes += 1;
					return route.fulfill({ json: { in_line: false, your_turn: false, depth: 0, active: false } });
				}
				calls.lineGets += 1;
				const body = h.line ? await h.line(calls.lineGets) : { in_line: false, your_turn: false, depth: 0, active: false };
				return route.fulfill({ json: body });
			}
			if (req.method() === 'GET' && url.searchParams.get('catalog')) return route.fulfill({ json: CATALOG });
			if (req.method() === 'GET' && url.searchParams.get('health')) return route.fulfill({ json: HEALTH });
			if (req.method() === 'GET' && url.searchParams.get('job')) return route.fulfill({ json: DONE });
			if (req.method() === 'POST') {
				calls.posts += 1;
				const out = h.post(calls.posts);
				return route.fulfill({ status: out.status || 200, headers: out.headers, json: out.json });
			}
			return route.fulfill({ json: {} });
		},
	);
	await page.route((url) => url.pathname === '/api/forge-gallery', (r) => r.fulfill({ json: { enabled: false, creations: [] } }));
	return calls;
}

async function submitPrompt(page, path) {
	await page.goto(path);
	const engine = page.locator('#engine button', { has: page.locator('.eng-free') });
	// Cold Vite graph transform budget, same as forge-text-to-3d.spec.js.
	await expect(engine).toBeVisible({ timeout: 60_000 });
	await engine.click();
	await page.locator('textarea#prompt').fill('a brass diving helmet with rivets');
	await page.locator('#generate').click();
}

function gate() {
	let open;
	const p = new Promise((resolve) => (open = resolve));
	return { wait: () => p, open: () => open() };
}

for (const path of ['/forge', '/forge-studio']) {
	test.describe(`Forge waiting line on ${path}`, () => {
		test('a place in line is shown, kept by checking in, and resubmitted on its turn', async ({ page }) => {
			test.setTimeout(120_000);
			const firstCheckIn = gate();
			const calls = await installForge(page, {
				post: (n) => (n === 1 ? queued({ position: 3, ahead: 2, depth: 5, eta: 130 }) : { json: DONE }),
				line: async (n) => {
					if (n === 1) {
						await firstCheckIn.wait();
						return status({ position: 2, ahead: 1, depth: 4, eta: 85 });
					}
					return status({ position: 1, ahead: 0, depth: 3, eta: 0, turn: true });
				},
			});
			await submitPrompt(page, path);

			const card = page.locator('#state-generating .forge-line');
			await expect(card).toBeVisible({ timeout: 30_000 });
			await expect(card).toContainText("You're number 3 in line");
			await expect(card).toContainText('2 ahead of you');
			// Waiting is not generating: the "feel free to leave" promise is false here.
			await expect(page.locator('#state-generating .gen-leave-hint')).toBeHidden();
			await expect(page.locator('#state-error')).toBeHidden();
			await expect(page.getByText('Generation limit reached')).toHaveCount(0);

			firstCheckIn.open();
			await expect(card).toContainText("You're number 2 in line");

			// Its turn: the page resubmits on its own and the model arrives.
			await expect(page.locator('#state-result')).toBeVisible({ timeout: 60_000 });
			expect(calls.posts).toBe(2);
			expect(calls.lineGets).toBeGreaterThanOrEqual(2);
			await expect(card).toHaveCount(0);
		});

		test('Cancel while in line gives the place up', async ({ page }) => {
			test.setTimeout(120_000);
			const calls = await installForge(page, {
				post: () => queued({ position: 4, ahead: 3, depth: 6, eta: 170 }),
				line: () => status({ position: 4, ahead: 3, depth: 6, eta: 160 }),
			});
			await submitPrompt(page, path);
			const card = page.locator('#state-generating .forge-line');
			await expect(card).toContainText("You're number 4 in line", { timeout: 30_000 });

			await page.locator('#cancel').click();
			await expect(page.locator('#state-empty')).toBeVisible();
			await expect.poll(() => calls.lineDeletes).toBe(1);
			const getsAtCancel = calls.lineGets;
			await page.waitForTimeout(2500);
			expect(calls.lineGets).toBe(getsAtCancel);
			expect(calls.posts).toBe(1);
		});

		test('a full line says so and when to come back', async ({ page }) => {
			test.setTimeout(120_000);
			await installForge(page, {
				post: () => ({
					status: 503,
					headers: { 'retry-after': '240' },
					json: {
						error: 'forge_full',
						queued: false,
						depth: 20,
						max_depth: 20,
						retry_after: 240,
						message: 'Forge is full right now: 20 people are already waiting for the image step. Come back in about 4 minutes.',
					},
				}),
			});
			await submitPrompt(page, path);
			const error = page.locator('#state-error');
			await expect(error).toBeVisible({ timeout: 30_000 });
			await expect(page.locator('#error-title')).toHaveText('Forge is full right now');
			await expect(page.locator('#error-message')).toContainText('20 people are already waiting');
			await expect(page.locator('#error-message')).toContainText(/in [34]:\d\d/);
			await expect(page.locator('#retry')).toBeDisabled();
		});

		test('an upstream busy answer reads as busy, the allowance as a limit', async ({ page }) => {
			test.setTimeout(120_000);
			await installForge(page, {
				post: (n) =>
					n === 1
						? {
								status: 429,
								headers: { 'retry-after': '3' },
								json: {
									error: 'rate_limited',
									queued: false,
									message: 'The 3D generator is busy right now. Try again in a few seconds.',
									retry_after: 3,
								},
							}
						: {
								status: 429,
								headers: { 'retry-after': '30' },
								json: { error: 'rate_limited', message: 'Generation limit reached. Try again shortly.', retry_after: 30 },
							},
			});
			await submitPrompt(page, path);
			await expect(page.locator('#state-error')).toBeVisible({ timeout: 30_000 });
			await expect(page.locator('#error-title')).toHaveText('High demand right now');
			await expect(page.locator('#retry')).toBeEnabled({ timeout: 10_000 });

			await page.locator('#retry').click();
			await expect(page.locator('#error-title')).toHaveText('Generation limit reached', { timeout: 30_000 });
		});
	});
}
