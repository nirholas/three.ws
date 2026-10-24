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

const { composeLaunchReply, launchUrl, launchAgentForUser, LAUNCH_NO_SPEND_LINE } = await import('../api/_lib/x-mention-launch.js');
const poll = await import('../api/_lib/x-mention-poll.js');
const store = await import('../api/_lib/x-mention-store.js');
const { parseMentionIntent } = await import('../api/_lib/x-mention-intents.js');
const { weightedLength, X_POST_MAX_WEIGHT } = await import('../api/_lib/x-text-weight.js');

const BASE = 'https://three.ws';
const ARGS = { name: 'Moon Cat', symbol: 'MCAT', description: 'a cat on the moon' };
const AVATAR = '5b1f2c52-0000-4000-8000-000000000001';
const user = (id = 'u1') => async () => ({ user_id: id, username: 'alice' });

describe('composeLaunchReply', () => {
	it('gives a linked author with a bodied agent the prefilled /launch link', async () => {
		const r = await composeLaunchReply({ args: ARGS, authorId: '42', base: BASE }, { findUser: user(), findAgent: async () => ({ id: 'a1', name: 'Nova', avatarId: AVATAR, hasBody: true }) });
		expect(r.reason).toBe('launch_link');
		const u = new URL(r.link);
		expect(u.pathname).toBe('/launch');
		expect(Object.fromEntries(u.searchParams)).toEqual({ avatar: AVATAR, name: 'Moon Cat', symbol: 'MCAT', description: 'a cat on the moon' });
		expect(r.text).toContain(LAUNCH_NO_SPEND_LINE);
		expect(weightedLength(r.text)).toBeLessThanOrEqual(X_POST_MAX_WEIGHT);
		expect([...r.text].some((ch) => ch.charCodeAt(0) === 0x2013 || ch.charCodeAt(0) === 0x2014)).toBe(false);
	});

	it('sends an unlinked author to sign-in and X linking, with no launch link', async () => {
		const r = await composeLaunchReply({ args: ARGS, authorId: '42', base: BASE }, { findUser: async () => null });
		expect(r.reason).toBe('launch_unlinked');
		expect(r.text).not.toContain('/launch');
	});

	it('sends an author with no agent to create one, and one with no body to give it one', async () => {
		const none = await composeLaunchReply({ args: ARGS, authorId: '42', base: BASE }, { findUser: user(), findAgent: async () => null });
		expect(none).toMatchObject({ reason: 'launch_no_agent', link: `${BASE}/create` });
		const bare = await composeLaunchReply({ args: ARGS, authorId: '42', base: BASE }, { findUser: user(), findAgent: async () => ({ id: 'a1', name: 'Nova', avatarId: null, hasBody: false }) });
		expect(bare).toMatchObject({ reason: 'launch_no_body', link: `${BASE}/agents/a1` });
	});

	it('treats hostile text as data: it only ever lands URL-encoded in query values', () => {
		const url = launchUrl(BASE, { avatarId: AVATAR, name: 'x&avatar=evil', symbol: 'A', description: '"><script>https://evil.example</script>' });
		const u = new URL(url);
		expect(u.origin).toBe(BASE);
		expect(u.searchParams.get('avatar')).toBe(AVATAR);
		expect(u.searchParams.get('name')).toBe('x&avatar=evil');
	});

	it('has no path to a spend: the module imports no signer, wallet, payment or launch API', () => {
		const src = readFileSync(new URL('../api/_lib/x-mention-launch.js', import.meta.url), 'utf8');
		const imports = [...src.matchAll(/^import .* from '(.+)';$/gm)].map((m) => m[1]);
		expect(imports.sort()).toEqual(['./db.js', './x-creation-claim.js', './x-identity.js']);
		const code = src.replace(/^\/\/.*$/gm, '');
		expect(code).not.toMatch(/fetch\(|sendTransaction|signTransaction|x402|pump\//);
	});
});

describe('against the real tables', () => {
	beforeEach(async () => {
		dbState.pg = new PGlite();
		await dbState.pg.exec(`create table agent_identities (id uuid primary key default gen_random_uuid(), user_id text not null, name text, avatar_id uuid, created_at timestamptz not null default now(), deleted_at timestamptz);`);
	});

	it('prefers the newest live agent with a body and ignores deleted ones', async () => {
		await dbState.pg.query(`insert into agent_identities (user_id, name, avatar_id, created_at) values ('u1','Old',$1, now() - interval '2 day'), ('u1','New',$1, now())`, [AVATAR]);
		await dbState.pg.query(`insert into agent_identities (user_id, name, avatar_id, deleted_at) values ('u1','Gone',$1, now())`, [AVATAR]);
		expect(await launchAgentForUser('u1')).toMatchObject({ name: 'New', avatarId: AVATAR, hasBody: true });
		expect(await launchAgentForUser('nobody')).toBeNull();
	});
});

describe('the poll loop with a launch mention (dry run)', () => {
	const MIG = new URL('../api/_lib/migrations/', import.meta.url);
	const COMPANY = { kind: 'company', ref: 'trythreews', userId: '1700000000000000001', handle: 'trythreews' };

	it('records the would-be reply with the link and posts nothing', async () => {
		dbState.pg = new PGlite();
		const src = readFileSync(new URL('20260922210000_free_tier_models.sql', MIG), 'utf8');
		const start = src.indexOf('CREATE TABLE IF NOT EXISTS app_settings');
		await dbState.pg.exec(src.slice(start, src.indexOf(');', start) + 2));
		await dbState.pg.exec(readFileSync(new URL('20261008170000_x_mention_events.sql', MIG), 'utf8'));
		const id = '1900000000000000777';
		const mention = {
			id, userId: '42', username: 'alice', text: '@trythreews launch Moon Cat $MCAT a cat on the moon', createdAt: new Date().toISOString(), conversationId: id, account: COMPANY,
			mentions: [{ username: 'trythreews', id: COMPANY.userId }], urls: [], media: [], inReplyToUserId: null, repliedTo: null, quoted: null, isRetweet: false, fromSelf: false,
		};
		expect(parseMentionIntent(mention, COMPANY).intent).toBe('launch');
		const budget = { readGate: async () => ({ allow: true }), budgetGate: async () => ({ allow: true }), recordPosts: vi.fn(async () => {}) };
		const launch = (e) => composeLaunchReply(e, { findUser: user(), findAgent: async () => ({ id: 'a1', name: 'Nova', avatarId: AVATAR, hasBody: true }) });
		const out = await poll.handleMention({ mention, account: COMPANY, limits: poll.replyLimits({}), env: {}, budget, paused: async () => false, guard: async () => ({ allow: true }), launch });
		expect(out).toMatchObject({ intent: 'launch', decision: 'reply', reason: 'launch_link', dry_run: true });
		expect(out.text).toContain('/launch?avatar=');
		expect(await store.getMentionEvent(id)).toMatchObject({ intent: 'launch', decision: 'reply', dry_run: true, reply_tweet_id: null });
	});
});
