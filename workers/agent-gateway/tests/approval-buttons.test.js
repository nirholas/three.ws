// Approval requests in a paired chat, end to end: queued by the notification
// fan-out, sent by the drain with signed Approve and Deny buttons, pressed
// through the real Telegram adapter and gateway core, decided by the real
// approval inbox (api/_lib/approvals.js) against a real Postgres (PGlite with
// the shipped gateway and approval migrations). Only two boundaries are
// answered locally: the Telegram Bot API (tests/_telegram.js) and the executor
// that would sign the transfer, which records each call so the replay cases can
// prove it ran once.

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createGatewayDb, seedPairedChat } from './_db.js';
import { fakeBotApi, telegramEnv } from './_telegram.js';

const holder = vi.hoisted(() => {
	process.env.JWT_SECRET ||= 'approval-buttons-test-secret-0123456789abcdef';
	return { db: null, executed: [] };
});

vi.mock('../../../api/_lib/db.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, sql: (strings, ...values) => holder.db.sql(strings, ...values) };
});

vi.mock('../../../api/_lib/wallet-intents.js', () => ({
	executeApprovedIntentAction: async (row) => {
		holder.executed.push(row.id);
		return { status: 'ok', signature: '5imu1atedDevnetSignature1111111111111111111111111111111111111111111', note: 'sent on devnet' };
	},
}));

const store = await import('../../../api/_lib/gateway/store.js');
const { payloadHash } = await import('../../../api/_lib/approvals.js');
const buttons = await import('../../../api/_lib/gateway/approval-buttons.js');
const { queueChatNotifications } = await import('../../../api/_lib/gateway/notify.js');
const { COMMANDS } = await import('../../../api/_lib/gateway/commands.js');
const { createDrainer } = await import('../src/drain.js');
const { createTelegramAdapter } = await import('../src/adapters/telegram.js');

const quietLog = { debug() {}, info() {}, warn() {}, error() {} };
const baseConfig = {
	concurrency: 4, pollMs: 50, leaseSeconds: 60, maxAttempts: 3, backoffBaseMs: 5000, backoffMaxMs: 60_000,
	turnTimeoutMs: 10_000, sweepMs: 60_000, pruneKeepDays: 7, shutdownGraceMs: 1000, chatKeys: null,
};
const OWNER_TG = '7100000001';
const OWNER_CHAT = '7100000001';
const RECIPIENT = 'THREEsynthetic11111111111111111111111111111';

// Tables the commands touch that neither shipped migration set owns. Only the
// columns the code under test reads or writes.
const EXTRA_TABLES = `
	ALTER TABLE agent_identities ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
	ALTER TABLE agent_identities ADD COLUMN IF NOT EXISTS persona_prompt text;
	CREATE TABLE strategy_kill_switch (owner_id uuid PRIMARY KEY, engaged boolean NOT NULL DEFAULT false, engaged_at timestamptz, updated_at timestamptz);
	CREATE TABLE agent_sniper_strategies (agent_id uuid, network text NOT NULL DEFAULT 'mainnet', enabled boolean DEFAULT true, kill_switch boolean NOT NULL DEFAULT false, updated_at timestamptz DEFAULT now());
	CREATE TABLE agent_sniper_positions (
		id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agent_id uuid, wallet text, mint text, symbol text, name text,
		status text, exit_reason text, entry_quote_lamports bigint, exit_quote_lamports bigint, last_value_lamports bigint,
		peak_value_lamports bigint, realized_pnl_lamports bigint, realized_pnl_pct numeric, buy_sig text, sell_sig text,
		opened_at timestamptz DEFAULT now(), closed_at timestamptz, moonbag_base_amount numeric,
		moonbag_last_value_lamports bigint, initials_recovered boolean, network text DEFAULT 'mainnet'
	);
`;

let updateId = 1000;

function setup() {
	const bot = fakeBotApi();
	const adapter = createTelegramAdapter({ env: telegramEnv, api: bot.api });
	const drainer = createDrainer({ adapters: new Map([['telegram', adapter]]), config: baseConfig, log: quietLog });
	const drain = async () => {
		const n = await drainer.tick();
		await Promise.allSettled([...drainer.inflight.values()]);
		return n;
	};
	return { bot, adapter, drainer, drain };
}

function queueUpdate(update) {
	const chatId = update.message?.chat.id ?? update.callback_query.message.chat.id;
	return store.enqueueInbox({ platform: 'telegram', dedupeKey: String(update.update_id), chatKey: `telegram:${chatId}`, payload: update });
}

function press(data, { chatId = OWNER_CHAT, fromId = OWNER_TG, messageId = 9000 } = {}) {
	return {
		update_id: ++updateId,
		callback_query: {
			id: `cbq-${updateId}`,
			from: { id: Number(fromId), is_bot: false, first_name: 'Owner' },
			message: { message_id: messageId, date: 1791446400, chat: { id: Number(chatId), type: 'private' } },
			chat_instance: '1',
			data,
		},
	};
}

function message(text, extra = {}, { chatId = OWNER_CHAT, fromId = OWNER_TG } = {}) {
	return {
		update_id: ++updateId,
		message: { message_id: updateId, date: 1791446400, chat: { id: Number(chatId), type: 'private' }, from: { id: Number(fromId), is_bot: false, first_name: 'Owner' }, text, ...extra },
	};
}

async function seedApproval({ userId, agentId, expiresInMs = 15 * 60_000, status = 'pending', amount = 0.5 }) {
	const payload = { kind: 'transfer', to: RECIPIENT, lamports: Math.round(amount * 1e9), network: 'devnet', nonce: randomUUID() };
	const [row] = await holder.db.query(
		`INSERT INTO approval_requests
		   (user_id, agent_id, source, action_type, venue, payload, payload_hash, summary, amount, amount_usd, asset,
		    chain, network, recipient, risk_notes, gate_reason, idempotency_key, status, expires_at)
		 VALUES ($1, $2, 'wallet_intent', 'transfer', 'wallet_transfer', $3::jsonb, $4, $5, $6, $7, 'SOL',
		    'solana', 'devnet', $8, $9::jsonb, 'Above your per-transfer approval threshold', $10, $11, now() + ($12 || ' milliseconds')::interval)
		 RETURNING *`,
		[userId, agentId, JSON.stringify(payload), payloadHash(payload), `Send ${amount} SOL to the treasury wallet`, amount, amount * 150,
			RECIPIENT, JSON.stringify(['First transfer to this address']), randomUUID(), status, String(expiresInMs)],
	);
	return row;
}

async function approvalRow(id) {
	const [row] = await holder.db.query('SELECT * FROM approval_requests WHERE id = $1', [id]);
	return row;
}

async function agentMeta(id) {
	const [row] = await holder.db.query('SELECT meta FROM agent_identities WHERE id = $1', [id]);
	return row.meta;
}

beforeAll(async () => {
	holder.db = await createGatewayDb();
	await holder.db.exec(readFileSync(new URL('../../../api/_lib/migrations/20261010120000_approval_requests.sql', import.meta.url), 'utf8'));
	await holder.db.exec(EXTRA_TABLES);
});

beforeEach(async () => {
	holder.executed.length = 0;
	await holder.db.exec(`TRUNCATE gateway_inbox, gateway_reply_codes, gateway_previews, gateway_pair_codes, gateway_links,
		approval_requests, approval_auto_policies, strategy_kill_switch, agent_sniper_strategies, agent_sniper_positions,
		agent_identities, users RESTART IDENTITY CASCADE`);
});

describe('signed callback data', () => {
	const link = { id: randomUUID(), platform: 'telegram', platform_user_id: OWNER_TG };
	const row = { id: randomUUID(), payload_hash: 'a'.repeat(64), expires_at: new Date(Date.now() + 600_000).toISOString() };

	it('fits Telegram callback_data, parses back to the request, and verifies against it', () => {
		for (const verb of ['approve', 'deny']) {
			const data = buttons.signApprovalCallback({ verb, row, link });
			expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
			const parsed = buttons.parseApprovalCallback(data);
			expect(parsed).toMatchObject({ verb, approvalId: row.id });
			expect(buttons.verifyApprovalCallback(parsed, { row, link })).toEqual({ ok: true });
		}
	});

	it('fails a changed payload hash, another link, another presser, a moved deadline and a flipped verb', () => {
		const parsed = buttons.parseApprovalCallback(buttons.signApprovalCallback({ verb: 'approve', row, link }));
		const bad = { ok: false, reason: 'bad_signature' };
		expect(buttons.verifyApprovalCallback(parsed, { row: { ...row, payload_hash: 'b'.repeat(64) }, link })).toEqual(bad);
		expect(buttons.verifyApprovalCallback(parsed, { row, link: { ...link, id: randomUUID() } })).toEqual(bad);
		expect(buttons.verifyApprovalCallback(parsed, { row, link: { ...link, platform_user_id: '999' } })).toEqual(bad);
		expect(buttons.verifyApprovalCallback(parsed, { row: { ...row, expires_at: new Date(Date.now() + 900_000).toISOString() }, link })).toEqual(bad);
		expect(buttons.verifyApprovalCallback({ ...parsed, verb: 'deny' }, { row, link })).toEqual(bad);
	});

	it('fails every single-character change to the signed data', () => {
		const data = buttons.signApprovalCallback({ verb: 'approve', row, link });
		for (let i = 3; i < data.length; i++) {
			const swap = data[i] === 'A' ? 'B' : 'A';
			const parsed = buttons.parseApprovalCallback(`${data.slice(0, i)}${swap}${data.slice(i + 1)}`);
			if (!parsed) continue;
			const target = { ...row, id: parsed.approvalId };
			const out = buttons.verifyApprovalCallback(parsed, { row: target, link });
			expect(out.ok, `changed char ${i}`).toBe(false);
		}
	});

	it('reports a deadline that has passed as expired, not as a bad signature', () => {
		const past = { ...row, expires_at: new Date(Date.now() - 1000).toISOString() };
		const parsed = buttons.parseApprovalCallback(buttons.signApprovalCallback({ verb: 'approve', row: past, link }));
		expect(buttons.verifyApprovalCallback(parsed, { row: past, link })).toEqual({ ok: false, reason: 'expired' });
	});

	it('leaves trade-preview button ids and junk to their own parser', () => {
		expect(buttons.parseApprovalCallback('gw:ap:123')).toBeNull();
		expect(buttons.parseApprovalCallback('')).toBeNull();
		expect(buttons.parseApprovalCallback('ar1x' + 'A'.repeat(53))).toBeNull();
	});
});

describe('delivery into a paired chat', () => {
	it('queues an approval row per paired chat and the drain sends the full table with signed buttons', async () => {
		const { user, agent, link } = await seedPairedChat(holder.db, { chatId: OWNER_CHAT, platformUserId: OWNER_TG });
		const req = await seedApproval({ userId: user.id, agentId: agent.id });
		const queued = await queueChatNotifications({
			userId: user.id, type: 'approval_requested', notificationId: 'n-1', prefs: {},
			payload: { approval_id: req.id, summary: req.summary, expires_at: req.expires_at },
		});
		expect(queued).toEqual({ telegram: 1 });
		const [inbox] = await holder.db.query('SELECT payload FROM gateway_inbox');
		expect(inbox.payload).toMatchObject({ kind: 'approval', approvalId: req.id, linkId: link.id, chatId: OWNER_CHAT });

		const { bot, drain } = setup();
		expect(await drain()).toBe(1);
		const [sent] = bot.of('sendMessage');
		expect(sent.payload.chat_id).toBe(OWNER_CHAT);
		for (const line of ['Approval needed from Test Agent', 'Send 0.5 SOL to the treasury wallet', `Recipient: ${RECIPIENT}`, 'Amount: 0.5 SOL (~$75.00)', 'Asset: SOL', 'Chain: Solana devnet', 'First transfer to this address', 'Nothing runs unless you press Approve']) {
			expect(sent.payload.text).toContain(line);
		}
		const keys = sent.payload.reply_markup.inline_keyboard[0];
		expect(keys.map((k) => k.text)).toEqual(['Approve', 'Deny']);
		expect(keys.map((k) => buttons.parseApprovalCallback(k.callback_data)?.verb)).toEqual(['approve', 'deny']);
		expect(keys.every((k) => Buffer.byteLength(k.callback_data) <= 64)).toBe(true);
	});

	it('skips a request that was decided while it waited in the queue', async () => {
		const { user, agent, link } = await seedPairedChat(holder.db, { chatId: OWNER_CHAT, platformUserId: OWNER_TG });
		const req = await seedApproval({ userId: user.id, agentId: agent.id, status: 'denied' });
		await store.enqueueInbox({ platform: 'telegram', dedupeKey: 'ap-1', chatKey: `telegram:${OWNER_CHAT}`, payload: { kind: 'approval', approvalId: req.id, linkId: link.id, chatId: OWNER_CHAT, expiresAt: req.expires_at } });
		const { bot, drain, drainer } = setup();
		await drain();
		expect(bot.of('sendMessage')).toHaveLength(0);
		expect(drainer.stats.approvalsSkipped).toBe(1);
	});
});

describe('pressing Approve and Deny', () => {
	async function delivered() {
		const ctx = await seedPairedChat(holder.db, { chatId: OWNER_CHAT, platformUserId: OWNER_TG });
		const req = await seedApproval({ userId: ctx.user.id, agentId: ctx.agent.id });
		const [approve, deny] = buttons.approvalChoices(req, ctx.link).map((c) => c.id);
		return { ...ctx, req, approve, deny };
	}

	it('executes once on Approve, records the chat as the decision channel, and drops the buttons', async () => {
		const { req, approve } = await delivered();
		const { bot, drain } = setup();
		await queueUpdate(press(approve));
		await drain();

		expect(holder.executed).toEqual([req.id]);
		const row = await approvalRow(req.id);
		expect(row).toMatchObject({ status: 'executed', decided_via: 'telegram' });
		expect(bot.of('answerCallbackQuery')[0].payload.text).toBe('Approved. Executing...');
		const edit = bot.of('editMessageText').at(-1).payload;
		expect(edit.text).toContain('Approved and executed.');
		expect(edit.reply_markup).toEqual({ inline_keyboard: [] });
	});

	it('is idempotent: a replayed Approve redraws the outcome and never runs the action again', async () => {
		const { req, approve } = await delivered();
		const { bot, drain } = setup();
		await queueUpdate(press(approve));
		await drain();
		await queueUpdate(press(approve));
		await drain();

		expect(holder.executed).toEqual([req.id]);
		expect(bot.of('answerCallbackQuery').at(-1).payload.text).toBe('Already executed.');
		expect(bot.of('editMessageText').at(-1).payload.text).toContain('Approved and executed.');
	});

	it('denies on Deny, and Approve afterwards cannot revive it', async () => {
		const { req, approve, deny } = await delivered();
		const { bot, drain } = setup();
		await queueUpdate(press(deny));
		await drain();
		await queueUpdate(press(approve));
		await drain();

		expect(holder.executed).toEqual([]);
		expect(await approvalRow(req.id)).toMatchObject({ status: 'denied', decided_via: 'telegram' });
		expect(bot.of('editMessageText').at(-1).payload.text).toContain('Denied. Nothing was sent.');
	});

	it('fails closed when the request changed after it was shown (payload and hash rewritten)', async () => {
		const { req, approve } = await delivered();
		const swapped = { kind: 'transfer', to: 'THREEsynthetic22222222222222222222222222222', lamports: 50e9, network: 'devnet' };
		await holder.db.query('UPDATE approval_requests SET payload = $1::jsonb, payload_hash = $2 WHERE id = $3', [JSON.stringify(swapped), payloadHash(swapped), req.id]);
		const { bot, drain } = setup();
		await queueUpdate(press(approve));
		await drain();

		expect(holder.executed).toEqual([]);
		expect((await approvalRow(req.id)).status).toBe('pending');
		expect(bot.of('answerCallbackQuery')[0].payload.text).toContain('does not match the request on file');
	});

	it('fails closed when the stored payload was edited under an unchanged hash', async () => {
		const { req, approve } = await delivered();
		await holder.db.query(`UPDATE approval_requests SET payload = jsonb_set(payload, '{lamports}', '50000000000') WHERE id = $1`, [req.id]);
		const { bot, drain } = setup();
		await queueUpdate(press(approve));
		await drain();

		expect(holder.executed).toEqual([]);
		const row = await approvalRow(req.id);
		expect(row.status).toBe('failed');
		expect(row.result).toMatchObject({ integrity: false });
		expect(bot.of('editMessageText').at(-1).payload.text).toContain('did not execute');
	});

	it('refuses a tampered button', async () => {
		const { req, approve } = await delivered();
		const forged = `${approve.slice(0, -1)}${approve.endsWith('A') ? 'B' : 'A'}`;
		const { bot, drain } = setup();
		await queueUpdate(press(forged));
		await drain();

		expect(holder.executed).toEqual([]);
		expect((await approvalRow(req.id)).status).toBe('pending');
		expect(bot.of('answerCallbackQuery')[0].payload.text).toContain('does not match');
	});

	it('refuses an expired request and says so in place', async () => {
		const ctx = await seedPairedChat(holder.db, { chatId: OWNER_CHAT, platformUserId: OWNER_TG });
		const req = await seedApproval({ userId: ctx.user.id, agentId: ctx.agent.id, expiresInMs: 60_000 });
		const [approve] = buttons.approvalChoices(req, ctx.link).map((c) => c.id);
		await holder.db.query(`UPDATE approval_requests SET expires_at = now() - interval '1 second' WHERE id = $1`, [req.id]);
		const resigned = buttons.approvalChoices(await approvalRow(req.id), ctx.link)[0].id;
		const { bot, drain } = setup();
		await queueUpdate(press(approve));
		await drain();
		await queueUpdate(press(resigned));
		await drain();

		expect(holder.executed).toEqual([]);
		expect(bot.of('answerCallbackQuery')[0].payload.text).toContain('does not match');
		expect(bot.of('editMessageText').at(-1).payload.text).toContain('Expired before a decision');
		expect((await approvalRow(req.id)).status).toBe('pending');
	});

	it('refuses a press from anyone but the paired owner', async () => {
		const { req, approve } = await delivered();
		const { bot, drain } = setup();
		await queueUpdate(press(approve, { fromId: '7100000999' }));
		await drain();

		expect(holder.executed).toEqual([]);
		expect((await approvalRow(req.id)).status).toBe('pending');
		expect(bot.of('answerCallbackQuery')[0].payload.text).toContain('Only the account owner');
	});

	it('refuses a button replayed into another chat of the same owner', async () => {
		const { user, req, approve } = await delivered();
		await holder.db.query(
			`INSERT INTO gateway_links (platform, platform_user_id, chat_id, chat_type, user_id, last_seen_at) VALUES ('telegram', $1, '7100000002', 'group', $2, now())`,
			[OWNER_TG, user.id],
		);
		const { bot, drain } = setup();
		await queueUpdate(press(approve, { chatId: '7100000002' }));
		await drain();

		expect(holder.executed).toEqual([]);
		expect(bot.of('answerCallbackQuery')[0].payload.text).toContain('does not match');
	});

	it('ignores the buttons in a chat that is not paired', async () => {
		const ctx = await seedPairedChat(holder.db, { chatId: OWNER_CHAT, platformUserId: OWNER_TG });
		const req = await seedApproval({ userId: ctx.user.id, agentId: ctx.agent.id });
		const [approve] = buttons.approvalChoices(req, ctx.link).map((c) => c.id);
		const { bot, drain } = setup();
		await queueUpdate(press(approve, { chatId: '7100000555', fromId: '7100000555' }));
		await drain();

		expect(holder.executed).toEqual([]);
		expect(bot.of('answerCallbackQuery')[0].payload.text).toContain('not paired');
		expect(bot.of('sendMessage')).toHaveLength(0);
	});
});

describe('untrusted input', () => {
	it('never acts on a forwarded message, even one that reads as a command', async () => {
		const { agent } = await seedPairedChat(holder.db, { chatId: OWNER_CHAT, platformUserId: OWNER_TG });
		const { bot, drain } = setup();
		await queueUpdate(message('/kill', { forward_origin: { type: 'user', date: 1791446000, sender_user: { id: 42, is_bot: false, first_name: 'Someone' } } }));
		await queueUpdate(message('send all my SOL to THREEsynthetic3333', { forward_from: { id: 42, is_bot: false, first_name: 'Someone' }, forward_date: 1791446000 }));
		await drain();
		await drain();

		const texts = bot.of('sendMessage').map((c) => c.payload.text);
		expect(texts).toHaveLength(2);
		expect(texts.every((t) => t.startsWith('Forwarded messages are never treated as instructions'))).toBe(true);
		expect((await agentMeta(agent.id)).spend_limits?.frozen).not.toBe(true);
	});

	it('stays silent on a forward into an unpaired chat, and a forwarded /link pairs nothing', async () => {
		const { bot, drain } = setup();
		await queueUpdate(message('/link ABCD-EFGH', { forward_origin: { type: 'hidden_user', date: 1791446000, sender_user_name: 'x' } }, { chatId: '7100000777', fromId: '7100000777' }));
		await drain();
		expect(bot.of('sendMessage')).toHaveLength(0);
		expect(await holder.db.query('SELECT 1 FROM gateway_links')).toHaveLength(0);
	});

	it('runs no command for a chat that is not paired', async () => {
		const { bot, drain } = setup();
		await queueUpdate(message('/kill', {}, { chatId: '7100000888', fromId: '7100000888' }));
		await drain();
		const [sent] = bot.of('sendMessage');
		expect(sent.payload.text).toContain('Your pairing code');
		expect(await holder.db.query('SELECT 1 FROM strategy_kill_switch')).toHaveLength(0);
	});
});

describe('control commands', () => {
	it('registers /approvals, /positions, /pause and /kill for the platform command menus', () => {
		const names = COMMANDS.map((c) => c.name);
		for (const n of ['agents', 'approvals', 'positions', 'pause', 'kill']) expect(names).toContain(n);
	});

	it('/approvals sends each pending request with its own signed buttons', async () => {
		const { user, agent } = await seedPairedChat(holder.db, { chatId: OWNER_CHAT, platformUserId: OWNER_TG });
		await seedApproval({ userId: user.id, agentId: agent.id, amount: 0.25 });
		await seedApproval({ userId: user.id, agentId: agent.id, amount: 1.5 });
		await seedApproval({ userId: user.id, agentId: agent.id, status: 'denied' });
		const { bot, drain } = setup();
		await queueUpdate(message('/approvals'));
		await drain();

		const sent = bot.of('sendMessage');
		expect(sent[0].payload.text).toContain('2 pending requests');
		expect(sent.slice(1)).toHaveLength(2);
		for (const s of sent.slice(1)) expect(s.payload.reply_markup.inline_keyboard[0]).toHaveLength(2);
	});

	it('/positions lists open positions with live value', async () => {
		const { agent } = await seedPairedChat(holder.db, { chatId: OWNER_CHAT, platformUserId: OWNER_TG });
		await holder.db.query(
			`INSERT INTO agent_sniper_positions (agent_id, mint, symbol, status, entry_quote_lamports, last_value_lamports, network) VALUES ($1, 'THREEsyntheticMint111', 'THREE', 'open', 200000000, 260000000, 'mainnet')`,
			[agent.id],
		);
		const { bot, drain } = setup();
		await queueUpdate(message('/positions'));
		await drain();
		const text = bot.of('sendMessage')[0].payload.text;
		expect(text).toContain('1 open position');
		expect(text).toContain('THREE: in 0.2 SOL, now 0.26 SOL (+30');
	});

	it('/pause freezes the chat agent and its sniper, and points to the web to resume', async () => {
		const { agent } = await seedPairedChat(holder.db, { chatId: OWNER_CHAT, platformUserId: OWNER_TG });
		await holder.db.query('INSERT INTO agent_sniper_strategies (agent_id) VALUES ($1)', [agent.id]);
		const { bot, drain } = setup();
		await queueUpdate(message('/pause'));
		await drain();

		const meta = await agentMeta(agent.id);
		expect(meta.spend_limits.frozen).toBe(true);
		expect(meta.trade_limits.kill_switch).toBe(true);
		expect((await holder.db.query('SELECT kill_switch FROM agent_sniper_strategies'))[0].kill_switch).toBe(true);
		const text = bot.of('sendMessage')[0].payload.text;
		expect(text).toContain('Paused Test Agent.');
		expect(text).toContain('can only be lifted on the web');
	});

	it('/kill freezes every agent, engages the strategy kill switch and denies every pending approval', async () => {
		const { user, agent } = await seedPairedChat(holder.db, { chatId: OWNER_CHAT, platformUserId: OWNER_TG });
		const [second] = await holder.db.query("INSERT INTO agent_identities (user_id, name) VALUES ($1, 'Second Agent') RETURNING id", [user.id]);
		const a = await seedApproval({ userId: user.id, agentId: agent.id });
		const b = await seedApproval({ userId: user.id, agentId: second.id });
		const { bot, drain } = setup();
		await queueUpdate(message('/kill'));
		await drain();

		for (const id of [agent.id, second.id]) {
			const meta = await agentMeta(id);
			expect(meta.spend_limits.frozen).toBe(true);
			expect(meta.trade_limits.kill_switch).toBe(true);
		}
		const [kill] = await holder.db.query('SELECT engaged FROM strategy_kill_switch WHERE owner_id = $1', [user.id]);
		expect(kill.engaged).toBe(true);
		for (const r of [a, b]) expect(await approvalRow(r.id)).toMatchObject({ status: 'denied', decided_via: 'telegram' });
		const text = bot.of('sendMessage')[0].payload.text;
		expect(text).toContain('Kill switch engaged on 2 agents.');
		expect(text).toContain('2 pending approvals denied.');
		expect(holder.executed).toEqual([]);
	});
});
