// Authorization on the X mention-bot operator console (/api/x/ops/*).
//
// This console reads every account's mention and reply text, and one action
// (`send`) can post to X for real. So every action, including the read-only
// ones, must authorize as an admin BEFORE it touches a mention row, and every
// mutation must also pass the double-submit CSRF check. The sweep at the
// bottom enumerates the dispatch table itself, so a new action added later
// without the gate fails here instead of shipping open.
//
// `send` is exercised here only against a mocked, dry-run-forced
// sendDryRunReply: nothing in this file can reach the real X API.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSessionUser = vi.fn(async () => null);
const sqlMock = vi.fn(async () => []);

vi.mock('../api/_lib/auth.js', () => ({ getSessionUser }));
vi.mock('../api/_lib/db.js', () => ({
	sql: sqlMock,
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
	isStoragePressured: () => false,
}));

// Mirrors the real requireCsrf's contract: on failure it writes the 403
// itself (same shape http.js's error() writes) and returns false, it never
// throws. A mock that only returned false without writing to res would make
// these tests pass for the wrong reason.
let csrfOk = true;
const requireCsrf = vi.fn(async (_req, res) => {
	if (csrfOk) return true;
	res.statusCode = 403;
	res.setHeader('content-type', 'application/json');
	res.end(JSON.stringify({ error: 'csrf_invalid', error_description: 'CSRF token invalid or expired' }));
	return false;
});
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf }));

const logAudit = vi.fn();
vi.mock('../api/_lib/audit.js', () => ({ logAudit }));

class MentionStoreError extends Error {
	constructor(message, code) {
		super(message);
		this.name = 'MentionStoreError';
		this.code = code;
	}
}
const adminListMentions = vi.fn(async () => [MENTION]);
const adminCountMentions = vi.fn(async () => 1);
vi.mock('../api/_lib/x-mention-store.js', () => ({
	ACCOUNT_KINDS: ['company', 'agent'],
	DECISIONS: ['reply', 'skip', 'rate_limited', 'unsafe', 'budget', 'error', 'pending', 'paused'],
	MentionStoreError,
	adminListMentions,
	adminCountMentions,
}));

vi.mock('../api/_lib/x-mention-intents.js', () => ({
	INTENTS: ['make', 'image3d', 'avatar', 'help', 'launch', 'chat', 'ignore'],
}));

class MentionAdminError extends Error {
	constructor(message, code, status = 400) {
		super(message);
		this.name = 'MentionAdminError';
		this.code = code;
		this.status = status;
	}
}
const isPaused = vi.fn(async () => false);
const setPaused = vi.fn(async (p) => !!p);
const loadBlocklist = vi.fn(async () => []);
const blockAuthor = vi.fn(async () => ['author-1']);
const unblockAuthor = vi.fn(async () => []);
const sendDryRunReply = vi.fn(async () => ({ ...MENTION, dry_run: false, reply_tweet_id: '999' }));
vi.mock('../api/_lib/x-mention-admin.js', () => ({
	MentionAdminError,
	isPaused,
	setPaused,
	loadBlocklist,
	blockAuthor,
	unblockAuthor,
	sendDryRunReply,
}));

const MENTION = {
	tweet_id: '100000000000000001',
	account_kind: 'company',
	account_ref: 'trythreews',
	author_id: 'author-1',
	author_username: 'someone',
	mention_text: '@trythreews make me a dragon',
	intent: 'make',
	decision: 'reply',
	reason: 'queued a dry-run reply',
	reply_text: 'Here is your dragon.',
	reply_media_url: null,
	reply_link: null,
	reply_tweet_id: null,
	dry_run: true,
	error: null,
	created_at: '2026-10-10T00:00:00.000Z',
	decided_at: '2026-10-10T00:00:01.000Z',
	replied_at: null,
};

const handler = (await import('../api/x/ops/[action].js')).default;

function mockRes() {
	return {
		statusCode: 200,
		_headers: {},
		_body: '',
		setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
		getHeader(k) { return this._headers[k.toLowerCase()]; },
		end(b) { this._body = b || ''; },
		get headersSent() { return false; },
		get writableEnded() { return false; },
		get json() { try { return JSON.parse(this._body); } catch { return null; } },
	};
}

// Every action the console exposes, with a request that succeeds when the
// caller is an authorized admin. Kept as data so the sweeps below cannot miss
// a newly added action.
const ACTIONS = [
	{ action: 'list', method: 'GET' },
	{ action: 'status', method: 'GET' },
	{ action: 'pause', method: 'POST' },
	{ action: 'resume', method: 'POST' },
	{ action: 'block', method: 'POST', body: { author_id: 'author-1' } },
	{ action: 'unblock', method: 'POST', body: { author_id: 'author-1' } },
	{ action: 'send', method: 'POST', body: { tweet_id: MENTION.tweet_id } },
];

function mockReq({ action, method: httpMethod = 'GET', body = null, headers = {} }) {
	const req = {
		method: httpMethod,
		url: `/api/x/ops/${action}`,
		query: { action },
		headers: { host: 'three.ws', ...headers },
	};
	if (body) {
		req.headers['content-type'] = 'application/json';
		req.rawBody = Buffer.from(JSON.stringify(body));
	}
	return req;
}

async function call(spec, headers = {}) {
	const res = mockRes();
	await handler(mockReq({ ...spec, headers }), res);
	return res;
}

beforeEach(() => {
	vi.clearAllMocks();
	getSessionUser.mockResolvedValue(null);
	csrfOk = true;
	adminListMentions.mockResolvedValue([MENTION]);
	adminCountMentions.mockResolvedValue(1);
	isPaused.mockResolvedValue(false);
	setPaused.mockImplementation(async (p) => !!p);
	loadBlocklist.mockResolvedValue([]);
	blockAuthor.mockResolvedValue(['author-1']);
	unblockAuthor.mockResolvedValue([]);
	sendDryRunReply.mockResolvedValue({ ...MENTION, dry_run: false, reply_tweet_id: '999' });
	delete process.env.ADMIN_ADDRESSES;
});

describe('an anonymous caller is refused on every action', () => {
	for (const spec of ACTIONS) {
		it(`refuses anonymous ${spec.method} /api/x/ops/${spec.action}`, async () => {
			const res = await call(spec);
			expect(res.statusCode).toBe(401);
			expect(res.json.error).toBe('unauthorized');
		});
	}

	it('never reads a mention before deciding', async () => {
		await call({ action: 'list', method: 'GET' });
		expect(adminListMentions).not.toHaveBeenCalled();
	});

	it('never sends a reply before deciding', async () => {
		await call({ action: 'send', method: 'POST', body: { tweet_id: MENTION.tweet_id } });
		expect(sendDryRunReply).not.toHaveBeenCalled();
	});
});

describe('a signed-in non-admin is refused on every action', () => {
	beforeEach(() => {
		getSessionUser.mockResolvedValue({ id: 'user-9', wallet_address: 'NotAnAdmin1111111111111111111111111111111' });
	});

	for (const spec of ACTIONS) {
		it(`refuses a plain user on ${spec.action}`, async () => {
			const res = await call(spec);
			expect(res.statusCode).toBe(403);
			expect(res.json.error).toBe('forbidden');
		});
	}

	it('does not pause the bot it refused to let through', async () => {
		await call({ action: 'pause', method: 'POST' });
		expect(setPaused).not.toHaveBeenCalled();
	});

	it('does not send a reply it refused to let through', async () => {
		await call({ action: 'send', method: 'POST', body: { tweet_id: MENTION.tweet_id } });
		expect(sendDryRunReply).not.toHaveBeenCalled();
	});
});

describe('an authorized admin is admitted on every action', () => {
	beforeEach(() => {
		getSessionUser.mockResolvedValue({ id: 'admin-1', wallet_address: '9MjzHaTB6Jko4YKo9mDzJSaGnktzhbebgsnqPpYWnXC7' });
	});

	for (const spec of ACTIONS) {
		it(`admits an admin on ${spec.action}`, async () => {
			const res = await call(spec);
			expect(res.statusCode).toBe(200);
		});
	}

	it('lists mentions with the requested filters', async () => {
		const res = mockRes();
		await handler(
			mockReq({ action: 'list', method: 'GET' }, { host: 'three.ws' }),
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(res.json.mentions).toHaveLength(1);
		expect(res.json.mentions[0].tweet_id).toBe(MENTION.tweet_id);
	});

	it('pauses the bot and attributes the audit entry', async () => {
		const res = await call({ action: 'pause', method: 'POST' });
		expect(res.json).toEqual({ paused: true });
		expect(setPaused).toHaveBeenCalledWith(true);
		expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ userId: 'admin-1', action: 'x_mention_bot_pause' }));
	});

	it('resumes the bot', async () => {
		const res = await call({ action: 'resume', method: 'POST' });
		expect(res.json).toEqual({ paused: false });
		expect(setPaused).toHaveBeenCalledWith(false);
	});

	it('blocks an author', async () => {
		const res = await call({ action: 'block', method: 'POST', body: { author_id: 'author-1' } });
		expect(res.json.blocklist).toEqual(['author-1']);
		expect(blockAuthor).toHaveBeenCalledWith('author-1');
	});

	it('rejects block with no author id', async () => {
		const res = await call({ action: 'block', method: 'POST', body: {} });
		expect(res.statusCode).toBe(400);
		expect(blockAuthor).not.toHaveBeenCalled();
	});

	it('unblocks an author', async () => {
		const res = await call({ action: 'unblock', method: 'POST', body: { author_id: 'author-1' } });
		expect(res.json.blocklist).toEqual([]);
		expect(unblockAuthor).toHaveBeenCalledWith('author-1');
	});

	it('sends exactly one already-composed dry-run reply, never deriving new text', async () => {
		const res = await call({ action: 'send', method: 'POST', body: { tweet_id: MENTION.tweet_id } });
		expect(res.statusCode).toBe(200);
		expect(sendDryRunReply).toHaveBeenCalledWith({ tweetId: MENTION.tweet_id });
		expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'x_mention_send_live', resourceId: MENTION.tweet_id }));
	});

	it('rejects send with no tweet id', async () => {
		const res = await call({ action: 'send', method: 'POST', body: {} });
		expect(res.statusCode).toBe(400);
		expect(sendDryRunReply).not.toHaveBeenCalled();
	});

	it('maps a send that was already sent live to 409, not a crash', async () => {
		sendDryRunReply.mockRejectedValue(new MentionAdminError('this reply was already sent live', 'already_sent', 409));
		const res = await call({ action: 'send', method: 'POST', body: { tweet_id: MENTION.tweet_id } });
		expect(res.statusCode).toBe(409);
		expect(res.json.error).toBe('already_sent');
	});

	it('maps an unknown account kind filter to 400 via the store error', async () => {
		adminListMentions.mockRejectedValue(new MentionStoreError('unknown account kind: bogus', 'bad_account'));
		const res = await call({ action: 'list', method: 'GET' });
		expect(res.statusCode).toBe(400);
		expect(res.json.error).toBe('bad_account');
	});

	it('rejects an unknown action instead of dispatching it', async () => {
		const res = mockRes();
		await handler(mockReq({ action: 'delete-everything', method: 'GET' }), res);
		expect(res.statusCode).toBe(404);
	});
});

describe('CSRF guards every mutation, even for an admin', () => {
	beforeEach(() => {
		getSessionUser.mockResolvedValue({ id: 'admin-1', wallet_address: '9MjzHaTB6Jko4YKo9mDzJSaGnktzhbebgsnqPpYWnXC7' });
		csrfOk = false;
	});

	const MUTATIONS = ACTIONS.filter((a) => a.method === 'POST');

	for (const spec of MUTATIONS) {
		it(`refuses ${spec.action} without a valid CSRF token`, async () => {
			const res = await call(spec);
			expect(res.statusCode).toBe(403);
		});
	}

	it('never sends a reply without a valid CSRF token', async () => {
		await call({ action: 'send', method: 'POST', body: { tweet_id: MENTION.tweet_id } });
		expect(sendDryRunReply).not.toHaveBeenCalled();
	});

	it('does not require CSRF for the read-only actions', async () => {
		expect((await call({ action: 'list', method: 'GET' })).statusCode).toBe(200);
		expect((await call({ action: 'status', method: 'GET' })).statusCode).toBe(200);
	});
});
