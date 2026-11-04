#!/usr/bin/env node
// Read-only live check of the Telegram gateway against production:
//
//   1. Telegram getWebhookInfo for the production bot: where Telegram delivers,
//      how many updates it is holding, and the last delivery error it saw.
//   2. gateway_inbox in the production database, grouped by platform and status,
//      with the age of the oldest open row and how many open rows are already
//      past the backlog TTL (they will get the "I was offline" reply instead of
//      an answer the moment the worker drains them).
//
// Nothing is written anywhere and no message is sent. The bot token comes from
// TELEGRAM_BOT_TOKEN in this process's env or, failing that, off the
// three-ws-api Cloud Run service (Secret Manager); it is never printed, and any
// error text is scrubbed of it before it reaches the terminal.
//
//   node workers/agent-gateway/scripts/live-smoke.mjs          # human summary
//   node workers/agent-gateway/scripts/live-smoke.mjs --json   # machine-readable

import { neon } from '@neondatabase/serverless';
import { serviceEnvValue } from '../../../scripts/lib/service-env.mjs';
import { loadConfig } from '../src/config.js';

const asJson = process.argv.includes('--json');
const secrets = [];

function scrub(text) {
	let out = String(text);
	for (const s of secrets) if (s) out = out.split(s).join('<redacted>');
	return out;
}

function resolve(name) {
	const fromEnv = process.env[name];
	if (fromEnv) return { value: fromEnv, source: 'env' };
	const value = serviceEnvValue(name);
	return value ? { value, source: 'three-ws-api (Cloud Run)' } : null;
}

async function webhookInfo(token) {
	const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, {
		signal: AbortSignal.timeout(15_000),
	});
	const body = await res.json().catch(() => null);
	if (!res.ok || !body?.ok) {
		throw new Error(`getWebhookInfo answered HTTP ${res.status}: ${body?.description || 'no body'}`);
	}
	const r = body.result;
	return {
		url: r.url || null,
		pending_update_count: r.pending_update_count ?? 0,
		last_error_message: r.last_error_message || null,
		last_error_date: r.last_error_date ? new Date(r.last_error_date * 1000).toISOString() : null,
		max_connections: r.max_connections ?? null,
		allowed_updates: r.allowed_updates || null,
	};
}

async function inboxCounts(databaseUrl, ttlSeconds) {
	const sql = neon(databaseUrl);
	const rows = await sql`
		SELECT platform, status, count(*)::int AS rows,
		       EXTRACT(EPOCH FROM now() - min(created_at))::int AS oldest_age_seconds,
		       count(*) FILTER (WHERE status IN ('queued', 'processing')
		                          AND ${ttlSeconds}::int > 0
		                          AND created_at < now() - make_interval(secs => ${ttlSeconds}::int))::int AS past_ttl
		FROM gateway_inbox
		GROUP BY platform, status
		ORDER BY platform, status`;
	return rows;
}

function human(seconds) {
	if (seconds == null) return '-';
	if (seconds < 120) return `${seconds}s`;
	if (seconds < 7200) return `${Math.round(seconds / 60)}m`;
	if (seconds < 172_800) return `${(seconds / 3600).toFixed(1)}h`;
	return `${(seconds / 86_400).toFixed(1)}d`;
}

async function main() {
	const report = { checked_at: new Date().toISOString(), telegram: null, inbox: null, errors: [] };
	const ttlSeconds = loadConfig(process.env).backlogTtlSeconds;
	report.backlog_ttl_seconds = ttlSeconds;

	const token = resolve('TELEGRAM_BOT_TOKEN');
	if (token) secrets.push(token.value);
	const db = resolve('DATABASE_URL');
	if (db) secrets.push(db.value);

	if (!token) {
		report.errors.push('TELEGRAM_BOT_TOKEN is not readable from env or the three-ws-api service');
	} else {
		try {
			report.telegram = { token_source: token.source, ...(await webhookInfo(token.value)) };
		} catch (err) {
			report.errors.push(`telegram: ${scrub(err.message)}`);
		}
	}

	if (!db) {
		report.errors.push('DATABASE_URL is not readable from env or the three-ws-api service');
	} else {
		try {
			report.inbox = await inboxCounts(db.value, ttlSeconds);
		} catch (err) {
			report.errors.push(`inbox: ${scrub(err.message)}`);
		}
	}

	const out = scrub(asJson ? JSON.stringify(report, null, 2) : render(report));
	process.stdout.write(out + '\n');
	process.exitCode = report.errors.length ? 1 : 0;
}

function render(r) {
	const lines = [`agent-gateway live smoke  ${r.checked_at}`, ''];
	if (r.telegram) {
		const t = r.telegram;
		lines.push(
			`Telegram webhook (token from ${t.token_source}, value not shown)`,
			`  url                   ${t.url || '(none: Telegram is holding updates for getUpdates)'}`,
			`  pending_update_count  ${t.pending_update_count}`,
			`  last_error_message    ${t.last_error_message || '(none)'}${t.last_error_date ? `  at ${t.last_error_date}` : ''}`,
			'',
		);
	}
	if (r.inbox) {
		lines.push(`gateway_inbox (backlog TTL ${human(r.backlog_ttl_seconds)})`);
		if (!r.inbox.length) lines.push('  (empty)');
		lines.push('  platform  status      rows  oldest   past TTL');
		for (const row of r.inbox) {
			lines.push(
				`  ${row.platform.padEnd(9)} ${row.status.padEnd(11)} ${String(row.rows).padStart(4)}  ` +
					`${human(row.oldest_age_seconds).padEnd(8)} ${['queued', 'processing'].includes(row.status) ? row.past_ttl : '-'}`,
			);
		}
		lines.push('');
	}
	for (const e of r.errors) lines.push(`ERROR ${e}`);
	return lines.join('\n');
}

main().catch((err) => {
	process.stderr.write(`live-smoke failed: ${scrub(err?.stack || err)}\n`);
	process.exit(1);
});
