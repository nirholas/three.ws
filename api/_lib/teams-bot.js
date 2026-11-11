// Microsoft Teams bot for three.ws (the Teams app built from
// integrations/microsoft/copilot-teams/):
//
//   searchAgents  message-extension search over three.ws agents
//   link unfurl   three.ws agent links become Glance cards
//   createModel   message-extension action "Create a 3D model", plus the bot
//                 command `forge <prompt>`: a real free-lane 3D generation with
//                 a card that updates itself (api/_lib/teams-forge.js)
//
// Teams calls POST /api/microsoft-teams/messages with a Bot Framework activity.
// Every call, whatever its invoke name (composeExtension/*, adaptiveCard/action,
// a plain message), carries a JWT signed by the Bot Framework token service; it
// is verified against the published Bot Framework keys, issuer and the bot's own
// app id before anything is read (verifyBotToken, which never looks at the
// activity type).
//
// Search, unfurling and card refreshes answer in the invoke's HTTP response and
// need no credential. Posting a card into the chat (Send on the preview, the
// `forge` reply, the finished card replacing the progress card for everyone)
// uses the Bot Connector with the bot's client secret (api/_lib/teams-connector.js);
// without MS_TEAMS_BOT_APP_PASSWORD the action inserts the card into the
// compose box instead and the requester's own refreshes keep it current.
//
// Agent cards are the Glance card (api/_lib/glance-adaptive.js), the same
// Adaptive Card the Windows 11 widget board renders, bound to real agent data.
// The 3D cards are api/_lib/teams-forge-cards.js.

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { sql } from './db.js';
import { loadGlanceCard } from './glance-card.js';
import { adaptiveCardFor } from './glance-adaptive.js';
import { handleForgeActivity, isForgeActivity } from './teams-forge-bot.js';

export const BOTFRAMEWORK_ISSUER = 'https://api.botframework.com';
export const BOTFRAMEWORK_JWKS_URL = 'https://login.botframework.com/v1/.well-known/keys';
export const SEARCH_COMMAND_ID = 'searchAgents';
export const MAX_RESULTS = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AGENT_LINK = /^https:\/\/(?:www\.)?three\.ws\/agents\/([0-9a-f-]{36})(?:[/?#]|$)/i;

export class TeamsBotError extends Error {
	constructor(code, message, status = 401) {
		super(message);
		this.code = code;
		this.status = status;
	}
}

/** The Azure Bot registration's app id, or null when the bot is not configured. */
export function teamsBotAppId() {
	const id = (process.env.MS_TEAMS_BOT_APP_ID || '').trim();
	return id || null;
}

let jwks = null;
function botFrameworkJwks() {
	if (!jwks) jwks = createRemoteJWKSet(new URL(BOTFRAMEWORK_JWKS_URL));
	return jwks;
}

/**
 * Check verified token claims against the activity. Pure so the rule is tested
 * without a signed token: the token must be for this bot and, when it names a
 * serviceUrl, the activity must not point anywhere else.
 */
export function checkBotClaims(payload, { appId, serviceUrl }) {
	if (payload?.iss !== BOTFRAMEWORK_ISSUER) throw new TeamsBotError('invalid_token', 'token not issued by the Bot Framework');
	const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
	if (!audiences.includes(appId)) throw new TeamsBotError('invalid_token', 'token is for a different bot');
	if (payload.serviceurl && serviceUrl && payload.serviceurl !== serviceUrl) {
		throw new TeamsBotError('invalid_token', 'token serviceUrl does not match the activity');
	}
	return true;
}

// `keys` is the key set to verify against: the published Bot Framework keys,
// or a local set in tests that sign real tokens.
export async function verifyBotToken(authorization, { serviceUrl, keys = botFrameworkJwks() }) {
	const appId = teamsBotAppId();
	if (!appId) throw new TeamsBotError('not_configured', 'the Teams bot is not configured', 503);
	const match = /^Bearer\s+(.+)$/i.exec(authorization || '');
	if (!match) throw new TeamsBotError('missing_token', 'a Bot Framework bearer token is required');
	let payload;
	try {
		({ payload } = await jwtVerify(match[1], keys, { issuer: BOTFRAMEWORK_ISSUER, audience: appId, clockTolerance: 300 }));
	} catch (err) {
		throw new TeamsBotError('invalid_token', `the Bot Framework token did not verify: ${err?.code || err?.message}`);
	}
	checkBotClaims(payload, { appId, serviceUrl });
	return payload;
}

/** The search text of a composeExtension/query invoke ('' on the initial run). */
export function searchTextOf(value) {
	const params = Array.isArray(value?.parameters) ? value.parameters : [];
	const p = params.find((x) => x?.name === 'searchQuery') || params[0];
	if (!p || value?.initialRun === true || p.value === true) return '';
	return typeof p.value === 'string' ? p.value.trim().slice(0, 100) : '';
}

/** The agent id in a three.ws agent URL, or null. */
export function agentIdFromUrl(url) {
	const m = AGENT_LINK.exec(String(url || ''));
	return m && UUID.test(m[1]) ? m[1].toLowerCase() : null;
}

/** One result: the bound Glance card plus the compact preview Teams lists. */
export function attachmentFor(card) {
	return {
		contentType: 'application/vnd.microsoft.card.adaptive',
		content: adaptiveCardFor(card),
		preview: {
			contentType: 'application/vnd.microsoft.card.thumbnail',
			content: {
				title: card.name,
				text: card.description || card.headline,
				...(card.image ? { images: [{ url: card.image, alt: card.name }] } : {}),
				tap: { type: 'openUrl', value: card.url },
			},
		},
	};
}

export function resultResponse(attachments) {
	return { composeExtension: { type: 'result', attachmentLayout: 'list', attachments } };
}

export function messageResponse(text) {
	return { composeExtension: { type: 'message', text } };
}

/** Agents matching the search, newest first; the most active ones with no query. */
export async function searchAgents(text) {
	const rows = text
		? await sql`
			select id from agent_identities
			where deleted_at is null
			  and (name ilike ${'%' + text + '%'} or coalesce(description, '') ilike ${'%' + text + '%'})
			order by (name ilike ${text + '%'}) desc, created_at desc
			limit ${MAX_RESULTS}
		`
		: await sql`
			select a.agent_id as id
			from agent_actions a join agent_identities i on i.id = a.agent_id and i.deleted_at is null
			where a.created_at > now() - interval '7 days'
			group by a.agent_id
			order by count(*) desc
			limit ${MAX_RESULTS}
		`;
	const cards = await Promise.all(rows.map((r) => loadGlanceCard(r.id)));
	return cards.filter(Boolean);
}

/**
 * Handle one verified activity; returns the invoke response body (or null for
 * 200 with no body). `ctx.origin` is the base the forge runs against and the
 * cards link to; `ctx.selfBase` is this service, where a job run is dispatched.
 */
export async function handleActivity(activity, ctx = {}) {
	if (isForgeActivity(activity)) return handleForgeActivity(activity, ctx);
	if (activity?.type !== 'invoke') return null;
	switch (activity.name) {
		case 'composeExtension/query': {
			if (activity.value?.commandId && activity.value.commandId !== SEARCH_COMMAND_ID) {
				return messageResponse('That command is not available in this version of the app.');
			}
			const text = searchTextOf(activity.value);
			const cards = await searchAgents(text);
			if (!cards.length) {
				return messageResponse(text
					? `No three.ws agents match "${text}". Try a shorter name, or create one at https://three.ws/create`
					: 'No agents were active this week. Type a name to search every three.ws agent.');
			}
			return resultResponse(cards.map(attachmentFor));
		}
		case 'composeExtension/queryLink':
		case 'composeExtension/anonymousQueryLink': {
			const id = agentIdFromUrl(activity.value?.url);
			const card = id ? await loadGlanceCard(id) : null;
			if (!card) return messageResponse('This three.ws link is not an agent page.');
			return resultResponse([attachmentFor(card)]);
		}
		default:
			return {};
	}
}
