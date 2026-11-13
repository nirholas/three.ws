// Coverage for the "Hire this agent" Solana Blink (api/actions/agent-hire.js).
//
// A hire Blink lets any wallet pay an agent's priced offer straight from a link
// in a feed. The cases below pin what a Blink client and the hire ledger depend
// on:
//
//   1. The GET card is spec-shaped: type, icon, title, one transaction action
//      per Solana offer, offer inputs as Action parameters, version + CORS headers.
//   2. An unknown agent, or one with no Solana offers, is a 404 in the Actions
//      error shape (`message`), never an empty card.
//   3. POST rejects an off-curve account and invalid offer input before any
//      hire row is written or any transaction is built.
//   4. POST builds a Solana Pay layout transaction: the buyer pays the fee, the
//      USDC transfer to the agent's payout ATA for exactly the offer price is the
//      LAST instruction and carries the hire's reference key, and the
//      `hire:<id>` memo sits right before it. Nothing is signed server-side.
//   5. SOLANA_CLUSTER=devnet moves the whole flow to devnet USDC and the devnet
//      blockchain id.
//   6. The confirm callback verifies the payment on chain, runs the offer, and
//      returns a `completed` NextAction; a payment that does not match is refused.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import {
	ACCOUNT_SIZE,
	AccountLayout,
	TOKEN_PROGRAM_ID,
	decodeTransferCheckedInstruction,
	getAssociatedTokenAddressSync,
} from '@solana/spl-token';

const sqlMock = vi.fn();
vi.mock('../api/_lib/db.js', () => ({ sql: (...a) => sqlMock(...a) }));

const economy = {
	findReusableBlinkHire: vi.fn(),
	recordBlinkHire: vi.fn(),
	getHireById: vi.fn(),
	claimBlinkHire: vi.fn(),
	updateHire: vi.fn(),
};
vi.mock('../api/_lib/agent-economy.js', async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		findReusableBlinkHire: (...a) => economy.findReusableBlinkHire(...a),
		recordBlinkHire: (...a) => economy.recordBlinkHire(...a),
		getHireById: (...a) => economy.getHireById(...a),
		claimBlinkHire: (...a) => economy.claimBlinkHire(...a),
		updateHire: (...a) => economy.updateHire(...a),
	};
});

const services = { listSolanaServicesForAgent: vi.fn(), getServiceById: vi.fn() };
vi.mock('../api/_lib/agent-paid-services.js', async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		listSolanaServicesForAgent: (...a) => services.listSolanaServicesForAgent(...a),
		getServiceById: (...a) => services.getServiceById(...a),
	};
});

const hireBlinkIp = vi.fn(async () => ({ success: true }));
vi.mock('../api/_lib/rate-limit.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, limits: { ...actual.limits, hireBlinkIp: (...a) => hireBlinkIp(...a) } };
});

// One fake connection serves the mint-program read, the buyer balance read and
// the blockhash. `buyerBalance` is the buyer's USDC in atomics.
let buyerBalance = 10_000_000n;
const connection = {
	async getAccountInfo(pubkey) {
		const data = Buffer.alloc(ACCOUNT_SIZE);
		AccountLayout.encode(
			{
				mint: new PublicKey(USDC_MAINNET),
				owner: BUYER.publicKey,
				amount: buyerBalance,
				delegateOption: 0,
				delegate: PublicKey.default,
				state: 1,
				isNativeOption: 0,
				isNative: 0n,
				delegatedAmount: 0n,
				closeAuthorityOption: 0,
				closeAuthority: PublicKey.default,
			},
			data,
		);
		return { data, owner: TOKEN_PROGRAM_ID, lamports: 2_039_280, executable: false, pubkey };
	},
	async getLatestBlockhash() {
		return { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1_000 };
	},
};
vi.mock('../api/_lib/solana/connection.js', () => ({ solanaConnection: () => connection }));

const validateTransfer = vi.fn();
vi.mock('../api/_lib/solana/solana-pay-verify.js', async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		validateTransfer: (...a) => validateTransfer(...a),
		findReference: vi.fn(),
	};
});

const safeFetchJson = vi.fn();
vi.mock('../api/_lib/ssrf.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, safeFetchJson: (...a) => safeFetchJson(...a) };
});

const recordHireAttestation = vi.fn(async () => null);
vi.mock('../api/_lib/trust/hire-attestations.js', () => ({
	recordHireAttestation: (...a) => recordHireAttestation(...a),
}));

const { default: hireHandler } = await import('../api/actions/agent-hire.js');
const { ValidateTransferError } = await import('../api/_lib/solana/solana-pay-verify.js');

const USDC_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const AGENT_UUID = '3f1c8a52-9f6b-4a3d-8c21-0d5b7e9a1c44';
const OWNER_UUID = '7b2e4d10-1c3a-4f5e-9a8b-6c7d8e9f0a1b';
const SERVICE_UUID = 'a9d8c7b6-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const HIRE_UUID = 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f';
const BUYER = Keypair.generate();
const PAYOUT = Keypair.generate().publicKey.toBase58();
const AGENT_ROW = { id: AGENT_UUID, name: 'Nova', avatar_thumbnail_key: null };
// A PDA has no private key, so it can never sign a hire.
const OFF_CURVE = PublicKey.findProgramAddressSync([Buffer.from('three')], new PublicKey(MEMO_PROGRAM))[0].toBase58();

const OFFER = {
	id: SERVICE_UUID,
	owner_user_id: OWNER_UUID,
	agent_id: AGENT_UUID,
	slug: 'nova-summarize-ab12cd34',
	name: 'Summarize a page',
	description: 'Reads a public page and returns a short summary.',
	price_atomics: '250000',
	target_url: 'https://api.example.org/summarize',
	target_method: 'POST',
	network: 'solana',
	payout_address: PAYOUT,
	input_schema: {
		type: 'object',
		properties: {
			url: { type: 'string', format: 'uri', description: 'Page to summarize' },
			style: { type: 'string', enum: ['short', 'long'] },
			sentences: { type: 'integer', minimum: 1, maximum: 10 },
		},
		required: ['url'],
	},
};

function mockReq(method, url, body, headers = {}) {
	const req = { method, url, headers: { host: 'localhost', ...headers } };
	if (body !== undefined) {
		req.headers['content-type'] = 'application/json';
		req.body = body;
	}
	return req;
}

function mockRes() {
	return {
		statusCode: 200,
		headers: {},
		body: undefined,
		ended: false,
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		removeHeader(k) { delete this.headers[k.toLowerCase()]; },
		end(b) { this.body = b; this.ended = true; },
	};
}

const parse = (res) => JSON.parse(String(res.body));

function pendingHire(overrides = {}) {
	return {
		id: HIRE_UUID,
		hirer_agent_id: null,
		hirer_user_id: null,
		provider_agent_id: AGENT_UUID,
		provider_user_id: OWNER_UUID,
		service_id: SERVICE_UUID,
		service_slug: OFFER.slug,
		skill_name: OFFER.name,
		amount_atomics: '250000',
		usd: 0.25,
		network: 'solana',
		status: 'pending',
		payer_address: BUYER.publicKey.toBase58(),
		payout_address: PAYOUT,
		payment_signature: null,
		result_summary: null,
		error: null,
		meta: {
			source: 'blink',
			cluster: 'mainnet',
			reference: Keypair.generate().publicKey.toBase58(),
			input: { url: 'https://three.ws/', style: 'short' },
		},
		created_at: new Date().toISOString(),
		...overrides,
	};
}

const savedCluster = process.env.SOLANA_CLUSTER;

beforeEach(() => {
	sqlMock.mockReset();
	sqlMock.mockImplementation(async () => [AGENT_ROW]);
	for (const fn of Object.values(economy)) fn.mockReset();
	for (const fn of Object.values(services)) fn.mockReset();
	services.listSolanaServicesForAgent.mockResolvedValue([OFFER]);
	services.getServiceById.mockResolvedValue(OFFER);
	economy.findReusableBlinkHire.mockResolvedValue(null);
	economy.recordBlinkHire.mockImplementation(async (input) => ({
		...pendingHire(),
		payer_address: input.payerAddress,
		meta: input.meta,
	}));
	hireBlinkIp.mockReset();
	hireBlinkIp.mockResolvedValue({ success: true });
	validateTransfer.mockReset();
	safeFetchJson.mockReset();
	recordHireAttestation.mockClear();
	buyerBalance = 10_000_000n;
	delete process.env.SOLANA_CLUSTER;
});

afterEach(() => {
	if (savedCluster === undefined) delete process.env.SOLANA_CLUSTER;
	else process.env.SOLANA_CLUSTER = savedCluster;
});

describe('api/actions/agent-hire GET (the Blink card)', () => {
	it('returns a spec-shaped hire card with version and CORS headers', async () => {
		const res = mockRes();
		await hireHandler(mockReq('GET', `/api/actions/agent-hire?agent=${AGENT_UUID}`, undefined, { origin: 'https://dial.to' }), res);

		expect(res.statusCode).toBe(200);
		const card = parse(res);
		expect(card.type).toBe('action');
		expect(card.icon).toMatch(/^https?:\/\//);
		expect(card.title).toBe('Hire Nova');
		expect(card.label).toBeTruthy();
		expect(card.description).toContain('Summarize a page');
		expect(card.links.actions).toHaveLength(1);

		const action = card.links.actions[0];
		expect(action.type).toBe('transaction');
		expect(action.label).toBe('Hire: Summarize a page (0.25 USDC)');
		expect(action.href).toContain(`/api/actions/agent-hire?agent=${AGENT_UUID}`);
		expect(action.href).toContain(`offer=${OFFER.slug}`);
		expect(action.href).toContain('in_url={in_url}');

		const byName = Object.fromEntries(action.parameters.map((p) => [p.name, p]));
		expect(byName.in_url).toMatchObject({ type: 'url', required: true, label: 'Page to summarize' });
		expect(byName.in_style.type).toBe('select');
		expect(byName.in_style.options.map((o) => o.value)).toEqual(['short', 'long']);
		expect(byName.in_sentences).toMatchObject({ type: 'number', min: 1, max: 10 });

		expect(res.headers['x-action-version']).toBe('2.1.3');
		expect(res.headers['x-blockchain-ids']).toBe('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
		expect(res.headers['access-control-allow-origin']).toBe('*');
	});

	it('answers the CORS preflight with 204 and the Actions headers', async () => {
		const res = mockRes();
		await hireHandler(
			mockReq('OPTIONS', `/api/actions/agent-hire?agent=${AGENT_UUID}`, undefined, {
				origin: 'https://dial.to',
				'access-control-request-method': 'POST',
			}),
			res,
		);
		expect(res.statusCode).toBe(204);
		expect(res.headers['access-control-allow-origin']).toBe('*');
		expect(String(res.headers['access-control-allow-methods'])).toContain('POST');
	});

	it('is a 404 in the Actions error shape for an unknown agent', async () => {
		sqlMock.mockImplementation(async () => []);
		const res = mockRes();
		await hireHandler(mockReq('GET', `/api/actions/agent-hire?agent=${AGENT_UUID}`), res);

		expect(res.statusCode).toBe(404);
		const body = parse(res);
		expect(body.error).toBe('not_found');
		expect(typeof body.message).toBe('string');
		expect(body.message.length).toBeGreaterThan(0);
	});

	it('is a 404 for an agent with no Solana offers, not an empty card', async () => {
		services.listSolanaServicesForAgent.mockResolvedValue([]);
		const res = mockRes();
		await hireHandler(mockReq('GET', `/api/actions/agent-hire?agent=${AGENT_UUID}`), res);

		expect(res.statusCode).toBe(404);
		expect(parse(res).message).toMatch(/no Solana offers/i);
	});

	// The agent page asks whether to show "Share hire link" on every profile
	// view. Most agents sell nothing yet, and the spec-shaped 404 above put a
	// red network error in every such page's console. probe=1 answers the same
	// question with a 200 count; Blink clients never send it.
	it('answers probe=1 with a 200 offer count, even when there is nothing to hire', async () => {
		services.listSolanaServicesForAgent.mockResolvedValue([]);
		const empty = mockRes();
		await hireHandler(mockReq('GET', `/api/actions/agent-hire?agent=${AGENT_UUID}&probe=1`), empty);
		expect(empty.statusCode).toBe(200);
		expect(parse(empty)).toEqual({ agent: AGENT_UUID, offers: 0 });

		services.listSolanaServicesForAgent.mockResolvedValue([OFFER]);
		const one = mockRes();
		await hireHandler(mockReq('GET', `/api/actions/agent-hire?agent=${AGENT_UUID}&probe=1`), one);
		expect(one.statusCode).toBe(200);
		expect(parse(one)).toEqual({ agent: AGENT_UUID, offers: 1 });
	});

	it('still answers probe=1 for an unknown agent with a 404', async () => {
		sqlMock.mockImplementation(async () => []);
		const res = mockRes();
		await hireHandler(mockReq('GET', `/api/actions/agent-hire?agent=${AGENT_UUID}&probe=1`), res);
		expect(res.statusCode).toBe(404);
	});

	it('rejects a non-uuid agent id as 400 without touching the database', async () => {
		const res = mockRes();
		await hireHandler(mockReq('GET', '/api/actions/agent-hire?agent=nope'), res);
		expect(res.statusCode).toBe(400);
		expect(parse(res).message).toBeTruthy();
		expect(sqlMock).not.toHaveBeenCalled();
	});

	it('advertises the devnet blockchain id when SOLANA_CLUSTER=devnet', async () => {
		process.env.SOLANA_CLUSTER = 'devnet';
		const res = mockRes();
		await hireHandler(mockReq('GET', `/api/actions/agent-hire?agent=${AGENT_UUID}`), res);
		expect(res.statusCode).toBe(200);
		expect(res.headers['x-blockchain-ids']).toBe('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1');
	});
});

describe('api/actions/agent-hire POST (the hire transaction)', () => {
	const postUrl = `/api/actions/agent-hire?agent=${AGENT_UUID}&offer=${OFFER.slug}&in_url=${encodeURIComponent('https://three.ws/')}&in_style=short`;

	it('builds an unsigned USDC transfer to the payout ATA for the offer price, memo before it', async () => {
		const res = mockRes();
		await hireHandler(mockReq('POST', postUrl, { account: BUYER.publicKey.toBase58() }), res);

		expect(res.statusCode).toBe(200);
		const body = parse(res);
		expect(body.type).toBe('transaction');
		expect(body.message).toMatch(/Nova/);
		expect(body.links.next.type).toBe('post');
		expect(body.links.next.href).toContain(`confirm=${HIRE_UUID}`);

		const tx = Transaction.from(Buffer.from(body.transaction, 'base64'));
		expect(tx.feePayer.toBase58()).toBe(BUYER.publicKey.toBase58());
		expect(tx.signatures.every((s) => s.signature === null)).toBe(true);

		const last = tx.instructions.at(-1);
		expect(last.programId.equals(TOKEN_PROGRAM_ID)).toBe(true);
		const decoded = decodeTransferCheckedInstruction(last, TOKEN_PROGRAM_ID);
		const payoutAta = getAssociatedTokenAddressSync(new PublicKey(USDC_MAINNET), new PublicKey(PAYOUT), true);
		expect(decoded.keys.destination.pubkey.toBase58()).toBe(payoutAta.toBase58());
		expect(decoded.keys.mint.pubkey.toBase58()).toBe(USDC_MAINNET);
		expect(decoded.keys.owner.pubkey.toBase58()).toBe(BUYER.publicKey.toBase58());
		expect(decoded.data.amount).toBe(250_000n);
		expect(decoded.data.decimals).toBe(6);

		const recorded = economy.recordBlinkHire.mock.calls[0][0];
		expect(recorded).toMatchObject({
			providerAgentId: AGENT_UUID,
			providerUserId: OWNER_UUID,
			serviceId: SERVICE_UUID,
			amountAtomics: '250000',
			payerAddress: BUYER.publicKey.toBase58(),
			payoutAddress: PAYOUT,
		});
		expect(recorded.meta.input).toEqual({ url: 'https://three.ws/', style: 'short' });
		// The reference key rides on the transfer, where findReference looks.
		expect(last.keys.map((k) => k.pubkey.toBase58())).toContain(recorded.meta.reference);

		const memo = tx.instructions.at(-2);
		expect(memo.programId.toBase58()).toBe(MEMO_PROGRAM);
		expect(memo.data.toString('utf8')).toBe(`hire:${HIRE_UUID}`);
	});

	it('reuses a matching pending hire instead of writing a second row', async () => {
		const existing = pendingHire();
		economy.findReusableBlinkHire.mockResolvedValue(existing);
		const res = mockRes();
		await hireHandler(mockReq('POST', postUrl, { account: BUYER.publicKey.toBase58() }), res);

		expect(res.statusCode).toBe(200);
		expect(economy.recordBlinkHire).not.toHaveBeenCalled();
		const tx = Transaction.from(Buffer.from(parse(res).transaction, 'base64'));
		expect(tx.instructions.at(-1).keys.map((k) => k.pubkey.toBase58())).toContain(existing.meta.reference);
	});

	it('pays in devnet USDC when SOLANA_CLUSTER=devnet', async () => {
		process.env.SOLANA_CLUSTER = 'devnet';
		const res = mockRes();
		await hireHandler(mockReq('POST', postUrl, { account: BUYER.publicKey.toBase58() }), res);

		expect(res.statusCode).toBe(200);
		const tx = Transaction.from(Buffer.from(parse(res).transaction, 'base64'));
		const decoded = decodeTransferCheckedInstruction(tx.instructions.at(-1), TOKEN_PROGRAM_ID);
		expect(decoded.keys.mint.pubkey.toBase58()).toBe(USDC_DEVNET);
		expect(economy.recordBlinkHire.mock.calls[0][0].meta.cluster).toBe('devnet');
	});

	it('rejects an off-curve (PDA) account before writing a hire', async () => {
		const res = mockRes();
		await hireHandler(mockReq('POST', postUrl, { account: OFF_CURVE }), res);
		expect(res.statusCode).toBe(400);
		expect(parse(res).message).toMatch(/account/i);
		expect(economy.recordBlinkHire).not.toHaveBeenCalled();
	});

	it('rejects missing required offer input with a message naming the field', async () => {
		const res = mockRes();
		await hireHandler(
			mockReq('POST', `/api/actions/agent-hire?agent=${AGENT_UUID}&offer=${OFFER.slug}`, { account: BUYER.publicKey.toBase58() }),
			res,
		);
		expect(res.statusCode).toBe(400);
		expect(parse(res).message).toMatch(/Page to summarize|url/);
		expect(economy.recordBlinkHire).not.toHaveBeenCalled();
	});

	it('rejects an input outside the offer schema (enum and bounds)', async () => {
		const res = mockRes();
		await hireHandler(mockReq('POST', `${postUrl.replace('in_style=short', 'in_style=huge')}`, { account: BUYER.publicKey.toBase58() }), res);
		expect(res.statusCode).toBe(400);
		expect(economy.recordBlinkHire).not.toHaveBeenCalled();

		const res2 = mockRes();
		await hireHandler(mockReq('POST', `${postUrl}&in_sentences=40`, { account: BUYER.publicKey.toBase58() }), res2);
		expect(res2.statusCode).toBe(400);
	});

	it('tells a wallet without enough USDC how short it is, before writing a hire', async () => {
		buyerBalance = 100_000n;
		const res = mockRes();
		await hireHandler(mockReq('POST', postUrl, { account: BUYER.publicKey.toBase58() }), res);
		expect(res.statusCode).toBe(409);
		const body = parse(res);
		expect(body.error).toBe('insufficient_funds');
		expect(body.message).toMatch(/0\.15 USDC/);
		expect(economy.recordBlinkHire).not.toHaveBeenCalled();
	});

	it('is a 404 for an offer slug the agent does not sell', async () => {
		const res = mockRes();
		await hireHandler(
			mockReq('POST', `/api/actions/agent-hire?agent=${AGENT_UUID}&offer=someone-else-offer`, { account: BUYER.publicKey.toBase58() }),
			res,
		);
		expect(res.statusCode).toBe(404);
		expect(economy.recordBlinkHire).not.toHaveBeenCalled();
	});

	it('is 429 once the per-IP hire budget is spent', async () => {
		hireBlinkIp.mockResolvedValue({ success: false, reset: Date.now() + 60_000 });
		const res = mockRes();
		await hireHandler(mockReq('POST', postUrl, { account: BUYER.publicKey.toBase58() }), res);
		expect(res.statusCode).toBe(429);
		expect(parse(res).message).toBeTruthy();
	});
});

// Mirrors updateHire's UPDATE ... RETURNING *: patched columns win, meta merges.
function updatedRow(row, patch) {
	return {
		...row,
		status: patch.status ?? row.status,
		payment_signature: patch.paymentSignature ?? row.payment_signature,
		payer_address: patch.payerAddress ?? row.payer_address,
		result_summary: patch.resultSummary ?? row.result_summary,
		error: patch.error ?? row.error,
		meta: { ...row.meta, ...(patch.meta || {}) },
	};
}

describe('api/actions/agent-hire confirm callback (links.next)', () => {
	const confirmUrl = `/api/actions/agent-hire?agent=${AGENT_UUID}&confirm=${HIRE_UUID}`;
	const SIGNATURE = '5'.repeat(88);

	it('verifies the payment, runs the offer, and returns a completed NextAction', async () => {
		const hire = pendingHire();
		economy.getHireById.mockResolvedValue(hire);
		economy.claimBlinkHire.mockResolvedValue({ ...hire, meta: { ...hire.meta, claimed_at: new Date().toISOString() } });
		economy.updateHire.mockImplementation(async (id, patch) => updatedRow(hire, patch));
		validateTransfer.mockResolvedValue({});
		safeFetchJson.mockResolvedValue({ ok: true, status: 200, data: { summary: 'three.ws is a 3D agent platform.' } });

		const res = mockRes();
		await hireHandler(mockReq('POST', confirmUrl, { account: BUYER.publicKey.toBase58(), signature: SIGNATURE }), res);

		expect(res.statusCode).toBe(200);
		const next = parse(res);
		expect(next.type).toBe('completed');
		expect(next.title).toMatch(/Nova/);
		expect(next.description).toContain('three.ws is a 3D agent platform.');

		const [sig, fields, opts] = validateTransfer.mock.calls[0];
		expect(sig).toBe(SIGNATURE);
		expect(fields).toMatchObject({ recipient: PAYOUT, amount: 0.25, splToken: USDC_MAINNET, reference: hire.meta.reference, memo: `hire:${HIRE_UUID}` });
		expect(opts.network).toBe('mainnet');

		const [url, init] = safeFetchJson.mock.calls[0];
		expect(url).toBe(OFFER.target_url);
		expect(init).toMatchObject({ method: 'POST', body: { url: 'https://three.ws/', style: 'short' } });

		const done = economy.updateHire.mock.calls.at(-1);
		expect(done[0]).toBe(HIRE_UUID);
		expect(done[1]).toMatchObject({ status: 'completed', paymentSignature: SIGNATURE });
		expect(recordHireAttestation).toHaveBeenCalledWith(expect.objectContaining({ id: HIRE_UUID }), expect.objectContaining({ phase: 'recorded' }));
	});

	it('refuses a signature whose transfer does not match the hire, and runs nothing', async () => {
		economy.getHireById.mockResolvedValue(pendingHire());
		validateTransfer.mockRejectedValue(new ValidateTransferError('amount not transferred'));

		const res = mockRes();
		await hireHandler(mockReq('POST', confirmUrl, { account: BUYER.publicKey.toBase58(), signature: SIGNATURE }), res);

		expect(res.statusCode).toBe(400);
		expect(parse(res).message).toMatch(/does not match/i);
		expect(economy.claimBlinkHire).not.toHaveBeenCalled();
		expect(safeFetchJson).not.toHaveBeenCalled();
	});

	it('returns the finished result again for an already completed hire without re-running it', async () => {
		economy.getHireById.mockResolvedValue(pendingHire({ status: 'completed', payment_signature: SIGNATURE, result_summary: 'done before' }));
		const res = mockRes();
		await hireHandler(mockReq('POST', confirmUrl, { account: BUYER.publicKey.toBase58(), signature: SIGNATURE }), res);

		expect(res.statusCode).toBe(200);
		expect(parse(res).type).toBe('completed');
		expect(parse(res).description).toContain('done before');
		expect(validateTransfer).not.toHaveBeenCalled();
		expect(safeFetchJson).not.toHaveBeenCalled();
	});

	it('marks the hire failed and says so when the paid offer errors upstream', async () => {
		const hire = pendingHire();
		economy.getHireById.mockResolvedValue(hire);
		economy.claimBlinkHire.mockResolvedValue(hire);
		economy.updateHire.mockImplementation(async (id, patch) => updatedRow(hire, patch));
		validateTransfer.mockResolvedValue({});
		safeFetchJson.mockResolvedValue({ ok: false, status: 500, data: null });

		const res = mockRes();
		await hireHandler(mockReq('POST', confirmUrl, { account: BUYER.publicKey.toBase58(), signature: SIGNATURE }), res);

		expect(res.statusCode).toBe(200);
		const next = parse(res);
		expect(next.type).toBe('completed');
		expect(next.description).toMatch(/payment is recorded/i);
		expect(economy.updateHire.mock.calls.at(-1)[1]).toMatchObject({ status: 'failed', paymentSignature: SIGNATURE });
		expect(recordHireAttestation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ phase: 'failed' }));
	});

	it('rejects a confirm for a hire that belongs to another agent', async () => {
		economy.getHireById.mockResolvedValue(pendingHire({ provider_agent_id: OWNER_UUID }));
		const res = mockRes();
		await hireHandler(mockReq('POST', confirmUrl, { account: BUYER.publicKey.toBase58(), signature: SIGNATURE }), res);
		expect(res.statusCode).toBe(404);
		expect(validateTransfer).not.toHaveBeenCalled();
	});
});
