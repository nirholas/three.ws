// /api/event-markets/announcements: the admin review queue for Event Market
// announcement drafts. Admin only.
//   GET   ?status=draft|approved|posted|rejected   the queue
//   POST  { action: 'approve', ids: [uuid] }       approve one or a whole batch
//   POST  { action: 'edit', id, text }             edit (sends the draft back to review)
//   POST  { action: 'reject', id }
//   POST  { action: 'send', id, dry_run? }         dry run by default; a live send
//                                                  needs dry_run:false AND the flag
// The sender is api/_lib/event-markets/poster.js. Guide: docs/event-markets.md.

import { cors, error, json, method, readJson, wrap } from '../_lib/http.js';
import { requireAdmin } from '../_lib/admin.js';
import { requireCsrf } from '../_lib/csrf.js';
import { isUuid } from '../_lib/validate.js';
import { approveAnnouncements, editAnnouncement, listAnnouncements, rejectAnnouncement, ReviewError } from '../_lib/event-markets/review.js';
import { PosterError, postingEnabled, sendAnnouncement } from '../_lib/event-markets/poster.js';

const STATUSES = ['draft', 'approved', 'posting', 'posted', 'rejected'];

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;
	const admin = await requireAdmin(req, res);
	if (!admin) return;

	if (req.method === 'GET') {
		const status = new URL(req.url, 'http://x').searchParams.get('status');
		if (status && !STATUSES.includes(status)) return error(res, 400, 'validation_error', `status must be one of ${STATUSES.join(', ')}`);
		const announcements = await listAnnouncements({ status });
		return json(res, 200, { announcements, posting_enabled: postingEnabled() }, { 'cache-control': 'no-store' });
	}

	if (!(await requireCsrf(req, res, admin.id))) return;
	const body = (await readJson(req)) || {};
	try {
		switch (body.action) {
			case 'approve': {
				const ids = Array.isArray(body.ids) ? body.ids : [];
				if (!ids.length || ids.length > 50 || !ids.every(isUuid)) return error(res, 400, 'validation_error', 'ids must be 1 to 50 uuids');
				return json(res, 200, await approveAnnouncements(ids, admin.id));
			}
			case 'edit':
				if (!isUuid(body.id) || typeof body.text !== 'string') return error(res, 400, 'validation_error', 'id (uuid) and text required');
				return json(res, 200, { announcement: await editAnnouncement(body.id, body.text.trim()) });
			case 'reject':
				if (!isUuid(body.id)) return error(res, 400, 'validation_error', 'id must be a uuid');
				return json(res, 200, { announcement: await rejectAnnouncement(body.id) });
			case 'send':
				if (!isUuid(body.id)) return error(res, 400, 'validation_error', 'id must be a uuid');
				return json(res, 200, await sendAnnouncement(body.id, { dryRun: body.dry_run !== false }));
			default:
				return error(res, 400, 'validation_error', 'action must be approve, edit, reject or send');
		}
	} catch (err) {
		if (err instanceof ReviewError || err instanceof PosterError) return error(res, err.status, err.code, err.message);
		throw err;
	}
});
