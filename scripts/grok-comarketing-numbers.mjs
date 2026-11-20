#!/usr/bin/env node
/**
 * Grok co-marketing numbers: every figure the xAI co-marketing kit
 * (docs/partners/xai-comarketing-kit.md) quotes, from the query that produced
 * it, so the case study and the startups-team emails can be refreshed in one
 * command and any number can be traced back to its source.
 *
 * Sources, all read-only:
 *   Neon (SELECT only)        usage_events (tool calls on /api/mcp-grok, and
 *                             the distinct prompts behind its generation calls),
 *                             oauth_clients and oauth_refresh_tokens (Grok and
 *                             Cursor sign-ins), forge_creations (platform
 *                             text-to-3D jobs), acquisition_touches (signups
 *                             that landed from X)
 *   Cloud Logging (opt-in)    --logs: which xAI clients call /api/mcp-grok, by
 *                             user agent. --clicks: landings that carry
 *                             utm_campaign=grok-startups, per utm_content.
 *
 * Usage:
 *   node scripts/grok-comarketing-numbers.mjs                     last 30 days
 *   node scripts/grok-comarketing-numbers.mjs --from 2026-10-21 --to 2026-11-20
 *   node scripts/grok-comarketing-numbers.mjs --logs              adds the client census
 *   node scripts/grok-comarketing-numbers.mjs --clicks            adds campaign clicks
 *   node scripts/grok-comarketing-numbers.mjs --json              machine-readable
 *
 * `--to` is inclusive. Reads DATABASE_URL from .env.local, then .env, then the
 * shell. Nothing is written anywhere.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

for (const envFile of ['.env.local', '.env']) {
	try {
		for (const line of readFileSync(path.resolve(REPO_ROOT, envFile), 'utf8').split('\n')) {
			const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
			if (!m || process.env[m[1]]) continue;
			process.env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, '$2');
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
const SERVICE = 'three-ws-api';
const CAMPAIGN = 'grok-startups';
const DAY_MS = 86_400_000;
const isoDay = (d) => d.toISOString().slice(0, 10);
const TO_DAY = flag('to', isoDay(new Date()));
const FROM_DAY = flag('from', isoDay(new Date(Date.parse(`${TO_DAY}T00:00:00Z`) - 30 * DAY_MS)));
if (!/^\d{4}-\d{2}-\d{2}$/.test(FROM_DAY) || !/^\d{4}-\d{2}-\d{2}$/.test(TO_DAY) || FROM_DAY > TO_DAY) {
	console.error(`Bad window: --from ${FROM_DAY} --to ${TO_DAY}. Use YYYY-MM-DD with from <= to.`);
	process.exit(2);
}
const FROM = `${FROM_DAY}T00:00:00Z`;
const TO_EXCLUSIVE = `${isoDay(new Date(Date.parse(`${TO_DAY}T00:00:00Z`) + DAY_MS))}T00:00:00Z`;

// Tool groups as the kit reports them. A generation call returns a pending job
// that get_job / check_job poll, so these count requests, not finished models.
const GENERATION_TOOLS = ['forge_free', 'mesh_forge', 'forge_avatar', 'text_to_avatar', 'rig_mesh', 'refine_model'];
const CATALOG_TOOLS = ['search_catalog', 'get_catalog_item', 'get_item_source'];

// User agents of xAI's own clients on the Grok endpoint. Anything else (our
// liveness probes, ambiguous shared-cloud agents) is left out of the census.
const XAI_CLIENTS = [
	{ label: 'Grok connector service (grok.com, Grok Bot)', match: /grok-connectors-manager/i },
	{ label: 'Grok Build CLI', match: /grok-cli/i },
];

// Link unfurlers and crawlers fetch a posted URL without a person behind it.
const NON_HUMAN_UA = /bot|crawler|spider|preview|facebookexternalhit|embedly|slack|discord|whatsapp|telegram|curl|wget|python|node-fetch|axios|go-http/i;

const db = async () => {
	if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (looked in .env.local, .env and the shell)');
	const { neon } = await import('@neondatabase/serverless');
	return neon(process.env.DATABASE_URL);
};

const num = (v) => (v === null || v === undefined ? null : Number(v));

async function grokEndpoint(sql) {
	const where = `kind = 'tool_call' and meta->>'server' = 'mcp-grok' and created_at >= $1 and created_at < $2`;
	const [totals] = await sql.query(
		`select count(*) calls,
		        count(*) filter (where status = 'error') errors,
		        count(distinct date_trunc('day', created_at)) active_days
		   from usage_events where ${where}`,
		[FROM, TO_EXCLUSIVE],
	);
	const tools = await sql.query(`select tool, count(*) calls from usage_events where ${where} group by tool order by calls desc`, [FROM, TO_EXCLUSIVE]);
	const [latency] = await sql.query(
		`select percentile_cont(0.5) within group (order by latency_ms) p50,
		        percentile_cont(0.95) within group (order by latency_ms) p95,
		        count(*) n
		   from usage_events where ${where} and tool = 'search_catalog' and status = 'ok'`,
		[FROM, TO_EXCLUSIVE],
	);
	const weekly = await sql.query(
		`select date_trunc('week', created_at)::date week, count(*) calls from usage_events where ${where} group by 1 order by 1`,
		[FROM, TO_EXCLUSIVE],
	);
	const byTool = Object.fromEntries(tools.map((r) => [r.tool, Number(r.calls)]));
	const sum = (names) => names.reduce((n, name) => n + (byTool[name] || 0), 0);
	return {
		calls: num(totals.calls),
		errors: num(totals.errors),
		activeDays: num(totals.active_days),
		generationCalls: sum(GENERATION_TOOLS),
		catalogCalls: sum(CATALOG_TOOLS),
		byTool,
		searchCatalogLatencyMs: { p50: Math.round(num(latency.p50) || 0), p95: Math.round(num(latency.p95) || 0), n: num(latency.n) },
		weekly: weekly.map((r) => ({ week: isoDay(new Date(r.week)), calls: Number(r.calls) })),
	};
}

// Every tracked text file our own tests, demos and docs could have sent a prompt
// from. A prompt whose opening words appear here is ours, not a caller's.
const OWN_PROMPT_SOURCES = ['scripts', 'tests', 'docs', 'data/x-content', 'integrations', 'examples', 'packages', 'api', 'src', 'pages', 'prompts', 'public/grok-skill.md'];
const OWN_PROMPT_PREFIX = 60;

function ownPromptCorpus() {
	const files = execFileSync('git', ['ls-files', ...OWN_PROMPT_SOURCES], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
		.split('\n')
		.filter((f) => /\.(m?js|json|md|html|ts|py|txt|sh|ya?ml)$/.test(f));
	let corpus = '';
	for (const f of files) {
		try {
			corpus += `${readFileSync(path.resolve(REPO_ROOT, f), 'utf8').toLowerCase()}\n`;
		} catch {
			// A file deleted in the working tree but still tracked is skipped.
		}
	}
	return corpus;
}

// Distinct generation prompts, split into ours (found in the repo) and
// everyone else's. Only counts leave this function: a prompt is a caller's
// words and is never printed, logged or published.
async function generationPrompts(sql) {
	const rows = await sql.query(
		`select lower(meta->'args_summary'->>'prompt') prompt, count(*) calls
		   from usage_events
		  where kind = 'tool_call' and meta->>'server' = 'mcp-grok' and created_at >= $1 and created_at < $2
		    and tool = any($3::text[]) and coalesce(meta->'args_summary'->>'prompt', '') <> ''
		  group by 1`,
		[FROM, TO_EXCLUSIVE, GENERATION_TOOLS],
	);
	const corpus = ownPromptCorpus();
	const external = rows.filter((r) => !corpus.includes(String(r.prompt).slice(0, OWN_PROMPT_PREFIX)));
	return {
		distinct: rows.length,
		ours: rows.length - external.length,
		external: external.length,
		externalCalls: external.reduce((n, r) => n + Number(r.calls), 0),
	};
}

async function signIns(sql) {
	const registrations = await sql.query(
		`select name, count(*) clients, min(created_at)::date first, max(created_at)::date last
		   from oauth_clients where name ~* '^(grok|grok bot|cursor)$' and created_at < $1
		  group by name order by clients desc`,
		[TO_EXCLUSIVE],
	);
	const grants = await sql.query(
		`select c.name, count(*) grants, count(distinct t.user_id) users
		   from oauth_refresh_tokens t join oauth_clients c on c.client_id = t.client_id
		  where c.name ~* '^(grok|grok bot|cursor)$' and t.created_at < $1
		  group by c.name order by grants desc`,
		[TO_EXCLUSIVE],
	);
	return {
		registrations: registrations.map((r) => ({ client: r.name, count: Number(r.clients), first: isoDay(new Date(r.first)), last: isoDay(new Date(r.last)) })),
		refreshGrants: grants.map((r) => ({ client: r.name, grants: Number(r.grants), users: Number(r.users) })),
	};
}

async function platformForge(sql) {
	const [row] = await sql.query(
		`select count(*) filter (where status = 'done') done, count(*) total,
		        percentile_cont(0.5) within group (order by extract(epoch from completed_at - created_at))
		          filter (where status = 'done' and completed_at is not null) p50_s
		   from forge_creations
		  where created_at >= $1 and created_at < $2 and coalesce(internal, false) = false`,
		[FROM, TO_EXCLUSIVE],
	);
	return { done: num(row.done), total: num(row.total), timeToDoneP50s: Math.round(num(row.p50_s) || 0) };
}

async function xSignups(sql) {
	const rows = await sql.query(
		`select landing_path, count(*) signups from acquisition_touches
		  where source = 'x' and touched_at >= $1 and touched_at < $2
		  group by landing_path order by signups desc limit 25`,
		[FROM, TO_EXCLUSIVE],
	);
	return rows.map((r) => ({ landing: r.landing_path, signups: Number(r.signups) }));
}

function readLogs(filter, fields) {
	const csv = execFileSync(
		'gcloud',
		['logging', 'read', filter, '--project', PROJECT, '--limit', '200000', `--format=csv[no-heading](${fields.join(',')})`],
		{ encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: 900_000, stdio: ['ignore', 'pipe', 'pipe'] },
	);
	return csv.split('\n').filter(Boolean).map((line) => line.split(','));
}

function clientCensus() {
	const rows = readLogs(
		[
			'resource.type="cloud_run_revision"',
			`resource.labels.service_name="${SERVICE}"`,
			'httpRequest.requestMethod="POST"',
			'httpRequest.requestUrl:"/api/mcp-grok"',
			`timestamp>="${FROM}"`,
			`timestamp<"${TO_EXCLUSIVE}"`,
		].join(' AND '),
		['timestamp', 'httpRequest.userAgent', 'httpRequest.remoteIp', 'httpRequest.status'],
	);
	return XAI_CLIENTS.map(({ label, match }) => {
		const mine = rows.filter(([, ua]) => match.test(ua || ''));
		return {
			client: label,
			requests: mine.length,
			distinctIps: new Set(mine.map(([, , ip]) => ip)).size,
			activeDays: new Set(mine.map(([ts]) => ts.slice(0, 10))).size,
			ok: mine.filter(([, , , status]) => status === '200').length,
		};
	});
}

function campaignClicks() {
	const rows = readLogs(
		[
			'resource.type="cloud_run_revision"',
			`resource.labels.service_name="${SERVICE}"`,
			'httpRequest.requestMethod="GET"',
			`httpRequest.requestUrl:"utm_campaign=${CAMPAIGN}"`,
			`timestamp>="${FROM}"`,
			`timestamp<"${TO_EXCLUSIVE}"`,
		].join(' AND '),
		['httpRequest.requestUrl', 'httpRequest.userAgent', 'httpRequest.remoteIp'],
	);
	const byContent = new Map();
	for (const [url, ua, ip] of rows) {
		if (NON_HUMAN_UA.test(ua || '')) continue;
		let parsed;
		try {
			parsed = new URL(url);
		} catch {
			continue;
		}
		const content = parsed.searchParams.get('utm_content') || '(none)';
		const entry = byContent.get(content) || { content, landings: 0, ips: new Set(), pages: new Set() };
		entry.landings++;
		entry.ips.add(ip);
		entry.pages.add(parsed.pathname);
		byContent.set(content, entry);
	}
	return [...byContent.values()]
		.map((e) => ({ utmContent: e.content, landings: e.landings, distinctVisitors: e.ips.size, pages: [...e.pages] }))
		.sort((a, b) => b.landings - a.landings);
}

const sql = await db();
const report = {
	window: { from: FROM_DAY, to: TO_DAY },
	grokEndpoint: await grokEndpoint(sql),
	prompts: await generationPrompts(sql),
	signIns: await signIns(sql),
	platformForge: await platformForge(sql),
	xSignupsByLanding: await xSignups(sql),
};
if (has('logs')) report.xaiClients = clientCensus();
if (has('clicks')) report.campaignClicks = campaignClicks();

if (has('json')) {
	console.log(JSON.stringify(report, null, 2));
	process.exit(0);
}

const g = report.grokEndpoint;
const fmt = (n) => Number(n).toLocaleString('en-US');
console.log(`Grok co-marketing numbers, ${FROM_DAY} to ${TO_DAY} (inclusive)\n`);
console.log('Grok endpoint (/api/mcp-grok), usage_events tool calls');
console.log(`  ${fmt(g.calls)} tool calls, ${fmt(g.errors)} errors, active on ${g.activeDays} days`);
console.log(`  ${fmt(g.generationCalls)} generation calls (${GENERATION_TOOLS.map((t) => `${t} ${g.byTool[t] || 0}`).join(', ')})`);
console.log(`  ${fmt(g.catalogCalls)} catalog calls (${CATALOG_TOOLS.map((t) => `${t} ${g.byTool[t] || 0}`).join(', ')})`);
console.log(`  search_catalog latency p50 ${g.searchCatalogLatencyMs.p50} ms, p95 ${g.searchCatalogLatencyMs.p95} ms (n=${g.searchCatalogLatencyMs.n})`);
console.log(`  weekly: ${g.weekly.map((w) => `${w.week} ${w.calls}`).join(' | ')}`);
console.log(`  every tool: ${Object.entries(g.byTool).map(([t, n]) => `${t} ${n}`).join(', ')}\n`);
const p = report.prompts;
console.log('Generation prompts (distinct, case-folded; prompt text is never printed)');
console.log(`  ${fmt(p.distinct)} distinct, ${fmt(p.ours)} found in this repo (our own tests and demos), ${fmt(p.external)} from callers`);
console.log(`  ${fmt(p.externalCalls)} generation calls carried a caller's prompt\n`);
console.log('OAuth sign-ins (all time to the end of the window)');
for (const r of report.signIns.registrations) console.log(`  ${r.client}: ${r.count} client registrations (${r.first} to ${r.last})`);
for (const r of report.signIns.refreshGrants) console.log(`  ${r.client}: ${r.grants} refresh-token grants from ${r.users} distinct accounts`);
const f = report.platformForge;
console.log(`\nPlatform text-to-3D jobs (forge_creations, internal excluded)\n  ${fmt(f.done)} done of ${fmt(f.total)}, time to done p50 ${f.timeToDoneP50s} s`);
console.log('\nSignups that landed from X (acquisition_touches, by landing page)');
if (!report.xSignupsByLanding.length) console.log('  none in this window');
for (const r of report.xSignupsByLanding) console.log(`  ${r.landing}: ${r.signups}`);
if (report.xaiClients) {
	console.log('\nxAI clients on /api/mcp-grok (Cloud Logging, by user agent)');
	for (const c of report.xaiClients) console.log(`  ${c.client}: ${fmt(c.requests)} requests from ${c.distinctIps} IPs on ${c.activeDays} days, ${fmt(c.ok)} answered 200`);
}
if (report.campaignClicks) {
	console.log(`\nCampaign landings (utm_campaign=${CAMPAIGN}, crawlers and unfurlers excluded)`);
	if (!report.campaignClicks.length) console.log('  none in this window');
	for (const c of report.campaignClicks) console.log(`  ${c.utmContent}: ${c.landings} landings, ${c.distinctVisitors} distinct visitors, pages ${c.pages.join(' ')}`);
}
