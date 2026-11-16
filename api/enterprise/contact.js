// POST /api/enterprise/contact
//
// The contact form on /enterprise. Public (a procurement reviewer has no
// account), so it is guarded by a per-IP rate limit and a honeypot field. A
// valid submission becomes a lead in the existing Microsoft Marketplace leads
// pipeline (api/_lib/microsoft-leads.js): stored once, the owner notified, a
// reply drafted, all visible at /admin/microsoft/leads under the
// "Enterprise page" source. Nothing about the request beyond the form fields
// is kept (no IP, no headers).

import { cors, method, wrap, error, json, readJson, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { validateLeadPayload, storeLead, processNewLead } from '../_lib/microsoft-leads.js';
import { buildEnterpriseLead, isHoneypotHit } from '../_lib/enterprise-contact.js';

const MAX_BODY_BYTES = 16 * 1024;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', payments: false })) return;
	if (!method(req, res, ['POST'])) return;
	res.setHeader('cache-control', 'no-store');

	const rl = await limits.enterpriseContactIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl, 'Too many messages from this network. Try again in a few minutes, or email support@three.ws.');

	let body;
	try {
		body = await readJson(req, MAX_BODY_BYTES);
	} catch (err) {
		return error(res, err.status || 400, 'invalid_body', err.message);
	}

	if (isHoneypotHit(body)) return json(res, 200, { ok: true });

	const built = buildEnterpriseLead(body);
	if (!built.ok) return error(res, 400, 'invalid_fields', 'Some fields need attention.', { fields: built.errors });
	const check = validateLeadPayload(built.lead);
	if (!check.ok) return error(res, 400, 'invalid_fields', check.errors.join('; '));

	const { inserted, lead } = await storeLead(built.lead);
	if (inserted) {
		try {
			await processNewLead(lead);
		} catch (err) {
			console.error('[enterprise-contact] post-store work failed, the cron will retry:', err?.message);
		}
	}
	return json(res, 200, { ok: true, id: lead.id, duplicate: !inserted });
});
