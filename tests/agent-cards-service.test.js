// Service-level tests for the agent card secret path (api/_lib/cards/service.js):
// delivery seals the redemption secret encrypted at rest, a reveal needs
// confirm_reveal plus a single-use grant, the ciphertext is cleared by the
// reveal, and the secret never reaches the database, the audit trail or a log.
//
// The provider side replays responses recorded from the real Bitrefill v2 API
// (tests/fixtures/bitrefill). The database is a small in-memory emulation of
// exactly the statements the service issues against agent_identities,
// agent_cards and agent_card_events, so every row the service writes can be
// inspected after the call.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

process.env.WALLET_ENCRYPTION_KEY = 'cards-service-test-key-0123456789abcdef';
process.env.BITREFILL_API_KEY = 'test-key';

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name) => JSON.parse(readFileSync(join(here, 'fixtures/bitrefill', name), 'utf8'));

const INVOICE_ID = fx('invoice-get-delivered.json').data.id;
const ORDER_ID = fx('order-delivered.json').data.id;
const CODE = fx('order-delivered.json').data.redemption_info.code;

const AGENT_ID = '11111111-1111-4111-8111-111111111111';
const CARD_ID = '22222222-2222-4222-8222-222222222222';
const OWNER = { userId: '33333333-3333-4333-8333-333333333333', source: 'session', ip: '203.0.113.7' };

// ── in-memory database ──────────────────────────────────────────────────────

const db = { agents: [], cards: [], events: [] };
let nextEventId = 1;

const norm = (strings) => strings.join('?').replace(/\s+/g, ' ').trim();
const clone = (r) => (r ? { ...r } : r);

function runSql(strings, ...v) {
	const q = norm(strings);
	const now = new Date().toISOString();

	if (q.startsWith('SELECT id, user_id, name, meta FROM agent_identities')) {
		return db.agents.filter((a) => a.id === v[0]).map(clone);
	}
	if (q.startsWith('SELECT * FROM agent_cards WHERE id = ? AND agent_id = ?')) {
		return db.cards.filter((c) => c.id === v[0] && c.agent_id === v[1]).map(clone);
	}
	if (q.startsWith('INSERT INTO agent_card_events')) {
		const [card_id, agent_id, actor_user_id, actor_kind, event, from_status, to_status, grant_hash, grant_expires_at, ip, detail] = v;
		const row = {
			id: nextEventId++, card_id, agent_id, actor_user_id, actor_kind, event, from_status, to_status,
			grant_hash, grant_expires_at, grant_consumed_at: null, ip, detail: JSON.parse(detail), created_at: now,
		};
		db.events.push(row);
		return [{ id: row.id, created_at: now }];
	}
	if (q.startsWith('UPDATE agent_card_events SET grant_consumed_at = now()')) {
		const [hash, cardId] = v;
		const e = db.events.find((x) => x.grant_hash === hash && x.card_id === cardId
			&& !x.grant_consumed_at && new Date(x.grant_expires_at) > new Date());
		if (!e) return [];
		e.grant_consumed_at = now;
		return [{ id: e.id }];
	}
	if (q.startsWith('UPDATE agent_cards SET status = COALESCE(')) {
		const [status, provider_status, pay_signature, custody_event_id, error_code, error_message, delivered_at, id] = v;
		const c = db.cards.find((x) => x.id === id);
		Object.assign(c, {
			status: status ?? c.status,
			provider_status: provider_status ?? c.provider_status,
			pay_signature: pay_signature ?? c.pay_signature,
			custody_event_id: custody_event_id ?? c.custody_event_id,
			error_code, error_message,
			delivered_at: delivered_at ?? c.delivered_at,
			updated_at: now,
		});
		return [clone(c)];
	}
	if (q.startsWith('UPDATE agent_cards SET secret_enc = ?, secret_fields = ?')) {
		const [secret_enc, secret_fields, masked_number, redeem_instructions, expires_on, id] = v;
		const c = db.cards.find((x) => x.id === id && x.secret_enc == null && x.revealed_at == null);
		if (!c) return [];
		Object.assign(c, { secret_enc, secret_fields, masked_number, redeem_instructions, expires_on, updated_at: now });
		return [clone(c)];
	}
	if (q.startsWith('UPDATE agent_cards c SET secret_enc = NULL, revealed_at = now()')) {
		const c = db.cards.find((x) => x.id === v[0]);
		if (!c) return [];
		const sealed = c.secret_enc;
		Object.assign(c, { secret_enc: null, revealed_at: now, reveal_count: c.reveal_count + 1, updated_at: now });
		return [{ sealed, reveal_count: c.reveal_count }];
	}
	throw new Error(`unexpected SQL in card service test: ${q.slice(0, 120)}`);
}

const sqlMock = vi.fn(async (strings, ...v) => runSql(strings, ...v));
vi.mock('../api/_lib/db.js', () => ({ sql: sqlMock, isDbUnavailableError: () => false, isDbCapacityError: () => false }));

const logAuditMock = vi.fn();
vi.mock('../api/_lib/audit.js', () => ({ logAudit: logAuditMock, logAuditNow: vi.fn() }));
vi.mock('../api/_lib/agent-usdc-transfer.js', () => ({ transferUsdcGuarded: vi.fn() }));
vi.mock('../api/_lib/real-funds-agreement.js', () => ({ currentSignatureFor: vi.fn(), agreementRequirement: () => ({}) }));
vi.mock('../api/_lib/agent-wallet.js', async () => {
	const box = await import('../api/_lib/secret-box.js');
	return { encryptSecret: box.encryptSecret, decryptSecret: box.decryptSecret };
});

const cards = await import('../api/_lib/cards/service.js');

// ── recorded provider ───────────────────────────────────────────────────────

const providerCalls = [];
function recordedFetch(url, init = {}) {
	const u = new URL(url);
	const key = `${init.method || 'GET'} ${u.pathname}`;
	providerCalls.push(key);
	const routes = {
		[`GET /v2/invoices/${INVOICE_ID}`]: fx('invoice-get-delivered.json'),
		[`GET /v2/orders/${ORDER_ID}`]: fx('order-delivered.json'),
	};
	const body = routes[key] ?? { message: 'Product not found', error_code: 'not_found' };
	return Promise.resolve(new Response(JSON.stringify(body), {
		status: routes[key] ? 200 : 404, headers: { 'content-type': 'application/json' },
	}));
}

// ── console capture: the secret must never be written to any log ───────────

const logged = [];
const CONSOLE = ['log', 'info', 'warn', 'error', 'debug'];
let spies = [];

beforeEach(() => {
	db.agents = [{ id: AGENT_ID, user_id: OWNER.userId, name: 'Card test agent', meta: {} }];
	db.cards = [{
		id: CARD_ID, agent_id: AGENT_ID, user_id: OWNER.userId, provider: 'bitrefill', mode: 'sandbox',
		kind: 'gift_card', product_id: 'test-gift-card-code', product_name: 'Test Gift Card Code',
		merchant: 'Test Gift Card Code', country_code: 'US', image_url: null, face_value: '20', currency: 'USD',
		status: 'processing', quote_total_usdc: '0', quote_total_atomic: '0', quote_fee_usdc: '0',
		quote_expires_at: new Date(Date.now() + 60_000).toISOString(), pay_network: 'mainnet', pay_address: null,
		provider_invoice_id: INVOICE_ID, provider_order_id: ORDER_ID, provider_status: 'payment_confirmed',
		custody_event_id: null, pay_signature: null, masked_number: null, secret_fields: [], secret_enc: null,
		redeem_instructions: null, expires_on: null, revealed_at: null, reveal_count: 0, error_code: null,
		error_message: null, meta: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
		delivered_at: null,
	}];
	db.events = [];
	providerCalls.length = 0;
	logged.length = 0;
	sqlMock.mockClear();
	logAuditMock.mockClear();
	vi.stubGlobal('fetch', recordedFetch);
	spies = CONSOLE.map((m) => vi.spyOn(console, m).mockImplementation((...a) => { logged.push(a); }));
});

afterEach(() => {
	spies.forEach((s) => s.mockRestore());
	vi.unstubAllGlobals();
});

const card = () => db.cards[0];
const serialized = (x) => JSON.stringify(x, (_k, val) => (typeof val === 'bigint' ? String(val) : val));

/** Every place the secret could leak besides the one reveal response. */
function assertNoLeak() {
	expect(serialized(db.cards)).not.toContain(CODE);
	expect(serialized(db.events)).not.toContain(CODE);
	expect(serialized(logAuditMock.mock.calls)).not.toContain(CODE);
	expect(serialized(logged)).not.toContain(CODE);
	for (const call of sqlMock.mock.calls) {
		expect(serialized(call.slice(1))).not.toContain(CODE);
	}
}

async function deliverAndSeal() {
	return cards.refreshCard({ agentId: AGENT_ID, principal: OWNER, cardId: CARD_ID });
}

describe('delivery seals the secret', () => {
	it('stores only ciphertext, the masked number and the field names', async () => {
		const view = await deliverAndSeal();
		expect(view.status).toBe('delivered');
		expect(view.masked_number).toBe(`•••• ${CODE.slice(-4)}`);
		expect(view.secret_fields).toEqual(['code']);
		expect(view).not.toHaveProperty('secret_enc');
		expect(card().secret_enc).toMatch(/^v2:/);
		expect(card().revealed_at).toBeNull();
		assertNoLeak();
	});
});

describe('reveal', () => {
	it('returns the secret once, clears the ciphertext and logs the reveal without the value', async () => {
		await deliverAndSeal();
		const data = await cards.cardData({ agentId: AGENT_ID, principal: OWNER, cardId: CARD_ID });
		expect(serialized(data)).not.toContain(CODE);
		expect(data.preview_id.length).toBeGreaterThanOrEqual(16);
		// The grant is stored as a hash, never as the id the owner holds.
		const grant = db.events.find((e) => e.event === 'reveal_preview');
		expect(grant.grant_hash).toMatch(/^[0-9a-f]{64}$/);
		expect(serialized(db.events)).not.toContain(data.preview_id);

		const callsBefore = providerCalls.length;
		const r = await cards.revealCard({
			agentId: AGENT_ID, principal: OWNER, cardId: CARD_ID, previewId: data.preview_id, confirmReveal: true,
		});
		expect(r.secret).toEqual({ code: CODE });
		// Served from the sealed copy, not a second provider read.
		expect(providerCalls.length).toBe(callsBefore);

		expect(card().secret_enc).toBeNull();
		expect(card().revealed_at).not.toBeNull();
		expect(card().reveal_count).toBe(1);
		const revealed = db.events.find((e) => e.event === 'revealed');
		expect(revealed).toMatchObject({ actor_user_id: OWNER.userId, actor_kind: 'owner_session', ip: OWNER.ip });
		expect(revealed.detail).toMatchObject({ fields: ['code'], source: 'sealed', reveal_count: 1 });
		expect(logAuditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'cards.reveal' }));
		assertNoLeak();
	});

	it('refuses a second reveal with the spent grant and logs the refusal', async () => {
		await deliverAndSeal();
		const data = await cards.cardData({ agentId: AGENT_ID, principal: OWNER, cardId: CARD_ID });
		await cards.revealCard({ agentId: AGENT_ID, principal: OWNER, cardId: CARD_ID, previewId: data.preview_id, confirmReveal: true });

		await expect(cards.revealCard({
			agentId: AGENT_ID, principal: OWNER, cardId: CARD_ID, previewId: data.preview_id, confirmReveal: true,
		})).rejects.toMatchObject({ status: 409, code: 'preview_invalid' });
		expect(card().reveal_count).toBe(1);
		expect(db.events.filter((e) => e.event === 'reveal_refused').map((e) => e.detail.reason)).toEqual(['preview_invalid']);
		assertNoLeak();
	});

	it('refuses without confirm_reveal even with a fresh grant, and leaves the grant unspent', async () => {
		await deliverAndSeal();
		const data = await cards.cardData({ agentId: AGENT_ID, principal: OWNER, cardId: CARD_ID });
		for (const confirmReveal of [undefined, false, 'true', 1]) {
			await expect(cards.revealCard({
				agentId: AGENT_ID, principal: OWNER, cardId: CARD_ID, previewId: data.preview_id, confirmReveal,
			})).rejects.toMatchObject({ status: 400, code: 'confirm_required' });
		}
		expect(card().secret_enc).toMatch(/^v2:/);
		expect(db.events.find((e) => e.event === 'reveal_preview').grant_consumed_at).toBeNull();
		assertNoLeak();
	});

	it('refuses a reveal with no grant at all', async () => {
		await deliverAndSeal();
		await expect(cards.revealCard({ agentId: AGENT_ID, principal: OWNER, cardId: CARD_ID, confirmReveal: true }))
			.rejects.toMatchObject({ status: 400, code: 'preview_required' });
		expect(card().secret_enc).toMatch(/^v2:/);
	});

	it('a new grant plus a new confirm reveals again from the provider and never re-stores the secret', async () => {
		await deliverAndSeal();
		const first = await cards.cardData({ agentId: AGENT_ID, principal: OWNER, cardId: CARD_ID });
		await cards.revealCard({ agentId: AGENT_ID, principal: OWNER, cardId: CARD_ID, previewId: first.preview_id, confirmReveal: true });

		const second = await cards.cardData({ agentId: AGENT_ID, principal: OWNER, cardId: CARD_ID });
		expect(second.preview_id).not.toBe(first.preview_id);
		const r = await cards.revealCard({ agentId: AGENT_ID, principal: OWNER, cardId: CARD_ID, previewId: second.preview_id, confirmReveal: true });
		expect(r.secret).toEqual({ code: CODE });
		expect(card().secret_enc).toBeNull();
		expect(card().reveal_count).toBe(2);
		expect(db.events.filter((e) => e.event === 'revealed').map((e) => e.detail.source)).toEqual(['sealed', 'provider']);

		// A later status sync must not seal the secret back into the row.
		await cards.refreshCard({ agentId: AGENT_ID, principal: OWNER, cardId: CARD_ID });
		expect(card().secret_enc).toBeNull();
		assertNoLeak();
	});

	it('only the owner can open a grant', async () => {
		await deliverAndSeal();
		const stranger = { userId: '44444444-4444-4444-8444-444444444444', source: 'session' };
		await expect(cards.cardData({ agentId: AGENT_ID, principal: stranger, cardId: CARD_ID }))
			.rejects.toMatchObject({ status: 403, code: 'forbidden' });
		expect(db.events.some((e) => e.event === 'reveal_preview')).toBe(false);
	});
});
