import { describe, it, expect, vi, beforeEach } from 'vitest';

const setStrategy = vi.fn(async () => ({ mode: 'shadow' }));
const submitIntent = vi.fn(async () => ({ mode: 'shadow', recorded: {} }));
vi.mock('../api/_lib/predictions/shadow.js', () => ({
	getStrategy: vi.fn(() => ({ mode: 'shadow' })),
	setStrategy: (...a) => setStrategy(...a),
	submitIntent: (...a) => submitIntent(...a),
	listLedger: vi.fn(async () => ({ entries: [], summary: {} })),
}));
vi.mock('../api/_lib/predictions/engine.js', () => ({
	previewOpen: vi.fn(), executeOpen: vi.fn(), previewClose: vi.fn(), executeClose: vi.fn(), previewRedeem: vi.fn(), executeRedeem: vi.fn(),
	agentPositions: vi.fn(), loadOwnedAgent: vi.fn(), describeError: vi.fn(() => null),
}));
vi.mock('../api/_lib/predictions/index.js', () => ({ getVenue: vi.fn(() => ({ id: 'solana' })), DEFAULT_VENUE: 'solana', listVenues: vi.fn(() => []) }));
vi.mock('../api/_lib/agent-trade-guards.js', () => ({ getPredictionLimits: vi.fn(), setPredictionLimits: vi.fn() }));
vi.mock('../api/_lib/real-funds-agreement.js', () => ({ currentSignatureFor: vi.fn(), agreementRequirement: vi.fn() }));
vi.mock('../api/_lib/predictions/watch.js', () => ({ createWatch: vi.fn(), listWatches: vi.fn(), deleteWatch: vi.fn() }));

const { agentRoutes, publicRoutes } = await import('../api/_lib/predictions/routes.js');
const ID = '11111111-1111-4111-8111-111111111111';
const route = (name) => agentRoutes.find((r) => r.name === name);

beforeEach(() => vi.clearAllMocks());

describe('shadow routes', () => {
	it('registers the scanner as a public read on both mounts', () => {
		expect(publicRoutes('/predictions').find((r) => r.name === 'predictions.scan')).toMatchObject({ method: 'GET', auth: 'public', path: '/predictions/scan' });
		expect(agentRoutes.find((r) => r.name === 'predictions.scan')).toMatchObject({ auth: 'public' });
	});

	it('only treats a browser session as the owner session when changing the strategy', async () => {
		const r = route('predictions.strategy.set');
		await r.handler({ params: { id: ID }, principal: { userId: 'u', source: 'api_key' }, body: { mode: 'live' }, req: {} });
		expect(setStrategy.mock.calls[0][0].ownerSession).toBe(false);
		await r.handler({ params: { id: ID }, principal: { userId: 'u', source: 'session' }, body: { mode: 'live' }, req: {} });
		expect(setStrategy.mock.calls[1][0].ownerSession).toBe(true);
	});

	it('records an intent for the owned agent and marks API callers in the source', async () => {
		const out = await route('predictions.shadow.intent').handler({ params: { id: ID }, principal: { userId: 'u', source: 'api_key' }, body: { market_id: 'M', side: 'yes', stake_usd: 5 } });
		expect(submitIntent.mock.calls[0][0]).toMatchObject({ agentId: ID, userId: 'u', source: 'api:api_key' });
		expect(out.data.mode).toBe('shadow');
	});

	it('rejects a malformed agent id before touching the ledger', async () => {
		await expect(route('predictions.shadow.list').handler({ params: { id: 'nope' }, principal: { userId: 'u' }, query: {} })).rejects.toBeTruthy();
	});
});
