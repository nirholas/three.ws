// Persistence for a user's VRoid Hub OAuth grant, shared by the OAuth route
// (api/auth/vroid/[action].js) and every endpoint that needs to call the Hub
// API on the user's behalf (api/vroid/models.js, api/vroid/import.js).

import { sql } from '../db.js';
import { encryptVroidToken, decryptVroidToken } from './token-crypto.js';
import { refreshToken } from './client.js';

export async function saveVroidToken(userId, tokenData) {
	const encryptedAccess = await encryptVroidToken(tokenData.access_token);
	const encryptedRefresh = tokenData.refresh_token ? await encryptVroidToken(tokenData.refresh_token) : null;
	const expiresAt = tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString() : null;

	await sql`
		INSERT INTO social_connections (user_id, provider, provider_uid, username, access_token, refresh_token, expires_at, scopes, raw_data)
		VALUES (
			${userId}, 'vroid_hub', ${userId}, 'VRoid Hub',
			${encryptedAccess}, ${encryptedRefresh}, ${expiresAt},
			${tokenData.scope || 'default'},
			${JSON.stringify({ connect_method: 'oauth' })}::jsonb
		)
		ON CONFLICT (user_id, provider) DO UPDATE SET
			access_token = EXCLUDED.access_token,
			refresh_token = EXCLUDED.refresh_token,
			expires_at   = EXCLUDED.expires_at,
			scopes       = EXCLUDED.scopes,
			raw_data     = EXCLUDED.raw_data,
			connected_at = now(),
			disconnected_at = null
	`;
}

export async function vroidConnectionStatus(userId) {
	const [row] = await sql`
		SELECT connected_at FROM social_connections
		WHERE user_id = ${userId} AND provider = 'vroid_hub' AND disconnected_at IS NULL
	`;
	return { connected: Boolean(row), connected_at: row?.connected_at ?? null };
}

export async function disconnectVroid(userId) {
	await sql`
		UPDATE social_connections SET disconnected_at = now()
		WHERE user_id = ${userId} AND provider = 'vroid_hub'
	`;
}

/** Decrypt and, if expired, refresh the stored token for a user. Returns null when not connected. */
export async function getValidVroidToken(userId) {
	const [row] = await sql`
		SELECT access_token, refresh_token, expires_at FROM social_connections
		WHERE user_id = ${userId} AND provider = 'vroid_hub' AND disconnected_at IS NULL
	`;
	if (!row) return null;

	const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : null;
	if (!expiresAt || expiresAt - Date.now() > 60_000 || !row.refresh_token) {
		return decryptVroidToken(row.access_token);
	}

	const refreshed = await refreshToken(await decryptVroidToken(row.refresh_token));
	await saveVroidToken(userId, refreshed);
	return refreshed.access_token;
}
