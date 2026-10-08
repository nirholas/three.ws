import { test, expect, request as playwrightRequest } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';

// A cloud MCP connector signing in to three.ws, end to end, as a real person.
//
// Grok Bot adds an MCP server with OAuth 2.1 from xAI's cloud: it registers a
// client we have never seen, with a callback on a host nobody could list in
// advance, then runs the PKCE authorization-code flow in the person's browser.
// This drives every step of that against the dev server with the QA account:
// register "Grok Bot", read the consent screen, approve, catch the code at the
// external callback, exchange it, call tools/list on /api/mcp with the token,
// then press Revoke in Settings > Connected apps and see the very next call
// refused.
//
// Needs AUDIT_EMAIL / AUDIT_PASSWORD (the QA account, `npm run
// audit:web:provision` makes one) and skips cleanly without them. It talks to
// whatever API the dev server proxies to, so run the API from this tree beside
// it to test local code (docs/mcp.md, "Cloud connectors and revocation").

const EMAIL = process.env.AUDIT_EMAIL;
const PASSWORD = process.env.AUDIT_PASSWORD;

// An https callback on a host three.ws could never have predicted. The name is
// on a reserved TLD, so nothing outside this machine ever receives the code:
// the spec reads it from the request the browser makes.
const CALLBACK_ORIGIN = 'https://connectors.grok-cloud.example';
const CALLBACK = `${CALLBACK_ORIGIN}/oauth/callback/${randomBytes(4).toString('hex')}`;

const base64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function pkcePair() {
	const verifier = base64url(randomBytes(48));
	return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) };
}

async function toolsList(api, origin, accessToken) {
	return api.post(`${origin}/api/mcp`, {
		headers: {
			authorization: `Bearer ${accessToken}`,
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
		},
		data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
	});
}

test.describe('OAuth 2.1 for a cloud connector', () => {
	test.skip(!EMAIL || !PASSWORD, 'needs AUDIT_EMAIL and AUDIT_PASSWORD (npm run audit:web:provision)');

	test('Grok Bot registers, signs in with PKCE, lists tools, and is cut off the moment it is revoked', async ({ page, baseURL }) => {
		test.setTimeout(300_000);
		const origin = baseURL.replace(/\/$/, '');
		// A context with no cookies, so every MCP call below is authorized by
		// the bearer token alone, exactly as Grok Bot's cloud would send it.
		const machine = await playwrightRequest.newContext();

		// 1. Dynamic client registration, the way the connector discovers it.
		const meta = await (await machine.get(`${origin}/.well-known/oauth-authorization-server`)).json();
		expect(meta.code_challenge_methods_supported).toEqual(['S256']);
		const registrationEndpoint = new URL(new URL(meta.registration_endpoint).pathname, origin).href;
		const registered = await machine.post(registrationEndpoint, {
			data: {
				client_name: 'Grok Bot',
				client_uri: 'https://grok.com',
				redirect_uris: [CALLBACK],
				grant_types: ['authorization_code', 'refresh_token'],
				response_types: ['code'],
				token_endpoint_auth_method: 'none',
				scope: 'avatars:read avatars:write profile offline_access agents:read wallet:read wallet:write',
			},
		});
		expect(registered.status(), await registered.text()).toBe(201);
		const client = await registered.json();
		expect(client.client_name).toBe('Grok Bot');
		expect(client.redirect_uris).toEqual([CALLBACK]);

		// 2. The person signs in to three.ws in their browser.
		const login = await page.context().request.post(`${origin}/api/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
		expect(login.ok(), `login failed: HTTP ${login.status()}`).toBe(true);

		// 3. The connector sends them to the consent screen.
		const { verifier, challenge } = pkcePair();
		const state = base64url(randomBytes(12));
		const authorize = new URL('/oauth/authorize', origin);
		for (const [k, v] of Object.entries({
			response_type: 'code', client_id: client.client_id, redirect_uri: CALLBACK, scope: client.scope,
			state, code_challenge: challenge, code_challenge_method: 'S256', resource: `${origin}/api/mcp`,
		})) authorize.searchParams.set(k, v);

		await page.goto(authorize.href);
		await expect(page.locator('h1')).toHaveText('Grok Bot wants to connect to your three.ws account');
		await expect(page.locator('[data-fact="client-host"]')).toHaveText('grok.com');
		await expect(page.locator('[data-fact="return-host"]')).toHaveText('connectors.grok-cloud.example');
		await expect(page.getByText('three.ws has not verified this app')).toBeVisible();
		await expect(page.locator('[data-scopes] li').first()).toBeVisible();
		await expect(page.locator('[data-scopes]')).not.toContainText('Spend USDC');
		const neverSpends = page.locator('[data-wallet="never-spends"]');
		await expect(neverSpends).toBeVisible();
		await expect(neverSpends).toContainText('It can never spend from your wallet.');
		// The spend box starts unticked, and ticking it swaps the statement.
		const spendBox = page.locator('#allow-spend');
		await expect(spendBox).not.toBeChecked();
		await spendBox.check();
		await expect(page.locator('[data-wallet="may-spend"]')).toBeVisible();
		await expect(neverSpends).toBeHidden();
		await spendBox.uncheck();
		await expect(neverSpends).toBeVisible();

		// The browser follows the 302 to the connector's host, which proves the
		// consent page's CSP form-action lets that cross-origin hop through.
		const callbackRequest = page.waitForRequest((r) => r.url().startsWith(`${CALLBACK_ORIGIN}/`));
		await page.getByRole('button', { name: 'Authorize' }).click();
		const back = new URL((await callbackRequest).url());
		expect(back.origin + back.pathname).toBe(CALLBACK);
		expect(back.searchParams.get('state')).toBe(state);
		const code = back.searchParams.get('code');
		expect(code).toBeTruthy();

		// 4. The connector exchanges the code with its PKCE verifier.
		const tokenEndpoint = new URL(new URL(meta.token_endpoint).pathname, origin).href;
		const wrongVerifier = await machine.post(tokenEndpoint, {
			form: { grant_type: 'authorization_code', client_id: client.client_id, code, redirect_uri: CALLBACK, code_verifier: pkcePair().verifier, resource: `${origin}/api/mcp` },
		});
		expect(wrongVerifier.status()).toBe(400);
		const exchanged = await machine.post(tokenEndpoint, {
			form: { grant_type: 'authorization_code', client_id: client.client_id, code, redirect_uri: CALLBACK, code_verifier: verifier, resource: `${origin}/api/mcp` },
		});
		expect(exchanged.status(), await exchanged.text()).toBe(200);
		const tokens = await exchanged.json();
		expect(tokens.token_type).toBe('Bearer');
		expect(tokens.refresh_token).toBeTruthy();
		const granted = tokens.scope.split(' ');
		expect(granted).not.toContain('wallet:write');
		expect(granted).toContain('wallet:read');

		// 5. The token works on the MCP server.
		const listed = await toolsList(machine, origin, tokens.access_token);
		expect(listed.status(), await listed.text()).toBe(200);
		const listing = await listed.json();
		expect(Array.isArray(listing.result?.tools)).toBe(true);
		expect(listing.result.tools.length).toBeGreaterThan(0);

		// 6. The person revokes it in Settings > Connected apps.
		await page.goto(`${origin}/dashboard/settings#connected-apps`);
		const row = page.locator(`#connected-apps [data-client-id="${client.client_id}"]`);
		await expect(row).toBeVisible({ timeout: 60_000 });
		await expect(row).toContainText('Grok Bot');
		await expect(row).toContainText('grok.com');
		page.once('dialog', (dialog) => dialog.accept());
		await row.getByRole('button', { name: 'Revoke' }).click();
		await expect(row).toHaveCount(0);

		// 7. The very next call with the same access token is refused, and the
		// refresh token can no longer mint a new one.
		const afterRevoke = await toolsList(machine, origin, tokens.access_token);
		expect(afterRevoke.status()).toBe(401);
		const refreshed = await machine.post(tokenEndpoint, {
			form: { grant_type: 'refresh_token', client_id: client.client_id, refresh_token: tokens.refresh_token, resource: `${origin}/api/mcp` },
		});
		expect(refreshed.status()).toBe(400);

		await machine.dispose();
	});
});
