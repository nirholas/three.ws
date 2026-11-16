// /api/admin/forge-judge: the Forge judge comparison board (/admin/forge-judge).
//
//   GET   ?view=disagree|cosmos_reject|unlabelled|all  &source=forge|eval|all
//         &issue=<cosmos issue>  &limit=40  &before=<id>
//         shadow rows (forge_judge_shadow), newest first, with links to the
//         four judging views, both verdicts and the human label; plus the
//         running totals the board header shows (rows, disagreements, agreement
//         of each judge with the human label where one exists).
//   GET   ?render=<key>
//         the PNG of one judging view. Served here rather than as a presigned
//         R2 link because a view written during an R2 outage lives only in the
//         GCS fallback bucket, where an R2 link 404s; getObjectBuffer reads
//         either. Same-origin, so the admin session cookie authorizes the <img>.
//   POST  { id, label: 'accepted'|'rejected'|null }
//         record (or clear) an operator's label on a row, for tuning the judge
//         and the promotion rule.
//
// Writes: api/_lib/forge-judge-shadow.js (live gate) and
// scripts/cosmos-judge-eval.mjs (eval). Auth: authorizeOps, the gate every
// internal board uses. Rows carry structured verdicts only; no reasoning trace
// is ever stored, so none can be returned.

import { error, json, method, rateLimited, readJson, wrap } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { authorizeOps } from '../_lib/ops-auth.js';
import { respondMfaRequired } from '../_lib/admin-mfa.js';
import { sql } from '../_lib/db.js';
import { getObjectBuffer } from '../_lib/r2.js';
import { COSMOS_ISSUE_KEYS, cosmosJudgeMode, cosmosJudgeConfigured } from '../_lib/cosmos-reason-judge.js';

const NO_STORE = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' };
const VIEWS = ['disagree', 'cosmos_reject', 'unlabelled', 'all'];
const SOURCES = ['forge', 'eval', 'all'];
const LABELS = ['accepted', 'rejected'];

// Only keys recordJudgeShadow writes (forge/judge-shadow/<source>/<date>/<id>/<view>.png).
const RENDER_KEY = /^forge\/judge-shadow\/(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_-]+\.png$/;
const isRenderKey = (key) => RENDER_KEY.test(key) && !key.split('/').some((seg) => seg === '.' || seg === '..');
const renderLinks = (keys) => (keys || []).map((key) => ({
	key,
	url: isRenderKey(key) ? `/api/admin/forge-judge?render=${encodeURIComponent(key)}` : null,
}));

async function serveRender(res, key) {
	if (!isRenderKey(key)) return error(res, 400, 'validation_error', 'render must be a judge view key');
	let png;
	try {
		png = await getObjectBuffer(key);
	} catch (e) {
		const code = e?.Code || e?.name;
		if (code === 'NoSuchKey' || code === 'NotFound' || e?.$metadata?.httpStatusCode === 404) {
			return error(res, 404, 'not_found', 'that view is not stored');
		}
		throw e;
	}
	res.writeHead(200, {
		'content-type': 'image/png',
		'content-length': png.length,
		'cache-control': 'private, max-age=3600',
		'x-robots-tag': 'noindex',
		'x-content-type-options': 'nosniff',
	});
	res.end(png);
}

async function listRows({ view, source, issue, limit, before }) {
	const src = source === 'all' ? null : source;
	const rows = await sql`
		select id, created_at, source, creation_id, glb_url, prompt, subject, render_keys,
		       current, cosmos, current_pass, cosmos_pass, disagree, mode, applied,
		       human_label, labelled_by, labelled_at
		from forge_judge_shadow
		where (${src}::text is null or source = ${src})
		  and (${before}::bigint is null or id < ${before})
		  and (${issue}::text is null or cosmos->'issues' ? ${issue})
		  and case ${view}
		        when 'disagree' then disagree
		        when 'cosmos_reject' then cosmos_pass = false
		        when 'unlabelled' then human_label is null and disagree
		        else true end
		order by id desc
		limit ${limit + 1}`;
	const page = rows.slice(0, limit);
	return { rows: page.map((r) => ({ ...r, renders: renderLinks(r.render_keys) })), nextBefore: rows.length > limit ? page[page.length - 1].id : null };
}

async function totals(source) {
	const src = source === 'all' ? null : source;
	const [t] = await sql`
		select count(*)::int as rows,
		       count(*) filter (where disagree)::int as disagree,
		       count(*) filter (where current_pass is not null and cosmos_pass is not null)::int as both_answered,
		       count(*) filter (where human_label is not null)::int as labelled,
		       count(*) filter (where human_label is not null and current_pass is not null
		                         and current_pass = (human_label = 'accepted'))::int as current_agrees,
		       count(*) filter (where human_label is not null and current_pass is not null)::int as current_labelled,
		       count(*) filter (where human_label is not null and cosmos_pass is not null
		                         and cosmos_pass = (human_label = 'accepted'))::int as cosmos_agrees,
		       count(*) filter (where human_label is not null and cosmos_pass is not null)::int as cosmos_labelled,
		       count(*) filter (where applied = 'cosmos')::int as cosmos_decided
		from forge_judge_shadow
		where (${src}::text is null or source = ${src})`;
	return t;
}

export default wrap(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	// A board page loads up to 160 views; they draw on the image budget so a
	// couple of page loads cannot exhaust the read budget the JSON calls use.
	const isRender = req.method === 'GET' && /[?&]render=/.test(req.url || '');
	const rl = await (isRender ? limits.imgProxyIp : limits.authedReadIp)(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);
	const auth = await authorizeOps(req);
	if (auth.mfaRequired) return respondMfaRequired(res);
	if (!auth.ok) return error(res, 401, 'unauthorized', 'admin session or ops secret required');

	if (req.method === 'GET') {
		const url = new URL(req.url, 'http://local');
		if (url.searchParams.has('render')) return serveRender(res, url.searchParams.get('render') || '');
		const view = url.searchParams.get('view') || 'disagree';
		const source = url.searchParams.get('source') || 'all';
		const issue = url.searchParams.get('issue') || null;
		if (!VIEWS.includes(view)) return error(res, 400, 'validation_error', `view must be one of ${VIEWS.join(', ')}`);
		if (!SOURCES.includes(source)) return error(res, 400, 'validation_error', `source must be one of ${SOURCES.join(', ')}`);
		if (issue && !COSMOS_ISSUE_KEYS.includes(issue)) return error(res, 400, 'validation_error', `issue must be one of ${COSMOS_ISSUE_KEYS.join(', ')}`);
		const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 40, 1), 100);
		const beforeRaw = url.searchParams.get('before');
		const before = beforeRaw && /^\d+$/.test(beforeRaw) ? beforeRaw : null;
		const [page, sums] = await Promise.all([listRows({ view, source, issue, limit, before }), totals(source)]);
		return json(res, 200, {
			ok: true,
			view, source, issue,
			mode: cosmosJudgeMode(),
			configured: cosmosJudgeConfigured(),
			issues: COSMOS_ISSUE_KEYS,
			totals: sums,
			rows: page.rows,
			nextBefore: page.nextBefore,
		}, NO_STORE);
	}

	const body = (await readJson(req)) || {};
	const id = String(body.id ?? '');
	if (!/^\d+$/.test(id)) return error(res, 400, 'validation_error', 'id must be a shadow row id');
	const label = body.label ?? null;
	if (label !== null && !LABELS.includes(label)) return error(res, 400, 'validation_error', `label must be one of ${LABELS.join(', ')} or null`);
	const actor = String(auth.actor || 'ops').slice(0, 120);
	const rows = await sql`
		update forge_judge_shadow
		set human_label = ${label},
		    labelled_by = ${label ? `admin:${actor}` : null},
		    labelled_at = ${label ? new Date().toISOString() : null}
		where id = ${id}
		returning id, human_label, labelled_by, labelled_at`;
	if (!rows.length) return error(res, 404, 'not_found', 'no shadow row with that id');
	return json(res, 200, { ok: true, row: rows[0] }, NO_STORE);
});
