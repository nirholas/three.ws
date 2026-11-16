// Microsoft Teams as an approval channel (docs/approvals.md "Approving from
// Microsoft Teams"). An agent's gated action becomes an approval_requests row
// (api/_lib/approvals.js); this module puts it in the owner's 1:1 chat with the
// three.ws bot as a Universal Actions card and decides it from a button press.
//
// Exports: captureConversation stores or clears the 1:1 conversation
// reference from installationUpdate, conversationUpdate and message
// activities; deliverApprovalToTeams posts the card proactively through the
// Bot Connector; handleApprovalAction answers the adaptiveCard/action invoke
// for approval.approve, approval.deny and approval.refresh; sendTestApproval
// delivers a labelled no-op request to Teams only; teamsApprovalStatus is what
// the /approvals Teams panel renders.
//
// Who may decide: the activity's Bot Framework token is verified before this
// module sees it (api/microsoft-teams/messages.js). The Teams person is
// `<tenant id>:<Entra object id>` from the activity, and they are the account
// owner only when that identity is the Microsoft sign-in linked to the account
// that owns the request (user_identities, the same key Sign in with Microsoft
// writes), or when they linked Teams with a one-time code where that sibling
// store exists. Approve and Deny then go through decideApproval, the path the
// inbox uses: the payload hash in the conditional UPDATE, single execution,
// idempotent repeats, the executor's re-hash. Nothing here can widen it.

import { randomUUID } from 'node:crypto';
import { sql } from './db.js';
import { limits } from './rate-limit.js';
import {
	ApprovalError,
	createApprovalRequest,
	decideApproval,
	effectiveStatus,
	isUuid,
} from './approvals.js';
import {
	APPROVAL_VERBS,
	TEST_ACTION_TYPE,
	VERB_APPROVAL_REFRESH,
	approvalAttachment,
	approvalCard,
	decisionOf,
	verifyTeamsAction,
} from './teams-approval-cards.js';
import { CARD_CONTENT_TYPE, FORGE_CARD_VERSION } from './teams-forge-cards.js';
import * as teamsConnector from './teams-connector.js';
import { appOrigin } from './gateway/format.js';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const TEST_TTL_MS = 15 * 60 * 1000;
export const MAX_PENDING_LISTED = 5;

// ── who is this Teams person ────────────────────────────────────────────────────

/** `{ tenantId, aadObjectId }` of the person an activity came from, or null. */
export function identityOf(activity) {
	const tenantId = String(activity?.channelData?.tenant?.id || activity?.conversation?.tenantId || '');
	const aadObjectId = String(activity?.from?.aadObjectId || '');
	if (!GUID.test(tenantId) || !GUID.test(aadObjectId)) return null;
	return { tenantId: tenantId.toLowerCase(), aadObjectId: aadObjectId.toLowerCase() };
}

async function tableExists(name) {
	const [row] = await sql`select to_regclass(${name}) is not null as present`;
	return Boolean(row?.present);
}

/**
 * The three.ws account a Teams person is, or null. The Microsoft identity
 * linked through Sign in with Microsoft decides first; a code link from the
 * Teams activity feed store counts too when that table is present.
 */
export async function ownerForIdentity(identity) {
	if (!identity) return null;
	const subject = `${identity.tenantId}:${identity.aadObjectId}`;
	const [linked] = await sql`
		select u.id from user_identities i join users u on u.id = i.user_id
		where i.provider = 'microsoft' and i.subject = ${subject} and u.deleted_at is null
		limit 1`;
	if (linked) return linked.id;
	if (!(await tableExists('public.teams_identities'))) return null;
	const [coded] = await sql`
		select user_id from teams_identities
		where tenant_id = ${identity.tenantId} and aad_object_id = ${identity.aadObjectId}
		  and user_id is not null and installed = true
		limit 1`;
	return coded?.user_id || null;
}

/** Every Teams identity linked to an account, as `{ tenantId, aadObjectId, label }`. */
export async function identitiesForUser(userId) {
	const rows = await sql`
		select subject, coalesce(display_name, email) as label from user_identities
		where user_id = ${userId} and provider = 'microsoft'`;
	const out = [];
	for (const r of rows) {
		const [tenantId, aadObjectId] = String(r.subject).split(':');
		if (GUID.test(tenantId || '') && GUID.test(aadObjectId || '')) out.push({ tenantId, aadObjectId, label: r.label || null, via: 'microsoft_sign_in' });
	}
	if (await tableExists('public.teams_identities')) {
		const coded = await sql`
			select tenant_id, aad_object_id from teams_identities
			where user_id = ${userId} and installed = true`;
		for (const c of coded) {
			if (!out.some((o) => o.tenantId === c.tenant_id && o.aadObjectId === c.aad_object_id)) {
				out.push({ tenantId: c.tenant_id, aadObjectId: c.aad_object_id, label: null, via: 'teams_code' });
			}
		}
	}
	return out;
}

// ── conversation references ─────────────────────────────────────────────────────

/** The 1:1 conversation reference an activity carries, or null for any other conversation. */
export function conversationRefOf(activity) {
	const identity = identityOf(activity);
	if (!identity) return null;
	if (activity?.conversation?.conversationType !== 'personal') return null;
	const teamsUserId = String(activity?.from?.id || '');
	const conversationId = String(activity?.conversation?.id || '');
	const botId = String(activity?.recipient?.id || '');
	const serviceUrl = String(activity?.serviceUrl || '');
	if (!teamsUserId || !conversationId || !botId || !serviceUrl.startsWith('https://')) return null;
	return { ...identity, teamsUserId, userName: activity?.from?.name ? String(activity.from.name).slice(0, 200) : null, conversationId, botId, serviceUrl };
}

function botRemoved(activity) {
	const bot = activity?.recipient?.id;
	if (activity?.type === 'installationUpdate') return String(activity.action || '').startsWith('remove');
	if (activity?.type === 'conversationUpdate') return Array.isArray(activity.membersRemoved) && activity.membersRemoved.some((m) => m?.id && m.id === bot);
	return false;
}

function botPresent(activity) {
	const bot = activity?.recipient?.id;
	if (activity?.type === 'installationUpdate') return String(activity.action || '').startsWith('add');
	if (activity?.type === 'conversationUpdate') return Array.isArray(activity.membersAdded) && activity.membersAdded.some((m) => m?.id && m.id === bot);
	return activity?.type === 'message' || activity?.type === 'invoke';
}

export async function saveConversationRef(ref) {
	await sql`
		insert into teams_conversation_refs (tenant_id, aad_object_id, teams_user_id, user_name, service_url, conversation_id, bot_id)
		values (${ref.tenantId}, ${ref.aadObjectId}, ${ref.teamsUserId}, ${ref.userName}, ${ref.serviceUrl}, ${ref.conversationId}, ${ref.botId})
		on conflict (tenant_id, aad_object_id) do update set
			teams_user_id = excluded.teams_user_id,
			user_name = coalesce(excluded.user_name, teams_conversation_refs.user_name),
			service_url = excluded.service_url,
			conversation_id = excluded.conversation_id,
			bot_id = excluded.bot_id,
			updated_at = now()`;
}

export async function clearConversationRef(identity) {
	await sql`delete from teams_conversation_refs where tenant_id = ${identity.tenantId} and aad_object_id = ${identity.aadObjectId}`;
}

/**
 * Keep the 1:1 reference current from a verified activity: an install or any
 * message in the personal chat stores it, an uninstall deletes it. Activities
 * from channels and group chats are ignored (approvals are private).
 * @returns {Promise<'saved'|'cleared'|null>}
 */
export async function captureConversation(activity) {
	if (botRemoved(activity)) {
		const identity = identityOf(activity);
		if (!identity || activity?.conversation?.conversationType !== 'personal') return null;
		await clearConversationRef(identity);
		return 'cleared';
	}
	if (!botPresent(activity)) return null;
	const ref = conversationRefOf(activity);
	if (!ref) return null;
	await saveConversationRef(ref);
	return 'saved';
}

async function refsFor(identities) {
	const out = [];
	for (const id of identities) {
		const [ref] = await sql`
			select * from teams_conversation_refs
			where tenant_id = ${id.tenantId} and aad_object_id = ${id.aadObjectId}`;
		if (ref) out.push(ref);
	}
	return out;
}

// ── preference ──────────────────────────────────────────────────────────────────

export async function teamsApprovalsEnabled(userId) {
	const [row] = await sql`select enabled from teams_approval_prefs where user_id = ${userId}`;
	return row ? row.enabled : true;
}

export async function setTeamsApprovalsEnabled(userId, enabled) {
	await sql`
		insert into teams_approval_prefs (user_id, enabled) values (${userId}, ${Boolean(enabled)})
		on conflict (user_id) do update set enabled = excluded.enabled, updated_at = now()`;
	return Boolean(enabled);
}

// ── rendering helpers ───────────────────────────────────────────────────────────

/** One request with its agent's and decider's names, whoever owns it. Callers check ownership. */
export async function loadApprovalForCard(id) {
	if (!isUuid(id)) return null;
	const [row] = await sql`
		select r.*, a.name as agent_name, d.display_name as decider_name
		from approval_requests r
		left join agent_identities a on a.id = r.agent_id
		left join users d on d.id = r.decided_by
		where r.id = ${id}`;
	return row || null;
}

function cardResponse(card) {
	return { statusCode: 200, type: CARD_CONTENT_TYPE, value: card };
}

function errorResponse(statusCode, code, message) {
	return { statusCode, type: 'application/vnd.microsoft.error', value: { code, message } };
}

/**
 * A card with no request details, for a viewer who may not see them: someone
 * the owner's card was forwarded to, or a Teams account linked to no one.
 */
export function restrictedCard(message, { origin }) {
	return {
		type: 'AdaptiveCard',
		$schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
		version: FORGE_CARD_VERSION,
		body: [
			{ type: 'TextBlock', text: 'three.ws', size: 'small', weight: 'bolder', color: 'accent', spacing: 'none', wrap: true },
			{ type: 'TextBlock', text: 'Approval request', size: 'large', weight: 'bolder', spacing: 'small', wrap: true },
			{ type: 'Container', style: 'attention', spacing: 'medium', items: [{ type: 'TextBlock', text: message, wrap: true }] },
		],
		actions: [{ type: 'Action.OpenUrl', title: 'Open three.ws approvals', url: `${origin}/approvals` }],
	};
}

const NOT_LINKED =
	'This Teams account is not linked to a three.ws account, so it cannot see or decide approval requests. ' +
	'Sign in to three.ws with this Microsoft account (Settings, Sign-in methods), then try again.';
const NOT_OWNER = 'Only the three.ws account owner this request belongs to can view or decide it. Nothing was changed.';

// ── delivery ────────────────────────────────────────────────────────────────────

function deps(overrides = {}) {
	return {
		connector: overrides.connector || teamsConnector,
		origin: overrides.origin || appOrigin(),
		now: overrides.now || (() => Date.now()),
	};
}

/**
 * Post the request's card into every 1:1 chat the owner has with the bot.
 * Never throws: a Teams failure is reported in the result and never blocks the
 * other channels. A conversation the bot was removed from is forgotten.
 *
 * @returns {Promise<{ sent:number, reason?:string, errors?:string[] }>}
 */
export async function deliverApprovalToTeams(row, { ignorePreference = false, ...overrides } = {}) {
	const d = deps(overrides);
	try {
		if (!d.connector.connectorConfigured()) return { sent: 0, reason: 'not_configured' };
		if (!ignorePreference && !(await teamsApprovalsEnabled(row.user_id))) return { sent: 0, reason: 'disabled' };
		const identities = await identitiesForUser(row.user_id);
		if (!identities.length) return { sent: 0, reason: 'not_linked' };
		const refs = await refsFor(identities);
		if (!refs.length) return { sent: 0, reason: 'not_installed' };
		const full = (await loadApprovalForCard(row.id)) || row;
		if (effectiveStatus(full, d.now()) !== 'pending') return { sent: 0, reason: effectiveStatus(full, d.now()) };
		let sent = 0;
		const errors = [];
		for (const ref of refs) {
			const identity = { tenantId: ref.tenant_id, aadObjectId: ref.aad_object_id };
			const card = approvalCard(full, { origin: d.origin, identity, canDecide: true, teamsUserId: ref.teams_user_id, now: d.now() });
			const activity = {
				type: 'message',
				summary: full.action_type === TEST_ACTION_TYPE ? 'Test approval from three.ws' : `Approval needed: ${String(full.summary || '').slice(0, 120)}`,
				attachments: [approvalAttachment(card)],
			};
			try {
				await d.connector.sendToConversation({ serviceUrl: ref.service_url, conversationId: ref.conversation_id, activity });
				sent += 1;
			} catch (err) {
				errors.push(err?.code || err?.message || 'send_failed');
				// 403: the bot was blocked or removed; 404: the conversation is gone.
				if (err?.status === 403 || err?.status === 404) await clearConversationRef(identity).catch(() => {});
				console.warn('[teams-approvals] delivery failed', { approvalId: row.id, status: err?.status, code: err?.code });
			}
		}
		return errors.length ? { sent, errors } : { sent };
	} catch (err) {
		console.warn('[teams-approvals] delivery failed', { approvalId: row.id, error: err?.message });
		return { sent: 0, reason: 'error', errors: [err?.message || String(err)] };
	}
}

// ── the invoke ──────────────────────────────────────────────────────────────────

/** True for an adaptiveCard/action this module answers. */
export function isApprovalAction(activity) {
	return activity?.type === 'invoke'
		&& activity.name === 'adaptiveCard/action'
		&& APPROVAL_VERBS.includes(activity.value?.action?.verb);
}

/**
 * Answer one approval card action with the card to show next.
 *
 *   refresh   the current state, buttons only for the owner
 *   approve / deny
 *     refused with no change: a Teams account linked to no one or to another
 *     account (restricted card), a button whose signature does not match the
 *     request on file (tampered, forwarded, or the payload changed)
 *     a request no longer pending: redrawn as it stands (double click, replay)
 *     otherwise decideApproval({ via: 'teams' }) and the resulting state
 */
export async function handleApprovalAction(activity, ctx = {}) {
	const d = deps(ctx.deps);
	const origin = ctx.origin || d.origin;
	const action = activity.value.action;
	const verb = action.verb;
	const data = action.data && typeof action.data === 'object' ? action.data : {};
	if (!isUuid(data.approval_id)) return errorResponse(400, 'BadRequest', 'This card does not name an approval request.');

	const identity = identityOf(activity);
	const ownerId = identity ? await ownerForIdentity(identity) : null;
	if (!ownerId) return cardResponse(restrictedCard(NOT_LINKED, { origin }));

	const row = await loadApprovalForCard(data.approval_id);
	if (!row || row.user_id !== ownerId) return cardResponse(restrictedCard(NOT_OWNER, { origin }));

	const teamsUserId = activity.from?.id ? String(activity.from.id) : null;
	const view = (r, notice = null) => cardResponse(approvalCard(r, { origin, identity, canDecide: true, teamsUserId, notice, now: d.now() }));

	const decision = decisionOf(verb);
	if (verb === VERB_APPROVAL_REFRESH || !decision) return view(row);

	const check = verifyTeamsAction({ verb, data, row, identity, now: d.now() });
	if (!check.ok && check.reason === 'bad_signature') {
		console.warn('[teams-approvals] action failed its signature', { approvalId: row.id });
		return view(row, 'This button does not match the request on file, so nothing ran. Review it on the web.');
	}
	if (effectiveStatus(row, d.now()) !== 'pending' || !check.ok) return view(row);

	const rl = await limits.approvalsUser(ownerId);
	if (!rl.success) return view(row, 'Too many actions in a short time. Wait a minute and press again.');

	try {
		await decideApproval({ userId: ownerId, id: row.id, decision, payloadHash: row.payload_hash, via: 'teams' });
		return view((await loadApprovalForCard(row.id)) || row);
	} catch (err) {
		if (err instanceof ApprovalError) return view((await loadApprovalForCard(row.id)) || row, `Not executed: ${err.message}`);
		throw err;
	}
}

// ── the `approvals` bot command ─────────────────────────────────────────────────

/** True for `approvals` (or `/approvals`) typed to the bot in a 1:1 chat. */
export function isApprovalsCommand(activity, plainText) {
	if (activity?.type !== 'message' || activity?.conversation?.conversationType !== 'personal') return false;
	return /^\/?approvals$/i.test(plainText(activity.text || '').trim());
}

/**
 * Reply to `approvals` with the owner's pending requests (soonest deadline
 * first, up to five), each as its own card. Needs the Bot Connector.
 */
export async function replyWithPendingApprovals(activity, ctx = {}) {
	const d = deps(ctx.deps);
	if (!d.connector.connectorConfigured()) return null;
	const reply = (body) => d.connector.replyToActivity({ serviceUrl: activity.serviceUrl, conversationId: activity.conversation.id, activityId: activity.id, activity: { type: 'message', ...body } });
	const identity = identityOf(activity);
	const ownerId = identity ? await ownerForIdentity(identity) : null;
	if (!ownerId) return reply({ text: NOT_LINKED });
	const rows = await sql`
		select r.*, a.name as agent_name, null::text as decider_name
		from approval_requests r left join agent_identities a on a.id = r.agent_id
		where r.user_id = ${ownerId} and r.status = 'pending' and r.expires_at > now()
		order by r.expires_at asc
		limit ${MAX_PENDING_LISTED}`;
	if (!rows.length) return reply({ text: 'Nothing is waiting for your approval. New requests from your agents arrive here as cards.' });
	const teamsUserId = activity.from?.id ? String(activity.from.id) : null;
	for (const row of rows) {
		const card = approvalCard(row, { origin: ctx.origin || d.origin, identity, canDecide: true, teamsUserId, now: d.now() });
		await reply({ attachments: [approvalAttachment(card)] });
	}
	return null;
}

// ── test approval and the settings panel ────────────────────────────────────────

/**
 * What the Microsoft Teams panel on /approvals shows: whether a Teams identity
 * is linked, whether the app is in a 1:1 chat with it, whether the bot can post,
 * and the owner's switch.
 */
export async function teamsApprovalStatus(userId, overrides = {}) {
	const d = deps(overrides);
	const identities = await identitiesForUser(userId);
	const refs = await refsFor(identities);
	const appId = String(process.env.MS_APP_ID || '').trim();
	return {
		linked: identities.length > 0,
		identity: identities[0] ? { label: identities[0].label, via: identities[0].via } : null,
		installed: refs.length > 0,
		chats: refs.length,
		bot_configured: d.connector.connectorConfigured(),
		enabled: await teamsApprovalsEnabled(userId),
		install_url: GUID.test(appId) ? `https://teams.microsoft.com/l/app/${appId}` : null,
	};
}

/**
 * Create a test approval request and deliver it to Teams only. It runs nothing
 * when approved (its executor is a no-op that says so), never auto-approves,
 * and expires in 15 minutes. Sent even when the Teams switch is off, because
 * the owner asked for it.
 */
export async function sendTestApproval(userId, overrides = {}) {
	const status = await teamsApprovalStatus(userId, overrides);
	if (!status.linked) throw new ApprovalError(409, 'teams_not_linked', 'Link your Microsoft account in Settings, Sign-in methods first, then send a test.');
	if (!status.installed) throw new ApprovalError(409, 'teams_not_installed', 'Add the three.ws app in Teams and open its chat once, then send a test.');
	if (!status.bot_configured) throw new ApprovalError(503, 'teams_unavailable', 'The three.ws Teams bot cannot post messages right now. Try again later.');
	const nonce = randomUUID();
	const { request } = await createApprovalRequest({
		userId,
		requesterRole: 'owner',
		source: 'approval_test',
		sourceRef: null,
		actionType: TEST_ACTION_TYPE,
		venue: 'approval_test',
		payload: { v: 1, source: 'approval_test', test: true, nonce },
		summary: 'Test approval from three.ws. Approving or denying it does nothing.',
		chain: null,
		network: null,
		gateReason: 'You asked for a test card from the Teams panel on /approvals.',
		idempotencyKey: `approval_test:${userId}:${nonce}`,
		ttlMs: TEST_TTL_MS,
		autoApprovable: false,
		deliver: false,
	});
	const delivery = await deliverApprovalToTeams(request, { ignorePreference: true, ...overrides });
	return { approval_id: request.id, delivered: delivery.sent, ...(delivery.reason ? { reason: delivery.reason } : {}), ...(delivery.errors ? { errors: delivery.errors } : {}) };
}
