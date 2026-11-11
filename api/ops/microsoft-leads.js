// /api/ops/microsoft-leads: the admin side of Microsoft Marketplace leads, read
// by /admin/microsoft/leads. Platform admin session required on every method.
//
//   GET   ?status=&source=&action=&q=&before=   list (newest first, 50 a page)
//                                                plus counts by status
//   GET   ?id=<uuid>                            one lead with its raw payload
//   PATCH { id, status?, owner_notes? }         follow-up status and notes
//   POST  { id, op: 'draft' }                   (re)draft the reply now
//
// Nothing here sends anything to the lead: the reply is copied by the owner.

import { cors, json, method, wrap, error, rateLimited, readJson } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { requireAdmin } from '../_lib/admin.js';
import { isSameSiteOrigin } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { draftReply, LEAD_STATUSES, LEAD_SOURCES, LEAD_ACTIONS } from '../_lib/microsoft-leads.js';

const PAGE = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LIST_COLUMNS = sql`
	id, source, action, offer_id, offer_title, first_name, last_name, company, country, job_title,
	received_at, status, status_changed_at, notified_at, draft_status, redacted_at
`;

function pick(value, allowed) {
	const v = String(value || '').trim();
	return allowed.includes(v) ? v : null;
}

async function list(q) {
	const status = pick(q.status, LEAD_STATUSES);
	const source = pick(q.source, [...LEAD_SOURCES, 'other']);
	const action = pick(q.action, LEAD_ACTIONS);
	const term = String(q.q || '').trim().slice(0, 100);
	const like = term ? `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
	const before = q.before && !Number.isNaN(Date.parse(q.before)) ? new Date(q.before) : null;

	const leads = await sql`
		select ${LIST_COLUMNS} from microsoft_marketplace_leads
		where (${status}::text is null or status = ${status})
			and (${source}::text is null or source = ${source})
			and (${action}::text is null or action = ${action})
			and (${before}::timestamptz is null or received_at < ${before})
			and (${like}::text is null or concat_ws(' ', first_name, last_name, company, offer_title, email) ilike ${like})
		order by received_at desc
		limit ${PAGE + 1}
	`;
	const counts = await sql`select status, count(*)::int as n from microsoft_marketplace_leads group by status`;
	const byStatus = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0]));
	for (const c of counts) byStatus[c.status] = c.n;
	const more = leads.length > PAGE;
	const page = more ? leads.slice(0, PAGE) : leads;
	return {
		leads: page,
		counts: byStatus,
		next_before: more ? page[page.length - 1].received_at : null,
	};
}

async function detail(id) {
	const [lead] = await sql`select * from microsoft_marketplace_leads where id = ${id}`;
	return lead || null;
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,PATCH,POST,OPTIONS' })) return;
	if (!method(req, res, ['GET', 'PATCH', 'POST'])) return;

	const rl = await limits.authedReadIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const admin = await requireAdmin(req, res);
	if (!admin) return;
	const noStore = { 'cache-control': 'private, no-store' };

	try {
		if (req.method === 'GET') {
			const id = String(req.query?.id || '');
			if (id) {
				if (!UUID_RE.test(id)) return error(res, 400, 'validation_error', 'id must be a lead id');
				const lead = await detail(id);
				if (!lead) return error(res, 404, 'not_found', 'no lead with that id');
				return json(res, 200, { lead }, noStore);
			}
			return json(res, 200, await list(req.query || {}), noStore);
		}

		if (!isSameSiteOrigin(req)) return error(res, 403, 'forbidden', 'cross-site requests are not allowed');
		const body = await readJson(req);
		const id = String(body.id || '');
		if (!UUID_RE.test(id)) return error(res, 400, 'validation_error', 'id must be a lead id');
		const lead = await detail(id);
		if (!lead) return error(res, 404, 'not_found', 'no lead with that id');

		if (req.method === 'PATCH') {
			const status = body.status === undefined ? null : pick(body.status, LEAD_STATUSES);
			if (body.status !== undefined && !status) {
				return error(res, 400, 'validation_error', `status must be one of ${LEAD_STATUSES.join(', ')}`);
			}
			const hasNotes = typeof body.owner_notes === 'string';
			const notes = hasNotes ? body.owner_notes.slice(0, 5000) : null;
			const [updated] = await sql`
				update microsoft_marketplace_leads set
					status = coalesce(${status}, status),
					status_changed_at = case when ${status}::text is not null and ${status} <> status then now() else status_changed_at end,
					owner_notes = case when ${hasNotes} then ${notes} else owner_notes end,
					updated_at = now()
				where id = ${id}
				returning *
			`;
			return json(res, 200, { lead: updated }, noStore);
		}

		if (body.op !== 'draft') return error(res, 400, 'validation_error', "op must be 'draft'");
		if (lead.redacted_at) return error(res, 409, 'redacted', 'this lead is past retention and no longer has the details a draft needs');
		if (lead.action === 'DNC') return error(res, 409, 'do_not_contact', 'this lead asked not to be contacted, so no reply is drafted');
		const updated = await draftReply(lead, { timeoutMs: 25_000 });
		return json(res, 200, { lead: updated }, noStore);
	} catch (err) {
		if (err?.code === '42P01') {
			return error(res, 503, 'migration_pending', 'microsoft_marketplace_leads is missing: apply 20261111160847_microsoft_marketplace_leads.sql (npm run db:status)');
		}
		throw err;
	}
});
