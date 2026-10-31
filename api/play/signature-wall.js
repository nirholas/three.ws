// /api/play/signature-wall: the persistent signature wall near spawn in the $THREE
// /play world.
//
//   GET    ?offset=0&limit=60      newest-first page by rank   -> { total, signatures }
//   GET    ?since=<no>             everything newer than <no>  -> { total, signatures }
//   GET    ?id=<id>                one signature               -> { total, signatures: [one] }
//   POST   { name, line?, playPass? | session? }               -> 201 { ok, signature, total }
//   DELETE ?id=<id>   (Authorization: Bearer $CRON_SECRET)     -> { ok, removed }
//
// Identity: a signed-in wallet presents its play pass (HMAC-verified here) and signs
// once, ever. A guest presents a client-minted session id and signs once per session.
// The wallet address is used only as a claim key; the stored and returned record
// carries display text only. Storage and the idempotency claims live in
// api/_lib/signature-wall-store.js.
import { z } from 'zod';
import { cors, error, json, method, readJson, wrap, rateLimited } from '../_lib/http.js';
import { clientIp, limits } from '../_lib/rate-limit.js';
import { requireCron } from '../_lib/cron-auth.js';
import { verifyPlayPass } from '../_lib/play-pass.js';
import {
	WallError, validateSignature, addSignature, removeSignature,
	listByOffset, listSince, getSignature, countSignatures,
} from '../_lib/signature-wall-store.js';

const postSchema = z.object({
	name: z.string().max(200),
	line: z.string().max(400).optional().default(''),
	playPass: z.string().trim().min(16).max(4096).optional(),
	session: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).optional(),
});

const ID_RE = /^[A-Za-z0-9]{8,32}$/;
const STATUS = {
	name_required: 400, no_links: 400, not_allowed: 400,
	already_signed: 409, unavailable: 503,
};

function sendWallError(res, err) {
	const status = STATUS[err.code] || 400;
	return error(res, status, err.code, err.message, err.extra || {});
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,DELETE,OPTIONS' })) return;
	if (!method(req, res, ['GET', 'POST', 'DELETE'])) return;

	if (req.method === 'GET') {
		const rl = await limits.publicIp(clientIp(req));
		if (!rl.success) return rateLimited(res, rl);
		const q = req.query || {};
		try {
			let signatures;
			if (q.id != null) {
				const id = String(q.id);
				if (!ID_RE.test(id)) return error(res, 400, 'bad_id', 'invalid signature id');
				const one = await getSignature(id);
				signatures = one ? [one] : [];
				res.setHeader('cache-control', 'public, max-age=30');
			} else if (q.since != null) {
				const since = Number(q.since);
				if (!Number.isFinite(since) || since < 0) return error(res, 400, 'bad_since', 'since must be a signature number');
				signatures = await listSince(since);
				// Short on purpose: this is the live catch-up the room ping triggers.
				res.setHeader('cache-control', 'public, max-age=1, stale-while-revalidate=4');
			} else {
				const offset = Number(q.offset ?? 0);
				const limit = Number(q.limit ?? 60);
				if (!Number.isFinite(offset) || !Number.isFinite(limit) || offset < 0 || limit < 1) {
					return error(res, 400, 'bad_page', 'offset and limit must be positive numbers');
				}
				signatures = await listByOffset(offset, limit);
				res.setHeader('cache-control', 'public, max-age=10, stale-while-revalidate=30');
			}
			return json(res, 200, { total: await countSignatures(), signatures });
		} catch (err) {
			if (err instanceof WallError) return sendWallError(res, err);
			console.error('[play/signature-wall] read failed:', err?.message);
			return error(res, 502, 'read_failed', 'could not load the wall');
		}
	}

	res.setHeader('cache-control', 'no-store');

	if (req.method === 'DELETE') {
		if (!requireCron(req, res)) return;
		const id = String(req.query?.id || '');
		if (!ID_RE.test(id)) return error(res, 400, 'bad_id', 'invalid signature id');
		try {
			const removed = await removeSignature(id);
			return json(res, removed ? 200 : 404, { ok: removed, removed, total: await countSignatures() });
		} catch (err) {
			if (err instanceof WallError) return sendWallError(res, err);
			console.error('[play/signature-wall] remove failed:', err?.message);
			return error(res, 502, 'remove_failed', 'could not remove that signature');
		}
	}

	// POST: sign the wall.
	const rl = await limits.sigwallSignIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl, 'signing too fast, try again shortly');

	const parsed = postSchema.safeParse(await readJson(req, 8_000).catch(() => null));
	if (!parsed.success) return error(res, 400, 'validation_error', 'a name is required to sign the wall');
	const { name, line, playPass, session } = parsed.data;

	let identity;
	if (playPass) {
		const pass = verifyPlayPass(playPass);
		if (!pass) return error(res, 401, 'pass_invalid', 'Your sign-in expired. Sign in again to sign the wall.');
		identity = { wallet: pass.wallet };
	} else if (session) {
		identity = { session };
	} else {
		return error(res, 400, 'validation_error', 'a session or sign-in is required to sign the wall');
	}

	try {
		const clean = validateSignature({ name, line });
		const signature = await addSignature(clean, identity);
		return json(res, 201, { ok: true, signature, total: await countSignatures() });
	} catch (err) {
		if (err instanceof WallError) return sendWallError(res, err);
		console.error('[play/signature-wall] sign failed:', err?.message);
		return error(res, 502, 'sign_failed', 'could not sign the wall, try again');
	}
});
