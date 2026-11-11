// GET /api/cron/microsoft-partner-center (daily, Cloud Scheduler)
//
// Ingests the Partner Center commercial marketplace analytics reports (orders,
// metered usage, customers) into microsoft_partner_center_rows for
// /admin/microsoft. Logic: api/_lib/microsoft-partner-center.js. Without the
// Marketplace publisher credentials it answers 200 with reason not_configured;
// a missing Partner Center role is recorded per dataset and shown on the board.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { ingestPartnerCenter } from '../_lib/microsoft-partner-center.js';

export const maxDuration = 120;

export default wrapCron(async (req, res) => {
	if (!method(req, res, 'GET')) return;
	if (!requireCron(req, res)) return;
	const result = await ingestPartnerCenter();
	return json(res, 200, result);
});
