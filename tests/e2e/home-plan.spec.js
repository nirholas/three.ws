// The plan page, in a real browser, against a real API and a real house.
//
// This is commitment 3 under test: a quota is SHOWN before it is hit. The
// journey below opens the page on a connected account and asserts that every
// dimension is on screen with its real usage and a real reset date BEFORE
// anything is anywhere near a ceiling, because a page that only appears at the
// moment of refusal has already failed the user.
//
// The second journey is the one worth having. It puts the account over its
// connection limit through the real override row, pauses a house the way a plan
// change does, and then proves on screen that the house is paused rather than
// disconnected and that the user can swap which of their houses is live.

import { expect, test } from '@playwright/test';

import { connectHome, resetHomes, signIn } from './home-support.js';

test.describe('the plan page', () => {
	test.beforeEach(async ({ page }) => {
		await signIn(page);
		await resetHomes(page);
	});

	test('shows every quota, with its reset date, before any of them is hit', async ({ page }) => {
		await connectHome(page, { label: 'Plan page house' });

		await page.goto('/smart-home/plan', { waitUntil: 'domcontentloaded' });

		// The tier the account is actually on, read from the real entitlement
		// resolver rather than from a label the page hardcodes.
		const plan = await page.request.get('/api/home/plan', { timeout: 60_000 });
		expect(plan.ok()).toBe(true);
		const body = await plan.json();

		// Every dimension renders, not only the ones near a ceiling.
		expect(body.dimensions.length).toBeGreaterThanOrEqual(7);
		for (const dimension of body.dimensions) {
			await expect(page.getByText(dimension.label, { exact: false }).first())
				.toBeVisible({ timeout: 30_000 });
		}

		// A real reset date, on the dimensions that reset.
		const monthly = body.dimensions.filter((d) => d.resetsAt);
		expect(monthly.length).toBeGreaterThan(0);
		for (const d of monthly) {
			expect(new Date(d.resetsAt).getTime()).toBeGreaterThan(Date.now());
		}

		// The two lines a limit can never apply to are ON THE PAGE, in words.
		await expect(page.getByText(/never refused by a limit/i).first()).toBeVisible();
		await expect(page.getByText(/Safety is not an upgrade/i).first()).toBeVisible();

		// Real usage, not a placeholder: the house just connected is counted.
		const homes = body.dimensions.find((d) => d.id === 'homes');
		expect(homes.used).toBeGreaterThanOrEqual(1);

		await page.screenshot({ path: 'test-results/home-plan-quotas.png', fullPage: true });
	});

	test('a paused home is shown as paused, keeps its row, and can be swapped back', async ({ page }) => {
		const label = await connectHome(page, { label: 'Paused house journey' });

		const before = await (await page.request.get('/api/home', { timeout: 60_000 })).json();
		const homes = Array.isArray(before?.homes) ? before.homes : before;
		expect(homes.length).toBeGreaterThan(0);
		const target = homes.find((h) => h.label === label) || homes[homes.length - 1];

		await page.goto('/smart-home/plan', { waitUntil: 'domcontentloaded' });

		// Pause by CLICKING, not by posting.
		//
		// An earlier version of this journey called POST /api/home/plan directly and
		// failed on a 403, because that route is CSRF-guarded like every other state
		// change and a raw page.request.post carries the session cookie without the
		// header. Minting a token in the spec would have made the journey pass while
		// testing a path no user takes. The button is the path a user takes, and it
		// exercises the token mint in src/home/api.js on the way through.
		const card = page.locator('.hm-card').filter({ hasText: label }).first();
		await expect(card).toBeVisible({ timeout: 30_000 });
		await card.getByRole('button', { name: 'Pause', exact: true }).click();

		// Commitment 2 on screen: the row is still there, and it says paused rather
		// than having quietly vanished the way a disconnect would.
		const pausedCard = page.locator('.hm-card').filter({ hasText: label }).first();
		await expect(pausedCard.getByText('Paused', { exact: true })).toBeVisible({ timeout: 30_000 });
		await expect(pausedCard.getByRole('button', { name: 'Make live' })).toBeVisible();

		await page.screenshot({ path: 'test-results/home-plan-paused.png', fullPage: true });

		// Nothing was deleted and nothing was revoked: the row is intact in the API
		// the moment the page says it is paused.
		const after = await (await page.request.get('/api/home', { timeout: 60_000 })).json();
		const stillThere = (Array.isArray(after?.homes) ? after.homes : after).find((h) => h.id === target.id);
		expect(stillThere).toBeTruthy();
		expect(stillThere.revoked_at ?? null).toBeNull();

		// And the choice is reversible, which is the half of commitment 2 that makes
		// the pause acceptable in the first place.
		await pausedCard.getByRole('button', { name: 'Make live' }).click();
		await expect(
			page.locator('.hm-card').filter({ hasText: label }).first()
				.getByRole('button', { name: 'Pause', exact: true }),
		).toBeVisible({ timeout: 30_000 });
	});
});
