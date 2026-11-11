// POST /api/microsoft-marketplace/leads/<token>
//
// The HTTPS endpoint lead destination for every Microsoft Marketplace offer
// (Partner Center > offer > Offer setup > Customer leads > HTTPS endpoint).
// vercel.json rewrites the token path segment to ?token=. Partner Center does
// not sign leads, so the long random token (MS_MARKETPLACE_LEADS_TOKEN) is the
// credential; without it configured the endpoint refuses everything.
//
// Order of work: per-IP rate limit, token, body validation, idempotent store,
// then the owner notification and the drafted reply. Once the row exists the
// answer is 200 no matter what follows, so Partner Center never retries a lead
// that is already safe; anything unfinished is picked up by
// api/cron/microsoft-leads.js. Runbook: docs/ops/microsoft-marketplace-leads.md.

import { cors, method, wrap, error, json, readBody, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { leadsToken, leadTokenMatches, validateLeadPayload, storeLead, processNewLead } from '../_lib/microsoft-leads.js';

const MAX_BODY_BYTES = 64 * 1024;

async function readLeadBody(req) {
	// Partner Center's content type is not documented, so the body is parsed as
	// JSON whatever header it carries.
	const buf = await readBody(req, MAX_BODY_BYTES);
	try {
		return JSON.parse(buf.toString('utf8'));
	} catch {
		throw Object.assign(new Error('the lead body is not valid JSON'), { status: 400 });
	}
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;
	res.setHeader('cache-control', 'no-store');

	const rl = await limits.msMarketplaceLeadIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl, 'too many lead posts from this address');

	const expected = leadsToken();
	if (!expected) {
		return error(res, 503, 'not_configured', 'MS_MARKETPLACE_LEADS_TOKEN is not set, so this lead destination accepts nothing');
	}
	if (!leadTokenMatches(String(req.query?.token || ''), expected)) {
		return error(res, 401, 'invalid_token', 'the lead destination URL is missing its token or the token is wrong');
	}

	let body;
	try {
		body = await readLeadBody(req);
	} catch (err) {
		return error(res, err.status || 400, 'invalid_lead', err.message);
	}
	const check = validateLeadPayload(body);
	if (!check.ok) return error(res, 400, 'invalid_lead', check.errors.join('; '));

	const { inserted, lead } = await storeLead(body);
	if (inserted) {
		try {
			await processNewLead(lead);
		} catch (err) {
			console.error('[microsoft-leads] post-store work failed, the cron will retry:', err?.message);
		}
	}
	return json(res, 200, { ok: true, id: lead.id, duplicate: !inserted });
});
