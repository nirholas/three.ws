/**
 * Forge — text → 3D (free NVIDIA lane). Playwright e2e.
 *
 * Drives the real /forge page (src/forge.js): the catalog loads, the free
 * NVIDIA engine is pickable, a prompt + Generate runs the real submit→run→
 * showResult path, and the stage transitions empty → generating → result with
 * the <model-viewer> mounted on the returned GLB.
 *
 * The Forge backend (/api/forge) is fulfilled at the route layer with realistic
 * payloads — the free draft lane completes synchronously (status:"done" + a
 * glb_url, job_id:null), exactly as src/forge.js expects (see the comment at
 * run() about the NVIDIA NIM synchronous path). The client makes the real
 * fetches; we assert the real POST body and the rendered result state.
 */

import { test, expect } from '@playwright/test';

// A served, real GLB so <model-viewer> has something valid to point at.
const RESULT_GLB = '/avatars/default.glb';

const CATALOG = {
	backends: [
		{
			id: 'nvidia',
			label: 'NVIDIA NIM',
			blurb: 'Free, fast text-to-3D',
			configured: true,
			free: true,
			byok: null,
			paths: ['image'],
			poly_control: false,
			user_images: true,
			estimates: { image: [{ tier: 'draft', eta_seconds: 18, credits: 0 }] },
		},
	],
	tiers: [
		{ id: 'draft', label: 'Draft', polycount: 50000 },
		{ id: 'standard', label: 'Standard', polycount: 150000 },
		{ id: 'high', label: 'High', polycount: 500000 },
	],
	default_backend: { image: 'nvidia', geometry: 'nvidia' },
	default_backend_for_tier: {
		draft: { image: 'nvidia', geometry: 'nvidia' },
		standard: { image: 'nvidia', geometry: 'nvidia' },
		high: { image: 'nvidia', geometry: 'nvidia' },
	},
};

const HEALTH = { backends: { nvidia: { status: 'up', message: '' } } };

const DONE = {
	job_id: null,
	status: 'done',
	glb_url: RESULT_GLB,
	creation_id: 'e2e-forge-1',
	backend: 'nvidia',
	tier: 'draft',
	path: 'image',
};

/**
 * Fulfil every /api/forge* endpoint the page touches.
 * @param {(body:object)=>{status?:number,json:object}} [post] override the POST response.
 */
async function installForge(page, post) {
	const calls = { post: null };
	await page.route(
		(url) => url.pathname === '/api/forge',
		async (route) => {
			const req = route.request();
			const url = new URL(req.url());
			if (req.method() === 'GET' && url.searchParams.get('catalog')) return route.fulfill({ json: CATALOG });
			if (req.method() === 'GET' && url.searchParams.get('health')) return route.fulfill({ json: HEALTH });
			if (req.method() === 'GET' && url.searchParams.get('job')) {
				return route.fulfill({ json: { status: 'done', glb_url: RESULT_GLB, backend: 'nvidia', tier: 'draft', path: 'image' } });
			}
			if (req.method() === 'POST') {
				calls.post = JSON.parse(req.postData() || '{}');
				const out = post ? post(calls.post) : { json: DONE };
				return route.fulfill({ status: out.status || 200, json: out.json });
			}
			return route.fulfill({ json: {} });
		},
	);
	await page.route((url) => url.pathname === '/api/forge-gallery', (r) => r.fulfill({ json: { enabled: false, creations: [] } }));
	for (const p of ['/api/forge-feedback', '/api/forge-categorize', '/api/forge-poster']) {
		await page.route((url) => url.pathname === p, (r) => r.fulfill({ json: { ok: true } }));
	}
	return calls;
}

test.describe('Forge — text → 3D', () => {
	test('empty → pick free NVIDIA → generate → result viewer mounts', async ({ page }) => {
		test.setTimeout(120_000);
		const calls = await installForge(page);

		await page.goto('/forge');

		// Empty state is the designed starting state.
		const empty = page.locator('#state-empty');
		await expect(empty).toBeVisible();
		await expect(page.locator('#state-result')).toBeHidden();

		// Catalog-driven engine picker renders the free NVIDIA lane with a FREE pill.
		const freeEngine = page.locator('#engine button', { has: page.locator('.eng-free') });
		// The picker is built after the page's module graph finishes loading and
		// the catalog answers. On a cold Vite dev server that graph transform is
		// the 30-60s budget playwright.config.js documents, and 30s here flaked
		// exactly there (first attempt red, retry green). Same ceiling as the
		// cold-start budget, so a genuinely missing picker still fails.
		await expect(freeEngine).toBeVisible({ timeout: 60_000 });
		await expect(freeEngine).toHaveAttribute('data-backend', 'nvidia');
		await freeEngine.click();
		await expect(freeEngine).toHaveAttribute('aria-pressed', 'true');

		// Type a prompt and forge.
		await page.locator('textarea#prompt').fill('a worn leather armchair, studio lighting');
		await page.locator('#generate').click();

		// The result state is the durable end state; the synchronous free lane can
		// race past the transient generating panel, so assert the result directly.
		const result = page.locator('#state-result');
		await expect(result).toBeVisible({ timeout: 60_000 });
		await expect(empty).toBeHidden();

		// The GLB viewer mounted on the returned model.
		await expect(page.locator('#viewer')).toHaveAttribute('src', /default\.glb/);

		// The real POST fired with the prompt + the free NVIDIA backend.
		expect(calls.post).toMatchObject({ prompt: /armchair/, backend: 'nvidia' });
	});

	test('a backend failure surfaces actionable copy, not a blank result', async ({ page }) => {
		test.setTimeout(120_000);
		await installForge(page, () => ({
			status: 503,
			json: { error: 'unconfigured', message: 'The free engine is temporarily unavailable.' },
		}));

		await page.goto('/forge');
		await expect(page.locator('#engine button', { has: page.locator('.eng-free') })).toBeVisible({ timeout: 30_000 });
		await page.locator('textarea#prompt').fill('a small ceramic mug');
		await page.locator('#generate').click();

		// Never lands on a blank result; the designed "unconfigured" state takes over.
		await expect(page.locator('#state-unconfigured')).toBeVisible({ timeout: 30_000 });
		await expect(page.locator('#state-result')).toBeHidden();
	});
});
