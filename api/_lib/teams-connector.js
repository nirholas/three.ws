// Outbound Bot Connector calls for the three.ws Teams bot: post a card into a
// conversation, reply to a message, and replace a message the bot posted.
//
// Search and link unfurling answer in the invoke's HTTP response and need no
// credential. Posting on the user's behalf ("Send" on a preview card), the
// `forge <prompt>` reply, and the update that swaps a finished card into the
// chat for everyone need the bot's own token, minted with the Azure Bot app
// registration's client secret:
//
//   MS_TEAMS_BOT_APP_ID        the Azure Bot / Entra app id (already the JWT audience)
//   MS_TEAMS_BOT_APP_PASSWORD  its client secret
//   MS_TEAMS_BOT_TENANT_ID     the tenant of a single-tenant bot; multi-tenant
//                              bots mint from botframework.com (the default)
//
// Without the secret every connector call reports `configured: false` and the
// caller degrades (teams-bot.js inserts the card into the compose box instead
// of posting it). Token request and REST shapes:
// https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication
// https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-api-reference

const TOKEN_SCOPE = 'https://api.botframework.com/.default';
const REFRESH_EARLY_MS = 5 * 60_000;
const CALL_TIMEOUT_MS = 10_000;
const MAX_RETRY_AFTER_S = 10;

// A serviceUrl comes from the activity body. The activity's JWT binds it (the
// serviceurl claim, checked in teams-bot.js checkBotClaims), and this list
// keeps the bot's token from ever being sent to any other host.
const SERVICE_HOSTS = [/^smba\.trafficmanager\.net$/i, /(^|\.)botframework\.com$/i, /(^|\.)teams\.microsoft\.(com|us)$/i, /(^|\.)infra\.gov\.teams\.microsoft\.us$/i];

let cachedToken = null;

export class ConnectorError extends Error {
	constructor(message, { status = 0, code = 'connector_error' } = {}) {
		super(message);
		this.name = 'ConnectorError';
		this.status = status;
		this.code = code;
	}
}

/** True when the bot can call the Bot Connector (app id and secret are set). */
export function connectorConfigured(env = process.env) {
	return Boolean(String(env.MS_TEAMS_BOT_APP_ID || '').trim() && String(env.MS_TEAMS_BOT_APP_PASSWORD || '').trim());
}

/** Throws unless `serviceUrl` is an https Bot Connector host; returns it without a trailing slash. */
export function assertServiceUrl(serviceUrl) {
	let url;
	try {
		url = new URL(String(serviceUrl || ''));
	} catch {
		throw new ConnectorError('The activity has no valid serviceUrl.', { code: 'bad_service_url' });
	}
	if (url.protocol !== 'https:' || !SERVICE_HOSTS.some((re) => re.test(url.hostname))) {
		throw new ConnectorError(`Refusing to call an unrecognized Bot Connector host (${url.hostname}).`, { code: 'bad_service_url' });
	}
	return url.href.replace(/\/+$/, '');
}

async function mintToken(fetchImpl, env) {
	const tenant = String(env.MS_TEAMS_BOT_TENANT_ID || '').trim() || 'botframework.com';
	const res = await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'client_credentials',
			client_id: String(env.MS_TEAMS_BOT_APP_ID).trim(),
			client_secret: String(env.MS_TEAMS_BOT_APP_PASSWORD).trim(),
			scope: TOKEN_SCOPE,
		}),
		signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok || !data.access_token) {
		throw new ConnectorError(`Bot token request failed (${res.status}${data.error ? ` ${data.error}` : ''}).`, { status: res.status, code: 'token_failed' });
	}
	return { token: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 };
}

/** The bot's bearer token, minted once and reused until 5 minutes before it expires. */
export async function botToken({ fetchImpl = fetch, env = process.env } = {}) {
	if (!connectorConfigured(env)) throw new ConnectorError('MS_TEAMS_BOT_APP_PASSWORD is not set.', { code: 'not_configured' });
	if (cachedToken && cachedToken.expiresAt - REFRESH_EARLY_MS > Date.now()) return cachedToken.token;
	cachedToken = await mintToken(fetchImpl, env);
	return cachedToken.token;
}

/** Forget the cached token (tests, or after a 401 from the connector). */
export function resetBotToken() {
	cachedToken = null;
}

async function call(methodName, serviceUrl, path, body, opts = {}) {
	const fetchImpl = opts.fetchImpl || fetch;
	const base = assertServiceUrl(serviceUrl);
	for (let attempt = 0; attempt < 2; attempt++) {
		const token = await botToken(opts);
		const res = await fetchImpl(`${base}${path}`, {
			method: methodName,
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
		});
		if (res.ok) return res.json().catch(() => ({}));
		if (res.status === 401 && attempt === 0) {
			resetBotToken();
			continue;
		}
		// Teams throttles per bot and per conversation and says when to come back.
		if (res.status === 429 && attempt === 0) {
			const wait = Math.min(MAX_RETRY_AFTER_S, Math.max(1, Number(res.headers.get('retry-after')) || 1));
			await new Promise((r) => setTimeout(r, wait * 1000));
			continue;
		}
		const detail = await res.text().catch(() => '');
		throw new ConnectorError(`Bot Connector ${methodName} ${path} returned ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`, {
			status: res.status,
			code: res.status === 429 ? 'throttled' : 'connector_error',
		});
	}
	throw new ConnectorError(`Bot Connector ${methodName} ${path} kept failing.`);
}

const conv = (id) => `/v3/conversations/${encodeURIComponent(id)}/activities`;

/** Post a new activity into a conversation; resolves to `{ id }`. */
export function sendToConversation({ serviceUrl, conversationId, activity }, opts) {
	return call('POST', serviceUrl, conv(conversationId), activity, opts);
}

/** Reply to an activity in its conversation (threads in channels); resolves to `{ id }`. */
export function replyToActivity({ serviceUrl, conversationId, activityId, activity }, opts) {
	return call('POST', serviceUrl, `${conv(conversationId)}/${encodeURIComponent(activityId)}`, { ...activity, replyToId: activityId }, opts);
}

/** Replace an activity the bot posted (the finished card for the whole chat). */
export function updateActivity({ serviceUrl, conversationId, activityId, activity }, opts) {
	return call('PUT', serviceUrl, `${conv(conversationId)}/${encodeURIComponent(activityId)}`, { ...activity, id: activityId }, opts);
}
