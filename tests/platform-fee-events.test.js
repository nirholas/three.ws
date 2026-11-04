// platform_fee_events: one append-only row per platform fee three.ws takes,
// written in the same database transaction as the money-state change it
// belongs to. Runs the real migration on an in-process Postgres (PGlite) and
// drives each fee-taking writer through its real code:
//
//   pump_trade / pump_launch   fee read off the confirmed tx (pumpFeeEventFromTx)
//   agent_trade                custody confirm (updateCustodyEvent) and the
//                              pumpfun spend finalize (finalizeSpend)
//   skill_purchase             confirmSkillPurchase on the Solana split path
//   skill_bundle               the bundle confirm handler
//   subscription               activateSubscription
//   x402_skill_split           accrueSkillCallRoyalty (ledger settlement)
//
// Each path must write exactly one event carrying amount, asset/mint, chain,
// tx signature, payer, beneficiary and a unique idempotency key, and a replay
// must not write a second one.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Keypair } from '@solana/web3.js';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { createPgliteSql } from './_helpers/pglite-sql.js';
import { makeReq, makeRes } from './_helpers/monetization.js';

const holder = vi.hoisted(() => ({
	db: null,
	userId: null,
	bundleVerdict: null,
	parsedTx: null,
	alerts: [],
}));

vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	const sql = (...args) => holder.db.sql(...args);
	sql.transaction = (...args) => holder.db.sql.transaction(...args);
	return { ...actual, sql };
});
vi.mock('../api/_lib/alerts.js', () => ({
	sendOpsAlert: async (title, body, opts) => { holder.alerts.push({ title, body, opts }); },
}));
vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: async () => (holder.userId ? { id: holder.userId } : null),
	authenticateBearer: async () => null,
	extractBearer: () => null,
}));
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: async () => true }));
vi.mock('../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	const ok = async () => ({ success: true, limit: 100, remaining: 99, reset: Date.now() + 60_000 });
	return { ...actual, limits: new Proxy({}, { get: () => ok }) };
});
vi.mock('../api/_lib/notify.js', () => ({
	insertNotification: async () => {},
	emailAllowedForType: async () => false,
}));
vi.mock('../api/_lib/email.js', () => ({
	sendPurchaseReceiptEmail: async () => {},
	sendSaleNotificationEmail: async () => {},
}));
vi.mock('../api/_lib/referrals.js', () => ({ creditReferralCommission: async () => {} }));
vi.mock('../api/_lib/splits.js', () => ({
	resolveListingSplit: async () => null,
	recordSplitDistribution: async () => {},
}));
vi.mock('../api/_lib/skill-license-issue.js', () => ({ recordOnchainLicenseForPurchase: async () => null }));
vi.mock('../api/_lib/receipt-key.js', () => ({ resolveReceiptKey: () => 'platform-fee-test-receipt-key' }));
// The chain reads behind a Solana Pay confirm: the reference lookup, the
// seller-leg validation, and the parsed tx the fee leg is proven against.
vi.mock('../api/_lib/solana/solana-pay-verify.js', () => ({
	findReference: async () => ({ signature: holder.parsedTx.signature }),
	validateTransfer: async () => ({}),
}));
vi.mock('../api/_lib/solana/rpc-fallback.js', () => ({
	rpcFallbackFromEnv: () => ({
		withFallback: (fn) => fn({ getParsedTransaction: async () => holder.parsedTx.tx }),
	}),
}));
vi.mock('../api/_lib/purchase-confirm.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		verifyBundlePayment: async (b) => holder.bundleVerdict ?? actual.verifyBundlePayment(b),
	};
});

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';

const MIGRATION = readFileSync(
	fileURLToPath(new URL('../api/_lib/migrations/20261104150000_platform_fee_events.sql', import.meta.url)),
	'utf8',
);

// Synthetic, freshly generated keys: no real wallet, mint or coin.
const pk = () => Keypair.generate().publicKey.toBase58();
const FEE_WALLET = pk();
const PAYER = pk();
const SELLER = pk();
const QUOTE_MINT = pk();
const sig = (n) => `THREEsyntheticSig${String(n).padStart(70, '1')}`.slice(0, 88);
const uuid = () => crypto.randomUUID();

// The tables the writers under test touch, reduced to the columns they use.
// revenue_ledger_entries exists only because the migration's view joins it.
const DDL = `
	create table revenue_ledger_entries (id bigserial primary key, source text, user_id uuid,
		amount_atomics numeric, decimals int, tx_signature text, chain text);
	create table agent_actions (id bigserial primary key, agent_id uuid, type text, payload jsonb default '{}'::jsonb,
		source_skill text, created_at timestamptz default now());
	create table agent_custody_events (id bigserial primary key, status text, signature text, usd numeric,
		amount_lamports numeric, meta jsonb default '{}'::jsonb, updated_at timestamptz);
	create table royalty_ledger (id bigserial primary key, skill_id text, agent_id uuid, author_user_id text,
		price_usd numeric, status text, settled_at timestamptz, tx_hash text, network text, payer text,
		source text, platform_fee_usd numeric);
	create table users (id uuid primary key, username text, display_name text, email text);
	create table agent_identities (id uuid primary key, user_id uuid, name text, deleted_at timestamptz);
	create table agent_payout_wallets (id bigserial primary key, user_id uuid, agent_id uuid, chain text, address text,
		is_default boolean default true, approved_at timestamptz default now(), effective_at timestamptz default now(),
		created_at timestamptz default now());
	create table skill_purchases (id uuid primary key default gen_random_uuid(), user_id uuid, recipient_user_id uuid,
		referrer_user_id uuid, agent_id uuid, skill text, status text, kind text default 'purchase', reference text unique,
		amount numeric, currency_mint text, mint_decimals int, chain text, platform_fee_amount numeric,
		platform_fee_wallet text, tx_signature text, confirmed_at timestamptz, valid_until timestamptz,
		expires_at timestamptz);
	create table skill_access_grants (user_id uuid, agent_id uuid, skill_name text, purchase_id uuid,
		expires_at timestamptz, updated_at timestamptz, unique (user_id, agent_id, skill_name));
	create table agent_payment_intents (id text primary key, payer_user_id uuid, agent_id uuid, currency_mint text,
		amount text, status text, expires_at timestamptz, cluster text, tx_signature text, paid_at timestamptz,
		payload jsonb);
	create table agent_revenue_events (id bigserial primary key, agent_id uuid, intent_id text unique, skill text,
		gross_amount numeric, fee_amount numeric, platform_fee_amount numeric, net_amount numeric,
		currency_mint text, chain text, payer_address text, settled_to_wallet boolean);
	create table purchase_events (purchase_id uuid, event text, payload jsonb);
	create table purchase_receipts (purchase_id uuid unique, receipt_json jsonb, signature text);
	create table skill_bundles (id uuid primary key default gen_random_uuid());
	create table bundle_items (bundle_id uuid, skill_name text);
	create table bundle_purchases (id uuid primary key default gen_random_uuid(), bundle_id uuid, user_id uuid,
		agent_id uuid, status text, chain text, reference text, currency_mint text, mint_decimals int,
		price_amount numeric, platform_fee_amount numeric, platform_fee_wallet text, tx_signature text unique,
		confirmed_at timestamptz);
	create table subscription_plans (id uuid primary key, creator_id uuid, agent_id uuid, name text, price_usd numeric,
		interval text);
	create table subscription_checkouts (id uuid primary key, reference text, user_id uuid, plan_id uuid, agent_id uuid,
		status text, amount numeric, creator_amount numeric, platform_fee_amount numeric, platform_fee_wallet text,
		currency_mint text, chain text, recipient text, buyer_public_key text, interval text,
		expires_at timestamptz, tx_signature text, confirmed_at timestamptz);
	create table creator_subscriptions (id uuid primary key default gen_random_uuid(), plan_id uuid,
		subscriber_user_id uuid, status text, current_period_start timestamptz, current_period_end timestamptz,
		payment_method text, wallet_address text, chain text, currency_mint text, cancelled_at timestamptz);
	create table subscription_payments (id bigserial primary key, subscription_id uuid, amount_usd numeric, status text,
		tx_hash text, paid_at timestamptz);
	create table user_agent_subscriptions (user_id uuid, agent_id uuid, status text, current_period_ends_at timestamptz,
		tx_signature text, price_amount numeric, currency_mint text, chain text, cancelled_at timestamptz,
		updated_at timestamptz, unique (user_id, agent_id));
`;

const fees = () => holder.db.query('select * from platform_fee_events order by id');

let fx;
beforeAll(async () => {
	fx = await import('../api/_lib/platform-fee-events.js');
});

beforeEach(async () => {
	holder.db = createPgliteSql();
	holder.alerts = [];
	holder.bundleVerdict = null;
	holder.parsedTx = null;
	holder.userId = null;
	await holder.db.exec(DDL);
	await holder.db.exec(MIGRATION);
});

// A parsed confirmed transaction in which `to` received `lamports` SOL and/or
// `tokens` of `mint`, the shape getParsedTransaction returns.
function parsedTx({ to, lamports = 0n, tokens = 0n, mint = QUOTE_MINT, err = null, blockTime = 1_790_000_000 }) {
	return {
		blockTime,
		transaction: { message: { accountKeys: [{ pubkey: PAYER }, { pubkey: to }] } },
		meta: {
			err,
			preBalances: [5_000_000_000, 1_000_000],
			postBalances: [5_000_000_000 - Number(lamports), 1_000_000 + Number(lamports)],
			preTokenBalances: [{ owner: to, mint, uiTokenAmount: { amount: '100' } }],
			postTokenBalances: [{ owner: to, mint, uiTokenAmount: { amount: String(100n + tokens) } }],
		},
	};
}

function onchainEvent(over = {}) {
	return {
		source: 'pump_trade',
		sourceRef: sig(1),
		chain: 'solana',
		network: 'mainnet',
		asset: 'SOL',
		amountAtomics: 1_000_000n,
		decimals: 9,
		bps: 100,
		basis: 'buy',
		txSignature: sig(1),
		payer: PAYER,
		beneficiary: FEE_WALLET,
		...over,
	};
}

// Every event a path writes must carry the full provenance set.
function expectComplete(row, { source, amount, asset, settlement = 'onchain' }) {
	expect(row.source).toBe(source);
	expect(row.settlement).toBe(settlement);
	expect(String(row.amount_atomics)).toBe(String(amount));
	expect(row.asset).toBe(asset);
	expect(row.chain).toBeTruthy();
	expect(row.source_ref).toBeTruthy();
	expect(row.tx_signature).toBeTruthy();
	if (settlement === 'onchain') expect(row.beneficiary).toBeTruthy();
}

describe('platform_fee_events table', () => {
	it('records one event and ignores a replay of the same (source, source_ref)', async () => {
		const first = await fx.recordPlatformFee(onchainEvent());
		const replay = await fx.recordPlatformFee(onchainEvent());
		expect(first.recorded).toBe(true);
		expect(replay.recorded).toBe(false);
		const rows = await fees();
		expect(rows).toHaveLength(1);
		expectComplete(rows[0], { source: 'pump_trade', amount: 1_000_000, asset: 'SOL' });
		expect(rows[0].payer).toBe(PAYER);
	});

	it('refuses UPDATE, DELETE and TRUNCATE', async () => {
		await fx.recordPlatformFee(onchainEvent());
		await expect(holder.db.query('update platform_fee_events set amount_atomics = 1')).rejects.toThrow(/append-only/);
		await expect(holder.db.query('delete from platform_fee_events')).rejects.toThrow(/append-only/);
		await expect(holder.db.query('truncate platform_fee_events')).rejects.toThrow(/append-only/);
		expect(await fees()).toHaveLength(1);
	});

	it('requires a signature and beneficiary on an onchain row at the database level', async () => {
		await expect(
			holder.db.query(
				`insert into platform_fee_events (source, source_ref, asset, amount_atomics, decimals)
				 values ('pump_trade', 'x', 'SOL', 5, 9)`,
			),
		).rejects.toThrow(/check constraint/);
	});

	it('totals by day and stream in platform_fee_daily', async () => {
		await fx.recordPlatformFee(onchainEvent());
		await fx.recordPlatformFee(onchainEvent({ sourceRef: sig(2), txSignature: sig(2), amountAtomics: 500n }));
		const [day] = await holder.db.query('select * from platform_fee_daily');
		expect(day.events).toBe(2);
		expect(String(day.amount_atomics)).toBe('1000500');
	});
});

describe('normalizePlatformFeeEvent', () => {
	it('returns null for a zero fee so callers can pass the builder output straight through', () => {
		expect(fx.normalizePlatformFeeEvent(onchainEvent({ amountAtomics: 0n }))).toBeNull();
	});

	it.each([
		['an unknown source', { source: 'tips' }],
		['a missing sourceRef', { sourceRef: '' }],
		['a missing asset', { asset: '' }],
		['bad decimals', { decimals: 40 }],
		['bps over 100%', { bps: 10_001 }],
		['an onchain fee with no signature', { txSignature: null }],
		['an onchain fee with no beneficiary', { beneficiary: null }],
	])('rejects %s', (_label, over) => {
		expect(() => fx.normalizePlatformFeeEvent(onchainEvent(over))).toThrow(
			expect.objectContaining({ code: 'invalid_platform_fee_event' }),
		);
	});

	it('accepts a ledger split with no beneficiary', () => {
		const row = fx.normalizePlatformFeeEvent(onchainEvent({ settlement: 'ledger', beneficiary: null }));
		expect(row.settlement).toBe('ledger');
	});
});

describe('withPlatformFee', () => {
	it('rolls the fee back with a failing state change', async () => {
		const failing = holder.db.sql`insert into agent_actions (id, type) values (1, 'a'), (1, 'b')`;
		await expect(fx.withPlatformFee(holder.db.sql, failing, onchainEvent())).rejects.toThrow();
		expect(await fees()).toHaveLength(0);
	});

	it('rolls the state change back with a failing fee insert', async () => {
		await holder.db.exec('alter table platform_fee_events rename to platform_fee_events_off');
		const statement = holder.db.sql`insert into agent_actions (type) values ('trade')`;
		await expect(fx.withPlatformFee(holder.db.sql, statement, onchainEvent())).rejects.toThrow();
		expect(await holder.db.query('select * from agent_actions')).toHaveLength(0);
	});

	it('withPlatformFeeOrAlert keeps the state row and pages ops when only the fee insert fails', async () => {
		await holder.db.exec('alter table platform_fee_events rename to platform_fee_events_off');
		const out = await fx.withPlatformFeeOrAlert(
			holder.db.sql,
			() => holder.db.sql`insert into agent_actions (type) values ('trade') returning id`,
			onchainEvent(),
		);
		expect(out.feeRecorded).toBe(false);
		expect(out.rows).toHaveLength(1);
		expect(holder.alerts.map((a) => a.title)).toEqual(['Platform fee not recorded']);
	});
});

describe('fee amounts read off a confirmed transaction', () => {
	it('reads the SOL lamport delta and the SPL token delta of the fee wallet', () => {
		const tx = parsedTx({ to: FEE_WALLET, lamports: 7_000n, tokens: 42n });
		expect(fx.feeReceivedInTx(tx, { recipient: FEE_WALLET, asset: 'SOL' })).toBe(7_000n);
		expect(fx.feeReceivedInTx(tx, { recipient: FEE_WALLET, asset: 'SPL', mint: QUOTE_MINT })).toBe(42n);
		expect(fx.feeReceivedInTx(tx, { recipient: FEE_WALLET, asset: 'SPL', mint: pk() })).toBe(0n);
	});

	it('reads nothing from a failed transaction', () => {
		const tx = parsedTx({ to: FEE_WALLET, lamports: 7_000n, err: { InstructionError: [0, 'Custom'] } });
		expect(fx.feeReceivedInTx(tx, { recipient: FEE_WALLET, asset: 'SOL' })).toBe(0n);
	});

	it('pump_trade: builds the event from what the fee wallet received, not from the client', async () => {
		const ev = await fx.pumpFeeEventFromTx({
			tx: parsedTx({ to: FEE_WALLET, lamports: 12_345n }),
			signature: sig(3), source: 'pump_trade', network: 'mainnet', quoteMint: null,
			basis: 'buy', payer: PAYER, recipient: FEE_WALLET,
		});
		await fx.recordPlatformFee(ev);
		await fx.recordPlatformFee(ev);
		const rows = await fees();
		expect(rows).toHaveLength(1);
		expectComplete(rows[0], { source: 'pump_trade', amount: 12_345, asset: 'SOL' });
		expect(new Date(rows[0].occurred_at).getTime()).toBe(1_790_000_000_000);
	});

	it('pump_trade: probes an unknown pairing and records a USDC fee with its mint', async () => {
		const ev = await fx.pumpFeeEventFromTx({
			tx: parsedTx({ to: FEE_WALLET, tokens: 900n, mint: QUOTE_MINT }),
			signature: sig(4), source: 'pump_trade', network: 'mainnet', quoteMint: QUOTE_MINT,
			basis: 'sell', payer: PAYER, recipient: FEE_WALLET,
		});
		expect(ev).toMatchObject({ asset: 'USDC', assetMint: QUOTE_MINT, amountAtomics: 900n, decimals: 6 });
	});

	it('pump_trade: a transaction that paid no fee yields no event', async () => {
		const ev = await fx.pumpFeeEventFromTx({
			tx: parsedTx({ to: FEE_WALLET }), signature: sig(5), source: 'pump_trade',
			network: 'mainnet', quoteMint: null, basis: 'buy', recipient: FEE_WALLET,
		});
		expect(ev).toBeNull();
	});

	it('pump_launch: a disclosure settled in a separate fee tx keys on the launch and points at the fee tx', async () => {
		const ev = fx.feeEventFromDisclosure({
			disclosure: { bps: 100, asset: 'SOL', amount: '2000000', recipient: FEE_WALLET, basis: 'launch' },
			signature: sig(6), sourceRef: sig(7), source: 'pump_launch', network: 'mainnet', payer: PAYER,
		});
		await fx.recordPlatformFee(ev);
		const [row] = await fees();
		expectComplete(row, { source: 'pump_launch', amount: 2_000_000, asset: 'SOL' });
		expect(row.tx_signature).toBe(sig(6));
		expect(row.source_ref).toBe(sig(7));
	});

	it('a USDC disclosure without an explicit quote mint records the network USDC mint', async () => {
		const { SOLANA_USDC_MINT_DEVNET } = await import('../api/payments/_config.js');
		const ev = fx.feeEventFromDisclosure({
			disclosure: { bps: 100, asset: 'USDC', amount: '10', recipient: FEE_WALLET, basis: 'buy' },
			signature: sig(8), source: 'agent_trade', network: 'devnet',
		});
		expect(ev.assetMint).toBe(SOLANA_USDC_MINT_DEVNET);
	});
});

describe('agent_trade: custody confirm and spend finalize', () => {
	const disclosure = { bps: 100, asset: 'SOL', amount: '30000', recipient: FEE_WALLET, basis: 'buy' };

	it('updateCustodyEvent writes the confirm and its fee together, once', async () => {
		const { updateCustodyEvent } = await import('../api/_lib/agent-trade-guards.js');
		const [{ id }] = await holder.db.query(`insert into agent_custody_events (status) values ('pending') returning id`);
		const platformFee = fx.feeEventFromDisclosure({
			disclosure, signature: sig(9), source: 'agent_trade', network: 'mainnet', payer: PAYER,
		});
		await updateCustodyEvent(id, { status: 'confirmed', signature: sig(9), platformFee });
		await updateCustodyEvent(id, { status: 'confirmed', signature: sig(9), platformFee });
		const [custody] = await holder.db.query('select * from agent_custody_events');
		expect(custody.status).toBe('confirmed');
		const rows = await fees();
		expect(rows).toHaveLength(1);
		expectComplete(rows[0], { source: 'agent_trade', amount: 30_000, asset: 'SOL' });
	});

	it('finalizeSpend writes the confirmed spend and its fee together, once', async () => {
		const { finalizeSpend } = await import('../api/_lib/agent-spend-policy.js');
		const [{ id }] = await holder.db.query(`insert into agent_actions (type) values ('pumpfun.buy') returning id`);
		const platformFee = fx.feeEventFromDisclosure({
			disclosure, signature: sig(10), source: 'agent_trade', network: 'mainnet', payer: PAYER,
		});
		await finalizeSpend(id, { signature: sig(10) }, { platformFee });
		await finalizeSpend(id, { signature: sig(10) }, { platformFee });
		const [action] = await holder.db.query('select payload from agent_actions');
		expect(action.payload.status).toBe('confirmed');
		expect(await fees()).toHaveLength(1);
	});
});

describe('skill_purchase: confirmSkillPurchase', () => {
	async function seedPurchase({ fee = 25_000n } = {}) {
		const buyer = uuid();
		const seller = uuid();
		const agentId = uuid();
		await holder.db.query('insert into users (id, username) values ($1, $2), ($3, $4)', [buyer, 'buyer', seller, 'seller']);
		await holder.db.query('insert into agent_identities (id, user_id, name) values ($1, $2, $3)', [agentId, seller, 'Seller agent']);
		await holder.db.query(
			`insert into agent_payout_wallets (user_id, chain, address) values ($1, 'solana', $2)`,
			[seller, SELLER],
		);
		const [pur] = await holder.db.query(
			`insert into skill_purchases (user_id, agent_id, skill, status, reference, amount, currency_mint, mint_decimals,
				chain, platform_fee_amount, platform_fee_wallet)
			 values ($1, $2, 'summarize', 'pending', $3, 1000000, $4, 6, 'solana', $5, $6) returning *`,
			[buyer, agentId, pk(), QUOTE_MINT, fee.toString(), FEE_WALLET],
		);
		return pur;
	}

	it('records the fee proven on-chain beside the revenue row, and not again on replay', async () => {
		const { confirmSkillPurchase } = await import('../api/_lib/purchase-confirm.js');
		const pur = await seedPurchase();
		holder.parsedTx = { signature: sig(11), tx: parsedTx({ to: FEE_WALLET, tokens: 25_000n }) };
		await confirmSkillPurchase(pur);
		await confirmSkillPurchase(pur);
		const rows = await fees();
		expect(rows).toHaveLength(1);
		expectComplete(rows[0], { source: 'skill_purchase', amount: 25_000, asset: 'SPL' });
		expect(rows[0].source_ref).toBe(pur.id);
		expect(rows[0].asset_mint).toBe(QUOTE_MINT);
		expect(rows[0].beneficiary).toBe(FEE_WALLET);
		const [rev] = await holder.db.query('select * from agent_revenue_events');
		expect(String(rev.platform_fee_amount)).toBe('25000');
	});

	it('records nothing when the buyer paid the full price to the seller', async () => {
		const { confirmSkillPurchase } = await import('../api/_lib/purchase-confirm.js');
		const pur = await seedPurchase();
		holder.parsedTx = { signature: sig(12), tx: parsedTx({ to: FEE_WALLET, tokens: 0n }) };
		await confirmSkillPurchase(pur);
		expect(await fees()).toHaveLength(0);
	});
});

describe('skill_bundle: bundle confirm handler', () => {
	async function seedBundle() {
		const buyer = uuid();
		const agentId = uuid();
		holder.userId = buyer;
		const [bundle] = await holder.db.query('insert into skill_bundles default values returning id');
		await holder.db.query(`insert into bundle_items (bundle_id, skill_name) values ($1, 'a'), ($1, 'b')`, [bundle.id]);
		const [bp] = await holder.db.query(
			`insert into bundle_purchases (bundle_id, user_id, agent_id, status, chain, reference, currency_mint,
				mint_decimals, price_amount, platform_fee_amount, platform_fee_wallet)
			 values ($1, $2, $3, 'pending', 'solana', $4, $5, 6, 2000000, 50000, $6) returning *`,
			[bundle.id, buyer, agentId, pk(), QUOTE_MINT, FEE_WALLET],
		);
		return bp;
	}

	async function confirm(id) {
		const { default: handler } = await import('../api/marketplace/purchase-bundle.js');
		const res = makeRes();
		await handler(makeReq({ method: 'POST', url: `/api/marketplace/bundles/purchase?purchase_id=${id}&op=confirm`, body: {} }), res);
		return res;
	}

	it('records the proven fee once; the replay is refused before any write', async () => {
		const bp = await seedBundle();
		holder.bundleVerdict = { status: 'confirmed', txSignature: sig(13), feeTaken: '50000', feeWallet: FEE_WALLET };
		expect((await confirm(bp.id)).statusCode).toBe(200);
		expect((await confirm(bp.id)).statusCode).toBe(404);
		const rows = await fees();
		expect(rows).toHaveLength(1);
		expectComplete(rows[0], { source: 'skill_bundle', amount: 50_000, asset: 'SPL' });
		expect(rows[0].source_ref).toBe(bp.id);
		const [rev] = await holder.db.query('select * from agent_revenue_events');
		expect(String(rev.platform_fee_amount)).toBe('50000');
		expect(String(rev.net_amount)).toBe('1950000');
	});

	// The bug: the revenue row booked the QUOTED fee even when the verifier
	// matched the full-price fallback, so the platform claimed a fee it never
	// received and the creator's net was understated by the same amount.
	it('books no platform fee when the buyer paid the full price to the seller', async () => {
		const bp = await seedBundle();
		holder.bundleVerdict = { status: 'confirmed', txSignature: sig(14), feeTaken: '0', feeWallet: null };
		expect((await confirm(bp.id)).statusCode).toBe(200);
		const [rev] = await holder.db.query('select * from agent_revenue_events');
		expect(String(rev.platform_fee_amount)).toBe('0');
		expect(String(rev.net_amount)).toBe('2000000');
		expect(await fees()).toHaveLength(0);
	});
});

describe('subscription: activateSubscription', () => {
	async function seedCheckout() {
		const user = uuid();
		const plan = uuid();
		const checkout = {
			id: uuid(), reference: pk(), user_id: user, plan_id: plan, agent_id: uuid(), status: 'pending',
			amount: '5000000', creator_amount: '4875000', platform_fee_amount: '125000', platform_fee_wallet: FEE_WALLET,
			currency_mint: QUOTE_MINT, chain: 'solana', recipient: SELLER, buyer_public_key: PAYER, interval: 'monthly',
		};
		await holder.db.query(
			`insert into subscription_plans (id, creator_id, name, price_usd, interval) values ($1, $2, 'Pro', 5, 'monthly')`,
			[plan, uuid()],
		);
		await holder.db.query(
			`insert into subscription_checkouts (id, reference, user_id, plan_id, agent_id, status, amount, creator_amount,
				platform_fee_amount, platform_fee_wallet, currency_mint, chain, recipient, buyer_public_key, interval)
			 values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
			Object.values(checkout),
		);
		return checkout;
	}

	it('records the proven fee with the first payment, once', async () => {
		const { activateSubscription } = await import('../api/_lib/subscription-checkout.js');
		const checkout = await seedCheckout();
		const fee = { feeTaken: '125000', feeWallet: FEE_WALLET };
		await activateSubscription(checkout, sig(15), PAYER, fee);
		const again = await activateSubscription(checkout, sig(15), PAYER, fee);
		expect(again.already_processed).toBe(true);
		const rows = await fees();
		expect(rows).toHaveLength(1);
		expectComplete(rows[0], { source: 'subscription', amount: 125_000, asset: 'USDC' });
		expect(rows[0].payer).toBe(PAYER);
		expect(await holder.db.query('select * from subscription_payments')).toHaveLength(1);
	});

	it('records nothing on the full-amount fallback', async () => {
		const { activateSubscription } = await import('../api/_lib/subscription-checkout.js');
		const checkout = await seedCheckout();
		await activateSubscription(checkout, sig(16), PAYER, { feeTaken: '0', feeWallet: null });
		expect(await fees()).toHaveLength(0);
	});
});

describe('x402_skill_split: accrueSkillCallRoyalty', () => {
	it('records the platform share as a ledger split keyed by the settlement tx', async () => {
		const { accrueSkillCallRoyalty, computeSkillRoyaltySplit, skillRoyaltyPlatformBps } = await import('../api/_lib/skill-royalty.js');
		const opts = {
			skillId: 'skill-1', authorId: uuid(), payer: PAYER, network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
			txHash: sig(17), priceAtomics: 1_000_000n,
		};
		const first = await accrueSkillCallRoyalty(opts);
		expect(first.ok).toBe(true);
		await accrueSkillCallRoyalty(opts);
		const rows = await fees();
		expect(rows).toHaveLength(1);
		const { platformAtomics } = computeSkillRoyaltySplit({ priceAtomics: 1_000_000n, platformBps: skillRoyaltyPlatformBps() });
		expectComplete(rows[0], { source: 'x402_skill_split', amount: platformAtomics, asset: 'USDC', settlement: 'ledger' });
		expect(rows[0]).toMatchObject({ chain: 'solana', network: 'mainnet', source_ref: `x402:${sig(17)}` });
	});

	it('maps x402 network ids onto chain and network', async () => {
		const { feeChainOf } = await import('../api/_lib/skill-royalty.js');
		expect(feeChainOf('eip155:8453')).toEqual({ chain: 'base', network: 'mainnet' });
		expect(feeChainOf('eip155:84532')).toEqual({ chain: 'base', network: 'testnet' });
		expect(feeChainOf('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1')).toEqual({ chain: 'solana', network: 'devnet' });
		expect(feeChainOf('base')).toEqual({ chain: 'base', network: 'mainnet' });
	});
});
