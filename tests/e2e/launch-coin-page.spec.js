import { test, expect } from '@playwright/test';

// Regression guards for /launch, the "Launch a Coin" page.
//
// Two bugs this pins down, both found by driving the page as a first-time user
// with a real session and a real agent list:
//
// 1. The primary CTA went dead the moment the form became valid. The panel
//    patches the name/symbol/description inputs into the DOM instead of
//    re-rendering (a full render on each keystroke destroys the caret), and the
//    launch button's label and data-action were only ever computed inside that
//    render. So a visitor who arrived with the description empty (the real
//    default: the panel prefills name and symbol from the avatar, never the
//    description) filled the form and was left with a button still reading
//    "Add name, symbol & description to launch" whose focus-form action found no
//    empty field and did nothing at all. The one action the page exists for was
//    unreachable.
// 2. Pressing that CTA with a field missing moved the caret into the gap and
//    explained nothing: the inline "… is required." hints only appeared after a
//    field had been visited and blurred, which pressing the CTA never did.
//
// A third guard covers the picker: a failing /api/avatars used to be reported to
// a signed-in owner as "No agents yet … create one first", pushing them toward a
// duplicate agent, because the loader swallowed every fault into an empty list.
//
// Auth and the agent list are stubbed at the network seam (the nav-auth.spec.js
// technique); everything from the keystroke to the assertion is shipped code.

const USER = { id: 'launch-test-user', handle: 'tester', email: 'tester@example.test' };
const AVATARS = [
	{
		id: 'launch-test-avatar-1',
		name: 'Overlay Knight',
		slug: 'overlay-knight',
		// Deliberately blank: the panel prefills the token description from the
		// avatar's, so an avatar WITH one opens on an already-valid form and
		// hides the exact bug these tests exist for. A freshly forged avatar has
		// no description, which is the case that shipped broken.
		description: '',
		thumbnail_url: null,
		visibility: 'public',
	},
];

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

// Only the agent-list read, never the per-avatar /api/avatars/:id/* routes.
const isAvatarList = (url) => url.pathname === '/api/avatars';

function stubSession(page, { avatars = AVATARS } = {}) {
	return Promise.all([
		page.route('**/api/auth/me', (route) => route.fulfill(json({ user: USER }))),
		page.route(isAvatarList, (route) => route.fulfill(json({ avatars }))),
		// The panel blocks on this check before it will paint the form: a synthetic
		// agent id has no launch record, so answer the real "no token yet" shape.
		page.route('**/api/pump/by-agent**', (route) => route.fulfill(json({ data: null }))),
	]);
}

// The panel mounts asynchronously behind a runtime import; wait for the CTA.
async function openLaunch(page) {
	await page.goto('/launch', { waitUntil: 'domcontentloaded' });
	await expect(page.locator('#lp-go')).toBeVisible({ timeout: 60_000 });
}

test.describe('/launch · Launch a Coin', () => {
	test.beforeEach(({ page }) => {
		page.on('pageerror', (err) => {
			// Vite HMR socket noise on the forwarded Codespace port is not a product bug.
			if (/websocket|hmr|wss:|failed to connect/i.test(err.message)) return;
			throw new Error(`Page error: ${err.message}`);
		});
	});

	test('the launch CTA becomes a real action as soon as the form is complete', async ({ page }) => {
		test.setTimeout(120_000);
		await stubSession(page);
		await openLaunch(page);

		const cta = page.locator('#lp-go');
		// The avatar prefills name and symbol but never the description, so the
		// page opens on the "something is missing" CTA.
		await expect(cta).toHaveAttribute('data-action', 'focus-form');
		await expect(page.locator('#lp-desc')).toHaveValue('');

		await page.fill('#lp-desc', 'A knight that answers lore questions for a fee.');

		// The CTA must leave focus-form the moment the last gap is filled, with no
		// blur, no re-render and no other interaction.
		await expect(cta).not.toHaveAttribute('data-action', 'focus-form');
		await expect(cta).not.toContainText('Add name, symbol');
		// It also has to carry a real explanation of what pressing it does.
		await expect(cta).toHaveAttribute('title', /.+/);

		// And it must go back when the form stops being valid.
		await page.fill('#lp-name', '');
		await expect(cta).toHaveAttribute('data-action', 'focus-form');
	});

	test('pressing the CTA with a gap says which field is missing', async ({ page }) => {
		test.setTimeout(120_000);
		await stubSession(page);
		await openLaunch(page);

		const hint = page.locator('#lp-desc-msg');
		await expect(hint).toBeHidden();

		await page.click('#lp-go');

		await expect(hint).toBeVisible();
		await expect(hint).toContainText('required');
		await expect(page.locator('#lp-desc')).toHaveAttribute('aria-invalid', 'true');
		await expect(page.locator('#lp-desc')).toBeFocused();

		// Typing clears the hint again.
		await page.fill('#lp-desc', 'A knight that answers lore questions for a fee.');
		await expect(hint).toBeHidden();
		await expect(page.locator('#lp-desc')).toHaveAttribute('aria-invalid', 'false');
	});

	test('a failing agent list reports the fault and recovers on retry', async ({ page }) => {
		test.setTimeout(120_000);
		let failing = true;
		await page.route('**/api/auth/me', (route) => route.fulfill(json({ user: USER })));
		await page.route('**/api/pump/by-agent**', (route) => route.fulfill(json({ data: null })));
		await page.route(isAvatarList, (route) =>
			failing
				? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' })
				: route.fulfill(json({ avatars: AVATARS })),
		);

		await page.goto('/launch', { waitUntil: 'domcontentloaded' });

		const err = page.locator('.lc-err');
		await expect(err).toBeVisible({ timeout: 60_000 });
		await expect(err).toContainText('Could not load your agents');
		// The fault is named, not disguised as an empty account.
		await expect(err).toContainText('503');
		await expect(page.locator('.lc-pick')).not.toContainText('No agents yet');

		failing = false;
		await page.click('#lc-retry');

		await expect(page.locator('.lc-card')).toHaveCount(AVATARS.length, { timeout: 30_000 });
		await expect(page.locator('.lc-err')).toHaveCount(0);
	});
});
