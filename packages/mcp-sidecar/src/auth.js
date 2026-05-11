import { createServer } from 'http';
import { createHash, randomBytes } from 'crypto';

const REMOTE_DEFAULT = 'https://three.ws';

// OAuth 2.1 PKCE flow — opens the browser, waits for the redirect callback,
// and returns the access token. Requires the remote to support /oauth/authorize
// and /oauth/token with PKCE (S256).
export async function runOAuthFlow(config) {
	const remote = config?.remote ?? REMOTE_DEFAULT;
	const port = 9753;
	const redirectUri = `http://localhost:${port}/callback`;

	const verifier = randomBytes(32).toString('base64url');
	const challenge = createHash('sha256').update(verifier).digest('base64url');

	const params = new URLSearchParams({
		response_type: 'code',
		client_id: 'three-ws-mcp-sidecar',
		redirect_uri: redirectUri,
		code_challenge: challenge,
		code_challenge_method: 'S256',
		scope: 'avatars:read avatars:write models:read models:write',
	});

	const authUrl = `${remote}/oauth/authorize?${params}`;

	// Wait for the browser redirect
	const code = await waitForCode(port);

	// Exchange code for token
	const tokenRes = await fetch(`${remote}/oauth/token`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			redirect_uri: redirectUri,
			client_id: 'three-ws-mcp-sidecar',
			code_verifier: verifier,
		}).toString(),
	});

	if (!tokenRes.ok) {
		const text = await tokenRes.text().catch(() => '');
		throw new Error(`token exchange failed ${tokenRes.status}: ${text.slice(0, 200)}`);
	}

	const token = await tokenRes.json();
	return { authUrl, accessToken: token.access_token, expiresIn: token.expires_in };
}

function waitForCode(port) {
	return new Promise((resolve, reject) => {
		const server = createServer((req, res) => {
			const url = new URL(req.url, `http://localhost:${port}`);
			const code = url.searchParams.get('code');
			const error = url.searchParams.get('error');

			res.writeHead(200, { 'content-type': 'text/html' });
			res.end(code
				? '<html><body><h2>Authorized. You can close this tab.</h2></body></html>'
				: `<html><body><h2>Error: ${error ?? 'unknown'}</h2></body></html>`,
			);
			server.close();

			if (code) resolve(code);
			else reject(new Error(`OAuth error: ${error ?? 'no code returned'}`));
		});

		server.listen(port, () => {});
		server.on('error', reject);

		// Abort after 2 minutes
		setTimeout(() => {
			server.close();
			reject(new Error('OAuth timeout — no browser response within 2 minutes'));
		}, 120_000);
	});
}
