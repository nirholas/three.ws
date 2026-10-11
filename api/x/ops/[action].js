// @ts-check
// X mention-bot operator console API: /api/x/ops/{list,status,pause,resume,block,unblock,send}.
//
//   GET  /api/x/ops/list?account_kind=&account_ref=&intent=&decision=&dry_run=&author_id=&limit=&offset=
//   GET  /api/x/ops/status
//   POST /api/x/ops/pause
//   POST /api/x/ops/resume
//   POST /api/x/ops/block   { author_id }
//   POST /api/x/ops/unblock { author_id }
//   POST /api/x/ops/send    { tweet_id }   (owner action: posts one dry-run reply live)
//
// Admin only, every action: this reads every account's mention text and reply
// content, and `send` can post to X, so requireAdmin runs before anything
// else, including the read-only actions. Mutations also need the double-
// submit CSRF token (requireCsrf) and are attributed in audit_log (logAudit),
// the same combination api/spotlight/[action].js uses for its one admin
// action (moderate).
//
// `send` is the one action that reaches X for real. It only ever posts a
// reply that was already composed and recorded with dry_run = true; nothing
// here re-derives a reply from a mention's text, and a mention's text is
// never treated as an instruction (x-grok design rule 1). The page this API
// serves renders a public-posting confirmation before calling it; this
// handler does not re-confirm, it trusts the admin session and CSRF token the
// same way every other admin mutation on this platform does.

import { cors, error, json, method, readJson, wrap } from '../../_lib/http.js';
import { requireAdmin } from '../../_lib/admin.js';
import { requireCsrf } from '../../_lib/csrf.js';
import { logAudit } from '../../_lib/audit.js';
import { ACCOUNT_KINDS, DECISIONS, MentionStoreError, adminCountMentions, adminListMentions } from '../../_lib/x-mention-store.js';
import { INTENTS } from '../../_lib/x-mention-intents.js';
import {
	MentionAdminError,
	blockAuthor,
	isPaused,
	loadBlocklist,
	sendDryRunReply,
	setPaused,
	unblockAuthor,
} from '../../_lib/x-mention-admin.js';

function mentionRow(r) {
	return {
		tweet_id: r.tweet_id,
		account_kind: r.account_kind,
		account_ref: r.account_ref,
		author_id: r.author_id,
		author_username: r.author_username,
		mention_text: r.mention_text,
		intent: r.intent,
		decision: r.decision,
		reason: r.reason,
		reply_text: r.reply_text,
		reply_media_url: r.reply_media_url,
		reply_link: r.reply_link,
		reply_tweet_id: r.reply_tweet_id,
		dry_run: r.dry_run,
		error: r.error,
		created_at: r.created_at,
		decided_at: r.decided_at,
		replied_at: r.replied_at,
	};
}

function parseBool(v) {
	if (v == null || v === '') return null;
	return v === '1' || v === 'true';
}

// ── reads ────────────────────────────────────────────────────────────────────

/** GET /api/x/ops/list */
async function handleList(req, res) {
	const url = new URL(req.url, 'http://x');
	const q = url.searchParams;
	const accountKind = q.get('account_kind') || null;
	if (accountKind != null && !ACCOUNT_KINDS.includes(accountKind)) {
		return error(res, 400, 'validation_error', `account_kind must be one of ${ACCOUNT_KINDS.join(', ')}`);
	}
	const intent = q.get('intent') || null;
	if (intent != null && !INTENTS.includes(intent)) {
		return error(res, 400, 'validation_error', `intent must be one of ${INTENTS.join(', ')}`);
	}
	const decision = q.get('decision') || null;
	if (decision != null && !DECISIONS.includes(decision)) {
		return error(res, 400, 'validation_error', `decision must be one of ${DECISIONS.join(', ')}`);
	}
	const filters = {
		accountKind,
		accountRef: q.get('account_ref') || null,
		intent,
		decision,
		dryRun: parseBool(q.get('dry_run')),
		authorId: q.get('author_id') || null,
	};
	const limit = Math.min(Math.max(Number(q.get('limit')) || 50, 1), 200);
	const offset = Math.max(Number(q.get('offset')) || 0, 0);

	const [rows, total] = await Promise.all([
		adminListMentions({ ...filters, limit, offset }),
		adminCountMentions(filters),
	]);
	return json(res, 200, { mentions: rows.map(mentionRow), total, limit, offset });
}

/** GET /api/x/ops/status: the kill switch and blocklist, for the console's header. */
async function handleStatus(_req, res) {
	const [paused, blocklist] = await Promise.all([isPaused(), loadBlocklist()]);
	return json(res, 200, { paused, blocklist });
}

// ── mutations ────────────────────────────────────────────────────────────────

/** POST /api/x/ops/pause */
async function handlePause(req, res, admin) {
	if (!(await requireCsrf(req, res, admin.id))) return;
	await setPaused(true);
	logAudit({ userId: admin.id, action: 'x_mention_bot_pause', req });
	return json(res, 200, { paused: true });
}

/** POST /api/x/ops/resume */
async function handleResume(req, res, admin) {
	if (!(await requireCsrf(req, res, admin.id))) return;
	await setPaused(false);
	logAudit({ userId: admin.id, action: 'x_mention_bot_resume', req });
	return json(res, 200, { paused: false });
}

/** POST /api/x/ops/block { author_id } */
async function handleBlock(req, res, admin) {
	if (!(await requireCsrf(req, res, admin.id))) return;
	const body = await readJson(req).catch(() => null);
	const authorId = String(body?.author_id || '').trim();
	if (!authorId) return error(res, 400, 'validation_error', 'author_id is required');
	const blocklist = await blockAuthor(authorId);
	logAudit({ userId: admin.id, action: 'x_mention_block_author', resourceId: authorId, req });
	return json(res, 200, { blocklist });
}

/** POST /api/x/ops/unblock { author_id } */
async function handleUnblock(req, res, admin) {
	if (!(await requireCsrf(req, res, admin.id))) return;
	const body = await readJson(req).catch(() => null);
	const authorId = String(body?.author_id || '').trim();
	if (!authorId) return error(res, 400, 'validation_error', 'author_id is required');
	const blocklist = await unblockAuthor(authorId);
	logAudit({ userId: admin.id, action: 'x_mention_unblock_author', resourceId: authorId, req });
	return json(res, 200, { blocklist });
}

/**
 * POST /api/x/ops/send { tweet_id }
 * The owner action: posts one dry-run reply to X for real. The confirmation
 * (what this will post, and to whom) is rendered by the page before this is
 * ever called; this is the step that actually reaches X.
 */
async function handleSend(req, res, admin) {
	if (!(await requireCsrf(req, res, admin.id))) return;
	const body = await readJson(req).catch(() => null);
	const tweetId = String(body?.tweet_id || '').trim();
	if (!tweetId) return error(res, 400, 'validation_error', 'tweet_id is required');
	const row = await sendDryRunReply({ tweetId });
	logAudit({ userId: admin.id, action: 'x_mention_send_live', resourceId: tweetId, req });
	return json(res, 200, { mention: mentionRow(row) });
}

// ── dispatcher ───────────────────────────────────────────────────────────────

const DISPATCH = {
	list: { methods: ['GET'], fn: handleList },
	status: { methods: ['GET'], fn: handleStatus },
	pause: { methods: ['POST'], fn: handlePause },
	resume: { methods: ['POST'], fn: handleResume },
	block: { methods: ['POST'], fn: handleBlock },
	unblock: { methods: ['POST'], fn: handleUnblock },
	send: { methods: ['POST'], fn: handleSend },
};

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;

	const action = req.query?.action ?? new URL(req.url, 'http://x').pathname.split('/').pop();
	const route = DISPATCH[action];
	if (!route) return error(res, 404, 'not_found', `unknown x ops action: ${action}`);
	if (!method(req, res, route.methods)) return;

	// Admin before anything else, including the read-only actions: this console
	// shows every account's mention and reply text, and `send` can post to X.
	const admin = await requireAdmin(req, res);
	if (!admin) return;

	try {
		return await route.fn(req, res, admin);
	} catch (err) {
		if (err instanceof MentionAdminError) return error(res, err.status, err.code, err.message);
		if (err instanceof MentionStoreError) return error(res, 400, err.code, err.message);
		throw err;
	}
});
