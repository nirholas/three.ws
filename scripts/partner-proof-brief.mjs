#!/usr/bin/env node
/**
 * Partner proof brief: the monthly evidence numbers behind every OpenAI, IBM,
 * and NVIDIA pitch (docs/partners/proof-brief-2026-10.md is the first issue;
 * docs/partners/openai-ibm-nvidia-growth-plan.md schedules it).
 *
 * Every number comes from a real source and the brief quotes the query that
 * produced it, so a partner manager can ask "where does that come from" and get
 * a reproducible answer:
 *
 *   Neon (read-only SELECTs)   forge_creations, forge_seed_jobs, usage_events,
 *                              oauth_clients, oauth_refresh_tokens, users,
 *                              agent_identities, avatars, widgets, widget_views,
 *                              granite_inference_health, x402_receipts
 *   Cloud Run Admin (gcloud)   GPU accelerator, vCPU and memory per service
 *   Cloud Monitoring API       billable instance time per GPU service
 *   Cloud Billing Catalog API  public list price per GPU, vCPU and GiB second
 *   npm registry + downloads   every package in the three-ws npm org
 *   GitHub REST API            stars, forks, forks created in the window
 *   Cloud Logging (opt-in)     MCP request user agents (slow: --mcp-logs)
 *
 * Usage:
 *   node scripts/partner-proof-brief.mjs                       last 30 days
 *   node scripts/partner-proof-brief.mjs --from 2026-08-31 --to 2026-09-30
 *   node scripts/partner-proof-brief.mjs --json                machine-readable
 *   node scripts/partner-proof-brief.mjs --skip-gcp --skip-public
 *   node scripts/partner-proof-brief.mjs --mcp-logs            adds Cloud Logging
 *                                                              user-agent census
 *
 * `--to` is inclusive. Reads DATABASE_URL from .env.local, then .env, then the
 * shell. GITHUB_TOKEN is optional: without it the stargazer timeline (which
 * GitHub only serves to authenticated callers) is reported as unmeasured.
 * Read-only everywhere: no INSERT, no UPDATE, no gcloud mutation.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

for (const envFile of ['.env.local', '.env']) {
	try {
		const raw = readFileSync(path.resolve(REPO_ROOT, envFile), 'utf8');
		for (const line of raw.split('\n')) {
			const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
			if (!m || process.env[m[1]]) continue;
			let val = m[2].trim();
			if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
				val = val.slice(1, -1);
			}
			process.env[m[1]] = val;
		}
	} catch {
		// The file is optional; the shell environment may already carry the vars.
	}
}

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const PROJECT = 'aerial-vehicle-466722-p5';
const GITHUB_REPO = 'nirholas/three.ws';
const NPM_ORG = 'three-ws';

const DAY_MS = 86_400_000;
const isoDay = (d) => d.toISOString().slice(0, 10);
const TO_DAY = flag('to', isoDay(new Date()));
const FROM_DAY = flag('from', isoDay(new Date(Date.parse(`${TO_DAY}T00:00:00Z`) - 30 * DAY_MS)));
if (!/^\d{4}-\d{2}-\d{2}$/.test(FROM_DAY) || !/^\d{4}-\d{2}-\d{2}$/.test(TO_DAY) || FROM_DAY > TO_DAY) {
	console.error(`Bad window: --from ${FROM_DAY} --to ${TO_DAY}. Use YYYY-MM-DD with from <= to.`);
	process.exit(2);
}
const FROM = `${FROM_DAY}T00:00:00Z`;
const TO_EXCL = new Date(Date.parse(`${TO_DAY}T00:00:00Z`) + DAY_MS).toISOString();
const WINDOW_DAYS = Math.round((Date.parse(TO_EXCL) - Date.parse(FROM)) / DAY_MS);

// Forge backend id -> the Cloud Run GPU services that execute it. `hunyuan3d`
// routes to the RTX PRO 6000 build (GCP_HUNYUAN3D_URL on three-ws-api), and
// auto-rig rows carry no backend id: they are identified by prompt 'auto-rig'
// and run on model-rig (GCP_UNIRIG_URL). Both trellis regions are counted
// because the us-east4 copy is a warm standby that bills whether or not it
// serves traffic.
const LANE_SERVICES = {
	trellis_selfhost: [['model-trellis', 'us-central1'], ['model-trellis', 'us-east4']],
	hunyuan3d: [['model-hunyuan3d-21-rtx', 'us-central1']],
	triposg: [['model-triposg', 'us-central1']],
	rig: [['model-rig', 'us-central1']],
};

// A person, not a seed cron, a QA login, or a synthetic test registration.
// service_account is the platform's own flag (migration 20260725130000); the
// email patterns cover the QA and e2e accounts that register through the real
// signup flow.
const HUMAN_USER = `not u.service_account
	and u.email::text !~* '(@qa\\.three\\.ws$|\\.invalid$|^(qa|gdqa|e2e|test|probe|audit|home-e2e)[-_.0-9])'`;

// User-facing forge requests: not platform-generated, not a catalog-seeder row,
// and not an attempt that failed over to a successor row (the successor carries
// the request to its real outcome). Same predicates as api/_lib/forge-funnel.js.
const FORGE_WINDOW = `fc.created_at >= $1 and fc.created_at < $2`;
const FORGE_EXTERNAL = `${FORGE_WINDOW} and fc.internal = false
	and not exists (select 1 from forge_seed_jobs sj where sj.creation_id = fc.id)`;
const FORGE_REQUESTS = `${FORGE_EXTERNAL} and fc.superseded_by is null`;
const LANE_EXPR = `coalesce(fc.backend, case when fc.prompt = 'auto-rig' then 'rig' else '(unrouted)' end)`;

const report = {
	window: { from: FROM_DAY, to: TO_DAY, days: WINDOW_DAYS },
	generated_at: new Date().toISOString(),
	sources: {},
	unmeasured: [],
};

let sql = null;
async function db(text, params = [FROM, TO_EXCL]) {
	return sql.query(text, params);
}

const int = (v) => (v == null ? 0 : Number(v));
const round = (v, dp = 1) => (v == null ? null : Math.round(Number(v) * 10 ** dp) / 10 ** dp);
const pct = (n, d) => (d ? round((100 * n) / d, 1) : null);

async function section(name, fn) {
	try {
		report[name] = await fn();
	} catch (err) {
		report[name] = { error: String(err?.message || err).slice(0, 300) };
		report.unmeasured.push(`${name}: ${report[name].error}`);
	}
}

// ── Database sections ────────────────────────────────────────────────────────

async function forgeRequests() {
	const [totals] = await db(`
		select count(*) as requests,
		       count(*) filter (where status = 'done') as done,
		       count(*) filter (where status = 'failed') as failed,
		       count(*) filter (where status = 'generating') as in_flight,
		       count(*) filter (where status = 'done' and (outcome = 'accepted' or downloaded)) as kept,
		       count(distinct coalesce(user_id::text, client_key)) filter (where client_key <> 'anon' or user_id is not null) as browsers,
		       count(distinct ip_hash) as origins,
		       count(distinct user_id) as signed_in_makers
		from forge_creations fc where ${FORGE_REQUESTS}`);
	const split = await db(`
		select case when fc.prompt = 'auto-rig' and fc.backend is null then 'rig' else 'generate' end as kind,
		       count(*) as requests,
		       count(*) filter (where status = 'done') as done,
		       count(*) filter (where status = 'failed') as failed
		from forge_creations fc where ${FORGE_REQUESTS} group by 1 order by 1`);
	const daily = await db(`
		select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day,
		       count(*) as requests,
		       count(*) filter (where status = 'done') as done
		from forge_creations fc where ${FORGE_REQUESTS} group by 1 order by 1`);
	const errors = await db(`
		select ${LANE_EXPR} as lane,
		       regexp_replace(left(coalesce(error, ''), 80), 'ref [0-9a-f]+', 'ref <id>') as error,
		       count(*) as n
		from forge_creations fc where ${FORGE_REQUESTS} and status = 'failed'
		group by 1, 2 order by 3 desc limit 8`);
	const t = {
		requests: int(totals.requests), done: int(totals.done), failed: int(totals.failed),
		in_flight: int(totals.in_flight), kept: int(totals.kept),
		distinct_browsers: int(totals.browsers), distinct_origins: int(totals.origins),
		signed_in_makers: int(totals.signed_in_makers),
	};
	t.completion_pct = pct(t.done, t.done + t.failed);
	const days = daily.map((d) => ({ day: d.day, requests: int(d.requests), done: int(d.done), completion_pct: pct(int(d.done), int(d.requests)) }));
	const last5 = days.slice(-5);
	const l5 = last5.reduce((a, d) => ({ r: a.r + d.requests, d: a.d + d.done }), { r: 0, d: 0 });
	return {
		totals: t,
		by_kind: split.map((s) => ({ kind: s.kind, requests: int(s.requests), done: int(s.done), failed: int(s.failed), completion_pct: pct(int(s.done), int(s.done) + int(s.failed)) })),
		last_5_days: { from: last5[0]?.day, requests: l5.r, done: l5.d, completion_pct: pct(l5.d, l5.r) },
		daily: days,
		top_errors: errors.map((e) => ({ lane: e.lane, error: e.error, n: int(e.n) })),
	};
}

async function forgeLanes() {
	const rows = await db(`
		select ${LANE_EXPR} as lane,
		       count(*) as attempts,
		       count(*) filter (where status = 'done') as done,
		       count(*) filter (where status = 'failed') as failed,
		       count(*) filter (where superseded_by is not null) as failed_over,
		       count(*) filter (where status = 'done' and completed_at is not null) as timed,
		       percentile_cont(0.5) within group (order by extract(epoch from completed_at - created_at))
		           filter (where status = 'done' and completed_at is not null) as p50_s,
		       percentile_cont(0.95) within group (order by extract(epoch from completed_at - created_at))
		           filter (where status = 'done' and completed_at is not null) as p95_s,
		       min(created_at) filter (where completed_at is not null) as timed_since
		from forge_creations fc where ${FORGE_EXTERNAL}
		group by 1 order by 2 desc`);
	return rows.map((r) => ({
		lane: r.lane, attempts: int(r.attempts), done: int(r.done), failed: int(r.failed),
		failed_over: int(r.failed_over), completion_pct: pct(int(r.done), int(r.done) + int(r.failed)),
		timed: int(r.timed), p50_s: round(r.p50_s), p95_s: round(r.p95_s),
		timed_since: r.timed_since ? new Date(r.timed_since).toISOString().slice(0, 10) : null,
	}));
}

async function fleetLatency() {
	// The catalog seeder drives the same GPU workers with started/finished
	// stamps on every job, so it is the only full-window latency series for the
	// self-hosted lanes. It includes the quality-gate render after the mesh.
	const rows = await db(`
		select coalesce(backend, '(unrouted)') as lane, status, count(*) as jobs,
		       percentile_cont(0.5) within group (order by extract(epoch from finished_at - started_at)) as p50_s,
		       percentile_cont(0.95) within group (order by extract(epoch from finished_at - started_at)) as p95_s
		from forge_seed_jobs
		where started_at >= $1 and started_at < $2 and finished_at is not null
		group by 1, 2 order by 3 desc`);
	return rows.map((r) => ({ lane: r.lane, status: r.status, jobs: int(r.jobs), p50_s: round(r.p50_s), p95_s: round(r.p95_s) }));
}

async function laneOutputsAllOrigins() {
	// Every successful mesh a GPU produced in the window, whoever asked for it:
	// the denominator for cost per successful output.
	const rows = await db(`
		select ${LANE_EXPR} as lane, count(*) filter (where status = 'done') as done
		from forge_creations fc where ${FORGE_WINDOW} group by 1`);
	return Object.fromEntries(rows.map((r) => [r.lane, int(r.done)]));
}

async function mcpUsage() {
	const servers = await db(`
		select coalesce(meta->>'server', 'mcp (main)') as server, count(*) as calls,
		       count(*) filter (where status = 'error') as errors
		from usage_events where kind = 'tool_call' and created_at >= $1 and created_at < $2
		group by 1 order by 2 desc`);
	const tools = await db(`
		select tool, count(*) as calls from usage_events
		where kind = 'tool_call' and created_at >= $1 and created_at < $2
		group by 1 order by 2 desc limit 12`);
	const [lat] = await db(`
		select percentile_cont(0.5) within group (order by latency_ms) as p50,
		       percentile_cont(0.95) within group (order by latency_ms) as p95
		from usage_events where kind = 'tool_call' and status is distinct from 'error'
		  and latency_ms is not null and created_at >= $1 and created_at < $2`);
	const registrations = await db(`
		select name, count(*) as registrations from oauth_clients
		where created_at >= $1 and created_at < $2
		  and name !~* '(probe|test|poc-|security|sec-)'
		group by 1 order by 2 desc`);
	const grants = await db(`
		select c.name, count(*) as token_grants, count(distinct t.user_id) as users
		from oauth_refresh_tokens t join oauth_clients c on c.client_id = t.client_id
		where t.created_at >= $1 and t.created_at < $2 and c.name !~* '(probe|test|poc-|security|sec-)'
		group by 1 order by 3 desc, 2 desc`);
	const calls = servers.reduce((a, s) => a + int(s.calls), 0);
	const errors = servers.reduce((a, s) => a + int(s.errors), 0);
	return {
		tool_calls: calls,
		tool_errors: errors,
		tool_success_pct: pct(calls - errors, calls),
		handler_p50_ms: round(lat?.p50, 0),
		handler_p95_ms: round(lat?.p95, 0),
		by_server: servers.map((s) => ({ server: s.server, calls: int(s.calls), errors: int(s.errors) })),
		top_tools: tools.map((t) => ({ tool: t.tool, calls: int(t.calls) })),
		oauth_client_registrations: registrations.map((r) => ({ name: r.name, n: int(r.registrations) })),
		distinct_client_products: registrations.length,
		oauth_grants: grants.map((g) => ({ name: g.name, token_grants: int(g.token_grants), users: int(g.users) })),
	};
}

async function platform() {
	const [signups] = await db(`select count(*) as n from users u where u.created_at >= $1 and u.created_at < $2 and ${HUMAN_USER}`);
	const [active] = await db(`
		select count(*) as n from users u where ${HUMAN_USER}
		  and (u.last_active_at >= $1 or exists (
		        select 1 from sessions s where s.user_id = u.id and (s.last_seen_at >= $1 or s.created_at >= $1)))
		  and u.created_at < $2`);
	const [agents] = await db(`
		select count(*) as created, count(distinct a.user_id) as owners,
		       count(*) filter (where a.is_published) as published,
		       count(*) filter (where a.avatar_id is not null) as with_body
		from agent_identities a join users u on u.id = a.user_id
		where a.created_at >= $1 and a.created_at < $2 and ${HUMAN_USER}`);
	const avatars = await db(`
		select a.source, count(*) as n, count(distinct a.owner_id) as owners
		from avatars a join users u on u.id = a.owner_id
		where a.created_at >= $1 and a.created_at < $2 and ${HUMAN_USER}
		group by 1 order by 2 desc`);
	const [seeded] = await db(`
		select count(*) as n from avatars a join users u on u.id = a.owner_id
		where a.created_at >= $1 and a.created_at < $2 and u.service_account`);
	const [widgets] = await db(`select count(*) as n from widgets where created_at >= $1 and created_at < $2`);
	const [views] = await db(`
		select count(*) as views, count(distinct widget_id) as widgets,
		       count(distinct referer_host) filter (where referer_host is not null and referer_host <> 'three.ws') as external_hosts
		from widget_views where created_at >= $1 and created_at < $2`);
	return {
		human_signups: int(signups.n),
		active_humans: int(active.n),
		agents_created: int(agents.created), agent_owners: int(agents.owners),
		agents_published: int(agents.published), agents_with_3d_body: int(agents.with_body),
		avatars_by_humans: avatars.reduce((a, r) => a + int(r.n), 0),
		avatars_by_source: avatars.map((r) => ({ source: r.source, n: int(r.n), owners: int(r.owners) })),
		avatars_by_seed_crons: int(seeded.n),
		widgets_created: int(widgets.n),
		widget_views: int(views.views), widgets_viewed: int(views.widgets), external_embed_hosts: int(views.external_hosts),
	};
}

async function nvidiaInference() {
	const rows = await db(`
		select kind, model, count(*) as calls,
		       count(*) filter (where user_id is not null) as user_calls,
		       sum(coalesce(input_tokens, 0) + coalesce(output_tokens, 0)) as tokens,
		       percentile_cont(0.5) within group (order by latency_ms) as p50_ms,
		       percentile_cont(0.95) within group (order by latency_ms) as p95_ms
		from usage_events where provider = 'nvidia' and created_at >= $1 and created_at < $2
		group by 1, 2 order by 3 desc`);
	return rows.map((r) => ({
		kind: r.kind, model: r.model, calls: int(r.calls), user_calls: int(r.user_calls),
		tokens: int(r.tokens), p50_ms: round(r.p50_ms, 0), p95_ms: round(r.p95_ms, 0),
	}));
}

async function ibmGranite() {
	const [h] = await db(`
		select count(*) as checks,
		       count(*) filter (where all_healthy) as healthy,
		       max(checked_at) as last_check,
		       (select max(checked_at) from granite_inference_health where watsonx_responding) as last_watsonx_response
		from granite_inference_health where checked_at >= $1 and checked_at < $2`);
	const errs = await db(`
		select meta->>'error' as error, count(*) as n from usage_events
		where kind = 'tool_call' and meta->>'server' = 'mcpibm' and created_at >= $1 and created_at < $2
		group by 1 order by 2 desc`);
	return {
		health_checks: int(h.checks), healthy_checks: int(h.healthy),
		last_check: h.last_check ? new Date(h.last_check).toISOString() : null,
		last_watsonx_response: h.last_watsonx_response ? new Date(h.last_watsonx_response).toISOString() : null,
		tool_call_outcomes: errs.map((e) => ({ error: e.error, n: int(e.n) })),
	};
}

async function x402() {
	const rows = await db(`
		select split_part(r.network, ':', 1) as family,
		       (exists (select 1 from x402_ring_wallets w where w.pubkey = r.payer)
		        or exists (select 1 from x402_ring_pool p where p.pubkey = r.payer)) as platform_wallet,
		       count(*) as receipts, count(distinct r.payer) as payers
		from x402_receipts r where r.issued_at >= $1 and r.issued_at < $2
		group by 1, 2 order by 3 desc`);
	return rows.map((r) => ({ family: r.family, platform_wallet: r.platform_wallet, receipts: int(r.receipts), payers: int(r.payers) }));
}

async function showcaseCandidates() {
	// Finished, public, user-made meshes someone acted on (kept, downloaded,
	// voted, or revisited). The brief's gallery is picked from this list by a
	// person; the script only guarantees each file is live.
	const rows = await db(`
		select fc.id, fc.backend, fc.tier, left(fc.prompt, 90) as prompt,
		       coalesce(fc.web_glb_url, fc.glb_url) as glb, fc.outcome, fc.downloaded,
		       fc.vote_count, fc.view_count, fc.created_at
		from forge_creations fc
		where ${FORGE_REQUESTS} and fc.status = 'done' and fc.backend is not null
		  and coalesce(fc.visibility, 'public') = 'public' and fc.glb_url is not null
		  and (fc.outcome = 'accepted' or fc.downloaded or coalesce(fc.vote_count, 0) > 0 or coalesce(fc.view_count, 0) >= 5)
		order by (fc.outcome = 'accepted')::int + fc.downloaded::int + coalesce(fc.vote_count, 0) desc,
		         fc.view_count desc nulls last, fc.created_at desc
		limit 10`);
	const out = [];
	for (const r of rows) {
		let live = false;
		try {
			const res = await fetch(r.glb, { headers: { Range: 'bytes=0-3' }, signal: AbortSignal.timeout(15_000) });
			live = res.ok && Buffer.from(await res.arrayBuffer()).toString('latin1') === 'glTF';
		} catch {
			live = false;
		}
		out.push({
			id: r.id, lane: r.backend, tier: r.tier, prompt: r.prompt, glb: r.glb, glb_live: live,
			page: `https://three.ws/m/${r.id}`, accepted: r.outcome === 'accepted', downloaded: r.downloaded,
			votes: int(r.vote_count), views: int(r.view_count), day: new Date(r.created_at).toISOString().slice(0, 10),
		});
	}
	return out;
}

// ── Google Cloud sections ────────────────────────────────────────────────────

function gcloud(argv) {
	return execFileSync('gcloud', [...argv, '--project', PROJECT], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180_000 });
}

let accessToken = null;
function token() {
	if (!accessToken) accessToken = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8', timeout: 60_000 }).trim();
	return accessToken;
}

async function gapi(url) {
	const res = await fetch(url, { headers: { Authorization: `Bearer ${token()}`, 'x-goog-user-project': PROJECT } });
	const body = await res.json();
	if (!res.ok) throw new Error(`${res.status} ${body?.error?.message || ''}`.trim());
	return body;
}

function parseQuantity(v) {
	if (v == null) return 0;
	const s = String(v);
	if (s.endsWith('Gi')) return Number(s.slice(0, -2));
	if (s.endsWith('Mi')) return Number(s.slice(0, -2)) / 1024;
	if (s.endsWith('m')) return Number(s.slice(0, -1)) / 1000;
	return Number(s);
}

async function gpuFleet() {
	const services = JSON.parse(gcloud(['run', 'services', 'list', '--format=json']));
	const fleet = [];
	for (const s of services) {
		const tpl = s.spec?.template;
		const accel = tpl?.spec?.nodeSelector?.['run.googleapis.com/accelerator'];
		if (!accel) continue;
		const limits = tpl.spec.containers?.[0]?.resources?.limits || {};
		const ann = tpl.metadata?.annotations || {};
		fleet.push({
			service: s.metadata.name,
			region: s.metadata.labels?.['cloud.googleapis.com/location'],
			accelerator: accel,
			gpus: Number(limits['nvidia.com/gpu'] || 1),
			vcpu: parseQuantity(limits.cpu),
			memory_gib: parseQuantity(limits.memory),
			min_instances: Number(ann['autoscaling.knative.dev/minScale'] || 0),
			max_instances: Number(ann['autoscaling.knative.dev/maxScale'] || 0),
			zonal_redundancy: ann['run.googleapis.com/gpu-zonal-redundancy-disabled'] !== 'true',
		});
	}
	return fleet.sort((a, b) => a.service.localeCompare(b.service) || a.region.localeCompare(b.region));
}

async function billableHours() {
	const params = new URLSearchParams({
		filter: 'metric.type="run.googleapis.com/container/billable_instance_time" AND resource.label.service_name=starts_with("model-")',
		'interval.startTime': FROM,
		'interval.endTime': TO_EXCL,
		'aggregation.alignmentPeriod': `${WINDOW_DAYS * 86400}s`,
		'aggregation.perSeriesAligner': 'ALIGN_SUM',
		'aggregation.crossSeriesReducer': 'REDUCE_SUM',
	});
	params.append('aggregation.groupByFields', 'resource.label.service_name');
	params.append('aggregation.groupByFields', 'resource.label.location');
	const body = await gapi(`https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries?${params}`);
	const out = {};
	for (const ts of body.timeSeries || []) {
		const { service_name: svc, location } = ts.resource.labels;
		const seconds = ts.points.reduce((a, p) => a + Number(p.value.doubleValue ?? p.value.int64Value ?? 0), 0);
		out[`${svc}@${location}`] = round(seconds / 3600, 1);
	}
	return out;
}

async function gpuUtilization() {
	// GPU utilization is a gauge distribution; the window-long percentile per
	// service answers "how busy is the warm fleet", which is what drives cost
	// per output down as volume grows.
	const out = {};
	for (const [key, aligner] of [['p50_pct', 'ALIGN_PERCENTILE_50'], ['p95_pct', 'ALIGN_PERCENTILE_95']]) {
		const params = new URLSearchParams({
			filter: 'metric.type="run.googleapis.com/container/gpu/utilizations"',
			'interval.startTime': FROM,
			'interval.endTime': TO_EXCL,
			'aggregation.alignmentPeriod': `${WINDOW_DAYS * 86400}s`,
			'aggregation.perSeriesAligner': aligner,
			'aggregation.crossSeriesReducer': 'REDUCE_MEAN',
		});
		params.append('aggregation.groupByFields', 'resource.label.service_name');
		params.append('aggregation.groupByFields', 'resource.label.location');
		const body = await gapi(`https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries?${params}`);
		for (const ts of body.timeSeries || []) {
			const id = `${ts.resource.labels.service_name}@${ts.resource.labels.location}`;
			out[id] = { ...(out[id] || {}), [key]: round(100 * Number(ts.points[0]?.value?.doubleValue ?? 0), 1) };
		}
	}
	return out;
}

async function cloudRunPrices() {
	const services = await gapi('https://cloudbilling.googleapis.com/v1/services?pageSize=5000');
	const run = services.services.find((s) => s.displayName === 'Cloud Run');
	if (!run) throw new Error('Cloud Run is missing from the billing catalog');
	const skus = [];
	let pageToken = '';
	do {
		const page = await gapi(`https://cloudbilling.googleapis.com/v1/services/${run.serviceId}/skus?pageSize=5000&pageToken=${pageToken}`);
		skus.push(...(page.skus || []));
		pageToken = page.nextPageToken || '';
	} while (pageToken);
	const unit = (sku) => {
		const tier = sku.pricingInfo[0].pricingExpression.tieredRates.at(-1).unitPrice;
		return Number(tier.units || 0) + (tier.nanos || 0) / 1e9;
	};
	const find = (desc) => skus.find((s) => s.description === desc);
	return (region, accelerator, zonal) => {
		const gpuName = accelerator === 'nvidia-rtx-pro-6000' ? 'NVIDIA RTX Pro 6000 GPU' : 'NVIDIA L4 GPU';
		const gpu = find(`${gpuName} with ${zonal ? 'zonal redundancy' : 'no zonal redundancy'} in ${region}`);
		const cpu = find(`Services CPU (Instance-based billing) in ${region}`);
		const mem = find(`Services Memory (Instance-based billing) in ${region}`);
		if (!gpu || !cpu || !mem) return null;
		return { gpu_per_s: unit(gpu), vcpu_per_s: unit(cpu), gib_per_s: unit(mem), skus: [gpu.skuId, cpu.skuId, mem.skuId] };
	};
}

async function gpuCost(fleet, hours, outputs) {
	const price = await cloudRunPrices();
	const perService = fleet.map((f) => {
		const p = price(f.region, f.accelerator, f.zonal_redundancy);
		const h = hours[`${f.service}@${f.region}`] ?? 0;
		const hourly = p ? 3600 * (f.gpus * p.gpu_per_s + f.vcpu * p.vcpu_per_s + f.memory_gib * p.gib_per_s) : null;
		return { ...f, instance_hours: h, list_usd_per_hour: round(hourly, 3), list_usd: hourly == null ? null : round(h * hourly, 0), skus: p?.skus };
	});
	const lanes = Object.entries(LANE_SERVICES).map(([lane, svcs]) => {
		const rows = perService.filter((s) => svcs.some(([n, r]) => n === s.service && r === s.region));
		const usd = rows.reduce((a, r) => a + (r.list_usd || 0), 0);
		const ok = outputs[lane] || 0;
		return {
			lane, services: rows.map((r) => `${r.service}@${r.region} (${r.accelerator})`),
			instance_hours: round(rows.reduce((a, r) => a + r.instance_hours, 0), 1),
			list_usd: round(usd, 0), successful_outputs: ok,
			list_usd_per_success: ok ? round(usd / ok, 2) : null,
		};
	});
	return { per_service: perService, per_lane: lanes };
}

async function mcpLogCensus() {
	// Slow on purpose-built grounds: Cloud Logging has no aggregate endpoint on
	// this bucket (Log Analytics is off), so this pages every POST. The
	// Go-http-client monitor that polls /api/mcp-studio is excluded up front; it
	// alone is about 43k POSTs a day.
	const filter = [
		'resource.type="cloud_run_revision"',
		'resource.labels.service_name="three-ws-api"',
		'httpRequest.requestMethod="POST"',
		'httpRequest.requestUrl:"/api/mcp"',
		'-httpRequest.userAgent:"Go-http-client"',
		`timestamp>="${FROM}"`,
		`timestamp<"${TO_EXCL}"`,
	].join(' ');
	const csv = execFileSync('gcloud', [
		'logging', 'read', filter, '--project', PROJECT, '--limit=5000000',
		'--format=csv[no-heading](httpRequest.requestUrl,httpRequest.userAgent)',
	], { encoding: 'utf8', maxBuffer: 1 << 30, timeout: 3 * 3600_000 });
	const agents = new Map();
	const endpoints = new Map();
	for (const line of csv.split('\n')) {
		if (!line) continue;
		const comma = line.indexOf(',');
		const url = line.slice(0, comma).replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '');
		const product = line.slice(comma + 1).replace(/^"/, '').split(/[\s/(]/)[0] || '(none)';
		agents.set(product, (agents.get(product) || 0) + 1);
		endpoints.set(url, (endpoints.get(url) || 0) + 1);
	}
	const sorted = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ k, n }));
	return { filter, posts: [...agents.values()].reduce((a, n) => a + n, 0), user_agents: sorted(agents).slice(0, 40), distinct_user_agents: agents.size, endpoints: sorted(endpoints) };
}

// ── Public sources ───────────────────────────────────────────────────────────

async function getJson(url, headers = {}) {
	// The npm downloads API rate-limits bursts with 429, so back off hard and
	// give it several tries before calling the source unmeasured.
	for (let attempt = 0; attempt < 6; attempt++) {
		const res = await fetch(url, { headers: { 'User-Agent': 'three-ws-partner-proof', ...headers } });
		if (res.status === 429 || res.status >= 500) {
			await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
			continue;
		}
		const body = await res.json();
		if (!res.ok) throw new Error(`${url} -> ${res.status} ${body?.message || body?.error || ''}`.trim());
		return body;
	}
	throw new Error(`${url} kept failing after 6 attempts`);
}

async function npmDownloads() {
	const org = await getJson(`https://registry.npmjs.org/-/org/${NPM_ORG}/package`);
	const names = Object.keys(org).filter((n) => n.startsWith(`@${NPM_ORG}/`)).sort();
	const rows = [];
	for (const name of names) {
		const body = await getJson(`https://api.npmjs.org/downloads/point/${FROM_DAY}:${TO_DAY}/${name.replace('/', '%2F')}`);
		rows.push({ name, downloads: int(body.downloads) });
		await new Promise((r) => setTimeout(r, 300));
	}
	rows.sort((a, b) => b.downloads - a.downloads);
	const sortedCounts = rows.map((r) => r.downloads).sort((a, b) => a - b);
	return {
		scoped_packages: rows.length,
		downloads: rows.reduce((a, r) => a + r.downloads, 0),
		median_per_package: sortedCounts[Math.floor(sortedCounts.length / 2)] ?? 0,
		top: rows.slice(0, 15),
	};
}

async function github() {
	const repo = await getJson(`https://api.github.com/repos/${GITHUB_REPO}`);
	const forks = [];
	for (let page = 1; page <= 10; page++) {
		const batch = await getJson(`https://api.github.com/repos/${GITHUB_REPO}/forks?per_page=100&sort=newest&page=${page}`);
		forks.push(...batch);
		if (batch.length < 100) break;
	}
	const inWindow = (t) => t >= FROM && t < TO_EXCL;
	const out = {
		stars_total: repo.stargazers_count,
		forks_total: repo.forks_count,
		watchers: repo.subscribers_count,
		forks_created_in_window: forks.filter((f) => inWindow(f.created_at)).length,
		stars_in_window: null,
	};
	if (process.env.GITHUB_TOKEN) {
		let stars = 0;
		for (let page = 1; page <= 50; page++) {
			const batch = await getJson(`https://api.github.com/repos/${GITHUB_REPO}/stargazers?per_page=100&page=${page}`, {
				Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
				Accept: 'application/vnd.github.star+json',
			});
			stars += batch.filter((s) => inWindow(s.starred_at)).length;
			if (batch.length < 100) break;
		}
		out.stars_in_window = stars;
	} else {
		report.unmeasured.push('github.stars_in_window: GitHub serves star timestamps only to authenticated callers; set GITHUB_TOKEN');
	}
	return out;
}

// ── Run ──────────────────────────────────────────────────────────────────────

if (!process.env.DATABASE_URL) {
	console.error('DATABASE_URL is not set. Add it to .env.local or export it in your shell.');
	console.error("Production's value: node scripts/read-service-env.mjs '^DATABASE_URL$' --raw");
	process.exit(2);
}
const { neon } = await import('@neondatabase/serverless');
sql = neon(process.env.DATABASE_URL);

await section('forge', forgeRequests);
await section('lanes', forgeLanes);
await section('fleet_latency', fleetLatency);
await section('lane_outputs_all_origins', laneOutputsAllOrigins);
await section('mcp', mcpUsage);
await section('platform', platform);
await section('nvidia_inference', nvidiaInference);
await section('ibm_granite', ibmGranite);
await section('x402', x402);
await section('showcase_candidates', showcaseCandidates);

if (!has('skip-gcp')) {
	await section('gpu_fleet', gpuFleet);
	await section('gpu_hours', billableHours);
	await section('gpu_utilization', gpuUtilization);
	if (Array.isArray(report.gpu_fleet) && report.gpu_hours && !report.gpu_hours.error) {
		await section('gpu_cost', () => gpuCost(report.gpu_fleet, report.gpu_hours, report.lane_outputs_all_origins || {}));
	}
	if (has('mcp-logs')) await section('mcp_log_census', mcpLogCensus);
}
if (!has('skip-public')) {
	await section('npm', npmDownloads);
	await section('github', github);
}

if (has('json')) {
	console.log(JSON.stringify(report, null, 2));
	process.exit(0);
}

// ── Human-readable output ────────────────────────────────────────────────────

function table(headers, rows) {
	if (!rows.length) return console.log('  (none)');
	const cells = rows.map((r) => r.map((c) => (c == null ? 'n/a' : String(c))));
	const widths = headers.map((h, i) => Math.max(h.length, ...cells.map((r) => r[i].length)));
	const fmt = (r) => r.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
	console.log(`  ${fmt(headers)}`);
	console.log(`  ${widths.map((w) => '-'.repeat(w)).join('  ')}`);
	for (const r of cells) console.log(`  ${fmt(r)}`);
}
const heading = (s) => console.log(`\n${s}`);
const ok = (name) => report[name] && !report[name].error;

console.log(`Partner proof brief, ${FROM_DAY} to ${TO_DAY} (${WINDOW_DAYS} days), generated ${report.generated_at}`);

if (ok('forge')) {
	const f = report.forge;
	heading('Forge: user-facing requests (no seeder, no internal, failed-over attempts folded into their successor)');
	console.log(`  requests ${f.totals.requests}  done ${f.totals.done}  failed ${f.totals.failed}  in flight ${f.totals.in_flight}  completion ${f.totals.completion_pct}%`);
	console.log(`  distinct browsers ${f.totals.distinct_browsers}  distinct origins (ip hash) ${f.totals.distinct_origins}  signed-in makers ${f.totals.signed_in_makers}  kept or downloaded ${f.totals.kept}`);
	table(['kind', 'requests', 'done', 'failed', 'completion %'], f.by_kind.map((k) => [k.kind, k.requests, k.done, k.failed, k.completion_pct]));
	console.log(`  last 5 days (from ${f.last_5_days.from}): ${f.last_5_days.done}/${f.last_5_days.requests} = ${f.last_5_days.completion_pct}%`);
	heading('Forge: daily');
	table(['day', 'requests', 'done', 'completion %'], f.daily.map((d) => [d.day, d.requests, d.done, d.completion_pct]));
	heading('Forge: top failure causes');
	table(['lane', 'n', 'error'], f.top_errors.map((e) => [e.lane, e.n, e.error]));
}
if (ok('lanes')) {
	heading('Forge lanes (every attempt, failed-over ones included; latency from completed_at, stamped only since timed_since)');
	table(['lane', 'attempts', 'done', 'failed', 'failed over', 'completion %', 'timed', 'p50 s', 'p95 s', 'timed since'],
		report.lanes.map((l) => [l.lane, l.attempts, l.done, l.failed, l.failed_over, l.completion_pct, l.timed, l.p50_s, l.p95_s, l.timed_since]));
}
if (ok('fleet_latency')) {
	heading('GPU fleet job latency (catalog seeder on the same workers, started_at to finished_at, includes the quality gate)');
	table(['lane', 'status', 'jobs', 'p50 s', 'p95 s'], report.fleet_latency.map((r) => [r.lane, r.status, r.jobs, r.p50_s, r.p95_s]));
}
if (ok('gpu_cost')) {
	heading('GPU services (Cloud Run) with billable instance hours and list-price cost');
	const util = ok('gpu_utilization') ? report.gpu_utilization : {};
	table(['service', 'region', 'accelerator', 'min', 'max', 'inst h', 'usd/h', 'usd (list)', 'util p50 %', 'util p95 %'],
		report.gpu_cost.per_service.map((s) => {
			const u = util[`${s.service}@${s.region}`] || {};
			return [s.service, s.region, s.accelerator, s.min_instances, s.max_instances, s.instance_hours, s.list_usd_per_hour, s.list_usd, u.p50_pct, u.p95_pct];
		}));
	heading('Cost per successful output (list price x billable instance time / every successful mesh on that lane)');
	table(['lane', 'inst h', 'usd (list)', 'successes', 'usd/success', 'services'],
		report.gpu_cost.per_lane.map((l) => [l.lane, l.instance_hours, l.list_usd, l.successful_outputs, l.list_usd_per_success, l.services.join(', ')]));
}
if (ok('mcp')) {
	const m = report.mcp;
	heading('MCP');
	console.log(`  tool calls ${m.tool_calls}  errors ${m.tool_errors}  success ${m.tool_success_pct}%  handler p50 ${m.handler_p50_ms} ms  p95 ${m.handler_p95_ms} ms`);
	table(['server', 'calls', 'errors'], m.by_server.map((s) => [s.server, s.calls, s.errors]));
	table(['tool', 'calls'], m.top_tools.map((t) => [t.tool, t.calls]));
	console.log(`  distinct client products registering over OAuth: ${m.distinct_client_products}`);
	table(['client', 'registrations'], m.oauth_client_registrations.map((r) => [r.name, r.n]));
	table(['client (authorized)', 'token grants', 'users'], m.oauth_grants.map((g) => [g.name, g.token_grants, g.users]));
}
if (ok('mcp_log_census')) {
	const c = report.mcp_log_census;
	heading(`MCP HTTP census (Cloud Logging, excluding Go-http-client): ${c.posts} POSTs, ${c.distinct_user_agents} user-agent products`);
	table(['user agent', 'posts'], c.user_agents.map((u) => [u.k, u.n]));
	table(['endpoint', 'posts'], c.endpoints.map((u) => [u.k, u.n]));
}
if (ok('platform')) {
	const p = report.platform;
	heading('Platform (humans only: seed crons, QA and test registrations excluded)');
	console.log(`  signups ${p.human_signups}  active humans ${p.active_humans}`);
	console.log(`  agents created ${p.agents_created} by ${p.agent_owners} owners (${p.agents_published} published, ${p.agents_with_3d_body} with a 3D body)`);
	console.log(`  avatars by humans ${p.avatars_by_humans}  (seed crons added ${p.avatars_by_seed_crons} more, excluded)`);
	table(['source', 'avatars', 'owners'], p.avatars_by_source.map((a) => [a.source, a.n, a.owners]));
	console.log(`  widgets created ${p.widgets_created}  widget views ${p.widget_views} across ${p.widgets_viewed} widgets  external embed hosts ${p.external_embed_hosts}`);
}
if (ok('nvidia_inference')) {
	heading('NVIDIA-hosted inference (usage_events provider = nvidia)');
	table(['kind', 'model', 'calls', 'user calls', 'tokens', 'p50 ms', 'p95 ms'],
		report.nvidia_inference.map((r) => [r.kind, r.model, r.calls, r.user_calls, r.tokens, r.p50_ms, r.p95_ms]));
}
if (ok('ibm_granite')) {
	const g = report.ibm_granite;
	heading('IBM Granite / watsonx MCP');
	console.log(`  health checks ${g.health_checks}, healthy ${g.healthy_checks}, last watsonx response ${g.last_watsonx_response ?? 'never'}`);
	table(['tool call outcome', 'n'], g.tool_call_outcomes.map((e) => [e.error ?? 'ok', e.n]));
}
if (ok('x402')) {
	heading('x402 receipts (platform_wallet = payer is one of the platform\'s own ring wallets)');
	table(['family', 'platform wallet', 'receipts', 'payers'], report.x402.map((r) => [r.family, r.platform_wallet, r.receipts, r.payers]));
}
if (ok('npm')) {
	const n = report.npm;
	heading(`npm: ${n.downloads} downloads across ${n.scoped_packages} @${NPM_ORG} packages (median ${n.median_per_package} per package)`);
	table(['package', 'downloads'], n.top.map((r) => [r.name, r.downloads]));
}
if (ok('github')) {
	const g = report.github;
	heading('GitHub');
	console.log(`  stars ${g.stars_total}  forks ${g.forks_total}  watchers ${g.watchers}  forks created in window ${g.forks_created_in_window}  stars in window ${g.stars_in_window ?? 'unmeasured (set GITHUB_TOKEN)'}`);
}
if (ok('showcase_candidates')) {
	heading('Showcase candidates (GLB magic bytes checked live)');
	table(['id', 'lane', 'live', 'kept', 'dl', 'votes', 'views', 'prompt'],
		report.showcase_candidates.map((c) => [c.id, c.lane, c.glb_live, c.accepted, c.downloaded, c.votes, c.views, c.prompt.replace(/\s+/g, ' ').slice(0, 60)]));
}
if (report.unmeasured.length) {
	heading('Unmeasured');
	for (const u of report.unmeasured) console.log(`  ${u}`);
}
console.log('');
