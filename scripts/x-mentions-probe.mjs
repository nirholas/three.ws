#!/usr/bin/env node
// One real, read-only call to the @trythreews mention timeline, recorded.
//
// Answers the question every lane C order of the x-grok campaign depends on:
// can the credentials production holds read mentions at all? It makes exactly
// one GET /2/users/:id/mentions request through api/_lib/x-mentions.js (the
// same code the polling cron uses), with the company account's OAuth 1.0a user
// context, and writes what X answered to
// prompts/x-grok/_generated/mentions-probe.json: the HTTP status, the
// rate-limit headers, the problem body on a refusal, and on success the count
// and shape of the mentions (ids and structure only; post text is left out).
//
// It never writes to X. Credentials come from this process's env, or are
// resolved off the three-ws-api Cloud Run service when absent, and are never
// printed or written: the evidence file carries only redacted forms.
//
// USAGE
//   node scripts/x-mentions-probe.mjs            # probe and write the evidence file
//   node scripts/x-mentions-probe.mjs --stdout   # print instead of writing
//   node scripts/x-mentions-probe.mjs --raw-out <file>
//       also save X's full response body to <file> (outside the repo: it holds
//       other people's post text), for shaping test fixtures

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serviceEnvValue } from './lib/service-env.mjs';
import {
	fetchMentions,
	companyUserId,
	XMentionsError,
	plainHeaders,
	COMPANY_HANDLE_DEFAULT,
} from '../api/_lib/x-mentions.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'prompts', 'x-grok', '_generated', 'mentions-probe.json');
const KEYS = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'];

function redact(value) {
	if (!value) return null;
	const s = String(value);
	return `<redacted ${s.length} chars>`;
}

function loadCreds() {
	const env = {};
	const source = {};
	for (const k of KEYS) {
		if (process.env[k]) {
			env[k] = process.env[k];
			source[k] = 'process.env';
			continue;
		}
		const v = serviceEnvValue(k);
		if (v) {
			env[k] = v;
			source[k] = 'cloud-run:three-ws-api';
		}
	}
	if (process.env.X_COMPANY_USER_ID) env.X_COMPANY_USER_ID = process.env.X_COMPANY_USER_ID;
	return { env, source };
}

let lastRaw = null;

const RATE_HEADERS = ['x-rate-limit-limit', 'x-rate-limit-remaining', 'x-rate-limit-reset', 'x-user-limit-24hour-limit', 'x-user-limit-24hour-remaining', 'x-user-limit-24hour-reset', 'x-app-limit-24hour-limit', 'x-app-limit-24hour-remaining', 'x-app-limit-24hour-reset', 'x-access-level'];

function shapeOf(m) {
	return {
		id: m.id,
		created_at: m.createdAt,
		has_text: !!m.text,
		replied_to: m.repliedTo ? { available: m.repliedTo.available, media: m.repliedTo.media.length } : null,
		quoted: m.quoted ? { available: m.quoted.available, media: m.quoted.media.length } : null,
		is_retweet: m.isRetweet,
		media: m.media.map((x) => x.type),
		mentions: m.mentions.length,
		urls: m.urls.length,
		from_self: m.fromSelf,
	};
}

async function main() {
	const { env, source } = loadCreds();
	const missing = KEYS.filter((k) => !env[k]);
	const record = {
		probed_at: new Date().toISOString(),
		endpoint: 'GET https://api.twitter.com/2/users/:id/mentions',
		account: { kind: 'company', handle: COMPANY_HANDLE_DEFAULT, user_id: companyUserId(env) },
		auth: 'OAuth 1.0a user context (X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET)',
		credentials: Object.fromEntries(KEYS.map((k) => [k, { source: source[k] || 'missing', value: redact(env[k]) }])),
		request_count: 0,
	};
	if (missing.length) {
		record.outcome = 'not_configured';
		record.missing = missing;
		return record;
	}

	// Wrap the module's own transport so the raw status and headers are kept
	// for the record. One call only: no sinceId means one page.
	let raw = null;
	const { TwitterApi } = await import('twitter-api-v2');
	const client = new TwitterApi({ appKey: env.X_API_KEY, appSecret: env.X_API_SECRET, accessToken: env.X_ACCESS_TOKEN, accessSecret: env.X_ACCESS_SECRET }).readOnly;
	const request = async (path, query) => {
		record.request_count += 1;
		record.request = { path: path.replace(/^users\/\d+/, 'users/:id'), query };
		try {
			const res = await client.v2.get(path, query, { fullResponse: true });
			raw = { status: 200, headers: plainHeaders(res.headers), body: res.data };
		} catch (err) {
			if (typeof err?.code !== 'number') throw err;
			raw = { status: err.code, headers: plainHeaders(err.headers), body: err.data ?? null };
		}
		lastRaw = raw;
		return raw;
	};

	try {
		const result = await fetchMentions({
			account: { kind: 'company' },
			maxResults: 5,
			env,
			request,
			resolvedAccount: { kind: 'company', ref: COMPANY_HANDLE_DEFAULT, userId: companyUserId(env), handle: COMPANY_HANDLE_DEFAULT },
		});
		record.outcome = 'success';
		record.mention_count = result.mentions.length;
		record.newest_id = result.newestId;
		record.rate_limit = result.rateLimit;
		record.partial_errors = result.partialErrors.length;
		record.mentions = result.mentions.map(shapeOf);
	} catch (err) {
		record.outcome = err instanceof XMentionsError ? err.code : 'transport_error';
		record.error = { name: err?.name, message: String(err?.message || err).slice(0, 500), reset_at: err?.resetAt ?? null, reason: err?.reason ?? null };
		if (raw) record.problem_body = raw.body;
	}
	if (raw) {
		record.http_status = raw.status;
		record.rate_limit_headers = Object.fromEntries(RATE_HEADERS.filter((h) => raw.headers[h] != null).map((h) => [h, raw.headers[h]]));
	}
	return record;
}

const record = await main();
const rawOutIdx = process.argv.indexOf('--raw-out');
if (rawOutIdx > 0 && process.argv[rawOutIdx + 1] && lastRaw) {
	writeFileSync(process.argv[rawOutIdx + 1], `${JSON.stringify(lastRaw.body, null, '\t')}\n`);
}
const json = `${JSON.stringify(record, null, '\t')}\n`;
if (process.argv.includes('--stdout')) {
	process.stdout.write(json);
} else {
	mkdirSync(dirname(OUT), { recursive: true });
	writeFileSync(OUT, json);
	console.log(`outcome: ${record.outcome}${record.http_status ? ` (HTTP ${record.http_status})` : ''}; wrote ${OUT.replace(`${ROOT}/`, '')}`);
}
