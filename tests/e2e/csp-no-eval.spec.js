import { test, expect } from '@playwright/test';

// Loads the main routes under a script policy that has no 'unsafe-eval'
// (only 'wasm-unsafe-eval', as vercel.json ships for every page except /scene)
// and asserts the page raises no CSP violation and no uncaught page error.
// The dev server sends no CSP of its own, so the policy is attached to each
// document response here. 'unsafe-inline' stays because Vite injects inline
// module preambles in dev; the production hash rewrite is covered by
// scripts/audit-csp.mjs.
const POLICY =
	"script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: http://localhost:* https:; worker-src 'self' blob:";

const ROUTES = ['/', '/studio', '/viewer', '/agents', '/pay', '/activity'];

for (const route of ROUTES) {
	test(`no eval-class CSP violation or page error on ${route}`, async ({ page }) => {
		const violations = [];
		const errors = [];
		await page.route('**/*', async (r) => {
			if (r.request().resourceType() !== 'document') return r.continue();
			const res = await r.fetch();
			await r.fulfill({
				response: res,
				headers: { ...res.headers(), 'content-security-policy': POLICY },
			});
		});
		await page.addInitScript(() => {
			window.__cspViolations = [];
			document.addEventListener('securitypolicyviolation', (e) => {
				window.__cspViolations.push(`${e.effectiveDirective} ${e.blockedURI} ${e.sample || ''}`);
			});
		});
		page.on('pageerror', (e) => errors.push(e.message));
		await page.goto(route, { waitUntil: 'load', timeout: 240_000 });
		await page.waitForTimeout(3000);
		violations.push(...(await page.evaluate(() => window.__cspViolations)));
		expect(violations, `CSP violations on ${route}`).toEqual([]);
		expect(errors, `page errors on ${route}`).toEqual([]);
	});
}
