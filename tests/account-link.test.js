// Account linking: Telegram payload verification and replay, magic-link
// claim/complete, link-code claim/decide, and the payout-wallet policy.
// The database is replaced by a scripted tagged-template fake; hashing and
// HMAC checks are real.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash, createHmac } from 'node:crypto';

process.env.JWT_SECRET ||= 'vitest-ephemeral-jwt-secret-00000000000000';

const queue = [];
const calls = [];
vi.mock('../api/_lib/db.js', () => ({
	sql: Object.assign(
		async (strings, ...vals) => {
			calls.push({ text: strings.join('?'), vals });
			const next = queue.shift();
			return typeof next === 'function' ? next() : (next ?? []);
		},
		{ json: (v) => v },
	),
}));
vi.mock('../api/_lib/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('../api/_lib/identities.js', () => ({
	findUserByIdentity: vi.fn(async () => null),
	linkIdentity: vi.fn(async () => ({ relinked: false })),
	touchIdentity: vi.fn(),
	IdentityError: class IdentityError extends Error {},
}));
vi.mock('../api/_lib/gateway/bots.js', () => ({
	telegramConfigured: () => true,
	telegramUsername: async () => 'three_ws_bot',
}));

const { findUserByIdentity } = await import('../api/_lib/identities.js');
const tl = await import('../api/_lib/account-link/telegram-login.js');
const lc = await import('../api/_lib/account-link/link-codes.js');
const ew = await import('../api/_lib/account-link/external-wallets.js');

const TOKEN = '123456:TEST-bot-token';
const env = { TELEGRAM_BOT_TOKEN: TOKEN };
const NOW = Date.UTC(2026, 9, 10, 12, 0, 0);

function sign(fields, token = TOKEN) {
	const lines = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
	const hash = createHmac('sha256', createHash('sha256').update(token).digest()).update(lines).digest('hex');
	return { ...fields, hash };
}
const fresh = (over = {}) => sign({ id: '42', first_name: 'Ada', username: 'ada', auth_date: String(NOW / 1000 - 30), ...over });

beforeEach(() => {
	queue.length = 0;
	calls.length = 0;
	findUserByIdentity.mockReset();
	findUserByIdentity.mockResolvedValue(null);
});

describe('telegram widget payload', () => {
	it('accepts a correctly signed fresh payload', () => {
		const out = tl.verifyWidgetPayload(fresh(), { env, now: NOW });
		expect(out.claims.subject).toBe('42');
		expect(out.claims.username).toBe('ada');
	});

	it('rejects a tampered field', () => {
		const p = fresh();
		p.id = '43';
		expect(() => tl.verifyWidgetPayload(p, { env, now: NOW })).toThrow(expect.objectContaining({ code: 'invalid_hash' }));
	});

	it('rejects a payload signed with another bot token', () => {
		expect(() => tl.verifyWidgetPayload(fresh({}) && sign({ id: '42', auth_date: String(NOW / 1000) }, 'other:token'), { env, now: NOW }))
			.toThrow(expect.objectContaining({ code: 'invalid_hash' }));
	});

	it('rejects a missing or malformed hash', () => {
		expect(() => tl.verifyWidgetPayload({ id: '42', auth_date: '1' }, { env, now: NOW })).toThrow(expect.objectContaining({ code: 'invalid_hash' }));
	});

	it('rejects a stale payload outside the freshness window', () => {
		const old = sign({ id: '42', auth_date: String(NOW / 1000 - tl.WIDGET_MAX_AGE_SEC - 1) });
		expect(() => tl.verifyWidgetPayload(old, { env, now: NOW })).toThrow(expect.objectContaining({ code: 'stale' }));
	});

	it('rejects a payload dated in the future', () => {
		const future = sign({ id: '42', auth_date: String(NOW / 1000 + 3600) });
		expect(() => tl.verifyWidgetPayload(future, { env, now: NOW })).toThrow(expect.objectContaining({ code: 'invalid_payload' }));
	});

	it('refuses everything when no bot token is configured', () => {
		expect(() => tl.verifyWidgetPayload(fresh(), { env: {}, now: NOW })).toThrow(expect.objectContaining({ code: 'not_configured' }));
	});

	it('treats the second use of the same payload as a replay', async () => {
		queue.push([], [{ payload_hash: 'h' }]);
		await tl.recordWidgetPayload('h', new Date(NOW));
		queue.push([], []);
		await expect(tl.recordWidgetPayload('h', new Date(NOW))).rejects.toMatchObject({ code: 'replayed', status: 409 });
	});
});

describe('telegram magic link', () => {
	const token = `tl_${'a'.repeat(43)}`;
	const from = { id: 42, first_name: 'Ada', username: 'ada' };
	const priv = { id: 42, type: 'private' };

	it('rejects tokens that do not have the magic shape', async () => {
		expect(await tl.claimMagicToken({ token: 'nope', from, chat: priv })).toEqual({ ok: false, reason: 'invalid' });
		expect(calls).toHaveLength(0);
	});

	it('refuses to claim from a group chat', async () => {
		expect(await tl.claimMagicToken({ token, from, chat: { id: -1, type: 'group' } })).toEqual({ ok: false, reason: 'group' });
	});

	it('a second tap (or an expired token) claims nothing', async () => {
		queue.push([]);
		expect(await tl.claimMagicToken({ token, from, chat: priv })).toEqual({ ok: false, reason: 'expired' });
	});

	it('a link token cannot attach a Telegram account owned by someone else', async () => {
		queue.push([{ id: 'row1', intent: 'link', user_id: 'u1' }], []);
		findUserByIdentity.mockResolvedValue({ id: 'u2' });
		expect(await tl.claimMagicToken({ token, from, chat: priv })).toEqual({ ok: false, reason: 'in_use' });
	});

	it('completing a link from a different signed-in account is refused and burns the token', async () => {
		queue.push([{ id: 'row1', intent: 'link', user_id: 'u1', claims: { subject: '42' } }], []);
		await expect(tl.completeMagicToken({ id: 'row1', pollSecret: 's', sessionUserId: 'u2' })).rejects.toMatchObject({ code: 'wrong_account', status: 403 });
		expect(calls.some((c) => /set status = 'expired'/.test(c.text))).toBe(true);
	});

	it('completing twice finds nothing to complete', async () => {
		queue.push([]);
		await expect(tl.completeMagicToken({ id: 'row1', pollSecret: 's' })).rejects.toMatchObject({ code: 'not_claimable', status: 409 });
	});

	it('only the poll secret unlocks a token row', async () => {
		expect(await tl.readMagicToken({ id: 'row1', pollSecret: '' })).toBeNull();
		queue.push([]);
		expect(await tl.readMagicToken({ id: 'row1', pollSecret: 'wrong' })).toBeNull();
	});
});

describe('link codes', () => {
	it('normalizes case and separators and rejects junk', () => {
		expect(lc.normalizeLinkCode('bcdf ghjk')).toBe('BCDFGHJK');
		expect(lc.normalizeLinkCode('not a code')).toBeFalsy();
	});

	it('bounds a device description', () => {
		const d = lc.describeClaim({ name: `x\u0000${'y'.repeat(500)}` });
		expect(d.name.length).toBeLessThanOrEqual(80);
		expect(d.name).not.toMatch(/\u0000/);
	});

	it('an unknown code is a 404', async () => {
		queue.push([]);
		await expect(lc.claimLinkCode({ code: 'BCDF-GHJK', claim: {} })).rejects.toMatchObject({ code: 'unknown_code', status: 404 });
	});

	it('a malformed code never reaches the database', async () => {
		await expect(lc.claimLinkCode({ code: 'zzz', claim: {} })).rejects.toMatchObject({ code: 'invalid_code' });
		expect(calls).toHaveLength(0);
	});

	it('an expired code is 410', async () => {
		queue.push([{ id: 'c1', status: 'issued', device_kind: 'cli' }], []);
		await expect(lc.claimLinkCode({ code: 'BCDF-GHJK', claim: {} })).rejects.toMatchObject({ code: 'expired', status: 410 });
	});

	it('a code that was already claimed cannot be claimed again', async () => {
		queue.push([{ id: 'c1', status: 'claimed', device_kind: 'cli' }], []);
		await expect(lc.claimLinkCode({ code: 'BCDF-GHJK', claim: {} })).rejects.toMatchObject({ code: 'already_used', status: 409 });
	});

	it('a code minted for another device kind is refused', async () => {
		queue.push([{ id: 'c1', status: 'issued', device_kind: 'phone' }]);
		await expect(lc.claimLinkCode({ code: 'BCDF-GHJK', claim: {}, expectKind: 'cli' })).rejects.toMatchObject({ code: 'wrong_kind' });
	});

	it('a different account cannot decide someone else\'s request', async () => {
		queue.push([{ id: 'c1', user_id: 'owner', status: 'claimed', expires_at: new Date(Date.now() + 60000) }]);
		await expect(lc.decideLinkCode({ id: 'c1', userId: 'intruder', decision: 'confirm' })).rejects.toMatchObject({ code: 'wrong_account', status: 403 });
		expect(calls).toHaveLength(1);
	});

	it('confirming an expired request marks it expired and fails', async () => {
		queue.push([{ id: 'c1', user_id: 'u', status: 'claimed', expires_at: new Date(Date.now() - 1000) }], []);
		await expect(lc.decideLinkCode({ id: 'c1', userId: 'u', decision: 'confirm' })).rejects.toMatchObject({ code: 'expired', status: 410 });
	});

	it('a second confirm after the first finds the row decided', async () => {
		queue.push([{ id: 'c1', user_id: 'u', status: 'confirmed', expires_at: new Date(Date.now() + 60000) }]);
		await expect(lc.decideLinkCode({ id: 'c1', userId: 'u', decision: 'confirm' })).rejects.toMatchObject({ code: 'already_decided' });
	});
});

describe('payout wallet policy', () => {
	it('lets a first payout wallet through with no cooldown', async () => {
		queue.push([]);
		const p = await ew.payoutChangePolicy({ userId: 'u', chain: 'solana', address: 'A' });
		expect(p.replacing).toBe(false);
		expect(p.effectiveAt).toBe(p.approvedAt);
	});

	it('refuses to replace a live payout wallet without step-up', async () => {
		queue.push([{ address: 'OLD' }]);
		await expect(ew.payoutChangePolicy({ userId: 'u', chain: 'solana', address: 'NEW' })).rejects.toMatchObject({ code: 'step_up_required', status: 403 });
	});

	it('replaces it with step-up, but only after the 24 hour cooldown', async () => {
		queue.push([{ address: 'OLD' }]);
		const p = await ew.payoutChangePolicy({ userId: 'u', chain: 'solana', address: 'NEW', stepUp: true });
		expect(p.replacing).toBe(true);
		const wait = new Date(p.effectiveAt).getTime() - new Date(p.approvedAt).getTime();
		expect(wait).toBeGreaterThanOrEqual(ew.PAYOUT_COOLDOWN_HOURS * 3600 * 1000 - 1000);
	});

	it('a proof with an unknown nonce is rejected', async () => {
		queue.push([]);
		await expect(ew.verifyWalletProof({ userId: 'u', chain: 'solana', message: 'm', signature: 's' })).rejects.toBeInstanceOf(ew.ExternalWalletError);
	});
});
