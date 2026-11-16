// The Teams bot's Responsible AI paths end to end on a real (PGlite) schema
// built from the shipped migration: the payloads are the activities Teams
// sends (feedback `message/submitAction`, the Report card button's task/fetch
// and task/submit, the Report message action), they go through the real
// handleActivity router, and the assertions read the stored rows back.
// Also covers an agent reply run: streamed in personal chat, one message in a
// group chat, cited passages, the AI label and the teams_ai_messages link.
// https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/bot-messages-ai-generated-content
// https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/feedback-loop

import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { createPgliteSql } from './_helpers/pglite-sql.js';

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';

const holder = vi.hoisted(() => ({ db: null }));

vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});

const MIGRATION = readFileSync('api/_lib/migrations/20261116145416_teams_responsible_ai.sql', 'utf8');
const BOT_APP_ID = '5d1c2b3a-0000-4000-8000-00000000b071';
const TENANT = '72f988bf-86f1-41af-91ab-2d7cd011db47';
const SERVICE = 'https://smba.trafficmanager.net/amer/';
const PERSONAL = 'a:1Hk3pQ-personal-chat-synthetic';
const GROUP = '19:meeting_N2Y4ZTlhsynthetic@thread.v2';
const AGENT = '00000000-0000-4000-8000-0000000000a1';
const DOC = '00000000-0000-4000-8000-0000000000d1';
const USER = { id: '29:1Xq2-teams-user-synthetic', name: 'Megan Bowen', aadObjectId: 'a1b2c3d4-0000-4000-8000-00000000e001' };

let handleActivity;
let forge;
let runTeamsAgentReply;
let recordAiMessage;
let hashId;

beforeAll(async () => {
	({ handleActivity } = await import('../api/_lib/teams-bot.js'));
	forge = await import('../api/_lib/teams-forge.js');
	({ runTeamsAgentReply } = await import('../api/_lib/teams-agent-chat.js'));
	({ recordAiMessage } = await import('../api/_lib/teams-ai-store.js'));
	({ hashId } = await import('../api/_lib/teams-ai.js'));
});

beforeEach(async () => {
	holder.db = createPgliteSql();
	await holder.db.exec(`
		create table agent_identities (id uuid primary key, name text, meta jsonb, user_id uuid, deleted_at timestamptz);
		insert into agent_identities (id, name) values ('${AGENT}', 'Atlas');
	`);
	await holder.db.exec(MIGRATION);
});

let seq = 0;
const nextId = () => `1731770${String(++seq).padStart(6, '0')}`;

const base = (conversation, over = {}) => ({
	channelId: 'msteams',
	serviceUrl: SERVICE,
	id: nextId(),
	timestamp: '2026-11-16T15:00:00.000Z',
	from: USER,
	recipient: { id: `28:${BOT_APP_ID}`, name: 'three.ws 3D Studio' },
	conversation: conversation === 'personal'
		? { conversationType: 'personal', tenantId: TENANT, id: PERSONAL }
		: { conversationType: 'groupChat', tenantId: TENANT, id: GROUP, isGroup: true },
	channelData: { tenant: { id: TENANT } },
	...over,
});

// Teams' documented feedback invoke: actionName 'feedback', the reaction, and
// the feedback form's JSON as a string; replyToId is the labelled message.
const feedbackInvoke = (messageId, reaction, feedbackText) => base('personal', {
	type: 'invoke',
	name: 'message/submitAction',
	replyToId: messageId,
	value: { actionName: 'feedback', actionValue: { reaction, feedback: JSON.stringify({ feedbackText }) } },
});

const alerts = () => {
	const sent = [];
	const alert = async (title, detail, opts) => { sent.push({ title, detail, opts }); return true; };
	return { sent, alert };
};

const ctx = (deps = {}) => ({ origin: 'https://three.ws', deps: { botAppId: BOT_APP_ID, ...deps } });

async function rows(table) {
	return holder.db.sql([`select * from ${table} order by created_at`]);
}

describe('feedback', () => {
	it('stores a thumbs down with its comment, linked to the agent and the tenant, and answers an empty 200', async () => {
		await recordAiMessage({ conversationId: PERSONAL, activityId: '1:bot-reply-1', tenantId: TENANT, kind: 'agent_reply', agentId: AGENT, model: 'llama-3.3-70b' });
		const body = await handleActivity(feedbackInvoke('1:bot-reply-1', 'dislike', 'It quoted the old returns policy'), ctx());
		expect(body).toBeNull();
		const [row] = await rows('teams_ai_feedback');
		expect(row).toMatchObject({
			activity_id: '1:bot-reply-1', reaction: 'dislike', comment: 'It quoted the old returns policy',
			kind: 'agent_reply', agent_id: AGENT, tenant_id: TENANT,
			conversation_hash: hashId(PERSONAL), reporter_hash: hashId(USER.aadObjectId),
		});
		expect(JSON.stringify(row)).not.toContain(USER.id);
		expect(JSON.stringify(row)).not.toContain(PERSONAL);
	});

	it('replaces a person\'s earlier vote on the same message instead of adding a second', async () => {
		await handleActivity(feedbackInvoke('1:bot-reply-2', 'dislike', ''), ctx());
		await handleActivity(feedbackInvoke('1:bot-reply-2', 'like', 'Fixed now, thanks'), ctx());
		const all = await rows('teams_ai_feedback');
		expect(all).toHaveLength(1);
		expect(all[0]).toMatchObject({ reaction: 'like', comment: 'Fixed now, thanks' });
	});
});

describe('Report on a generated 3D model card', () => {
	async function seedModel() {
		const key = forge.forgeKey(GROUP, nextId());
		await forge.claimJob({ key, prompt: 'a weathered brass ship compass', tier: 'standard', by: { id: USER.id, name: USER.name, tenantId: TENANT }, conversation: { id: GROUP, serviceUrl: SERVICE }, origin: 'https://three.ws' });
		await forge.patchJob(key, { state: 'done', activityId: '1:card-msg', result: { glbUrl: 'https://media.three.ws/forge/9b2f/model.glb', viewerUrl: 'https://three.ws/viewer?model=9b2f' } });
		return key;
	}
	// The card's Action.Submit with msteams.type task/fetch arrives as this.
	const cardTask = (name, data) => base('group', { type: 'invoke', name, replyToId: '1:card-msg', value: { type: 'task/fetch', data } });

	it('opens the report dialog, stores the report against the job, alerts ops and confirms', async () => {
		const key = await seedModel();
		const fetched = await handleActivity(cardTask('task/fetch', { msteams: { type: 'task/fetch' }, verb: 'threews.report', kind: 'forge_model', key }), ctx());
		expect(fetched.task.type).toBe('continue');
		expect(fetched.task.value.card.content.body.some((b) => b.id === 'reason')).toBe(true);

		const { sent, alert } = alerts();
		const done = await handleActivity(cardTask('task/submit', { verb: 'threews.report', kind: 'forge_model', key, reason: 'copyright', comment: 'This is a trademarked logo' }), ctx({ alert }));
		expect(done.task.type).toBe('message');
		expect(done.task.value).toMatch(/Thanks for the report/);

		const [report] = await rows('content_reports');
		expect(report).toMatchObject({
			surface: 'teams', subject_kind: 'forge_model', forge_key: key, activity_id: '1:card-msg', reason: 'copyright',
			comment: 'This is a trademarked logo', excerpt: 'Prompt: a weathered brass ship compass', status: 'open', tenant_id: TENANT,
			model_url: 'https://three.ws/viewer?model=9b2f',
		});
		expect(sent).toHaveLength(1);
		expect(sent[0].title).toBe('Content report in Teams: a generated 3D model');
		expect(sent[0].detail).toContain('Reason: Infringes copyright or a trademark');
		expect(sent[0].opts).toEqual({ signature: `content_report:${report.id}`, severity: 'warn' });
	});

	it('asks again when no reason was picked, and stores nothing', async () => {
		const key = await seedModel();
		const r = await handleActivity(cardTask('task/submit', { verb: 'threews.report', kind: 'forge_model', key, comment: 'bad' }), ctx());
		expect(r.task.type).toBe('continue');
		expect(await rows('content_reports')).toHaveLength(0);
	});
});

describe('Report message action', () => {
	// Teams' documented message action fetchTask/submitAction for a message
	// the bot posted (messagePayload.from.application).
	const action = (name, payload, data) => base('personal', {
		type: 'invoke',
		name,
		value: { commandId: 'reportContent', commandContext: 'message', context: { theme: 'default' }, messagePayload: payload, ...(data ? { data } : {}) },
	});
	const botReply = {
		id: '1:bot-reply-9',
		messageType: 'message',
		from: { application: { id: BOT_APP_ID, displayName: 'three.ws 3D Studio', applicationIdentityType: 'bot' } },
		body: { contentType: 'html', content: '<p>Returns are accepted for <b>30 days</b> [1].</p>' },
		attachments: [],
	};

	it('reports an agent reply with its excerpt, names the agent and alerts ops once', async () => {
		await recordAiMessage({ conversationId: PERSONAL, activityId: '1:bot-reply-9', tenantId: TENANT, kind: 'agent_reply', agentId: AGENT });
		const fetched = await handleActivity(action('composeExtension/fetchTask', botReply), ctx());
		expect(fetched.task.type).toBe('continue');

		const { sent, alert } = alerts();
		const done = await handleActivity(action('composeExtension/submitAction', botReply, { reason: 'misinformation', comment: '' }), ctx({ alert }));
		expect(done.task.value).toMatch(/Thanks for the report/);
		const [report] = await rows('content_reports');
		expect(report).toMatchObject({ subject_kind: 'agent_reply', agent_id: AGENT, reason: 'misinformation', excerpt: 'Returns are accepted for 30 days [1].', comment: null });
		expect(sent[0].detail).toContain(`Agent: https://three.ws/agents/${AGENT}`);

		const again = await handleActivity(action('composeExtension/submitAction', botReply, { reason: 'harmful' }), ctx({ alert }));
		expect(again.task.value).toMatch(/already reported/);
		expect(await rows('content_reports')).toHaveLength(1);
		expect(sent).toHaveLength(1);
	});

	it('refuses a person\'s message and points to Teams\' own reporting', async () => {
		const human = { ...botReply, id: '1:human-msg', from: { user: { id: USER.aadObjectId, displayName: USER.name, userIdentityType: 'aadUser' } } };
		const r = await handleActivity(action('composeExtension/fetchTask', human), ctx());
		expect(r.task.type).toBe('message');
		expect(r.task.value).toMatch(/Teams' own Report/);
		expect(await rows('content_reports')).toHaveLength(0);
	});
});

describe('agent reply run', () => {
	const agentRow = { id: AGENT, name: 'Atlas', description: 'Customer support for Contoso Outfitters.', skills: [], meta: {}, embed_policy: null };
	const hits = [
		{ doc_id: DOC, name: 'returns-policy.pdf', title: 'Returns policy', heading: 'Refunds', locator: 'page 2', kind: 'pdf', content: 'Returns are accepted within 30 days of delivery.' },
		{ doc_id: '00000000-0000-4000-8000-0000000000d2', name: 'shipping.md', title: 'Shipping', kind: 'md', content: 'Orders ship in 2 business days.' },
	];
	function recordingConnector() {
		const calls = [];
		let n = 0;
		const answer = (kind) => async (args) => { calls.push({ kind, ...args }); return { id: `1:stream-${++n}` }; };
		return { calls, connectorConfigured: () => true, sendToConversation: answer('send'), replyToActivity: answer('reply'), updateActivity: answer('update') };
	}
	function clock() {
		let t = 1_000_000;
		return { now: () => t, sleep: async (ms) => { t += ms; } };
	}
	// A provider that streams its answer in pieces, as streamRound does.
	const streamingProvider = (pieces, c) => async (_provider, { onContent }) => {
		for (const p of pieces) { await c.sleep(700); onContent(p); }
		return { content: pieces.join(''), usage: { input: 900, output: 40 } };
	};
	const snapshot = (conversation, text) => ({ agentId: AGENT, origin: 'https://three.ws', text, activity: base(conversation, { type: 'message', text }) });

	it('streams in personal chat: status lines, cumulative text, then the labelled final with the cited document', async () => {
		const connector = recordingConnector();
		const c = clock();
		const pieces = ['Returns are accepted within ', '30 days of delivery [1]. ', 'Refunds go back to the original payment method.'];
		const posted = await runTeamsAgentReply(snapshot('personal', 'What is the returns window?'), {
			connector, now: c.now, sleep: c.sleep,
			loadAgent: async () => agentRow,
			retrieve: async () => hits,
			chainFor: async () => [{ name: 'groq', model: 'llama-3.3-70b-versatile' }],
			streamRound: streamingProvider(pieces, c),
		});
		const acts = connector.calls.map((x) => x.activity);
		expect(connector.calls.every((x) => x.kind === 'send')).toBe(true);
		expect(acts[0]).toMatchObject({ type: 'typing', text: 'Searching Atlas\'s documents', entities: [{ type: 'streaminfo', streamType: 'informative', streamSequence: 1 }] });
		expect(acts[1]).toMatchObject({ type: 'typing', text: 'Found 2 relevant passages. Writing the answer' });
		const updates = acts.filter((a) => a.type === 'typing' && a.entities[0].streamType === 'streaming');
		expect(updates.length).toBeGreaterThan(0);
		updates.forEach((u, i) => {
			expect(pieces.join('').startsWith(u.text)).toBe(true);
			if (i) expect(u.text.length).toBeGreaterThan(updates[i - 1].text.length);
		});
		const seqs = acts.slice(0, -1).map((a) => a.entities[0].streamSequence);
		expect(seqs).toEqual(seqs.map((_, i) => i + 1));
		const final = acts.at(-1);
		expect(final.type).toBe('message');
		expect(final.text).toBe(pieces.join(''));
		expect(final.entities[0]).toEqual({ type: 'streaminfo', streamId: '1:stream-1', streamType: 'final' });
		expect(final.entities[1].additionalType).toEqual(['AIGeneratedContent']);
		expect(final.entities[1].citation).toHaveLength(1);
		expect(final.entities[1].citation[0]).toMatchObject({ position: 1, appearance: { name: 'Returns policy', url: `https://three.ws/agents/${AGENT}`, keywords: ['Refunds', 'page 2'] } });
		expect(final.channelData).toMatchObject({ feedbackLoopEnabled: true });
		expect(posted).toMatchObject({ id: '1:stream-1', streamed: true, labelled: true });

		const [link] = await rows('teams_ai_messages');
		expect(link).toMatchObject({ activity_id: '1:stream-1', kind: 'agent_reply', agent_id: AGENT, model: 'llama-3.3-70b-versatile', cited_docs: [DOC], tenant_id: TENANT });
	});

	it('posts one labelled message in a group chat', async () => {
		const connector = recordingConnector();
		const c = clock();
		const posted = await runTeamsAgentReply(snapshot('group', 'How fast do orders ship?'), {
			connector, now: c.now, sleep: c.sleep,
			loadAgent: async () => agentRow,
			retrieve: async () => hits,
			chainFor: async () => [{ name: 'groq', model: 'llama-3.3-70b-versatile' }],
			streamRound: streamingProvider(['Orders ship in ', '2 business days [2].'], c),
		});
		expect(connector.calls).toHaveLength(1);
		const [only] = connector.calls;
		expect(only.kind).toBe('reply');
		expect(only.activity.text).toBe('Orders ship in 2 business days [2].');
		expect(only.activity.entities).toHaveLength(1);
		expect(only.activity.entities[0].citation.map((x) => x.position)).toEqual([2]);
		expect(posted.streamed).toBe(false);
	});

	it('sends an unlabelled error message when no provider answers', async () => {
		const connector = recordingConnector();
		const c = clock();
		await runTeamsAgentReply(snapshot('group', 'Hello?'), {
			connector, now: c.now, sleep: c.sleep,
			loadAgent: async () => agentRow,
			retrieve: async () => [],
			chainFor: async () => [{ name: 'groq', model: 'llama-3.3-70b-versatile' }],
			streamRound: async () => { throw Object.assign(new Error('upstream 503'), { status: 503 }); },
			complete: async () => { throw new Error('all providers failed'); },
		});
		const [only] = connector.calls;
		expect(only.activity.text).toMatch(/cannot answer right now/);
		expect(only.activity.entities).toBeUndefined();
		expect(await rows('teams_ai_messages')).toHaveLength(0);
	});
});
