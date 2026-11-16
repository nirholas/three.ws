// Teams activity feed notifications: the bell, the feed and the mobile push in
// Microsoft Teams, sent with Microsoft Graph's sendActivityNotification.
//   https://learn.microsoft.com/en-us/graph/api/userteamwork-sendactivitynotification
//
// This is the `teams` leg of the notification fan-out (api/_lib/notify.js): the
// events that already ring the bell, push and paired chats reach a linked Teams
// person too, behind a per-event preference. Delivery never blocks or fails the
// originating job; a permanent failure is recorded once on the identity so
// settings can say why nothing arrives.
//
// Credentials: the Entra app behind the bot (MS_TEAMS_BOT_APP_ID /
// MS_TEAMS_BOT_APP_PASSWORD, the same registration webApplicationInfo names in
// the manifest) needs the TeamsActivity.Send application permission with admin
// consent in the recipient's tenant. The token is minted per tenant. MS_APP_ID
// is the Teams app id from the manifest, used to deep link into the tab.

import { readStoredPrefs } from './notify-prefs.js';
import { identitiesForUser, recordFailure, recordSent } from './teams-identity.js';

export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
export const LOGIN_BASE = 'https://login.microsoftonline.com';
export const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
export const TAB_ENTITY_ID = 'threews-agents';
// The Graph application permission a tenant admin consents to (provisioned in
// integrations/microsoft/provisioning/resources.json).
export const REQUIRED_PERMISSIONS = ['TeamsActivity.Send'];
export const PREVIEW_MAX = 150;
const MAX_ATTEMPTS = 3;
const MAX_WAIT_S = 20;
const CALL_TIMEOUT_MS = 10_000;
const REFRESH_EARLY_MS = 5 * 60_000;

/**
 * The activity types the manifest declares (manifest.template.json
 * activities.activityTypes), with the notification types that map to each, the
 * label settings shows, and whether it is on before the person chooses.
 */
export const ACTIVITY_TYPES = Object.freeze([
	{ type: 'forgeJobCompleted', label: 'A 3D model finished', defaultOn: true, from: ['forge_complete'] },
	{ type: 'forgeJobFailed', label: 'A 3D model failed', defaultOn: true, from: ['forge_failed'] },
	{ type: 'agentTaskCompleted', label: 'An agent finished a task', defaultOn: false, from: ['agent_loop_report'] },
	{ type: 'agentMentioned', label: 'An agent was mentioned', defaultOn: true, from: ['mention'] },
	{ type: 'agentMessageReceived', label: 'An agent got a message', defaultOn: true, from: ['reply', 'dm_received', 'mail_received'] },
]);

const BY_NOTIFICATION = new Map(ACTIVITY_TYPES.flatMap((a) => a.from.map((n) => [n, a])));

export class TeamsActivityError extends Error {
	constructor(code, message, { status = 0, retryable = false } = {}) {
		super(message);
		this.name = 'TeamsActivityError';
		this.code = code;
		this.status = status;
		this.retryable = retryable;
	}
}

const clean = (v) => String(v ?? '').trim();

/** True when the bot's app id and secret and the Teams app id are all set. */
export function activityConfigured(env = process.env) {
	return Boolean(clean(env.MS_TEAMS_BOT_APP_ID) && clean(env.MS_TEAMS_BOT_APP_PASSWORD) && clean(env.MS_APP_ID));
}

/** Where a tenant admin grants TeamsActivity.Send to the app. */
export function adminConsentUrl(tenantId, env = process.env) {
	return `${LOGIN_BASE}/${encodeURIComponent(tenantId)}/adminconsent?client_id=${encodeURIComponent(clean(env.MS_TEAMS_BOT_APP_ID))}`;
}

/**
 * The Teams deep link that opens the three.ws personal tab on one job or agent.
 * Teams hands `subEntityId` to the tab as {subPageId}, which the tab URL maps to
 * ?sub= (see manifest.template.json).
 */
export function buildDeepLink({ appId, subEntityId = null }) {
	const base = `https://teams.microsoft.com/l/entity/${encodeURIComponent(appId)}/${TAB_ENTITY_ID}`;
	return subEntityId ? `${base}?context=${encodeURIComponent(JSON.stringify({ subEntityId }))}` : base;
}

const short = (v, n) => {
	const s = clean(v).replace(/\s+/g, ' ');
	return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

/**
 * What a notification becomes in the Teams feed, or null when no activity type
 * covers it. Pure: the templateParameters fill the manifest's templateText.
 */
export function activityFor(type, payload = {}) {
	const kind = BY_NOTIFICATION.get(type);
	if (!kind) return null;
	const agent = short(payload.agent_name, 60) || 'Your agent';
	const jobId = payload.teams_job_key || payload.creation_id || null;
	const agentSub = payload.agent_id ? `agent:${payload.agent_id}` : null;
	switch (kind.type) {
		case 'forgeJobCompleted':
			return { activityType: kind.type, subEntityId: jobId && `job:${jobId}`, topic: '3D model ready', params: { prompt: short(payload.prompt, 80) || 'Your model' } };
		case 'forgeJobFailed':
			return { activityType: kind.type, subEntityId: jobId && `job:${jobId}`, topic: '3D model failed', params: { prompt: short(payload.prompt, 80) || 'Your model' } };
		case 'agentTaskCompleted':
			return { activityType: kind.type, subEntityId: agentSub, topic: agent, params: { agent, summary: short(payload.message, 100) || 'Finished a task' }, preview: short(payload.message, PREVIEW_MAX) };
		case 'agentMentioned':
			return { activityType: kind.type, subEntityId: agentSub, topic: agent, params: { agent, actor: short(payload.actor, 60) || 'Someone' } };
		default:
			return { activityType: kind.type, subEntityId: agentSub, topic: agent, params: { agent, from: short(payload.from_name || payload.from || payload.actor, 60) || 'Someone' }, preview: short(payload.subject || payload.message, PREVIEW_MAX) };
	}
}

const tokens = new Map();

/** App-only Graph token for one tenant, reused until five minutes before it expires. */
export async function graphToken(tenantId, { fetchImpl = fetch, env = process.env, now = Date.now } = {}) {
	const cached = tokens.get(tenantId);
	if (cached && cached.expiresAt - REFRESH_EARLY_MS > now()) return cached.token;
	const res = await fetchImpl(`${LOGIN_BASE}/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'client_credentials',
			client_id: clean(env.MS_TEAMS_BOT_APP_ID),
			client_secret: clean(env.MS_TEAMS_BOT_APP_PASSWORD),
			scope: GRAPH_SCOPE,
		}),
		signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok || !data.access_token) {
		// invalid_client / unauthorized_client / AADSTS700016: the app is not
		// consented or not present in that tenant, which no retry fixes.
		throw new TeamsActivityError('token_failed', `Graph token request failed (${res.status}${data.error ? ` ${data.error}` : ''}).`, {
			status: res.status,
			retryable: res.status === 429 || res.status >= 500,
		});
	}
	tokens.set(tenantId, { token: data.access_token, expiresAt: now() + Number(data.expires_in || 3600) * 1000 });
	return data.access_token;
}

/** Forget cached tokens (tests, or after a 401 from Graph). */
export function resetGraphTokens() {
	tokens.clear();
}

/** The Graph request body for one activity, per the documented contract. */
export function requestBody({ activityType, topic, params, preview, webUrl }) {
	return {
		topic: { source: 'text', value: short(topic, 120) || 'three.ws', webUrl },
		activityType,
		previewText: { content: preview || Object.values(params)[0] || 'three.ws' },
		templateParameters: Object.entries(params).map(([name, value]) => ({ name, value: String(value) })),
	};
}

function classify(status) {
	if (status === 403) return 'consent_missing';
	if (status === 404) return 'not_installed';
	if (status === 401) return 'unauthorized';
	return 'rejected';
}

const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));

/**
 * Send one activity feed notification to one person. Retries 429 and 5xx with
 * backoff, honouring Retry-After; any other failure throws a TeamsActivityError
 * whose `code` says what to do (consent_missing, not_installed, ...).
 */
export async function sendActivityNotification(
	{ tenantId, aadObjectId, activityType, topic, params, preview = null, subEntityId = null },
	{ fetchImpl = fetch, env = process.env, sleep = wait, now = Date.now } = {},
) {
	if (!activityConfigured(env)) throw new TeamsActivityError('not_configured', 'Teams notifications need MS_TEAMS_BOT_APP_ID, MS_TEAMS_BOT_APP_PASSWORD and MS_APP_ID.');
	const webUrl = buildDeepLink({ appId: clean(env.MS_APP_ID), subEntityId });
	const body = JSON.stringify(requestBody({ activityType, topic, params, preview, webUrl }));
	let lastError;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		let delay = Math.min(MAX_WAIT_S, 2 ** (attempt - 1));
		try {
			const token = await graphToken(tenantId, { fetchImpl, env, now });
			const res = await fetchImpl(`${GRAPH_BASE}/users/${encodeURIComponent(aadObjectId)}/teamwork/sendActivityNotification`, {
				method: 'POST',
				headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
				body,
				signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
			});
			if (res.ok) return { ok: true, status: res.status };
			const retryAfter = Number(res.headers?.get?.('retry-after'));
			if (retryAfter > 0) delay = Math.min(MAX_WAIT_S, retryAfter);
			if (res.status === 401) resetGraphTokens();
			const detail = await res.text().catch(() => '');
			const retryable = res.status === 429 || res.status >= 500 || (res.status === 401 && attempt === 1);
			lastError = new TeamsActivityError(classify(res.status), `Graph sendActivityNotification returned ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`, { status: res.status, retryable });
		} catch (err) {
			lastError = err instanceof TeamsActivityError
				? err
				: new TeamsActivityError('network', `Graph could not be reached: ${err?.message || err}`, { retryable: true });
		}
		if (!lastError.retryable || attempt === MAX_ATTEMPTS) break;
		await sleep(delay);
	}
	throw lastError;
}

/** The person's per-event choices over the defaults: `{ forgeJobCompleted: true, ... }`. */
export function resolveEventPrefs(stored) {
	const chosen = stored?.teams?.events || {};
	return Object.fromEntries(ACTIVITY_TYPES.map((a) => [a.type, typeof chosen[a.type] === 'boolean' ? chosen[a.type] : a.defaultOn]));
}

/**
 * The `teams` leg of the notification fan-out. Resolves to how many people it
 * reached (0 for a type Teams has no activity for, an unlinked account, an
 * event the person turned off, or missing configuration). Never throws.
 */
export async function deliverTeamsNotification({ userId, type, payload }, deps = {}) {
	const activity = activityFor(type, payload);
	if (!activity || !userId) return 0;
	try {
		if (!activityConfigured(deps.env || process.env)) return 0;
		const targets = (await identitiesForUser(userId)).filter((i) => i.installed);
		if (!targets.length) return 0;
		if (!resolveEventPrefs(await readStoredPrefs(userId))[activity.activityType]) return 0;
		let reached = 0;
		for (const t of targets) {
			const identity = { tenantId: t.tenant_id, aadObjectId: t.aad_object_id };
			try {
				await sendActivityNotification({ ...identity, ...activity }, deps);
				await recordSent(identity);
				reached++;
			} catch (err) {
				const code = err?.code || 'rejected';
				if (t.last_error_code !== code) console.warn(`[teams-activity] ${activity.activityType} to ${identity.tenantId}: ${err?.message || err}`);
				// Transient exhaustion is not recorded: the next event retries cleanly.
				if (!err?.retryable) await recordFailure(identity, code).catch(() => {});
			}
		}
		return reached;
	} catch (err) {
		console.error('[teams-activity] delivery failed:', err?.message || err);
		return 0;
	}
}
