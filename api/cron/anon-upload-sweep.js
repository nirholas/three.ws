// @ts-check
// GET /api/cron/anon-upload-sweep: enforces the declared size on anonymous
// presigned PUT uploads. presignUpload() cannot sign ContentLength (it breaks the
// CORS preflight), so this hourly sweep lists each anonymous prefix, HEAD-checks
// anything over its ceiling (api/_lib/anon-upload-limits.js) and deletes it.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { listObjectsPage, headObject, deleteObject, objectStorageConfigured } from '../_lib/r2.js';
import { sweepAnonUploads } from '../_lib/anon-upload-sweep.js';

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;
	if (!objectStorageConfigured()) {
		return json(res, 200, { ok: true, skipped: 'storage_unconfigured' });
	}
	const summary = await sweepAnonUploads({ listObjectsPage, headObject, deleteObject });
	return json(res, 200, { ok: true, ...summary });
});
