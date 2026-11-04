import { beforeEach, describe, expect, it, vi } from 'vitest';

const ids = {
	task: '11111111-1111-4111-8111-111111111111',
	agent: '22222222-2222-4222-8222-222222222222',
};
const state = { task: null, updates: [], inserts: [] };

vi.mock('../api/_lib/db.js', () => {
	const sql = (strings, ...vals) => {
		const text = strings.join('?');
		let result = [];
		if (/SELECT \* FROM human_tasks WHERE id/.test(text)) result = state.task ? [state.task] : [];
		else if (/UPDATE human_tasks SET status/.test(text)) {
			state.updates.push({ text, vals });
			result = state.task ? [{ ...state.task }] : [];
		} else if (/INSERT INTO/.test(text)) state.inserts.push({ text, vals });
		else if (/SELECT worker_user_id/.test(text)) result = [{ worker_user_id: 'worker-1' }];
		else if (/SELECT name FROM agent_identities/.test(text)) result = [{ name: 'Scout' }];
		return Promise.resolve(result);
	};
	return { sql };
});
vi.mock('../api/_lib/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('../api/_lib/notify.js', () => ({ insertNotification: vi.fn(async () => {}) }));
vi.mock('../api/_lib/real-funds-agreement.js', () => ({ currentSignatureFor: vi.fn(async () => true), agreementRequirement: vi.fn(() => ({ sign_url: '/x' })) }));
vi.mock('../api/_lib/agent-usdc-transfer.js', () => ({ transferUsdcGuarded: vi.fn() }));
vi.mock('../api/_lib/solana/gasless-tx.js', () => ({ resolveMarketplacePayer: vi.fn(async () => null) }));
vi.mock('../api/_lib/fee.js', () => ({ getFeeBps: vi.fn(async () => 100) }));
vi.mock('../api/_lib/r2.js', () => ({ presignGet: vi.fn(async () => 'https://x'), presignUpload: vi.fn(async () => 'https://x'), headObject: vi.fn() }));
vi.mock('../api/_lib/agent-market/settlement.js', () => ({ feeRecipient: vi.fn(async () => null) }));
vi.mock('../api/_lib/agent-wallet.js', () => ({ getSolanaAddressBalances: vi.fn() }));
vi.mock('../api/_lib/human-tasks/chain.js', () => ({
	closeTaskEscrow: vi.fn(), escrowAddressFor: vi.fn(), escrowBalance: vi.fn(), isSolanaAddress: vi.fn(() => true), sendFromEscrow: vi.fn(), taskNetwork: vi.fn(() => 'devnet'),
}));

const svc = await import('../api/_lib/human-tasks/service.js');

const poster = { id: 'poster-1' };
const future = (ms) => new Date(Date.now() + ms).toISOString();

function submittedTask(over = {}) {
	return {
		id: ids.task, status: 'submitted', poster_user_id: poster.id, poster_agent_id: ids.agent, title: 'Photo', instructions: 'Take a photo',
		category: 'photo', location_kind: 'remote', deadline_at: future(3_600_000), bounty_atomics: '10000000', fee_atomics: '100000',
		escrow_atomics: '10100000', min_verification: 0, network: 'devnet', escrow_address: 'Escrow1111', accepted_claim_id: 'claim-1',
		release_preview_id: 'htp_abc12345', release_preview_expires_at: future(300_000), review_due_at: future(3_600_000), payout_address: 'Worker1111',
		...over,
	};
}

beforeEach(() => {
	state.task = submittedTask();
	state.updates = [];
	state.inserts = [];
});

describe('approveTask preview binding', () => {
	it('refuses without confirm', async () => {
		await expect(svc.approveTask(poster, ids.task, { preview_id: 'htp_abc12345' })).rejects.toMatchObject({ code: 'confirmation_required' });
		expect(state.updates).toHaveLength(0);
	});

	it('refuses a preview id that was never issued for this task', async () => {
		await expect(svc.approveTask(poster, ids.task, { confirm: true, preview_id: 'htp_other' })).rejects.toMatchObject({ code: 'preview_stale' });
		expect(state.updates).toHaveLength(0);
	});

	it('refuses an expired preview', async () => {
		state.task = submittedTask({ release_preview_expires_at: future(-1000) });
		await expect(svc.approveTask(poster, ids.task, { confirm: true, preview_id: 'htp_abc12345' })).rejects.toMatchObject({ code: 'preview_stale' });
		expect(state.updates).toHaveLength(0);
	});

	it('refuses when no preview was ever shown', async () => {
		state.task = submittedTask({ release_preview_id: null, release_preview_expires_at: null });
		await expect(svc.approveTask(poster, ids.task, { confirm: true, preview_id: 'htp_abc12345' })).rejects.toMatchObject({ code: 'preview_stale' });
	});

	it('refuses a task that is not submitted', async () => {
		state.task = submittedTask({ status: 'open' });
		await expect(svc.approveTask(poster, ids.task, { confirm: true, preview_id: 'htp_abc12345' })).rejects.toMatchObject({ code: 'invalid_transition' });
	});

	it('refuses a caller who does not own the posting agent', async () => {
		await expect(svc.approveTask({ id: 'someone-else' }, ids.task, { confirm: true, preview_id: 'htp_abc12345' })).rejects.toMatchObject({ code: 'forbidden' });
	});
});

describe('dispute freezes release', () => {
	it('moves a submitted task to disputed and records the dispute', async () => {
		await svc.disputeTask(poster, ids.task, { reason: 'The photo shows the wrong building entirely.' }).catch(() => {});
		expect(state.updates.some((u) => /status = /.test(u.text) && u.vals.includes('disputed'))).toBe(true);
		expect(state.inserts.some((i) => /human_task_disputes/.test(i.text))).toBe(true);
	});

	it('refuses once the review window has closed', async () => {
		state.task = submittedTask({ review_due_at: future(-1000) });
		await expect(svc.disputeTask(poster, ids.task, { reason: 'The photo shows the wrong building entirely.' })).rejects.toMatchObject({ code: 'review_window_closed' });
		expect(state.updates).toHaveLength(0);
	});

	it('refuses a reason too short to review', async () => {
		await expect(svc.disputeTask(poster, ids.task, { reason: 'bad' })).rejects.toBeTruthy();
		expect(state.updates).toHaveLength(0);
	});
});

describe('postTask gates', () => {
	it('refuses without confirm before touching the quote', async () => {
		await expect(svc.postTask(poster, { quote_id: ids.task })).rejects.toMatchObject({ code: 'confirmation_required' });
		expect(state.updates).toHaveLength(0);
	});

	it('refuses a missing quote id', async () => {
		await expect(svc.postTask(poster, { confirm: true })).rejects.toMatchObject({ code: 'bad_request' });
	});

	it('requires a configured fee payer so escrow can settle', async () => {
		await expect(svc.postTask(poster, { quote_id: ids.task, confirm: true })).rejects.toMatchObject({ code: 'fee_payer_unavailable' });
	});
});

describe('haversineM', () => {
	it('is zero for the same point', () => {
		expect(svc.haversineM({ lat: 40.7, lng: -74 }, { lat: 40.7, lng: -74 })).toBe(0);
	});

	it('measures about 111 km per degree of latitude', () => {
		const d = svc.haversineM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
		expect(d).toBeGreaterThan(110_500);
		expect(d).toBeLessThan(111_800);
	});

	it('measures a short city hop in meters', () => {
		const d = svc.haversineM({ lat: 40.7484, lng: -73.9857 }, { lat: 40.7527, lng: -73.9772 });
		expect(d).toBeGreaterThan(800);
		expect(d).toBeLessThan(1000);
	});
});
