// VRoid Hub (developer.vroid.com) OAuth + API config.
//
// Endpoint shapes below are verified against the live API, not guessed:
//   - GET https://hub.vroid.com/oauth/authorize without `state`, `code_challenge`,
//     `code_challenge_method` answers 400 "Missing required parameters: state,
//     code_challenge, code_challenge_method": the authorize step requires PKCE.
//   - POST https://hub.vroid.com/oauth/token without `grant_type` answers 400
//     "Missing required parameter: grant_type." (Doorkeeper OAuth2 provider).
//   - GET https://hub.vroid.com/api/account/character_models without a bearer
//     token answers 401 {"error":{"code":"COMMON_SIGNED_IN_REQUIRED"}} inside
//     the hub's standard {data,error,_links,rand} envelope.
//   - developer.vroid.com's own API reference (list-character.html,
//     load-character.html) documents CharacterModelSerializer.license as
//     CharacterModelLicenseSerializer: characterization_allowed_user,
//     violent_expression, sexual_expression, corporate_commercial_use,
//     personal_commercial_use, credit, modification, redistribution, each
//     'default'|<specific values>. That exact shape is the schema
//     api/_lib/vroid/license.js normalizes. Downloading a licensed model is a
//     two-step flow: POST /api/download_licenses {character_model_id} to
//     mint a DownloadLicense, then GET /api/download_licenses/{id}/download
//     which 302s to an S3 presigned URL (see api/_lib/vroid/client.js).
import { env } from '../env.js';

export const API_BASE = 'https://hub.vroid.com';

// Doorkeeper requires this on every request; VRoid Hub's current version per
// developer.vroid.com/en/api/oauth-api.html.
export const API_VERSION = '11';

// Minimal scope that covers everything this feature needs: read the user's
// own and hearted character models and download licensed ones.
export const SCOPE = 'default';

export function vroidConfigured() {
	return Boolean(env.VROID_HUB_CLIENT_ID && env.VROID_HUB_CLIENT_SECRET);
}

export function clientId() {
	return env.VROID_HUB_CLIENT_ID || '';
}

export function clientSecret() {
	return env.VROID_HUB_CLIENT_SECRET || '';
}

export function redirectUri() {
	return `${env.APP_ORIGIN}/api/auth/vroid/callback`;
}

export function authorizeUrl({ state, codeChallenge }) {
	const url = new URL('/oauth/authorize', API_BASE);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('client_id', clientId());
	url.searchParams.set('redirect_uri', redirectUri());
	url.searchParams.set('scope', SCOPE);
	url.searchParams.set('state', state);
	url.searchParams.set('code_challenge', codeChallenge);
	url.searchParams.set('code_challenge_method', 'S256');
	return url.toString();
}
