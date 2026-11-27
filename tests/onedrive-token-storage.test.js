// @vitest-environment jsdom
//
// Where the OneDrive sign-in keeps its Microsoft tokens. Real MSAL
// (@azure/msal-browser) runs with the exact config "Save to OneDrive" uses
// (msalConfig in src/microsoft-graph/onedrive-client.js), a signed-in result is
// loaded into its cache through MSAL's own loadExternalTokens, and the test then
// reads every storage a page can persist into. The access token, the refresh
// token and the id token must appear in none of the persistent stores
// (localStorage, cookies), and the per-tab store they do use must be cleared
// with the tab. Silent token reads must still work from that per-tab cache.

import { PublicClientApplication, loadExternalTokens } from '@azure/msal-browser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GRAPH_SCOPES } from '../src/microsoft-graph/onedrive-core.js';
import { msalConfig } from '../src/microsoft-graph/onedrive-client.js';

const CLIENT_ID = '0f1e2d3c-4b5a-4968-8778-a6b5c4d3e2f1';
const TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';
const OID = '00000000-0000-0000-66f3-3332eca7ea81';

const b64url = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

function idToken() {
	const now = Math.floor(Date.now() / 1000);
	const claims = {
		aud: CLIENT_ID,
		iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
		iat: now,
		nbf: now,
		exp: now + 3600,
		name: 'Storage Test',
		preferred_username: 'storage.test@outlook.com',
		oid: OID,
		sub: 'storage-test-subject',
		tid: TENANT,
		ver: '2.0',
	};
	return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(claims)}.`;
}

const ACCESS = 'EwBYA8l6BAAU-access-token-marker-7d1f';
const REFRESH = 'M.C123-refresh-token-marker-4a9c';

function everythingPersistent() {
	const out = [];
	for (let i = 0; i < localStorage.length; i++) {
		const k = localStorage.key(i);
		out.push(k, localStorage.getItem(k));
	}
	out.push(document.cookie);
	return out.join('\n');
}

function everythingInSession() {
	const out = [];
	for (let i = 0; i < sessionStorage.length; i++) {
		const k = sessionStorage.key(i);
		out.push(k, sessionStorage.getItem(k));
	}
	return out.join('\n');
}

beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();
});

afterEach(() => {
	localStorage.clear();
	sessionStorage.clear();
});

describe('OneDrive MSAL token storage', () => {
	it('keeps tokens out of localStorage and cookies, in the per-tab cache only', async () => {
		const config = msalConfig(CLIENT_ID, location.origin);
		expect(config.cache.cacheLocation).toBe('sessionStorage');

		const id = idToken();
		await loadExternalTokens(
			config,
			{ scopes: GRAPH_SCOPES, authority: `https://login.microsoftonline.com/${TENANT}` },
			{
				token_type: 'Bearer',
				scope: GRAPH_SCOPES.join(' '),
				expires_in: 3600,
				ext_expires_in: 3600,
				access_token: ACCESS,
				refresh_token: REFRESH,
				id_token: id,
				client_info: b64url({ uid: OID, utid: TENANT }),
			},
			{},
		);

		const pca = new PublicClientApplication(config);
		await pca.initialize();
		const account = pca.getAllAccounts()[0];
		expect(account?.username).toBe('storage.test@outlook.com');

		// Silent reads still come from the cache, so a second save in the tab needs no popup.
		const silent = await pca.acquireTokenSilent({ scopes: GRAPH_SCOPES, account });
		expect(silent.accessToken).toBe(ACCESS);

		const persistent = everythingPersistent();
		expect(persistent).not.toContain(ACCESS);
		expect(persistent).not.toContain(REFRESH);
		expect(persistent).not.toContain(id.split('.')[1]);

		// The tokens are in the tab's own store, which the browser drops when the tab closes.
		const session = everythingInSession();
		expect(session).toContain(ACCESS);
	});
});
