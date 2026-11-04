#!/usr/bin/env node
// Ops alert delivery self-test: sends ONE clearly labelled test message through
// every configured push channel (Telegram, email) and prints which delivered.
//
//   node --env-file=.env scripts/alerts-self-test.mjs              every configured channel
//   node --env-file=.env scripts/alerts-self-test.mjs --channel email
//   node --env-file=.env scripts/alerts-self-test.mjs --dry-run    report config, send nothing
//
// The title is fixed and always says it is a test, so a recipient never mistakes
// it for an incident; it is deliberately not configurable. Messages go straight
// to the transports in api/_lib/alerts.js: nothing is written to ops_alerts and
// the dedup and hourly counters are untouched, so a self-test never hides or
// throttles a real alert.
//
// Channel config (see api/_lib/alert-channels.js):
//   telegram  TELEGRAM_BOT_TOKEN + TELEGRAM_ALERTS_CHAT_ID
//   email     OPS_ALERT_EMAILS (comma separated) + RESEND_API_KEY
// Without --env-file the script reads .env.local then .env when present; values
// already in the environment win.
//
// Exit codes: 0 every attempted channel delivered (or --dry-run); 1 a delivery
// failed or a channel named with --channel is not configured; 2 bad arguments.

import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const file of ['.env.local', '.env']) {
	const p = join(root, file);
	if (existsSync(p)) process.loadEnvFile(p);
}

const CHANNELS = ['telegram', 'email'];
export const SELF_TEST_TITLE = '[alerts self-test] three.ws ops alert delivery check (not an incident)';

function usage(code) {
	console.log('usage: node scripts/alerts-self-test.mjs [--dry-run] [--channel telegram|email]...');
	process.exit(code);
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const wanted = new Set();
for (let i = 0; i < args.length; i++) {
	const a = args[i];
	if (a === '--dry-run') continue;
	if (a === '--help' || a === '-h') usage(0);
	if (a === '--channel' || a.startsWith('--channel=')) {
		const v = a.includes('=') ? a.slice(a.indexOf('=') + 1) : args[++i];
		for (const c of String(v || '').split(',').map((s) => s.trim()).filter(Boolean)) {
			if (!CHANNELS.includes(c)) {
				console.error(`unknown channel "${c}"; expected one of ${CHANNELS.join(', ')}`);
				usage(2);
			}
			wanted.add(c);
		}
		continue;
	}
	console.error(`unknown argument "${a}"`);
	usage(2);
}

const { alertChannels, alertChannelGaps, parseAlertRecipients } = await import('../api/_lib/alert-channels.js');
const { configuredTransports } = await import('../api/_lib/alerts.js');

const environment = process.env.VERCEL_ENV || 'development';
const channels = alertChannels();
const gaps = alertChannelGaps();
const transports = configuredTransports();
const targets = wanted.size ? [...wanted] : CHANNELS;
const sentAt = new Date().toISOString();
const detail = [
	'This is a delivery check sent by scripts/alerts-self-test.mjs. No action is needed.',
	`Environment: ${environment}`,
	`Host: ${hostname()}`,
	`Sent: ${sentAt}`,
].join('\n');

console.log(`ops alert self-test (${environment})${dryRun ? ', dry run' : ''}`);
console.log(`  dashboard  always on (ops_alerts); not written by this test`);
if (gaps.invalidEmails.length) console.log(`  note: OPS_ALERT_EMAILS entries dropped as not addresses: ${gaps.invalidEmails.join(', ')}`);

let failures = 0;
for (const channel of targets) {
	const label = channel.padEnd(9);
	if (!channels[channel]) {
		console.log(`  ${label}  not configured (missing ${gaps[channel].join(', ')})`);
		if (wanted.has(channel)) failures++;
		continue;
	}
	const target = channel === 'email' ? `${parseAlertRecipients(process.env.OPS_ALERT_EMAILS).valid.length} recipient(s)` : 'ops chat';
	if (dryRun) {
		console.log(`  ${label}  configured, ${target}; would send "${SELF_TEST_TITLE}"`);
		continue;
	}
	const msg = {
		channel,
		kind: 'self-test',
		severity: 'info',
		title: SELF_TEST_TITLE,
		detail,
		environment,
		subject: `[three.ws ${environment}] ${SELF_TEST_TITLE}`,
		text: channel === 'telegram' ? `🧪 ${SELF_TEST_TITLE}\n${detail}` : `${SELF_TEST_TITLE}\n\n${detail}\n`,
	};
	const started = Date.now();
	try {
		const res = await transports[channel](msg);
		const id = res && typeof res === 'object' && 'id' in res && res.id ? `, id ${res.id}` : '';
		console.log(`  ${label}  delivered to ${target} in ${Date.now() - started}ms${id}`);
	} catch (err) {
		failures++;
		console.log(`  ${label}  FAILED after ${Date.now() - started}ms: ${err?.message || err}`);
	}
}

if (!channels.telegram && !channels.email) {
	console.log('no push channel is configured: alerts reach ops_alerts only. Set OPS_ALERT_EMAILS (with RESEND_API_KEY) or TELEGRAM_BOT_TOKEN + TELEGRAM_ALERTS_CHAT_ID.');
}
process.exit(failures ? 1 : 0);
