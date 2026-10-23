// Agent mode of the X mention bot: the supplier joining agent_x_policies and
// agent_x_connections, the scope check, and the policy gates in handleMention,
// against the real x_mention_events and agent_x_policies migrations (PGlite).
// The reply brain is the only captured boundary.

import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const dbState = { pg: null };

vi.mock('../api/_lib/db.js', () => {
	const sql = async (strings, ...values) => {
		const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''), '');
		return (await dbState.pg.query(text, values)).rows;
	};
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false };
});
vi.mock('../api/auth/x/[action].js', () => ({ encryptToken: (s) => s, decryptToken: (s) => s }));

const poll = await import('../api/_lib/x-mention-poll.js');
const store = await import('../api/_lib/x-mention-store.js');
const agents = await import('../api/_lib/x-agent-mentions.js');
const { DEFAULT_POLICY } = await import('../api/_lib/x-agent-policy.js');

const MIG = new URL('../api/_lib/migrations/', import.meta.url);
const read = (f) => readFileSync(new URL(f, MIG), 'utf8');
const APP_SETTINGS = (() => {
	const src = read('20260922210000_free_tier_models.sql');
	const start = src.indexOf('CREATE TABLE IF NOT EXISTS app_settings');
	return src.slice(start, src.indexOf(');', start) + 2);
})();

const AGENT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const AVATAR_ID = '33333333-3333-4333-8333-333333333333';
const ACCT = { kind: 'agent', ref: AGENT_ID };
const ACCOUNT = { ...ACCT, userId: '1700000000000000077', handle: 'scoutbot' };
const AGENT = { id: AGENT_ID, user_id: USER_ID, name: 'Scout', persona_prompt: 'Curious and brief.', meta: {}, avatar_id: null };
const policy = (over = {}) => ({ dry_run: true, daily_cap: 10, mention_replies_allowed_intents: ['chat'], ...over });
const ctx = (over = {}) => ({ agentId: AGENT_ID, userId: USER_ID, agent: AGENT, policy: policy(over) });

let n = 0;
function mention(text = '@scoutbot hello there', extra = {}) {
	const id = String(1900000000000001000n + BigInt(++n));
	return {
		id, userId: '42', username: 'alice', text, createdAt: new Date().toISOString(), conversationId: id, account: ACCT,
		mentions: [{ username: 'scoutbot', id: ACCOUNT.userId }], urls: [], media: [], inReplyToUserId: null, repliedTo: null,
		quoted: null, isRetweet: false, fromSelf: false, ...extra,
	};
}

const budget = { readGate: async () => ({ allow: true }), budgetGate: async () => ({ allow: true }), recordPosts: vi.fn(async () => {}) };
const compose = vi.fn(async () => ({ text: 'Hi Alice, Scout here.', source: 'model', reason: null }));
const run = (m, agentCtx, extra = {}) => poll.handleMention({
	mention: m, account: ACCOUNT, limits: poll.replyLimits({}), env: {}, budget, paused: async () => false,
	guard: async () => ({ allow: true }), compose, agentCtx, posterFor: async () => null, ...extra,
});

beforeEach(async () => {
	dbState.pg = new PGlite();
	await dbState.pg.exec(APP_SETTINGS);
	await dbState.pg.exec(read('20261008170000_x_mention_events.sql'));
	await dbState.pg.exec(`
		create table agent_identities (id uuid primary key, user_id uuid not null, name text not null, persona_prompt text, meta jsonb not null default '{}', avatar_id uuid, deleted_at timestamptz);
		create table avatars (id uuid primary key, storage_key text not null, deleted_at timestamptz);
		create table agent_x_connections (agent_id uuid primary key, scopes text not null default '', disconnected_at timestamptz);
		create table agent_x_policies (agent_id uuid primary key, enabled boolean not null default true);
	`);
	await dbState.pg.exec(read('20261011220000_agent_mention_policy.sql'));
	compose.mockClear();
	budget.recordPosts.mockClear();
});

describe('policy defaults', () => {
	it('keeps mention replies off, in dry run, with no intents, until the owner opts in', () => {
		expect(DEFAULT_POLICY).toMatchObject({ mention_replies_enabled: false, mention_replies_dry_run: true, mention_replies_daily_cap: 10 });
		expect(DEFAULT_POLICY.mention_replies_allowed_intents).toEqual([]);
		expect(agents.intentAllowed(DEFAULT_POLICY, 'chat')).toBe(false);
	});

	it('lets help and launch through the allow-list, which only gates the four action intents', () => {
		const p = { mention_replies_allowed_intents: ['chat'] };
		expect(agents.intentAllowed(p, 'chat')).toBe(true);
		for (const i of ['make', 'image3d', 'avatar']) expect(agents.intentAllowed(p, i)).toBe(false);
		for (const i of ['help', 'launch']) expect(agents.intentAllowed(p, i)).toBe(true);
	});
});

describe('agentMentionAccounts', () => {
	const seed = async ({ enabled = true, scopes = 'tweet.read users.read tweet.write offline.access', disconnected = false } = {}) => {
		await dbState.pg.query(`insert into agent_identities (id, user_id, name, persona_prompt) values ($1, $2, 'Scout', 'Curious and brief.')`, [AGENT_ID, USER_ID]);
		await dbState.pg.query(`insert into agent_x_connections (agent_id, scopes, disconnected_at) values ($1, $2, $3)`, [AGENT_ID, scopes, disconnected ? new Date().toISOString() : null]);
		await dbState.pg.query(`insert into agent_x_policies (agent_id, mention_replies_enabled, mention_replies_allowed_intents, mention_replies_daily_cap) values ($1, $2, '{chat,avatar}', 3)`, [AGENT_ID, enabled]);
	};

	it('returns an enabled agent with its persona, policy and no missing scopes', async () => {
		await seed();
		const [a] = await agents.agentMentionAccounts();
		expect(a).toMatchObject({ agentId: AGENT_ID, userId: USER_ID, missingScopes: [] });
		expect(a.agent).toMatchObject({ name: 'Scout', persona_prompt: 'Curious and brief.' });
		expect(a.policy).toEqual({ dry_run: true, daily_cap: 3, mention_replies_allowed_intents: ['chat', 'avatar'] });
	});

	it('skips agents whose policy is off or whose account is disconnected', async () => {
		await seed({ enabled: false });
		expect(await agents.agentMentionAccounts()).toEqual([]);
		await dbState.pg.exec('delete from agent_identities; delete from agent_x_connections; delete from agent_x_policies;');
		await seed({ disconnected: true });
		expect(await agents.agentMentionAccounts()).toEqual([]);
	});

	it('names the scopes a read-only connection lacks', async () => {
		await seed({ scopes: 'tweet.read users.read offline.access' });
		const [a] = await agents.agentMentionAccounts();
		expect(a.missingScopes).toEqual(['tweet.write']);
	});

	it('listAccounts still returns the company account when the agent lookup fails', async () => {
		const env = { X_COMPANY_HANDLE: 'trythreews', X_COMPANY_API_KEY: 'k', X_COMPANY_API_SECRET: 's', X_COMPANY_ACCESS_TOKEN: 't', X_COMPANY_ACCESS_SECRET: 's', X_COMPANY_USER_ID: '1' };
		const list = await poll.listAccounts({ env, agentAccounts: async () => { throw new Error('db down'); } });
		expect(list.every((a) => a.kind === 'company')).toBe(true);
	});

	it('listAccounts turns each agent into a pollable descriptor carrying its context', async () => {
		await seed();
		const list = await poll.listAccounts({ env: {} });
		expect(list).toHaveLength(1);
		expect(list[0]).toMatchObject({ kind: 'agent', ref: AGENT_ID, fetch: { kind: 'agent', agentId: AGENT_ID, userId: USER_ID }, missingScopes: [] });
		expect(list[0].agentCtx.policy.daily_cap).toBe(3);
	});
});

describe('pollAccount scope handling', () => {
	it('reports missing_scope without calling X', async () => {
		const fetchMentions = vi.fn();
		const out = await poll.pollAccount({
			descriptor: { kind: 'agent', ref: AGENT_ID, fetch: {}, missingScopes: ['tweet.write'], agentCtx: ctx() },
			env: {}, deps: { fetchMentions },
		});
		expect(out).toEqual({ account: `agent:${AGENT_ID}`, status: 'missing_scope', missing: ['tweet.write'] });
		expect(fetchMentions).not.toHaveBeenCalled();
	});
});

describe('handleMention in agent mode', () => {
	it('records a dry-run chat reply composed in the agent persona', async () => {
		const m = mention();
		const out = await run(m, ctx());
		expect(out).toMatchObject({ intent: 'chat', decision: 'reply', dry_run: true, text: 'Hi Alice, Scout here.' });
		expect(compose.mock.calls[0][0].agent).toMatchObject({ name: 'Scout', persona_prompt: 'Curious and brief.' });
		expect(compose.mock.calls[0][0].company).toBeUndefined();
		expect(await store.getMentionEvent(m.id)).toMatchObject({ account_kind: 'agent', account_ref: AGENT_ID, decision: 'reply', dry_run: true, reply_tweet_id: null });
	});

	it('attaches the agent avatar poster to a chat reply', async () => {
		const m = mention();
		const poster = 'https://three.test/api/render/glb?glbUrl=x&width=1024&height=1024';
		const out = await run(m, ctx(), { posterFor: async () => poster });
		expect(out.decision).toBe('reply');
		expect((await store.getMentionEvent(m.id)).reply_media_url).toBe(poster);
	});

	it('skips an intent the policy does not allow', async () => {
		const m = mention('@scoutbot make me an avatar');
		const out = await run(m, ctx({ mention_replies_allowed_intents: ['chat'] }));
		expect(out).toMatchObject({ decision: 'skip', reason: 'intent_not_allowed:avatar' });
		expect(compose).not.toHaveBeenCalled();
		expect(await store.getMentionEvent(m.id)).toMatchObject({ decision: 'skip', reason: 'intent_not_allowed:avatar' });
	});

	it('stops at the daily cap, counting dry-run replies', async () => {
		const c = ctx({ daily_cap: 2 });
		expect((await run(mention(), c)).decision).toBe('reply');
		expect((await run(mention(), c)).decision).toBe('reply');
		const third = await run(mention(), c);
		expect(third).toMatchObject({ decision: 'rate_limited', reason: 'agent_daily_cap' });
		expect(await store.countAccountReplies(ACCT)).toBe(2);
	});

	it('treats a cap of 0 as never replying', async () => {
		expect(await run(mention(), ctx({ daily_cap: 0 }))).toMatchObject({ decision: 'rate_limited', reason: 'agent_daily_cap' });
	});

	it('stays dry when the owner turned dry run off but the operator switch is off', async () => {
		const adapterFactory = vi.fn((o) => ({ live: false, sendText: async () => ({}), sendMedia: async () => ({}), o }));
		const out = await run(mention(), ctx({ dry_run: false }), { adapterFactory });
		expect(out.decision).toBe('reply');
		expect(adapterFactory.mock.calls[0][0]).toMatchObject({ policyDryRun: true, getAccessToken: null });
	});

	it('hands the adapter the agent token resolver only when both switches are live', async () => {
		const adapterFactory = vi.fn(() => ({ live: true, sendText: async () => ({}), sendMedia: async () => ({}) }));
		await run(mention(), ctx({ dry_run: false }), { adapterFactory, env: { X_MENTION_BOT_LIVE: '1' } });
		const call = adapterFactory.mock.calls[0][0];
		expect(call.policyDryRun).toBe(false);
		expect(typeof call.getAccessToken).toBe('function');
	});

	it('does not answer on behalf of a human when a known bot tags an agent', async () => {
		const out = await run(mention(), ctx(), { guard: async () => ({ allow: false, decision: 'skip', reason: 'known_bot' }) });
		expect(out).toMatchObject({ decision: 'skip', reason: 'known_bot' });
	});
});
