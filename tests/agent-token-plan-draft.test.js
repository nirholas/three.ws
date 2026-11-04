// Auto-drafted coin plans (api/_lib/agent-token-plan.js ensureDraftPlan and the
// hook in api/_lib/agent-create.js). The 2026-09-30 funnel experiment found 0
// token plans ever saved and 2 of 788 new agents launching, so every new agent
// now gets a private draft plan derived from its own name and persona.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const sqlCalls = [];
const sqlQueue = [];

vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...values) => {
		sqlCalls.push({ text: strings.join('?'), values });
		return sqlQueue.length ? sqlQueue.shift() : [];
	}),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));

const walletCalls = [];
vi.mock('../api/_lib/agent-wallet.js', () => ({
	generateAgentWallet: vi.fn(async () => ({ address: '0xabc', encrypted_key: 'enc' })),
	generateSolanaAgentWallet: vi.fn(async () => {
		throw new Error('secret box misconfigured');
	}),
	getOrCreateAgentSolanaWallet: vi.fn(async (id) => {
		walletCalls.push(id);
		return { address: 'SoLwallet1111111111111111111111111111111111', created: true };
	}),
}));
vi.mock('../api/_lib/identity-integrity.js', () => ({
	checkIdentityIntegrity: vi.fn(async () => ({ status: 'ok', configured: false, reasons: [], similar: [] })),
}));
vi.mock('../api/_lib/indexnow.js', () => ({ pingIndexNow: vi.fn(async () => {}) }));
vi.mock('../api/_lib/feed.js', () => ({ publishFeedEvent: vi.fn(async () => {}) }));

const { deriveDraftPlan, ensureDraftPlan } = await import('../api/_lib/agent-token-plan.js');
const { createAgentIdentity } = await import('../api/_lib/agent-create.js');
const { planReadiness } = await import('../api/_lib/agent-token-plan.js');

const AGENT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
	sqlCalls.length = 0;
	sqlQueue.length = 0;
	walletCalls.length = 0;
});

describe('deriveDraftPlan', () => {
	it('takes the coin name from the agent and a ticker from its first word', () => {
		const d = deriveDraftPlan({ name: 'Ada Ledger', description: 'Keeps the books.' });
		expect(d.name).toBe('Ada Ledger');
		expect(d.symbol).toBe('ADA');
		expect(d.description).toBe('Keeps the books.');
		expect(d.network).toBe('mainnet');
		expect(d.coin_type).toBe('agent');
	});

	it('falls back to the first sentence of the persona when there is no description', () => {
		const d = deriveDraftPlan({
			name: 'Nova',
			description: null,
			persona_prompt: 'You are Nova, a calm market analyst. You never give financial advice.',
		});
		expect(d.description).toBe('You are Nova, a calm market analyst.');
	});

	it('always yields a launchable name and ticker, even for a name with no latin letters', () => {
		for (const name of ['  ', '🚀🚀', 'アダ', 'x', 'A very long agent name that goes past the thirty-two character limit']) {
			const d = deriveDraftPlan({ name });
			expect(planReadiness(d).blockers).toEqual([]);
			expect(d.symbol).toMatch(/^[A-Z0-9]{2,10}$/);
			expect(d.name.length).toBeLessThanOrEqual(32);
		}
	});

	it('only carries an image the agent has already made public', () => {
		expect(deriveDraftPlan({ name: 'Ada' }, { imageUrl: 'https://three.ws/cdn/a.png' }).image_url).toBe(
			'https://three.ws/cdn/a.png',
		);
		expect(deriveDraftPlan({ name: 'Ada' }).image_url).toBeNull();
	});
});

describe('ensureDraftPlan', () => {
	it('inserts a private auto-drafted plan and reports it created', async () => {
		sqlQueue.push([{ id: 'p1', agent_id: AGENT_ID, status: 'draft', auto_drafted: true }]);
		const out = await ensureDraftPlan({ agent: { id: AGENT_ID, user_id: USER_ID, name: 'Ada Ledger' } });
		expect(out.created).toBe(true);
		const insert = sqlCalls.find((c) => /insert into agent_token_plans/.test(c.text));
		expect(insert.text).toMatch(/on conflict \(agent_id, network\) do nothing/);
		// Never ready: a draft nobody reviewed must not show visitors a "coming" card.
		expect(insert.text).toMatch(/'draft'/);
		expect(insert.text).toMatch(/auto_drafted/);
	});

	it('is idempotent: a second call leaves an existing plan untouched', async () => {
		sqlQueue.push([]); // on conflict do nothing returns no row
		const out = await ensureDraftPlan({ agent: { id: AGENT_ID, user_id: USER_ID, name: 'Ada Ledger' } });
		expect(out.created).toBe(false);
	});

	it('never throws: a database failure must not break agent creation', async () => {
		const { sql } = await import('../api/_lib/db.js');
		sql.mockImplementationOnce(async () => {
			throw new Error('db down');
		});
		const out = await ensureDraftPlan({ agent: { id: AGENT_ID, user_id: USER_ID, name: 'Ada' } });
		expect(out.created).toBe(false);
	});
});

describe('createAgentIdentity', () => {
	it('drafts a plan for the new agent and provisions the Solana wallet when minting failed', async () => {
		// insert agent_identities
		sqlQueue.push([{ id: AGENT_ID, user_id: USER_ID, name: 'Ada Ledger', description: 'Keeps the books.', meta: {}, avatar_id: null }]);
		const res = await createAgentIdentity({ userId: USER_ID, name: 'Ada Ledger', description: 'Keeps the books.' });
		expect(res.agent.id).toBe(AGENT_ID);
		// The creation-time mint failed (mock throws), so the wallet is provisioned now.
		expect(walletCalls).toEqual([AGENT_ID]);
		expect(sqlCalls.some((c) => /insert into agent_token_plans/.test(c.text))).toBe(true);
	});

	it('does not re-provision a wallet the agent already has', async () => {
		sqlQueue.push([{ id: AGENT_ID, user_id: USER_ID, name: 'Ada', meta: { solana_address: 'SoLwallet1111111111111111111111111111111111' }, avatar_id: null }]);
		await createAgentIdentity({ userId: USER_ID, name: 'Ada' });
		expect(walletCalls).toEqual([]);
	});
});
