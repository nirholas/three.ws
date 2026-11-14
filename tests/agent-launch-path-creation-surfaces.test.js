// Every agent-creation surface puts the agent on the coin path: a custodial
// Solana wallet that can sign the launch, and a private auto-drafted coin plan.
//
// Regression for 2026-11-14: after the default coin path shipped (2026-11-06),
// production showed 19 drafted plans for 177 new agents. Only
// createAgentIdentity drafted a plan; the surfaces that create most agents
// (the avatar page's "Use this avatar" button via POST /api/marketplace/agents,
// avatar uploads and forge saves via provisionAvatarAgent, and the avatar
// resolution the launch flows use) inserted agents with no draft, and two of
// them with no Solana wallet either.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Readable } from 'node:stream';

const AGENT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const AVATAR_ID = '33333333-3333-4333-8333-333333333333';
const SOL = 'THREEsynthetic11111111111111111111111111111';

const sqlCalls = [];
// Responders run in order; the first whose pattern matches the query text
// answers it. Anything unmatched returns no rows.
let responders = [];

vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...values) => {
		const text = strings.join('?');
		sqlCalls.push({ text, values });
		const hit = responders.find(([re]) => re.test(text));
		return hit ? hit[1](values) : [];
	}),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));

const walletCalls = [];
vi.mock('../api/_lib/agent-wallet.js', () => ({
	generateAgentWallet: vi.fn(async () => ({ address: '0xabc', encrypted_key: 'enc' })),
	generateSolanaAgentWallet: vi.fn(async () => ({ address: SOL, encrypted_secret: 'enc' })),
	getOrCreateAgentSolanaWallet: vi.fn(async (id) => {
		walletCalls.push(id);
		return { address: SOL, created: true };
	}),
}));
vi.mock('../api/_lib/asset-provenance.js', () => ({ writeAssetProvenance: vi.fn(async () => {}) }));
vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: vi.fn(async () => ({ id: USER_ID })),
	authenticateBearer: vi.fn(async () => null),
	extractBearer: vi.fn(() => null),
}));
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: vi.fn(async () => true) }));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: new Proxy({}, { get: () => vi.fn(async () => ({ success: true, limit: 60, remaining: 59, reset: Date.now() + 1000 })) }),
	clientIp: vi.fn(() => '127.0.0.1'),
}));

const { ensureAgentLaunchPath } = await import('../api/_lib/agent-token-plan.js');
const { provisionAvatarAgent } = await import('../api/_lib/avatar-agent.js');
const { resolveOrCreateAgentForAvatar } = await import('../api/_lib/agent-identity.js');

const planInserts = () => sqlCalls.filter((c) => /insert into agent_token_plans/.test(c.text));
const draftedFor = (agentId) => planInserts().some((c) => c.values[0] === agentId);

beforeEach(() => {
	sqlCalls.length = 0;
	walletCalls.length = 0;
	responders = [[/insert into agent_token_plans/, (v) => [{ id: 'plan-1', agent_id: v[0], status: 'draft' }]]];
});

describe('ensureAgentLaunchPath', () => {
	it('provisions the Solana wallet first, then drafts the plan', async () => {
		const out = await ensureAgentLaunchPath({ agent: { id: AGENT_ID, user_id: USER_ID, name: 'Ada Ledger', meta: {} } });
		expect(walletCalls).toEqual([AGENT_ID]);
		expect(out.wallet).toBe(SOL);
		expect(out.plan.created).toBe(true);
		expect(draftedFor(AGENT_ID)).toBe(true);
	});

	it('leaves an existing wallet alone', async () => {
		const out = await ensureAgentLaunchPath({ agent: { id: AGENT_ID, user_id: USER_ID, name: 'Ada', meta: { solana_address: SOL } } });
		expect(walletCalls).toEqual([]);
		expect(out.wallet).toBe(SOL);
		expect(draftedFor(AGENT_ID)).toBe(true);
	});

	it('drafts nothing for an agent that already launched its coin', async () => {
		await ensureAgentLaunchPath({ agent: { id: AGENT_ID, user_id: USER_ID, name: 'Ada', meta: { solana_address: SOL, token: { mint: 'x' } } } });
		expect(planInserts()).toEqual([]);
	});

	it('still drafts the plan when wallet provisioning fails, and never throws', async () => {
		const { getOrCreateAgentSolanaWallet } = await import('../api/_lib/agent-wallet.js');
		getOrCreateAgentSolanaWallet.mockImplementationOnce(async () => {
			throw new Error('secret box misconfigured');
		});
		const out = await ensureAgentLaunchPath({ agent: { id: AGENT_ID, user_id: USER_ID, name: 'Ada', meta: {} } });
		expect(out.wallet).toBeNull();
		expect(draftedFor(AGENT_ID)).toBe(true);
	});
});

describe('provisionAvatarAgent (avatar upload, forge save)', () => {
	it('drafts a coin plan named after the avatar for the agent it creates', async () => {
		responders.push([/INSERT INTO agent_identities/, () => [{ id: AGENT_ID, user_id: USER_ID, name: 'Ada Ledger', description: null, persona_prompt: null, meta: {} }]]);
		const id = await provisionAvatarAgent({ userId: USER_ID, avatarId: AVATAR_ID, avatarName: 'Ada Ledger' });
		expect(id).toBe(AGENT_ID);
		expect(walletCalls).toEqual([AGENT_ID]);
		const insert = planInserts().find((c) => c.values[0] === AGENT_ID);
		expect(insert, 'plan drafted').toBeTruthy();
		expect(insert.values[3]).toBe('Ada Ledger');
	});

	it('names the draft after the avatar when it claims a starter agent with a generic name', async () => {
		responders.push([/UPDATE agent_identities/, () => [{ id: AGENT_ID, user_id: USER_ID, name: 'My First Agent', description: null, persona_prompt: null, meta: {} }]]);
		await provisionAvatarAgent({ userId: USER_ID, avatarId: AVATAR_ID, avatarName: 'Nova Pilot' });
		const insert = planInserts().find((c) => c.values[0] === AGENT_ID);
		expect(insert.values[3]).toBe('Nova Pilot');
		expect(insert.values[4]).toBe('NOVA');
	});
});

describe('resolveOrCreateAgentForAvatar (launch and wallet flows)', () => {
	it('gives an agent it creates from an avatar a wallet and a draft plan', async () => {
		responders.push([/from avatars/, () => [{ id: AVATAR_ID, name: 'Ada Ledger', description: 'Keeps the books.' }]]);
		responders.push([/insert into agent_identities/, () => [{ id: AGENT_ID, user_id: USER_ID, name: 'Ada Ledger', description: 'Keeps the books.', meta: {} }]]);
		const agent = await resolveOrCreateAgentForAvatar({ userId: USER_ID, avatarId: AVATAR_ID });
		expect(agent).toEqual({ id: AGENT_ID, name: 'Ada Ledger' });
		expect(walletCalls).toEqual([AGENT_ID]);
		expect(draftedFor(AGENT_ID)).toBe(true);
	});

	it('does no provisioning when the avatar already has its agent', async () => {
		responders.push([/avatar_id=\?/, () => [{ id: AGENT_ID, name: 'Ada Ledger' }]]);
		await resolveOrCreateAgentForAvatar({ userId: USER_ID, avatarId: AVATAR_ID });
		expect(walletCalls).toEqual([]);
		expect(planInserts()).toEqual([]);
	});
});

function post(url, body) {
	const req = Readable.from([Buffer.from(JSON.stringify(body))]);
	req.method = 'POST';
	req.url = url;
	req.headers = { host: 'localhost', 'content-type': 'application/json' };
	const res = {
		statusCode: 200, headers: {}, body: '', writableEnded: false,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		end(chunk) { if (chunk != null) this.body += chunk; this.writableEnded = true; },
	};
	return import('../api/marketplace/[action].js').then(async ({ default: handler }) => {
		await handler(req, res);
		return res;
	});
}

describe('POST /api/marketplace/agents (the avatar page "Use this avatar" button)', () => {
	it('provisions the new agent a Solana wallet and drafts its coin plan', async () => {
		responders.push([/INSERT INTO agent_identities/, () => [{ id: AGENT_ID, user_id: USER_ID, name: 'Ada Ledger agent', description: 'Keeps the books.', meta: {}, tags: [], capabilities: {} }]]);
		const res = await post('/api/marketplace/agents', {
			name: 'Ada Ledger agent',
			description: 'Keeps the books.',
			system_prompt: 'You are Ada.',
			publish: false,
		});
		expect(res.statusCode, res.body).toBe(201);
		expect(walletCalls).toEqual([AGENT_ID]);
		expect(draftedFor(AGENT_ID)).toBe(true);
	});
});
