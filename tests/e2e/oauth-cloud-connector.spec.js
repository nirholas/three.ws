// A cloud connector (Grok Bot) signs in to /api/mcp the way it does in production:
// dynamic registration with an external https redirect URI, the PKCE
// authorization-code flow as the QA account, tools/list with the token, then the
// person revokes it from Settings and the very next call fails.
//
// Needs AUDIT_EMAIL / AUDIT_PASSWORD (.env; `npm run audit:web:provision` creates
// them). Run against a dev server whose /api reaches a build that includes
// api/_lib/auth.js revokeClientGrant: DEV_API_PROXY=http://localhost:3001 npm run dev
// with `PORT=3001 node server/index.mjs`.

import { test, expect } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

function loadEnv(file) {
	if (!existsSync(file)) return;
	for (const line of readFileSync(file, 'utf8').split('\n')) {
		const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
		if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
	}
}
loadEnv('.env');

const EMAIL = process.env.AUDIT_EMAIL;
const PASSWORD = process.env.AUDIT_PASSWORD;
const REDIRECT = 'https://grok-bot-connector.example/oauth/callback';

const b64url = (buf) => buf.toString('base64url');

async function toolsList(request, token) {
	return request.post('/api/mcp', {
		headers: {
			authorization: `Bearer ${token}`,
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
		},
		data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
	});
}

test.describe('OAuth for cloud connectors', () => {
	test.skip(!EMAIL || !PASSWORD, 'AUDIT_EMAIL / AUDIT_PASSWORD missing: run npm run audit:web:provision');
	test.setTimeout(240_000);

	test('Grok Bot registers, authorizes with PKCE, calls tools/list, is revoked, and fails on the next call', async ({ page }) => {
		// A connector learns the resource it is signing in for from discovery
		// (RFC 9728), exactly as Grok Bot does.
		const discovery = await page.request.get('/.well-known/oauth-protected-resource');
		expect(discovery.status()).toBe(200);
		const RESOURCE = (await discovery.json()).resource;

		await page.goto('/login');
		await page.waitForSelector('#email', { timeout: 60_000 });
		await page.fill('#email', EMAIL);
		await page.fill('#password', PASSWORD);
		await page.click('form button[type="submit"]');
		await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 60_000 });

		const reg = await page.request.post('/api/oauth/register', {
			data: {
				client_name: 'Grok Bot',
				client_uri: 'https://grok-bot-connector.example',
				redirect_uris: [REDIRECT],
				scope: 'avatars:read profile offline_access',
			},
		});
		expect(reg.status()).toBe(201);
		const client = await reg.json();
		expect(client.client_name).toBe('Grok Bot');

		const verifier = b64url(randomBytes(32));
		const challenge = b64url(createHash('sha256').update(verifier).digest());
		const state = b64url(randomBytes(8));
		const authorize = new URLSearchParams({
			response_type: 'code',
			client_id: client.client_id,
			redirect_uri: REDIRECT,
			scope: 'avatars:read profile offline_access',
			state,
			code_challenge: challenge,
			code_challenge_method: 'S256',
			resource: RESOURCE,
		});
		await page.goto(`/api/oauth/authorize?${authorize}`);

		await expect(page.locator('h1')).toContainText('Authorize Grok Bot');
		await expect(page.locator('.host')).toContainText('grok-bot-connector.example');
		await expect(page.locator('.nospend')).toContainText('can never spend from a wallet');
		await expect(page.locator('li')).toContainText(['Read your avatars', 'See your name and email']);

		// The connector's redirect host is not a real server: the 302 to it is the
		// observable result, so read the code off that request.
		const [callback] = await Promise.all([
			page.waitForRequest((r) => r.url().startsWith(REDIRECT)),
			page.click('button[value="allow"]'),
		]);
		const back = new URL(callback.url());
		expect(back.searchParams.get('state')).toBe(state);
		const code = back.searchParams.get('code');
		expect(code).toBeTruthy();

		const tokenRes = await page.request.post('/api/oauth/token', {
			form: {
				grant_type: 'authorization_code',
				client_id: client.client_id,
				code,
				redirect_uri: REDIRECT,
				code_verifier: verifier,
				resource: RESOURCE,
			},
		});
		expect(tokenRes.status()).toBe(200);
		const tokens = await tokenRes.json();
		expect(tokens.refresh_token).toBeTruthy();

		const listed = await toolsList(page.request, tokens.access_token);
		expect(listed.status()).toBe(200);
		expect(JSON.stringify(await listed.json())).toContain('"tools"');

		await page.goto('/dashboard/settings');
		const row = page.locator('[data-client-id="' + client.client_id + '"]');
		await expect(row).toContainText('Grok Bot', { timeout: 60_000 });
		page.once('dialog', (d) => d.accept());
		await row.getByRole('button', { name: 'Revoke' }).click();
		await expect(row).toHaveCount(0);

		const after = await toolsList(page.request, tokens.access_token);
		expect(after.status()).toBe(401);

		const refreshed = await page.request.post('/api/oauth/token', {
			form: { grant_type: 'refresh_token', client_id: client.client_id, refresh_token: tokens.refresh_token, resource: RESOURCE },
		});
		expect(refreshed.status()).toBe(400);
	});
});
