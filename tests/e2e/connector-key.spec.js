import { test, expect, request as playwrightRequest } from '@playwright/test';
import { randomBytes } from 'node:crypto';

// An API key made for an AI agent, end to end, as a real person.
//
// Grok Bot can hold an API key as a Bot secret and use it unattended. This
// signs in as the QA account, makes a key with the "For an AI agent" preset on
// /dashboard/api, checks the table marks it as a key that cannot spend, then
// uses it the way Grok Bot's cloud would: a tool that edits nothing runs, and
// a tool that moves funds answers with the JSON-RPC error that names the
// browser session. Revoking it in the table cuts it off on the next request.
//
// Needs AUDIT_EMAIL / AUDIT_PASSWORD (`npm run audit:web:provision` makes
// them) and skips cleanly without them. It talks to whatever API the dev
// server proxies to, so run the API from this tree beside it to test local
// code (docs/mcp.md, "Client compatibility").

const EMAIL = process.env.AUDIT_EMAIL;
const PASSWORD = process.env.AUDIT_PASSWORD;
const SHOTS = process.env.CONNECTOR_KEY_SHOTS || '';

function mcpCall(api, origin, key, name, args = {}) {
	return api.post(`${origin}/api/mcp`, {
		headers: {
			authorization: `Bearer ${key}`,
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
		},
		data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
	});
}

async function shot(page, name) {
	if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

test.describe('API keys for AI agents', () => {
	test.skip(!EMAIL || !PASSWORD, 'needs AUDIT_EMAIL and AUDIT_PASSWORD (npm run audit:web:provision)');

	test('the connector preset issues a key that works, cannot spend, and dies on revoke', async ({ page, baseURL }) => {
		test.setTimeout(240_000);
		const origin = baseURL.replace(/\/$/, '');
		const name = `Grok Bot e2e ${randomBytes(3).toString('hex')}`;
		const machine = await playwrightRequest.newContext();

		const login = await page.context().request.post(`${origin}/api/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
		expect(login.ok(), `login failed: HTTP ${login.status()}`).toBe(true);

		await page.goto(`${origin}/dashboard/api`);
		await page.getByRole('button', { name: '+ New key' }).first().click();
		const dialog = page.getByRole('dialog');
		await expect(dialog.getByText('What is this key for?')).toBeVisible();

		// The custom scopes are the default; the preset swaps them for a locked list.
		await expect(dialog.locator('[data-slot="custom-scopes"]')).toBeVisible();
		await dialog.getByText('For an AI agent').click();
		await expect(dialog.locator('[data-slot="custom-scopes"]')).toBeHidden();
		const locked = dialog.locator('[data-slot="connector-scopes"]');
		await expect(locked).toBeVisible();
		await expect(locked).toContainText('agents:write');
		await expect(locked).toContainText('wallet:write');
		await expect(dialog.locator('input[name="name"]')).toHaveAttribute('placeholder', 'e.g. Grok Bot');
		await shot(page, '1-preset');

		// Error state: a missing name is caught before any request.
		await dialog.getByRole('button', { name: 'Create key' }).click();
		await expect(dialog.locator('input[name="name"]:invalid')).toHaveCount(1);

		await dialog.locator('input[name="name"]').fill(name);
		const created = page.waitForResponse((r) => r.url().endsWith('/api/keys') && r.request().method() === 'POST');
		await dialog.getByRole('button', { name: 'Create key' }).click();
		const resp = await created;
		expect(resp.status()).toBe(201);
		const { key } = await resp.json();
		expect(key.scope.split(' ')).toEqual(['avatars:read', 'avatars:write', 'agents:read', 'agents:write', 'memory:read', 'memory:write', 'connector']);

		const reveal = page.getByRole('dialog');
		await expect(reveal.getByText('Give it to your agent')).toBeVisible();
		await expect(reveal.locator('[data-secret]')).toHaveText(key.secret);
		await shot(page, '2-reveal');
		await reveal.getByRole('button', { name: "I've saved it" }).click();

		const row = page.locator('tbody tr', { hasText: name });
		await expect(row.getByText('AI agent · cannot spend')).toBeVisible();
		await expect(row.locator('.dn-tag', { hasText: /^connector$/ })).toHaveCount(0);
		await shot(page, '3-table');

		// Used like Grok Bot would: no cookies, the key alone.
		const ok = await (await mcpCall(machine, origin, key.secret, 'list_my_avatars')).json();
		expect(ok.error, JSON.stringify(ok.error)).toBeUndefined();
		expect(ok.result.isError, JSON.stringify(ok.result)).not.toBe(true);

		const spend = await (await mcpCall(machine, origin, key.secret, 'agent_card_create', { confirm_spend: true })).json();
		expect(spend.error.code).toBe(-32003);
		expect(spend.error.message).toContain('needs a browser session on three.ws');
		expect(spend.error.data).toMatchObject({ reason: 'connector_key_cannot_spend', url: 'https://three.ws/dashboard' });

		// The REST spend routes refuse it the same way.
		const rest = await machine.post(`${origin}/api/monetization/withdrawals`, {
			headers: { authorization: `Bearer ${key.secret}`, 'content-type': 'application/json' },
			data: { amount: 1 },
		});
		expect(rest.status()).toBe(403);
		expect((await rest.json()).error_description).toContain('Connector keys');

		await row.getByRole('button', { name: `Revoke API key ${name}` }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'Revoke key' }).click();
		await expect(page.locator('tbody tr', { hasText: name })).toHaveCount(0);
		const after = await mcpCall(machine, origin, key.secret, 'list_my_avatars');
		expect(after.status()).toBe(401);
		await machine.dispose();
	});
});
