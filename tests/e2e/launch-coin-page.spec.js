import { test, expect } from '@playwright/test';

// Regression guards for /launch, the "Launch a Coin" page, in both of the
// launchers it serves.
//
// /launch is the launchpad (src/launch/launch-page.js). A Launch Studio recipe
// link (/launch?reward=...) needs the fee-split handoff that only the full
// studio panel owns, so those visits mount that panel instead
// (public/launch/launch.js). Each launcher is guarded against the same three
// first-time-user failures:
//
// 1. A dead primary CTA. The recipe panel patches the name/symbol/description
//    inputs into the DOM instead of re-rendering (a full render on each
//    keystroke destroys the caret), and its launch button's label and
//    data-action were once only computed inside that render, so a visitor who
//    filled the form was left with a button still reading "Add name, symbol &
//    description to launch" that did nothing. The launchpad's button has to arm
//    itself the same way: on the keystroke that completes the form, with no
//    blur and no re-render.
// 2. A gap with no explanation. Pressing the CTA (recipe panel) or reading the
//    checklist (launchpad) has to name the missing field and take the caret to
//    it.
// 3. A fault disguised as an empty account. A failing /api/avatars used to be
//    reported to a signed-in owner as "No agents yet ... create one first",
//    pushing them toward a duplicate agent, because the loader swallowed every
//    fault into an empty list.
//
// Auth, the agent list and the launch reads are stubbed at the network seam
// (the nav-auth.spec.js technique; the dev server would otherwise proxy them to
// production); everything from the keystroke to the assertion is shipped code.

const USER = { id: 'launch-test-user', handle: 'tester', email: 'tester@example.test' };
const AVATARS = [
	{
		id: 'launch-test-avatar-1',
		name: 'Overlay Knight',
		slug: 'overlay-knight',
		// Deliberately blank: the recipe panel prefills the token description
		// from the avatar's, so an avatar WITH one opens on an already-valid form
		// and hides the exact bug these tests exist for. A freshly forged avatar
		// has no description, which is the case that shipped broken.
		description: '',
		thumbnail_url: null,
		visibility: 'public',
	},
];

// A clearly synthetic custodial wallet for the agent-launch lane.
const AGENT_WALLET = { agent_id: 'launch-test-agent-1', address: 'THREEsynthetic111111111111111111111111111111', network: 'mainnet', lamports: 2e9, sol: 2 };

// The shape /api/pump/launch-config answers, minus the fields this page never reads.
const LAUNCH_CONFIG = {
	network: 'mainnet',
	launch_fee_bps: 100,
	launch_fee_basis: 'dev_buy',
	create_cost_sol_estimate: 0.022,
	max_sol_buy_in: 50,
	tx_v1: { active: false },
};

// What the API's error() helper sends for an upstream outage.
const AGENTS_DOWN = { error: 'service_unavailable', error_description: 'the agent directory is temporarily unavailable' };

const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

// Only the agent-list read, never the per-avatar /api/avatars/:id/* routes.
const isAvatarList = (url) => url.pathname === '/api/avatars';

// A recipe link: creator fees route to an X account, so /launch mounts the
// full studio panel. The handle is the platform's own.
const RECIPE_URL = '/launch?reward=x:trythreews';

function stubSession(page, { avatars = AVATARS, avatarsStatus = () => 200 } = {}) {
	return Promise.all([
		page.route('**/api/auth/me', (route) => route.fulfill(json({ user: USER }))),
		page.route(isAvatarList, (route) => {
			const status = avatarsStatus();
			return route.fulfill(status === 200 ? json({ avatars }) : json(AGENTS_DOWN, status));
		}),
		// The recipe panel blocks on this check before it will paint the form: a
		// synthetic agent id has no launch record, so answer the real "no token
		// yet" shape.
		page.route('**/api/pump/by-agent**', (route) => route.fulfill(json({ data: null }))),
		page.route('**/api/pump/launch-config**', (route) => route.fulfill(json({ data: LAUNCH_CONFIG }))),
		page.route('**/api/pump/agent-wallet', (route) => route.fulfill(json(AGENT_WALLET))),
	]);
}

test.beforeEach(({ page }) => {
	page.on('pageerror', (err) => {
		// Vite HMR socket noise on the forwarded Codespace port is not a product bug.
		if (/websocket|hmr|wss:|failed to connect/i.test(err.message)) return;
		throw new Error(`Page error: ${err.message}`);
	});
});

test.describe('/launch · the launchpad', () => {
	// The page boots its agent list behind the session check; wait for the pick.
	async function openLaunchpad(page) {
		await page.goto('/launch', { waitUntil: 'domcontentloaded' });
		await expect(page.locator('.lx-agent[aria-checked="true"]')).toBeVisible({ timeout: 60_000 });
	}

	// Launch from the agent's own wallet: the lane a headless browser can sign
	// for, since it carries no wallet extension.
	async function launchFromAgent(page) {
		await page.click('[data-seg="launcher"][data-value="agent"]');
		await expect(page.locator('#lx-wallet')).toContainText('Agent wallet');
	}

	test('the launch button arms itself on the keystroke that completes the form', async ({ page }) => {
		test.setTimeout(120_000);
		await stubSession(page);
		await openLaunchpad(page);
		await launchFromAgent(page);

		const cta = page.locator('#lx-launch');
		const checklist = page.locator('#lx-checklist');
		await expect(cta).toBeDisabled();
		await expect(checklist).toContainText('Name your coin');

		await page.fill('#f-name', 'Overlay Knight');

		// The ticker is suggested from the name, and the button arms with no blur
		// and no other interaction, naming exactly what it will launch.
		const ticker = await page.locator('#f-symbol').inputValue();
		expect(ticker.length).toBeGreaterThanOrEqual(2);
		await expect(cta).toBeEnabled();
		await expect(cta).toHaveText(`Launch $${ticker}`);
		await expect(checklist).toBeHidden();

		// And it disarms the moment the form stops being valid.
		await page.fill('#f-name', '');
		await expect(cta).toBeDisabled();
		await expect(checklist).toContainText('Name your coin');
	});

	test('every gap is named and one click from its field', async ({ page }) => {
		test.setTimeout(120_000);
		await stubSession(page);
		await openLaunchpad(page);
		await launchFromAgent(page);

		const checklist = page.locator('#lx-checklist');
		await expect(checklist.locator('[data-focus="name"]')).toHaveText('Name your coin');
		await expect(checklist.locator('[data-focus="symbol"]')).toContainText('Ticker');

		await checklist.locator('[data-focus="symbol"]').click();
		await expect(page.locator('#f-symbol')).toBeFocused();
		await checklist.locator('[data-focus="name"]').click();
		await expect(page.locator('#f-name')).toBeFocused();

		// Filling the field clears its line from the checklist as it is typed.
		await page.keyboard.type('Overlay Knight');
		await expect(checklist.locator('[data-focus="name"]')).toHaveCount(0);
	});

	test('a failing agent list reports the fault and recovers on retry', async ({ page }) => {
		test.setTimeout(120_000);
		let failing = true;
		await stubSession(page, { avatarsStatus: () => (failing ? 503 : 200) });
		await page.goto('/launch', { waitUntil: 'domcontentloaded' });

		const err = page.locator('#lx-agents .lx-empty.is-error');
		await expect(err).toBeVisible({ timeout: 60_000 });
		await expect(err).toContainText('Could not load your agents');
		// The fault is named, not disguised as an empty account.
		await expect(err).toContainText(AGENTS_DOWN.error_description);
		await expect(page.locator('#lx-agents')).not.toContainText("You don't have an agent yet");

		failing = false;
		await page.click('#agents-retry');

		await expect(page.locator('.lx-agent')).toHaveCount(AVATARS.length, { timeout: 30_000 });
		await expect(page.locator('#lx-agents .is-error')).toHaveCount(0);
	});
});

test.describe('/launch?reward= · the recipe launcher', () => {
	// The panel mounts asynchronously behind a runtime import; wait for the CTA.
	async function openRecipe(page) {
		await page.goto(RECIPE_URL, { waitUntil: 'domcontentloaded' });
		await expect(page.locator('#lp-go')).toBeVisible({ timeout: 60_000 });
	}

	test('the launch CTA becomes a real action as soon as the form is complete', async ({ page }) => {
		test.setTimeout(120_000);
		await stubSession(page);
		await openRecipe(page);

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
		await openRecipe(page);

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
		await stubSession(page, { avatarsStatus: () => (failing ? 503 : 200) });
		await page.goto(RECIPE_URL, { waitUntil: 'domcontentloaded' });

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
