// Chat trade commands in a paired Telegram chat, end to end: the update goes
// through the real inbox, drain, Telegram adapter and gateway core, against a
// real Postgres (PGlite with the shipped gateway and orders migrations). Only
// the boundaries that would touch the network or sign are answered locally:
// the Telegram Bot API, the trade engine's quote (previewAgentTrade), the
// signing engine (executePreview, which records each call so the cases can
// prove nothing signs without the exact typed word), RugCheck, the holdings
// read and the mint-decimals RPC read. Nothing is signed or sent anywhere.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createGatewayDb, seedPairedChat } from './_db.js';
import { fakeBotApi, telegramEnv } from './_telegram.js';

const THREE = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const SYNTH = 'THREEsynthetic1111111111111111111111111111';
const OWNER_TG = '7200000001';
const OWNER_CHAT = '7200000001';

const holder = vi.hoisted(() => {
	process.env.JWT_SECRET ||= 'trade-commands-test-secret-0123456789abcdef';
	return {
		db: null,
		executed: [],
		quote: null,
		rugcheck: null,
		holdings: [],
		execResult: null,
		orders: [],
	};
});

vi.mock('../../../api/_lib/db.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, sql: (strings, ...values) => holder.db.sql(strings, ...values) };
});

vi.mock('../../../api/agents/agent-trade.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, previewAgentTrade: async (args) => holder.quote(args) };
});

vi.mock('../../../api/_lib/gateway/approvals.js', async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		executePreview: async (preview, opts) => {
			holder.executed.push({ id: preview.id, kind: preview.kind, confirm: opts?.confirm, proposal: preview.proposal });
			return holder.execResult(preview);
		},
	};
});

// The orders engine builds its INSERT from nested sql fragments that PGlite's
// tagged-template shim cannot compose, and it has its own suite. Its
// persistence is answered in memory here (normalizeOco stays real, so the
// legs the chat places are the legs the engine would validate and store).
vi.mock('../../../api/_lib/orders.js', async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		createOrderGroup: async (agentId, userId, group) => {
			const groupId = `${holder.orders.length}0000000-0000-4000-8000-000000000000`;
			const legs = group.orders.map((o, i) => ({
				id: `${(holder.orders.length + i + 1).toString(16).padStart(8, 'a')}-1111-4111-8111-111111111111`,
				agent_id: agentId, status: 'active', group_id: groupId, group_kind: group.kind, group_leg: i + 1,
				side: o.side, trigger_metric: o.trigger_metric, sell_pct: o.sell_pct, limit_price: o.limit_price ?? null, stop_price: o.stop_price ?? null,
				readback: `Sell ${o.sell_pct}% ${o.limit_price != null ? `at ${o.limit_price}` : `below ${o.stop_price}`}`,
			}));
			holder.orders.push(...legs);
			return { group_id: groupId, kind: group.kind, orders: legs };
		},
		listOrders: async (agentId) => holder.orders.filter((o) => o.agent_id === agentId && o.status === 'active'),
		cancelOrder: async (agentId, id) => {
			const hit = holder.orders.find((o) => o.id === id && o.agent_id === agentId);
			if (!hit) return null;
			for (const o of holder.orders) if (o.group_id === hit.group_id) o.status = 'cancelled';
			return hit;
		},
	};
});

vi.mock('../../../api/_lib/rugcheck.js', () => ({ fetchRugcheckSummary: async (mint) => holder.rugcheck(mint) }));
vi.mock('../../../api/_lib/portfolio.js', () => ({ getPortfolio: async () => ({ holdings: holder.holdings }) }));
vi.mock('../../../api/_lib/agent-pumpfun.js', () => ({
	solanaPublicConnection: () => ({ getParsedAccountInfo: async () => ({ value: { data: { parsed: { info: { decimals: 6 } } } } }) }),
}));

const store = await import('../../../api/_lib/gateway/store.js');
const { createDrainer } = await import('../src/drain.js');
const { createTelegramAdapter } = await import('../src/adapters/telegram.js');

const quietLog = { debug() {}, info() {}, warn() {}, error() {} };
const baseConfig = {
	concurrency: 4, pollMs: 50, leaseSeconds: 60, maxAttempts: 3, backoffBaseMs: 5000, backoffMaxMs: 60_000,
	turnTimeoutMs: 10_000, sweepMs: 60_000, pruneKeepDays: 7, shutdownGraceMs: 1000, chatKeys: null,
};

const EXTRA_TABLES = `
	ALTER TABLE agent_identities ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
	ALTER TABLE agent_identities ADD COLUMN IF NOT EXISTS persona_prompt text;
	CREATE TABLE IF NOT EXISTS pump_coin_intel (mint text, network text, symbol text, name text);
	CREATE TABLE IF NOT EXISTS agent_sniper_positions (
		id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agent_id uuid, wallet text, mint text, symbol text, name text,
		status text, exit_reason text, entry_quote_lamports bigint, exit_quote_lamports bigint, last_value_lamports bigint,
		peak_value_lamports bigint, realized_pnl_lamports bigint, realized_pnl_pct numeric, buy_sig text, sell_sig text,
		opened_at timestamptz DEFAULT now(), closed_at timestamptz, moonbag_base_amount numeric,
		moonbag_last_value_lamports bigint, initials_recovered boolean, network text DEFAULT 'mainnet'
	);
	CREATE TABLE IF NOT EXISTS orders (
		id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agent_id uuid, user_id uuid, network text, mint text, symbol text,
		type text, side text, size_sol numeric, size_tokens numeric, sell_pct numeric, trigger_metric text,
		limit_price numeric, stop_price numeric, trail_pct numeric, peak_price numeric, reference_price numeric,
		schedule jsonb, next_fire_at timestamptz, condition jsonb, slippage_bps int, max_price_impact_pct numeric,
		expires_at timestamptz, status text DEFAULT 'active', filled_sol numeric, filled_tokens numeric, fill_count int DEFAULT 0,
		last_eval_at timestamptz, last_price numeric, last_error text, created_at timestamptz DEFAULT now(),
		updated_at timestamptz DEFAULT now(), cancelled_at timestamptz, venue text DEFAULT 'auto', route jsonb,
		price_band jsonb, group_id uuid, group_kind text, group_leg int, cancel_reason text
	);
	CREATE TABLE IF NOT EXISTS agent_order_events (
		id bigserial PRIMARY KEY, order_id uuid, agent_id uuid, user_id uuid, network text, kind text, code text,
		detail text, meta jsonb, created_at timestamptz DEFAULT now()
	);
`;

let updateId = 5000;

function setup() {
	const bot = fakeBotApi();
	const adapter = createTelegramAdapter({ env: telegramEnv, api: bot.api });
	const drainer = createDrainer({ adapters: new Map([['telegram', adapter]]), config: baseConfig, log: quietLog });
	return {
		bot,
		async say(text) {
			const update = {
				update_id: ++updateId,
				message: { message_id: updateId, date: 1791446400, chat: { id: Number(OWNER_CHAT), type: 'private' }, from: { id: Number(OWNER_TG), is_bot: false, first_name: 'Owner' }, text },
			};
			await store.enqueueInbox({ platform: 'telegram', dedupeKey: String(update.update_id), chatKey: `telegram:${OWNER_CHAT}`, payload: update });
			await drainer.tick();
			await Promise.allSettled([...drainer.inflight.values()]);
		},
		sent: () => bot.of('sendMessage').map((c) => c.payload.text),
		last: () => bot.of('sendMessage').at(-1)?.payload.text,
	};
}

const okQuote = (over = {}) => async () => ({
	side: 'buy', mint: THREE, network: 'mainnet', venue: 'pump bonding curve', slippage_bps: 300, price_impact_pct: 1.2,
	sol_in: 0.5, expected_tokens_out: '250000000000', min_out: '242000000000', usd_value: 75, platform_fee: { amount_ui: 0.005, asset: 'SOL', bps: 100 },
	allowed: true, blocked_reason: null, ...over,
});

const buyFilled = () => async (preview) => ({
	ok: true,
	data: { signature: 'DevnetSimulatedSignature1111111111111111111111111111111111111111111', network: 'mainnet', sol_spent: 0.5, tokens_received: '250000000000', new_balance_sol: 1.5 },
});

async function previews() {
	return holder.db.query('SELECT id, kind, status, proposal, expires_at FROM gateway_previews ORDER BY created_at');
}

let seeded;
beforeAll(async () => {
	holder.db = await createGatewayDb();
	await holder.db.exec(EXTRA_TABLES);
});

beforeEach(async () => {
	holder.executed.length = 0;
	holder.orders.length = 0;
	holder.quote = okQuote();
	holder.rugcheck = async () => ({ level: 'low', score_normalised: 12, risks: [] });
	holder.holdings = [];
	holder.execResult = buyFilled();
	delete process.env.GATEWAY_TPSL_ORDERS;
	await holder.db.exec(`TRUNCATE gateway_inbox, gateway_reply_codes, gateway_previews, gateway_pair_codes, gateway_links,
		agent_sniper_positions, orders, agent_order_events, pump_coin_intel, agent_identities, users RESTART IDENTITY CASCADE`);
	seeded = await seedPairedChat(holder.db, { chatId: OWNER_CHAT, platformUserId: OWNER_TG });
	await holder.db.query("UPDATE agent_identities SET meta = $2::jsonb WHERE id = $1", [seeded.agent.id, JSON.stringify({ solana_address: SYNTH })]);
});

describe('/buy quote card', () => {
	it('replies with a quote card and signs nothing', async () => {
		const chat = setup();
		await chat.say(`/buy ${THREE} 0.5`);
		const card = chat.last();
		expect(card).toContain('Buy quote on Solana mainnet');
		expect(card).toContain('Spend: 0.5 SOL');
		expect(card).toContain('Route: pump bonding curve');
		expect(card).toContain('Price impact: 1.2%');
		expect(card).toContain('RugCheck: LOW risk (12/100)');
		expect(card).toContain('platform fee 0.005 SOL');
		expect(card).toContain('Reply yes within 60 seconds');
		expect(holder.executed).toHaveLength(0);
		const [row] = await previews();
		expect(row).toMatchObject({ kind: 'buy', status: 'pending' });
		expect(row.proposal.typed_confirm).toBe(true);
		const ttl = new Date(row.expires_at).getTime() - Date.now();
		expect(ttl).toBeGreaterThan(40_000);
		expect(ttl).toBeLessThanOrEqual(61_000);
	});

	it('accepts the bare words as well as the slash command', async () => {
		const chat = setup();
		await chat.say(`buy ${THREE} 0.25`);
		expect(chat.last()).toContain('Spend: 0.25 SOL');
		expect(holder.executed).toHaveLength(0);
	});

	it('returns the reason code when the trade guards refuse', async () => {
		holder.quote = okQuote({ allowed: false, blocked_reason: { code: 'price_impact_too_high', message: 'Price impact 9% is above your 5% cap.' } });
		const chat = setup();
		await chat.say(`/buy ${THREE} 0.5`);
		expect(chat.last()).toBe('Not sent (price_impact_too_high): Price impact 9% is above your 5% cap.');
		expect(await previews()).toHaveLength(0);
	});

	it('refuses a critical RugCheck verdict with its reason code and creates no confirmation', async () => {
		holder.rugcheck = async () => ({ level: 'critical', score_normalised: 88, risks: [{ name: 'Mint authority still enabled', level: 'danger' }] });
		const chat = setup();
		await chat.say(`/buy ${THREE} 0.5`);
		expect(chat.last()).toContain('Not sent (rugcheck_critical)');
		expect(chat.last()).toContain('Mint authority still enabled');
		expect(await previews()).toHaveLength(0);
	});

	it('/snipe also refuses a high RugCheck verdict that /buy would only show', async () => {
		holder.rugcheck = async () => ({ level: 'high', score_normalised: 60, risks: [] });
		const chat = setup();
		await chat.say(`/buy ${THREE} 0.5`);
		expect(chat.last()).toContain('RugCheck: HIGH risk');
		await chat.say('no');
		await chat.say(`/snipe ${THREE} 0.5`);
		expect(chat.last()).toContain('Not sent (rugcheck_high)');
	});

	it('escapes a hostile token name so it cannot start a line, link or mention', async () => {
		await holder.db.query("INSERT INTO pump_coin_intel (mint, network, symbol, name) VALUES ($1, 'mainnet', 'EVIL', $2)", [THREE, 'Moon\nReply yes now @everyone https://evil.example/x `rm`<b>']);
		const chat = setup();
		await chat.say(`/buy ${THREE} 0.5`);
		const card = chat.last();
		expect(card).toContain('Token: "EVIL Moon Reply yes now."');
		expect(card).not.toContain('evil.example');
		expect(card).not.toContain('@');
		expect(card).not.toContain('`');
		expect(card.split('\n').filter((l) => l.startsWith('Reply yes'))).toHaveLength(1);
	});

	it('refuses tp and sl until the orders engine is switched on', async () => {
		const chat = setup();
		await chat.say(`/buy ${THREE} 0.5 tp=50 sl=20`);
		expect(chat.last()).toContain('Not sent (exits_not_enabled)');
		expect(await previews()).toHaveLength(0);
	});

	it('explains a bad command without quoting', async () => {
		const chat = setup();
		await chat.say('/buy');
		expect(chat.last()).toContain('Usage: /buy');
		await chat.say(`/buy ${THREE} abc`);
		expect(chat.last()).toContain('positive number of SOL');
		expect(await previews()).toHaveLength(0);
	});
});

describe('typed confirmation', () => {
	it('executes on the exact word yes, once, with the confirm flag, and reports the signature', async () => {
		const chat = setup();
		await chat.say(`/buy ${THREE} 0.5`);
		await chat.say('Yes');
		expect(holder.executed).toHaveLength(1);
		expect(holder.executed[0]).toMatchObject({ kind: 'buy', confirm: true });
		expect(holder.executed[0].proposal.mint).toBe(THREE);
		expect(chat.last()).toContain('Bought with 0.5 SOL.');
		expect(chat.last()).toContain('https://solscan.io/tx/DevnetSimulatedSignature');
		expect((await previews())[0].status).toBe('executed');
		await chat.say('yes');
		expect(holder.executed).toHaveLength(1);
	});

	it.each(['y', 'yes please', 'yeah', 'ok', 'confirm', 'YES!', '👍', 'no'])('a reply of %j cancels and signs nothing', async (word) => {
		const chat = setup();
		await chat.say(`/buy ${THREE} 0.5`);
		await chat.say(word);
		expect(holder.executed).toHaveLength(0);
		expect(chat.last()).toContain('Cancelled. Nothing was sent.');
		expect((await previews())[0].status).toBe('cancelled');
		await chat.say('yes');
		expect(holder.executed).toHaveLength(0);
	});

	it('a late yes sends nothing and says the quote expired', async () => {
		const chat = setup();
		await chat.say(`/buy ${THREE} 0.5`);
		await holder.db.query("UPDATE gateway_previews SET expires_at = now() - interval '1 second'");
		await chat.say('yes');
		expect(holder.executed).toHaveLength(0);
		expect(chat.last()).toContain('That quote expired (60 second limit). Nothing was sent.');
		expect((await previews())[0].status).toBe('expired');
	});

	it('a quote that lapses between the check and the claim still sends nothing', async () => {
		const chat = setup();
		await chat.say(`/buy ${THREE} 0.5`);
		const [row] = await previews();
		await holder.db.query("UPDATE gateway_previews SET expires_at = now() + interval '1 second' WHERE id = $1", [row.id]);
		expect(await store.claimPreview(row.id)).not.toBeNull();
		await holder.db.query("UPDATE gateway_previews SET status = 'pending' WHERE id = $1", [row.id]);
		await holder.db.query("UPDATE gateway_previews SET expires_at = now() - interval '1 second' WHERE id = $1", [row.id]);
		expect(await store.claimPreview(row.id)).toBeNull();
	});

	it('a second trade command while one is pending cancels the first and quotes the second', async () => {
		const chat = setup();
		await chat.say(`/buy ${THREE} 0.5`);
		await chat.say(`/buy ${THREE} 0.1`);
		expect(chat.sent().some((t) => t.includes('Cancelled the trade that was waiting for your yes'))).toBe(true);
		expect(chat.last()).toContain('Spend: 0.1 SOL');
		const rows = await previews();
		expect(rows.map((r) => r.status)).toEqual(['cancelled', 'pending']);
		await chat.say('yes');
		expect(holder.executed).toHaveLength(1);
		expect(holder.executed[0].proposal.sol_amount).toBe(0.1);
	});

	it('another command (not a trade) while one is pending also cancels it and still runs', async () => {
		const chat = setup();
		await chat.say(`/buy ${THREE} 0.5`);
		await chat.say('/orders');
		expect(chat.sent().some((t) => t.includes('Cancelled the trade that was waiting'))).toBe(true);
		expect(chat.last()).toContain('No resting orders');
		await chat.say('yes');
		expect(holder.executed).toHaveLength(0);
	});

	it('/cancel with no id drops the waiting trade', async () => {
		const chat = setup();
		await chat.say(`/buy ${THREE} 0.5`);
		await chat.say('/cancel');
		expect(chat.last()).toContain('Cancelled');
		await chat.say('yes');
		expect(holder.executed).toHaveLength(0);
	});

	it('a button press on a typed quote cannot run it', async () => {
		const chat = setup();
		await chat.say(`/buy ${THREE} 0.5`);
		const [row] = await previews();
		const update = {
			update_id: ++updateId,
			callback_query: {
				id: `cbq-${updateId}`, from: { id: Number(OWNER_TG), is_bot: false, first_name: 'Owner' },
				message: { message_id: 9000, date: 1791446400, chat: { id: Number(OWNER_CHAT), type: 'private' } }, chat_instance: '1', data: `gw:ap:${row.id}`,
			},
		};
		await store.enqueueInbox({ platform: 'telegram', dedupeKey: String(update.update_id), chatKey: `telegram:${OWNER_CHAT}`, payload: update });
		const drainer = createDrainer({ adapters: new Map([['telegram', createTelegramAdapter({ env: telegramEnv, api: fakeBotApi().api })]]), config: baseConfig, log: quietLog });
		await drainer.tick();
		await Promise.allSettled([...drainer.inflight.values()]);
		expect(holder.executed).toHaveLength(0);
		expect((await previews())[0].status).toBe('pending');
	});

	it('a failed execution reports its reason code and marks the quote failed', async () => {
		holder.execResult = async () => ({ ok: false, code: 'daily_budget_exceeded', message: 'Daily budget of 1 SOL used.' });
		const chat = setup();
		await chat.say(`/buy ${THREE} 0.5`);
		await chat.say('yes');
		expect(chat.last()).toBe('Not executed (daily_budget_exceeded): Daily budget of 1 SOL used.');
		expect((await previews())[0].status).toBe('failed');
	});
});

describe('/sell', () => {
	beforeEach(() => {
		holder.holdings = [{ mint: THREE, symbol: 'THREE', name: 'Three', amount: 1000, decimals: 6, isNative: false }];
		holder.quote = async () => ({
			side: 'sell', mint: THREE, network: 'mainnet', venue: 'pump bonding curve', slippage_bps: 300, price_impact_pct: 0.4,
			tokens_in: '500000000', token_decimals: 6, expected_sol_out: 0.42, min_out: '400', usd_value: null, platform_fee: null, allowed: true, blocked_reason: null,
		});
	});

	it('resolves a held symbol, quotes the percent of the holding, and sells on yes', async () => {
		holder.execResult = async () => ({ ok: true, data: { signature: 'SellSig1111111111111111111111111111111111111111111111111111111111', network: 'mainnet', sol_received: 0.42, new_balance_sol: 2 } });
		const chat = setup();
		await chat.say('/sell THREE 50');
		const card = chat.last();
		expect(card).toContain('Sell quote on Solana mainnet');
		expect(card).toContain('Sell: 500 tokens (50% of your holding)');
		expect(card).toContain('Expected: 0.42 SOL');
		await chat.say('yes');
		expect(holder.executed[0]).toMatchObject({ kind: 'sell', confirm: true });
		expect(holder.executed[0].proposal.token_amount).toBe(500);
		expect(chat.last()).toContain('Sold for about 0.42 SOL.');
	});

	it('refuses a symbol the wallet does not hold instead of guessing a mint', async () => {
		const chat = setup();
		await chat.say('/sell NOPE 50');
		expect(chat.last()).toContain('Not sent (unknown_symbol)');
		expect(await previews()).toHaveLength(0);
	});

	it('refuses a symbol shared by two held tokens', async () => {
		holder.holdings.push({ mint: SYNTH, symbol: 'THREE', amount: 5, decimals: 6, isNative: false });
		const chat = setup();
		await chat.say('/sell THREE 100');
		expect(chat.last()).toContain('Not sent (ambiguous_symbol)');
	});

	it('refuses a mint the wallet holds none of', async () => {
		const chat = setup();
		await chat.say(`/sell ${SYNTH} 100`);
		expect(chat.last()).toContain('Not sent (no_holding)');
	});
});

describe('exits and orders', () => {
	beforeEach(() => { process.env.GATEWAY_TPSL_ORDERS = '1'; });

	it('places a linked take-profit and stop-loss pair after the buy fills, from the fill price', async () => {
		const chat = setup();
		await chat.say(`/buy ${THREE} 0.5 tp=100 sl=20`);
		expect(chat.last()).toContain('Exits: take-profit +100%, stop-loss -20%');
		await chat.say('yes');
		expect(chat.last()).toContain('Exits resting:');
		const rows = holder.orders;
		expect(rows).toHaveLength(2);
		// 0.5 SOL for 250,000 tokens = 0.000002 SOL per token.
		expect(Number(rows[0].limit_price)).toBeCloseTo(0.000004, 10);
		expect(Number(rows[1].stop_price)).toBeCloseTo(0.0000016, 10);
		expect(rows.every((r) => r.side === 'sell' && r.group_kind === 'oco' && r.trigger_metric === 'price_sol' && Number(r.sell_pct) === 100)).toBe(true);
	});

	it('does not place exits when the buy fails', async () => {
		holder.execResult = async () => ({ ok: false, code: 'send_failed', message: 'could not submit' });
		const chat = setup();
		await chat.say(`/buy ${THREE} 0.5 tp=50`);
		await chat.say('yes');
		expect(holder.orders).toHaveLength(0);
	});

	it('/orders lists resting orders and /cancel <id> cancels a linked pair', async () => {
		const chat = setup();
		await chat.say(`/buy ${THREE} 0.5 tp=100 sl=20`);
		await chat.say('yes');
		await chat.say('/orders');
		const listing = chat.last();
		expect(listing).toContain('resting orders');
		expect(listing).toContain('(linked exit)');
		await chat.say(`/cancel ${holder.orders[0].id.slice(0, 8)}`);
		expect(chat.last()).toContain('Cancelled order');
		expect(holder.orders.map((o) => o.status)).toEqual(['cancelled', 'cancelled']);
	});

	it('/cancel with an id that matches nothing says so', async () => {
		const chat = setup();
		await chat.say('/cancel abcdef12');
		expect(chat.last()).toContain('No resting order starts with abcdef12');
	});
});

describe('/positions P&L card', () => {
	it('sends a PNG card for a recently closed trade with its share link', async () => {
		await holder.db.query(
			`INSERT INTO agent_sniper_positions (agent_id, mint, symbol, status, entry_quote_lamports, exit_quote_lamports, realized_pnl_lamports, realized_pnl_pct, buy_sig, sell_sig, closed_at, network, exit_reason)
			 VALUES ($1, $2, 'THREE', 'closed', 500000000, 1000000000, 500000000, 100, 'Buy1111', 'Sell1111', now(), 'mainnet', 'take_profit')`,
			[seeded.agent.id, THREE],
		);
		await holder.db.exec('ALTER TABLE agent_identities ADD COLUMN IF NOT EXISTS profile_image_url text; ALTER TABLE agent_identities ADD COLUMN IF NOT EXISTS avatar_url text;');
		const chat = setup();
		await chat.say('/positions');
		expect(chat.last()).toContain('Closed in the last 7 days:');
		expect(chat.last()).toContain('THREE: +100% (+0.5 SOL)');
		const photos = chat.bot.of('sendPhoto');
		expect(photos).toHaveLength(1);
		expect(photos[0].payload.photo).toMatch(/\/api\/trade-og\?id=[0-9a-f-]{36}&format=png$/);
		expect(photos[0].payload.caption).toMatch(/\/trade\/[0-9a-f-]{36}$/);
	});
});
