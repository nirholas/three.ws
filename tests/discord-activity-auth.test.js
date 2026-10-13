// api/_lib/gateway/discord-activity-auth.js: the OAuth2 code exchange and
// user lookup against (mocked) Discord endpoints, and the real HMAC
// sign/verify roundtrip for the Activity session token, unmocked.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.DISCORD_CLIENT_SECRET = 'test-client-secret';

const {
	discordActivityConfigured,
	DiscordActivityAuthError,
	exchangeActivityCode,
	fetchDiscordUser,
	signActivitySession,
	verifyActivitySession,
} = await import('../api/_lib/gateway/discord-activity-auth.js');

describe('discord-activity-auth', () => {
	let fetchSpy;

	beforeEach(() => {
		fetchSpy = vi.spyOn(globalThis, 'fetch');
	});

	afterEach(() => {
		fetchSpy.mockRestore();
	});

	it('reports configured once both env vars are present', () => {
		expect(discordActivityConfigured()).toBe(true);
	});

	it('exchanges a real-shaped request and surfaces Discord\'s own error on rejection', async () => {
		fetchSpy.mockResolvedValue({ ok: false, json: async () => ({ error: 'invalid_grant', error_description: 'Invalid "code" in request.' }) });
		await expect(exchangeActivityCode('bad-code')).rejects.toMatchObject({ code: 'token_exchange_failed', status: 502 });

		const [url, init] = fetchSpy.mock.calls[0];
		expect(url).toBe('https://discord.com/api/oauth2/token');
		expect(init.method).toBe('POST');
		const body = new URLSearchParams(init.body);
		expect(body.get('client_id')).toBe('test-client-id');
		expect(body.get('client_secret')).toBe('test-client-secret');
		expect(body.get('grant_type')).toBe('authorization_code');
		expect(body.get('code')).toBe('bad-code');
	});

	it('returns the access token on a successful exchange', async () => {
		fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ access_token: 'tok-123', scope: 'identify' }) });
		const result = await exchangeActivityCode('good-code');
		expect(result).toEqual({ accessToken: 'tok-123', scope: 'identify' });
	});

	it('rejects a missing code before ever calling Discord', async () => {
		await expect(exchangeActivityCode('')).rejects.toMatchObject({ code: 'bad_code' });
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('fetchDiscordUser re-verifies the token against /users/@me', async () => {
		fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ id: '123456789', username: 'alice', global_name: 'Alice', avatar: 'abc' }) });
		const user = await fetchDiscordUser('tok-123');
		expect(user).toEqual({ id: '123456789', username: 'alice', globalName: 'Alice', avatar: 'abc' });
		const [url, init] = fetchSpy.mock.calls[0];
		expect(url).toBe('https://discord.com/api/users/@me');
		expect(init.headers.Authorization).toBe('Bearer tok-123');
	});

	it('fetchDiscordUser surfaces a rejected token as a DiscordActivityAuthError', async () => {
		fetchSpy.mockResolvedValue({ ok: false, json: async () => ({ message: '401: Unauthorized' }) });
		await expect(fetchDiscordUser('expired')).rejects.toBeInstanceOf(DiscordActivityAuthError);
	});

	it('signs and verifies a session scoped to one room, and rejects a tampered one', () => {
		const token = signActivitySession({ discordUserId: 'u1', username: 'alice', globalName: 'Alice', roomId: 'room-1', guildId: 'g1', channelId: 'c1' });
		expect(token).toMatch(/^da1\./);

		const verified = verifyActivitySession(token);
		expect(verified).toMatchObject({ discordUserId: 'u1', roomId: 'room-1', guildId: 'g1', channelId: 'c1' });

		const [prefix, payload, sig] = token.split('.');
		const tampered = `${prefix}.${payload}.${sig.slice(0, -2)}xx`;
		expect(verifyActivitySession(tampered)).toBeNull();
	});

	it('rejects an expired session', () => {
		const realNow = Date.now;
		Date.now = () => realNow() - 5 * 3600 * 1000;
		const token = signActivitySession({ discordUserId: 'u1', username: 'alice', roomId: 'room-1', guildId: 'g1', channelId: 'c1' });
		Date.now = realNow;
		expect(verifyActivitySession(token)).toBeNull();
	});

	it('rejects malformed tokens without throwing', () => {
		expect(verifyActivitySession(null)).toBeNull();
		expect(verifyActivitySession('not-a-token')).toBeNull();
		expect(verifyActivitySession('da1.onlyonepart')).toBeNull();
	});
});
