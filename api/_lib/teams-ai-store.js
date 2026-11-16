// Storage for the Teams bot's Responsible AI records
// (migration 20261116145416_teams_responsible_ai.sql).
//
//   recordAiMessage   remember which agent or 3D job produced a labelled bot
//                     message, so feedback and reports on it name a subject
//   recordFeedback    one thumbs up or down (and optional comment) per person
//                     per message; voting again replaces the earlier vote
//   recordReport      a "Report" submission, then an ops alert so a person
//                     reviews it
//   listReports / reviewReport / feedbackSummary   the admin view
//
// Teams conversation and person ids are hashed (teams-ai.js hashId) before
// they reach the database. Message text is never stored, except the capped
// excerpt of reported bot output that a reviewer needs to judge a report.

import { sql } from './db.js';
import { sendOpsAlert } from './alerts.js';
import { FEEDBACK_COMMENT_MAX, REPORT_COMMENT_MAX, REPORT_EXCERPT_MAX, REPORT_REASONS, hashId } from './teams-ai.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v) => (typeof v === 'string' && UUID.test(v) ? v : null);
const capped = (v, n) => (v == null || v === '' ? null : String(v).slice(0, n));

export const REPORT_STATUSES = Object.freeze(['open', 'actioned', 'dismissed']);

/**
 * Remember a labelled bot message. `kind` is 'agent_reply' or 'forge_model'.
 * Never throws: a failed write must not cost the person their answer.
 */
export async function recordAiMessage({ conversationId, activityId, tenantId = null, kind, agentId = null, forgeKey = null, model = null, citedDocs = [] }) {
	const conversationHash = hashId(conversationId);
	if (!conversationHash || !activityId) return false;
	const docs = (citedDocs || []).map(uuidOrNull).filter(Boolean);
	try {
		await sql`
			insert into teams_ai_messages (conversation_hash, activity_id, tenant_id, kind, agent_id, forge_key, model, cited_docs)
			values (${conversationHash}, ${String(activityId)}, ${tenantId}, ${kind}, ${uuidOrNull(agentId)}, ${forgeKey}, ${capped(model, 200)}, ${docs})
			on conflict (conversation_hash, activity_id) do update
			set kind = excluded.kind, agent_id = excluded.agent_id, forge_key = excluded.forge_key,
			    model = excluded.model, cited_docs = excluded.cited_docs
		`;
		return true;
	} catch (err) {
		console.error(`[teams-ai] could not record AI message ${activityId}: ${err?.message || err}`);
		return false;
	}
}

/** The labelled message a feedback or report points at, or null. */
export async function findAiMessage(conversationId, activityId) {
	const conversationHash = hashId(conversationId);
	if (!conversationHash || !activityId) return null;
	const [row] = await sql`
		select kind, agent_id, forge_key, model
		from teams_ai_messages
		where conversation_hash = ${conversationHash} and activity_id = ${String(activityId)}
	`;
	return row || null;
}

/** Store one person's vote on one message; returns the row. */
export async function recordFeedback({ conversationId, activityId, personId, tenantId = null, reaction, comment = null }) {
	const subject = await findAiMessage(conversationId, activityId);
	const [row] = await sql`
		insert into teams_ai_feedback
			(conversation_hash, activity_id, reporter_hash, tenant_id, kind, agent_id, forge_key, reaction, comment)
		values
			(${hashId(conversationId)}, ${String(activityId)}, ${hashId(personId)}, ${tenantId},
			 ${subject?.kind || null}, ${subject?.agent_id || null}, ${subject?.forge_key || null},
			 ${reaction}, ${capped(comment, FEEDBACK_COMMENT_MAX)})
		on conflict (conversation_hash, activity_id, reporter_hash) do update
		set reaction = excluded.reaction, comment = excluded.comment, updated_at = now()
		returning id, kind, agent_id, forge_key, reaction, comment, tenant_id, created_at, updated_at
	`;
	return row;
}

function reasonTitle(value) {
	return REPORT_REASONS.find((r) => r.value === value)?.title || value;
}

/**
 * Store a report and alert ops. Resolves { report, duplicate }: a second
 * report from the same person on the same message keeps the first.
 */
export async function recordReport({
	conversationId, activityId, personId, tenantId = null, subjectKind, agentId = null, forgeKey = null,
	modelUrl = null, reason, comment = null, excerpt = null, alert = sendOpsAlert,
}) {
	const known = await findAiMessage(conversationId, activityId).catch(() => null);
	const kind = subjectKind || known?.kind || 'bot_message';
	const [row] = await sql`
		insert into content_reports
			(surface, subject_kind, conversation_hash, activity_id, tenant_id, reporter_hash,
			 agent_id, forge_key, model_url, reason, comment, excerpt)
		values
			('teams', ${kind}, ${hashId(conversationId)}, ${String(activityId)}, ${tenantId}, ${hashId(personId)},
			 ${uuidOrNull(agentId) || known?.agent_id || null}, ${forgeKey || known?.forge_key || null},
			 ${capped(modelUrl, 2000)}, ${reason}, ${capped(comment, REPORT_COMMENT_MAX)}, ${capped(excerpt, REPORT_EXCERPT_MAX)})
		on conflict (surface, conversation_hash, activity_id, reporter_hash) do nothing
		returning id, subject_kind, agent_id, forge_key, model_url, reason, comment, excerpt, status, tenant_id, created_at
	`;
	if (!row) return { report: null, duplicate: true };
	const what = row.subject_kind === 'forge_model' ? 'a generated 3D model' : row.subject_kind === 'agent_reply' ? 'an agent reply' : 'a bot message';
	const detail = [
		`Reason: ${reasonTitle(row.reason)}`,
		row.comment ? `Comment: ${row.comment}` : null,
		row.agent_id ? `Agent: https://three.ws/agents/${row.agent_id}` : null,
		row.model_url ? `Model: ${row.model_url}` : null,
		row.tenant_id ? `Tenant: ${row.tenant_id}` : null,
		row.excerpt ? `Excerpt: ${row.excerpt.slice(0, 300)}` : null,
		'Review: https://three.ws/admin/microsoft#responsible-ai',
	].filter(Boolean).join('\n');
	await alert(`Content report in Teams: ${what}`, detail, { signature: `content_report:${row.id}`, severity: 'warn' });
	return { report: row, duplicate: false };
}

/** Reports for the admin list, newest first. */
export async function listReports({ status = 'open', limit = 50 } = {}) {
	const n = Math.min(Math.max(Number(limit) || 50, 1), 200);
	const rows = status === 'all'
		? await sql`
			select r.*, a.name as agent_name from content_reports r
			left join agent_identities a on a.id = r.agent_id
			order by r.created_at desc limit ${n}
		`
		: await sql`
			select r.*, a.name as agent_name from content_reports r
			left join agent_identities a on a.id = r.agent_id
			where r.status = ${status}
			order by r.created_at desc limit ${n}
		`;
	return rows.map(({ conversation_hash, reporter_hash, ...r }) => ({ ...r, reason_title: reasonTitle(r.reason) }));
}

/** Close or reopen a report; returns the row, or null for an unknown id. */
export async function reviewReport(id, { status, resolution = null, reviewedBy = null }) {
	if (!uuidOrNull(id) || !REPORT_STATUSES.includes(status)) return null;
	const open = status === 'open';
	const [row] = await sql`
		update content_reports
		set status = ${status},
		    resolution = ${open ? null : capped(resolution, 1000)},
		    reviewed_by = ${open ? null : capped(reviewedBy, 200)},
		    reviewed_at = ${open ? null : new Date().toISOString()}
		where id = ${id}
		returning id, status, resolution, reviewed_by, reviewed_at
	`;
	return row || null;
}

/** Report counts and feedback totals for the admin header. */
export async function feedbackSummary({ days = 30 } = {}) {
	const d = Math.min(Math.max(Number(days) || 30, 1), 365);
	const [fb] = await sql`
		select
			count(*) filter (where reaction = 'like')::int as likes,
			count(*) filter (where reaction = 'dislike')::int as dislikes,
			count(*) filter (where comment is not null)::int as comments
		from teams_ai_feedback
		where created_at > now() - make_interval(days => ${d})
	`;
	const [rep] = await sql`
		select
			count(*) filter (where status = 'open')::int as open,
			count(*) filter (where created_at > now() - make_interval(days => ${d}))::int as recent
		from content_reports
	`;
	const recentComments = await sql`
		select f.reaction, f.comment, f.kind, f.updated_at, a.name as agent_name, f.agent_id
		from teams_ai_feedback f left join agent_identities a on a.id = f.agent_id
		where f.comment is not null and f.created_at > now() - make_interval(days => ${d})
		order by f.updated_at desc limit 20
	`;
	return { days: d, feedback: fb, reports: rep, recentComments };
}
