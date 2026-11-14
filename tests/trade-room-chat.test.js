import { describe, it, expect, vi } from 'vitest';

vi.mock('../api/_lib/db.js', () => ({ sql: () => Promise.resolve([]) }));

const {
	cleanBody, validateBody, publicName, shapeMessage, canRemove, chatCursor, isMissingTable,
	CHAT_MAX_LEN, CHAT_CURSOR_MAX_AGE_MS,
} = await import('../api/_lib/trade-room-chat.js');

const OWNER = '00000000-0000-0000-0000-00000000000a';
const FAN = '00000000-0000-0000-0000-00000000000b';

function row(over = {}) {
	return {
		id: '11111111-2222-3333-4444-555555555555',
		user_id: FAN,
		body: 'nice entry',
		created_at: '2026-11-14T12:00:00.123456Z',
		author_display_name: 'Ada',
		author_username: 'ada',
		author_avatar_url: null,
		...over,
	};
}

describe('cleanBody', () => {
	it('trims, collapses spaces and turns control characters into spaces', () => {
		expect(cleanBody('  gm \t\n  frens\u0007 ')).toBe('gm frens');
	});
	it('strips zero-width and bidi override characters', () => {
		expect(cleanBody('a​b‮c')).toBe('a b c');
	});
	it('returns an empty string for non-strings', () => {
		expect(cleanBody(null)).toBe('');
		expect(cleanBody(42)).toBe('');
	});
});

describe('validateBody', () => {
	it('accepts and normalizes a normal message', () => {
		expect(validateBody('  wen moon  ')).toEqual({ ok: true, body: 'wen moon' });
	});
	it('rejects non-text', () => {
		expect(validateBody({ a: 1 })).toMatchObject({ ok: false, code: 'invalid_body', status: 400 });
	});
	it('rejects an empty or whitespace-only message', () => {
		expect(validateBody('   \n ')).toMatchObject({ ok: false, code: 'empty', status: 400 });
	});
	it('accepts exactly the cap and rejects one over', () => {
		expect(validateBody('a'.repeat(CHAT_MAX_LEN)).ok).toBe(true);
		expect(validateBody('a'.repeat(CHAT_MAX_LEN + 1))).toMatchObject({ ok: false, code: 'too_long' });
	});
	it('counts characters, not UTF-16 units, so emoji do not eat the cap', () => {
		expect(validateBody('😀'.repeat(CHAT_MAX_LEN)).ok).toBe(true);
	});
	it('blocks an unambiguous slur with a 422 the page can explain', () => {
		expect(validateBody('you are a faggot')).toMatchObject({ ok: false, code: 'blocked_content', status: 422 });
	});
	it('does not block ordinary crude trader talk', () => {
		expect(validateBody('this shit is going to zero, damn').ok).toBe(true);
	});
});

describe('publicName', () => {
	it('prefers display name, then username, then Anonymous', () => {
		expect(publicName({ display_name: 'Ada', username: 'ada' })).toBe('Ada');
		expect(publicName({ display_name: ' ', username: 'ada' })).toBe('ada');
		expect(publicName({})).toBe('Anonymous');
	});
	it('caps a very long name', () => {
		expect(publicName({ display_name: 'x'.repeat(200) })).toHaveLength(40);
	});
});

describe('shapeMessage', () => {
	it('exposes the public name and ISO time but never ids or emails', () => {
		const m = shapeMessage(row({ author_email: 'a@b.c' }), { ownerId: OWNER });
		expect(m).toEqual({
			id: '11111111-2222-3333-4444-555555555555',
			body: 'nice entry',
			at: '2026-11-14T12:00:00.123Z',
			name: 'Ada',
			avatar: null,
			is_owner: false,
		});
		expect(JSON.stringify(m)).not.toContain(FAN);
		expect(JSON.stringify(m)).not.toContain('a@b.c');
	});
	it('flags the room owner', () => {
		expect(shapeMessage(row({ user_id: OWNER }), { ownerId: OWNER }).is_owner).toBe(true);
	});
	it('marks `mine` only when a viewer is given', () => {
		expect(shapeMessage(row(), { viewerId: FAN }).mine).toBe(true);
		expect(shapeMessage(row(), { viewerId: OWNER }).mine).toBe(false);
		expect('mine' in shapeMessage(row())).toBe(false);
	});
});

describe('canRemove', () => {
	const message = { user_id: FAN };
	it('lets the author remove their own message', () => {
		expect(canRemove({ message, viewerId: FAN, ownerId: OWNER })).toBe('author');
	});
	it('lets the room owner hide anyone', () => {
		expect(canRemove({ message, viewerId: OWNER, ownerId: OWNER })).toBe('owner');
	});
	it('treats an owner removing their own message as the author', () => {
		expect(canRemove({ message: { user_id: OWNER }, viewerId: OWNER, ownerId: OWNER })).toBe('author');
	});
	it('refuses everyone else and signed-out viewers', () => {
		expect(canRemove({ message, viewerId: '00000000-0000-0000-0000-00000000000c', ownerId: OWNER })).toBeNull();
		expect(canRemove({ message, viewerId: null, ownerId: OWNER })).toBeNull();
	});
});

describe('chatCursor', () => {
	const now = Date.parse('2026-11-14T12:00:00Z');
	it('defaults to now when missing or unparseable', () => {
		expect(chatCursor(undefined, now)).toBe(now);
		expect(chatCursor('nope', now)).toBe(now);
	});
	it('clamps the future to now and the distant past to the cap', () => {
		expect(chatCursor('2026-11-14T13:00:00Z', now)).toBe(now);
		expect(chatCursor('2026-11-01T00:00:00Z', now)).toBe(now - CHAT_CURSOR_MAX_AGE_MS);
	});
	it('keeps a recent cursor as sent', () => {
		expect(chatCursor('2026-11-14T11:58:00Z', now)).toBe(Date.parse('2026-11-14T11:58:00Z'));
	});
});

describe('isMissingTable', () => {
	it('recognises the Postgres undefined_table code only', () => {
		expect(isMissingTable({ code: '42P01' })).toBe(true);
		expect(isMissingTable({ code: '23505' })).toBe(false);
		expect(isMissingTable(null)).toBe(false);
	});
});
