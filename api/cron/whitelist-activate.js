// GET /api/cron/whitelist-activate - activate allowlist entries whose cooldown ended.
//
// Runs every 5 minutes. Flips pending destination-whitelist entries to active
// once activates_at has passed, applies parked loosening changes (a shorter
// cooldown, enforcement off) whose waiting period is over, and tells the owner.
// The enforcement path also activates due entries on demand, so this cron only
// guarantees the "now active" alert arrives promptly when nobody is sending.
// Library: api/_lib/destination-whitelist.js. Doc: docs/destination-whitelist.md.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { activateDue } from '../_lib/destination-whitelist.js';

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET'])) return;
	if (!requireCron(req, res)) return;
	return json(res, 200, { ok: true, ...(await activateDue()) });
});
