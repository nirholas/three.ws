// Microsoft Teams as an approval channel, end to end against the REAL
// approval_requests and teams_conversation_refs migrations in an in-process
// Postgres (PGlite). Every activity is signed with a Bot Framework style RS256
// token and goes through the real verifyBotToken before handleActivity sees it,
// exactly as api/microsoft-teams/messages.js does. Proactive sends go through
// the real Bot Connector client; only the network (fetch) is captured.
//
// Pins:
//   - the 1:1 conversation reference is stored on install and message, cleared
//     on uninstall, and never taken from a channel or group chat;
//   - an approval is delivered to Teams as a Universal Actions card bound to the
//     owner, behind the owner's switch, and a Teams failure never blocks push or
//     email;
//   - Approve executes exactly once (double submit, replay), Deny is terminal,
//     an expired request never runs, and a tampered button (edited mac, swapped
//     id, payload changed after the card was sent) runs nothing;
//   - someone who is not the owner gets a read-only card with no request details;
//   - the test approval runs nothing when approved;
//   - every card state validates against the Adaptive Cards 1.5 schema.

import { existsSync, readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from 'jose';
import Ajv from 'ajv';
import draft06 from 'ajv/dist/refs/json-schema-draft-06.json' with { type: 'json' };

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
const APP = '0b7f1f84-6f2b-4c39-9a0e-3c1d2c6e2a11';
process.env.MS_TEAMS_BOT_APP_ID = APP;
delete process.env.MS_TEAMS_BOT_APP_PASSWORD;
delete process.env.MS_TEAMS_BOT_TENANT_ID;

const dbState = { pg: null };

vi.mock('../api/_lib/db.js', () => {
	const sql = async (strings, ...values) => {
		const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''), '');
		const out = await dbState.pg.query(text, values);
		return out.rows;
	};
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false };
});

const audit = vi.hoisted(() => ({ logAudit: vi.fn() }));
vi.mock('../api/_lib/audit.js', () => audit);

const notify = vi.hoisted(() => ({
	insertNotification: vi.fn(async () => ({ id: 1, in_app: true, delivered: {} })),
	emailAllowedForType: vi.fn(async () => true),
}));
vi.mock('../api/_lib/notify.js', () => notify);

const email = vi.hoisted(() => ({ sendApprovalRequestEmail: vi.fn(async () => ({ id: 'email-1' })) }));
vi.mock('../api/_lib/email.js', () => email);

const executor = vi.hoisted(() => ({ executeApprovedIntentAction: vi.fn(async () => ({ status: 'ok', signature: 'SIGtest1111', usd: 12 })) }));
vi.mock('../api/_lib/wallet-intents.js', () => executor);

await import('../api/_lib/agent-knowledge.js');
const A = await import('../api/_lib/approvals.js');
const T = await import('../api/_lib/teams-approvals.js');
const C = await import('../api/_lib/teams-approval-cards.js');
const { handleActivity, verifyBotToken, BOTFRAMEWORK_ISSUER } = await import('../api/_lib/teams-bot.js');
const { resetBotToken } = await import('../api/_lib/teams-connector.js');

const migration = (name) => readFileSync(new URL(`../api/_lib/migrations/${name}`, import.meta.url), 'utf8');
const SIBLING_IDENTITIES = new URL('../api/_lib/migrations/20261116120000_teams_identities.sql', import.meta.url);

const { id: schemaId, ...schemaBody } = JSON.parse(readFileSync(new URL('./fixtures/adaptive-card-1.5.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
ajv.addMetaSchema(draft06);
const validateCard = ajv.compile({ $id: schemaId, ...schemaBody });
function expectValidCard(card) {
	const ok = validateCard(card);
	if (!ok) throw new Error(`card fails the Adaptive Cards 1.5 schema: ${JSON.stringify(validateCard.errors.slice(0, 5))}`);
}

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const AGENT = '33333333-3333-4333-8333-333333333333';
const TENANT = '72f988bf-86f1-41af-91ab-2d7cd011db47';
const OWNER_OID = 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_OID = 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb';
const STRANGER_OID = 'cccccccc-3333-4ccc-8ccc-cccccccccccc';
const RECIPIENT = 'THREEsynthetic1111111111111111111111111111';
const SERVICE = 'https://smba.trafficmanager.net/amer/';
const BOT = `28:${APP}`;
const ORIGIN = 'https://three.ws';

let keys;
let privateKey;

async function signedToken(serviceUrl = SERVICE) {
	return new SignJWT({ serviceurl: serviceUrl })
		.setProtectedHeader({ alg: 'RS256', kid: 'k1' })
		.setIssuer(BOTFRAMEWORK_ISSUER)
		.setAudience(APP)
		.setIssuedAt()
		.setExpirationTime('5m')
		.sign(privateKey);
}

/** What api/microsoft-teams/messages.js does: verify the token, then route. */
async function post(activity) {
	await verifyBotToken(`Bearer ${await signedToken(activity.serviceUrl)}`, { serviceUrl: activity.serviceUrl, keys });
	return handleActivity(activity, { origin: ORIGIN });
}

function person(oid, name = 'Ada Owner') {
	return { id: `29:mri-${oid}`, aadObjectId: oid.toUpperCase(), name };
}

function base(oid, extra = {}) {
	return {
		serviceUrl: SERVICE,
		channelId: 'msteams',
		from: person(oid),
		recipient: { id: BOT, name: 'three.ws' },
		conversation: { id: `a:1personal-${oid}`, conversationType: 'personal', tenantId: TENANT },
		channelData: { tenant: { id: TENANT } },
		...extra,
	};
}

function invoke(oid, verb, data) {
	return base(oid, {
		type: 'invoke',
		name: 'adaptiveCard/action',
		id: `act-${Math.random().toString(36).slice(2)}`,
		value: { action: { type: 'Action.Execute', verb, data }, trigger: 'manual' },
	});
}

function install(oid, action = 'add') {
	return base(oid, { type: 'installationUpdate', action, id: `inst-${action}` });
}

let seq = 0;
async function pending(overrides = {}) {
	seq += 1;
	const { request } = await A.createApprovalRequest({
		userId: OWNER,
		agentId: AGENT,
		source: 'wallet_intent',
		sourceRef: `intent-${seq}:${RECIPIENT}`,
		actionType: 'transfer_sol',
		venue: 'wallet_transfer',
		payload: { v: 1, source: 'wallet_intent', intent_id: `intent-${seq}`, lamports: '250000000', destination: RECIPIENT },
		summary: 'Send 0.25 SOL to a saved address',
		amount: 0.25,
		amountUsd: 40,
		asset: 'SOL',
		recipient: RECIPIENT,
		riskNotes: ['Your rule "Ask me above $25" asked for approval.'],
		gateReason: 'Ask me above $25',
		idempotencyKey: `wallet_intent:intent-${seq}:bucket`,
		deliver: false,
		...overrides,
	});
	return request;
}

const ownerIdentity = { tenantId: TENANT, aadObjectId: OWNER_OID };
const buttons = (row, identity = ownerIdentity) => ({
	approve: C.signTeamsAction({ verb: C.VERB_APPROVE, row, identity }),
	deny: C.signTeamsAction({ verb: C.VERB_DENY, row, identity }),
});
const rowOf = async (id) => (await dbState.pg.query('select * from approval_requests where id = $1', [id])).rows[0];
const refOf = async (oid) => (await dbState.pg.query('select * from teams_conversation_refs where aad_object_id = $1', [oid])).rows[0];
const cardText = (res) => JSON.stringify(res.value);
const actionsOf = (res) => (res.value.actions || []).map((a) => `${a.type}:${a.title}`);

beforeAll(async () => {
	const pair = await generateKeyPair('RS256');
	privateKey = pair.privateKey;
	keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' }] });

	dbState.pg = new PGlite();
	await dbState.pg.exec(`
		create table users (id uuid primary key, email text, display_name text, deleted_at timestamptz);
		create table agent_identities (id uuid primary key, user_id uuid, name text, deleted_at timestamptz, meta jsonb);
		create table user_identities (
			id uuid primary key default gen_random_uuid(), user_id uuid not null references users(id) on delete cascade,
			provider text not null, subject text not null, email text, display_name text, unique (provider, subject));
		insert into users (id, email, display_name) values ('${OWNER}', 'owner@example.com', 'Ada'), ('${OTHER}', 'other@example.com', 'Grace');
		insert into agent_identities (id, user_id, name) values ('${AGENT}', '${OWNER}', 'Scout');
		insert into user_identities (user_id, provider, subject, display_name) values
			('${OWNER}', 'microsoft', '${TENANT}:${OWNER_OID}', 'Ada Owner'),
			('${OTHER}', 'microsoft', '${TENANT}:${OTHER_OID}', 'Grace Other');
	`);
	await dbState.pg.exec(migration('20261010120000_approval_requests.sql'));
	await dbState.pg.exec(migration('20261116144659_teams_conversation_refs.sql'));
	// The `link <code>` store from the Teams activity feed work. teams-bot.js
	// writes install state there on every verified activity when it exists.
	if (existsSync(SIBLING_IDENTITIES)) await dbState.pg.exec(readFileSync(SIBLING_IDENTITIES, 'utf8'));
});

beforeEach(async () => {
	await dbState.pg.exec('delete from approval_requests; delete from teams_conversation_refs; delete from teams_approval_prefs;');
	vi.clearAllMocks();
	notify.insertNotification.mockResolvedValue({ id: 1, in_app: true, delivered: {} });
	executor.executeApprovedIntentAction.mockResolvedValue({ status: 'ok', signature: 'SIGtest1111', usd: 12 });
	resetBotToken();
});

afterEach(() => {
	vi.unstubAllGlobals();
	delete process.env.MS_TEAMS_BOT_APP_PASSWORD;
});

describe('conversation references', () => {
	it('stores the 1:1 reference on install, refreshes it on a message, and clears it on uninstall', async () => {
		await post(install(OWNER_OID));
		let ref = await refOf(OWNER_OID);
		expect(ref).toMatchObject({ tenant_id: TENANT, teams_user_id: `29:mri-${OWNER_OID}`, conversation_id: `a:1personal-${OWNER_OID}`, bot_id: BOT, service_url: SERVICE });

		await post(base(OWNER_OID, { type: 'message', id: 'm1', text: 'hello', serviceUrl: 'https://smba.trafficmanager.net/emea/' }));
		ref = await refOf(OWNER_OID);
		expect(ref.service_url).toBe('https://smba.trafficmanager.net/emea/');

		await post(install(OWNER_OID, 'remove'));
		expect(await refOf(OWNER_OID)).toBeUndefined();
	});

	it('clears the reference when the bot is removed from the 1:1 chat', async () => {
		await post(base(OWNER_OID, { type: 'conversationUpdate', membersAdded: [{ id: BOT }] }));
		expect(await refOf(OWNER_OID)).toBeTruthy();
		await post(base(OWNER_OID, { type: 'conversationUpdate', membersRemoved: [{ id: BOT }] }));
		expect(await refOf(OWNER_OID)).toBeUndefined();
	});

	it('never stores a channel or group chat as the approval destination', async () => {
		await post(base(OWNER_OID, { type: 'installationUpdate', action: 'add', conversation: { id: '19:channel@thread.tacv2', conversationType: 'channel', tenantId: TENANT } }));
		await post(base(OWNER_OID, { type: 'message', id: 'g1', text: 'hi', conversation: { id: '19:group@thread.v2', conversationType: 'groupChat', tenantId: TENANT } }));
		expect(await refOf(OWNER_OID)).toBeUndefined();
	});
});

describe('the invoke handler', () => {
	beforeEach(async () => {
		await post(install(OWNER_OID));
	});

	it('approve executes the action once and returns the executed card', async () => {
		const row = await pending();
		const res = await post(invoke(OWNER_OID, C.VERB_APPROVE, buttons(row).approve));
		expect(res.statusCode).toBe(200);
		expect(res.type).toBe('application/vnd.microsoft.card.adaptive');
		expect(executor.executeApprovedIntentAction).toHaveBeenCalledTimes(1);
		const stored = await rowOf(row.id);
		expect(stored).toMatchObject({ status: 'executed', decided_via: 'teams', decided_by: OWNER, signature: 'SIGtest1111' });
		expect(cardText(res)).toContain('Approved by Ada from Teams');
		expect(actionsOf(res)).toContain('Action.OpenUrl:View transaction');
		expect(actionsOf(res)).not.toContain('Action.Execute:Approve');
		expectValidCard(res.value);
	});

	it('deny is terminal, runs nothing, and names who denied it', async () => {
		const row = await pending();
		const res = await post(invoke(OWNER_OID, C.VERB_DENY, buttons(row).deny));
		expect(executor.executeApprovedIntentAction).not.toHaveBeenCalled();
		expect((await rowOf(row.id)).status).toBe('denied');
		expect(cardText(res)).toContain('Denied by Ada from Teams');
		const later = await post(invoke(OWNER_OID, C.VERB_APPROVE, buttons(row).approve));
		expect(executor.executeApprovedIntentAction).not.toHaveBeenCalled();
		expect((await rowOf(row.id)).status).toBe('denied');
		expect(cardText(later)).toContain('Denied by');
	});

	it('a double submit executes once', async () => {
		const row = await pending();
		const data = buttons(row).approve;
		const [a, b] = await Promise.all([post(invoke(OWNER_OID, C.VERB_APPROVE, data)), post(invoke(OWNER_OID, C.VERB_APPROVE, data))]);
		expect(executor.executeApprovedIntentAction).toHaveBeenCalledTimes(1);
		expect((await rowOf(row.id)).status).toBe('executed');
		for (const res of [a, b]) {
			expect(res.statusCode).toBe(200);
			expect(actionsOf(res)).not.toContain('Action.Execute:Approve');
		}
	});

	it('a replayed approve after execution redraws the card and runs nothing', async () => {
		const row = await pending();
		const data = buttons(row).approve;
		await post(invoke(OWNER_OID, C.VERB_APPROVE, data));
		const replay = await post(invoke(OWNER_OID, C.VERB_APPROVE, data));
		expect(executor.executeApprovedIntentAction).toHaveBeenCalledTimes(1);
		expect(cardText(replay)).toContain('executed');
		const denyAfter = await post(invoke(OWNER_OID, C.VERB_DENY, buttons(row).deny));
		expect((await rowOf(row.id)).status).toBe('executed');
		expect(cardText(denyAfter)).toContain('Approved by');
	});

	it('an expired request never runs and the card says it expired', async () => {
		const row = await pending();
		await dbState.pg.query(`update approval_requests set expires_at = now() - interval '1 minute' where id = $1`, [row.id]);
		const expired = await rowOf(row.id);
		const res = await post(invoke(OWNER_OID, C.VERB_APPROVE, buttons(expired).approve));
		expect(executor.executeApprovedIntentAction).not.toHaveBeenCalled();
		expect(['pending', 'expired']).toContain((await rowOf(row.id)).status);
		expect(cardText(res)).toContain('Expired before a decision');
		expect(actionsOf(res)).not.toContain('Action.Execute:Approve');
		expectValidCard(res.value);
	});

	it('a button pressed after its deadline runs nothing, even before the row is swept', async () => {
		const row = await pending();
		const data = buttons(row).approve;
		const res = await handleActivity(invoke(OWNER_OID, C.VERB_APPROVE, data), { origin: ORIGIN, deps: { now: () => new Date(row.expires_at).getTime() + 1000 } });
		expect(executor.executeApprovedIntentAction).not.toHaveBeenCalled();
		expect((await rowOf(row.id)).status).toBe('pending');
		expect(cardText(res)).toContain('Expired before a decision');
	});

	describe('tamper', () => {
		it('an edited mac runs nothing', async () => {
			const row = await pending();
			const data = { ...buttons(row).approve };
			data.mac = `${data.mac.slice(0, -1)}${data.mac.endsWith('A') ? 'B' : 'A'}`;
			const res = await post(invoke(OWNER_OID, C.VERB_APPROVE, data));
			expect(executor.executeApprovedIntentAction).not.toHaveBeenCalled();
			expect((await rowOf(row.id)).status).toBe('pending');
			expect(cardText(res)).toContain('does not match the request on file');
			expectValidCard(res.value);
		});

		it('a Deny signature replayed as Approve runs nothing', async () => {
			const row = await pending();
			await post(invoke(OWNER_OID, C.VERB_APPROVE, buttons(row).deny));
			expect(executor.executeApprovedIntentAction).not.toHaveBeenCalled();
			expect((await rowOf(row.id)).status).toBe('pending');
		});

		it('a button moved onto another request of the same owner runs nothing', async () => {
			const first = await pending();
			const second = await pending();
			await post(invoke(OWNER_OID, C.VERB_APPROVE, { ...buttons(first).approve, approval_id: second.id }));
			expect(executor.executeApprovedIntentAction).not.toHaveBeenCalled();
			expect((await rowOf(second.id)).status).toBe('pending');
		});

		it('a payload changed after the card was sent runs nothing', async () => {
			const row = await pending();
			const data = buttons(row).approve;
			const swapped = { ...row.payload, destination: 'THREEsynthetic2222222222222222222222222222' };
			await dbState.pg.query('update approval_requests set payload = $2::jsonb, payload_hash = $3 where id = $1', [row.id, JSON.stringify(swapped), A.payloadHash(swapped)]);
			const res = await post(invoke(OWNER_OID, C.VERB_APPROVE, data));
			expect(executor.executeApprovedIntentAction).not.toHaveBeenCalled();
			expect((await rowOf(row.id)).status).toBe('pending');
			expect(cardText(res)).toContain('does not match the request on file');
		});
	});

	describe('wrong user', () => {
		it('a different linked account gets a read-only card with no request details', async () => {
			const row = await pending();
			const res = await post(invoke(OTHER_OID, C.VERB_APPROVE, buttons(row).approve));
			expect(executor.executeApprovedIntentAction).not.toHaveBeenCalled();
			expect((await rowOf(row.id)).status).toBe('pending');
			expect(cardText(res)).toContain('Only the three.ws account owner');
			expect(cardText(res)).not.toContain('0.25 SOL');
			expect(cardText(res)).not.toContain(RECIPIENT);
			expect(actionsOf(res)).toEqual(['Action.OpenUrl:Open three.ws approvals']);
			expectValidCard(res.value);
		});

		it('a forwarded card pressed by its new holder fails even with their own signature', async () => {
			const row = await pending();
			const forged = buttons(row, { tenantId: TENANT, aadObjectId: OTHER_OID }).approve;
			await post(invoke(OTHER_OID, C.VERB_APPROVE, forged));
			expect(executor.executeApprovedIntentAction).not.toHaveBeenCalled();
		});

		it('an unlinked Teams account is told how to link and sees nothing', async () => {
			const row = await pending();
			const res = await post(invoke(STRANGER_OID, C.VERB_APPROVE, buttons(row).approve));
			expect(executor.executeApprovedIntentAction).not.toHaveBeenCalled();
			expect(cardText(res)).toContain('not linked to a three.ws account');
			expect(cardText(res)).not.toContain('0.25 SOL');
			const refresh = await post(invoke(STRANGER_OID, C.VERB_APPROVAL_REFRESH, { approval_id: row.id }));
			expect(cardText(refresh)).toContain('not linked to a three.ws account');
		});

		it('an invoke with no tenant identity is treated as unlinked', async () => {
			const row = await pending();
			const act = invoke(OWNER_OID, C.VERB_APPROVE, buttons(row).approve);
			delete act.from.aadObjectId;
			const res = await post(act);
			expect(cardText(res)).toContain('not linked');
			expect(executor.executeApprovedIntentAction).not.toHaveBeenCalled();
		});
	});

	it('refresh shows the current state to the owner with live buttons while pending', async () => {
		const row = await pending();
		const res = await post(invoke(OWNER_OID, C.VERB_APPROVAL_REFRESH, { approval_id: row.id }));
		expect(actionsOf(res)).toEqual(expect.arrayContaining(['Action.Execute:Approve', 'Action.Execute:Deny', 'Action.OpenUrl:Review on the web']));
		expect(res.value.refresh).toMatchObject({ action: { verb: C.VERB_APPROVAL_REFRESH }, userIds: [`29:mri-${OWNER_OID}`] });
		await A.decideApproval({ userId: OWNER, id: row.id, decision: 'deny', via: 'web' });
		const after = await post(invoke(OWNER_OID, C.VERB_APPROVAL_REFRESH, { approval_id: row.id }));
		expect(cardText(after)).toContain('Denied by Ada from the web inbox');
	});

	it('a request above the wallet-signature threshold is not executed and says why', async () => {
		const row = await pending();
		await dbState.pg.query(`update approval_requests set payload = payload || '{"_burner":{"tier":"owner_sign","auto_max_usd":5,"confirm_above_usd":10}}'::jsonb where id = $1`, [row.id]);
		const fixed = await rowOf(row.id);
		await dbState.pg.query('update approval_requests set payload_hash = $2 where id = $1', [row.id, A.payloadHash(fixed.payload)]);
		const signed = await rowOf(row.id);
		expect(A.requiresWalletSignature(signed)).toBe(true);
		const res = await post(invoke(OWNER_OID, C.VERB_APPROVE, buttons(signed).approve));
		expect(executor.executeApprovedIntentAction).not.toHaveBeenCalled();
		expect(cardText(res)).toContain('Not executed:');
	});

	it('answers a malformed card action with an error, not a crash', async () => {
		const res = await post(invoke(OWNER_OID, C.VERB_APPROVE, { approval_id: 'not-a-uuid' }));
		expect(res).toMatchObject({ statusCode: 400, type: 'application/vnd.microsoft.error' });
	});
});

describe('delivery', () => {
	/** Capture the Bot Connector traffic: the token mint and each posted activity. */
	function captureConnector({ status = 201 } = {}) {
		const posts = [];
		vi.stubGlobal('fetch', vi.fn(async (url, init) => {
			if (String(url).startsWith('https://login.microsoftonline.com/')) {
				return new Response(JSON.stringify({ access_token: 'bot-token', expires_in: 3600 }), { status: 200 });
			}
			posts.push({ url: String(url), auth: init.headers.authorization, body: JSON.parse(init.body) });
			return status < 300 ? new Response(JSON.stringify({ id: `msg-${posts.length}` }), { status }) : new Response('gone', { status });
		}));
		process.env.MS_TEAMS_BOT_APP_PASSWORD = 'test-secret';
		return posts;
	}

	beforeEach(async () => {
		await post(install(OWNER_OID));
	});

	it('posts the owner a card with Approve and Deny bound to them, and skips the email fallback', async () => {
		const posts = captureConnector();
		const row = await pending({ deliver: true });
		expect(posts).toHaveLength(1);
		expect(posts[0].url).toBe(`https://smba.trafficmanager.net/amer/v3/conversations/${encodeURIComponent(`a:1personal-${OWNER_OID}`)}/activities`);
		expect(posts[0].auth).toBe('Bearer bot-token');
		const [attachment] = posts[0].body.attachments;
		expect(attachment.contentType).toBe('application/vnd.microsoft.card.adaptive');
		const card = attachment.content;
		expectValidCard(card);
		const approve = card.actions.find((a) => a.title === 'Approve');
		expect(approve).toMatchObject({ type: 'Action.Execute', verb: C.VERB_APPROVE });
		expect(C.verifyTeamsAction({ verb: C.VERB_APPROVE, data: approve.data, row, identity: ownerIdentity }).ok).toBe(true);
		expect(card.refresh.userIds).toEqual([`29:mri-${OWNER_OID}`]);
		const text = JSON.stringify(card);
		expect(text).toContain('Scout');
		expect(text).toContain('0.25 SOL');
		expect(text).toContain('Ask me above $25');
		expect(notify.insertNotification).toHaveBeenCalledTimes(1);
		expect(email.sendApprovalRequestEmail).not.toHaveBeenCalled();

		// The delivered button decides the request through the inbox path.
		await post(invoke(OWNER_OID, approve.verb, approve.data));
		expect(executor.executeApprovedIntentAction).toHaveBeenCalledTimes(1);
	});

	it('reports the Teams leg in the fan-out result alongside push', async () => {
		captureConnector();
		notify.insertNotification.mockResolvedValue({ id: 1, in_app: true, delivered: { push: 1 } });
		const row = await pending();
		const out = await A.deliverApproval(row);
		expect(out).toMatchObject({ push: 1, teams: 1, email: 0 });
	});

	it('a Teams failure never blocks push or email, and a removed chat is forgotten', async () => {
		const posts = captureConnector({ status: 403 });
		const row = await pending();
		const out = await A.deliverApproval(row);
		expect(posts).toHaveLength(1);
		expect(out).toMatchObject({ teams: 0, email: 1 });
		expect(notify.insertNotification).toHaveBeenCalledTimes(1);
		expect(email.sendApprovalRequestEmail).toHaveBeenCalledTimes(1);
		expect(await refOf(OWNER_OID)).toBeUndefined();
	});

	it('a Teams outage does not throw out of the fan-out', async () => {
		process.env.MS_TEAMS_BOT_APP_PASSWORD = 'test-secret';
		vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
		const row = await pending();
		const out = await A.deliverApproval(row);
		expect(out).toMatchObject({ teams: 0, email: 1 });
	});

	it('respects the owner switch', async () => {
		const posts = captureConnector();
		await T.setTeamsApprovalsEnabled(OWNER, false);
		const row = await pending();
		expect(await T.deliverApprovalToTeams(row)).toMatchObject({ sent: 0, reason: 'disabled' });
		expect(posts).toHaveLength(0);
		await T.setTeamsApprovalsEnabled(OWNER, true);
		expect(await T.deliverApprovalToTeams(row)).toMatchObject({ sent: 1 });
	});

	it('says why nothing was sent when the bot cannot post or the owner never installed it', async () => {
		const row = await pending();
		expect(await T.deliverApprovalToTeams(row)).toMatchObject({ sent: 0, reason: 'not_configured' });
		captureConnector();
		await post(install(OWNER_OID, 'remove'));
		expect(await T.deliverApprovalToTeams(row)).toMatchObject({ sent: 0, reason: 'not_installed' });
	});
});

describe('the test approval', () => {
	it('is delivered to Teams only, labelled as a test, and runs nothing when approved', async () => {
		await post(install(OWNER_OID));
		const posts = [];
		process.env.MS_TEAMS_BOT_APP_PASSWORD = 'test-secret';
		vi.stubGlobal('fetch', vi.fn(async (url, init) => {
			if (String(url).startsWith('https://login.microsoftonline.com/')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
			posts.push(JSON.parse(init.body));
			return new Response(JSON.stringify({ id: 'm' }), { status: 201 });
		}));
		await T.setTeamsApprovalsEnabled(OWNER, false);
		const out = await T.sendTestApproval(OWNER);
		expect(out).toMatchObject({ delivered: 1 });
		expect(notify.insertNotification).not.toHaveBeenCalled();
		expect(email.sendApprovalRequestEmail).not.toHaveBeenCalled();
		const card = posts[0].attachments[0].content;
		expectValidCard(card);
		expect(JSON.stringify(card)).toContain('Test approval (nothing runs)');
		const approve = card.actions.find((a) => a.title === 'Approve');
		const res = await post(invoke(OWNER_OID, approve.verb, approve.data));
		const stored = await rowOf(out.approval_id);
		expect(stored).toMatchObject({ status: 'executed', source: 'approval_test', action_type: 'approval_test', decided_via: 'teams' });
		expect(stored.result.note).toBe('Test approval: nothing ran.');
		expect(executor.executeApprovedIntentAction).not.toHaveBeenCalled();
		expect(cardText(res)).toContain('This was a test, so nothing ran.');
	});

	it('refuses with a clear reason when Teams is not linked or not installed', async () => {
		await expect(T.sendTestApproval(OTHER)).rejects.toMatchObject({ status: 409, code: 'teams_not_installed' });
		await dbState.pg.query(`delete from user_identities where user_id = $1`, [OTHER]);
		await expect(T.sendTestApproval(OTHER)).rejects.toMatchObject({ status: 409, code: 'teams_not_linked' });
		await dbState.pg.query(`insert into user_identities (user_id, provider, subject, display_name) values ($1, 'microsoft', $2, 'Grace Other')`, [OTHER, `${TENANT}:${OTHER_OID}`]);
	});

	it('the settings status reflects link, install, bot and switch', async () => {
		expect(await T.teamsApprovalStatus(OWNER)).toMatchObject({ linked: true, installed: false, bot_configured: false, enabled: true });
		await post(install(OWNER_OID));
		process.env.MS_TEAMS_BOT_APP_PASSWORD = 'test-secret';
		await T.setTeamsApprovalsEnabled(OWNER, false);
		expect(await T.teamsApprovalStatus(OWNER)).toMatchObject({ linked: true, installed: true, chats: 1, bot_configured: true, enabled: false });
	});
});

describe('card states validate against the Adaptive Cards 1.5 schema', () => {
	it('pending, approved, executing, executed, failed, denied, expired, restricted and notice', async () => {
		const row = await pending();
		const full = await T.loadApprovalForCard(row.id);
		const at = new Date().toISOString();
		const states = [
			{ ...full },
			{ ...full, status: 'approved', decided_at: at, decided_via: 'push', decider_name: 'Ada' },
			{ ...full, status: 'executing', decided_at: at, decided_via: 'teams', decider_name: 'Ada' },
			{ ...full, status: 'executed', decided_at: at, executed_at: at, decided_via: 'teams', decider_name: 'Ada', signature: 'SIGtest1111' },
			{ ...full, status: 'failed', decided_at: at, decided_via: 'teams', decider_name: null, result: { note: 'Insufficient balance' } },
			{ ...full, status: 'denied', decided_at: at, decided_via: 'telegram', decider_name: 'Ada' },
			{ ...full, expires_at: new Date(Date.now() - 1000).toISOString() },
		];
		for (const state of states) {
			expectValidCard(C.approvalCard(state, { origin: ORIGIN, identity: ownerIdentity, canDecide: true, teamsUserId: `29:mri-${OWNER_OID}` }));
		}
		expectValidCard(C.approvalCard(full, { origin: ORIGIN, identity: ownerIdentity, canDecide: true, teamsUserId: null, notice: 'Not executed: test' }));
		expectValidCard(C.approvalCard(full, { origin: ORIGIN }));
		expectValidCard(T.restrictedCard('Only the owner can see this.', { origin: ORIGIN }));
		expect(C.outcomeBanner(states[4]).text).toContain('Insufficient balance');
		expect(C.outcomeBanner(states[4]).text).toContain('the account owner');
	});
});
