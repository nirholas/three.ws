#!/usr/bin/env node
// Report one autopilot tick to the owner over Telegram.
//
//   node services/autopilot/notify.mjs <run-dir>
//
// Reads status.json, result.json and triage.json from the run directory. Quiet
// ticks stay quiet: a message goes out only when the tick did something (Claude
// ran, a deploy or rollback happened, a step failed) or when the set of
// owner-class findings changed since the last message. The full record of
// every tick is uploaded to GCS by run.sh regardless.
//
// Destination: the private ops chat. Chat id from the VM metadata attribute
// `autopilot-telegram-chat-id`, else TELEGRAM_ALERTS_CHAT_ID on three-ws-api.
// Bot token from the `telegram-bot-token` secret. Never the public channel.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const PROJECT = process.env.AUTOPILOT_PROJECT || 'aerial-vehicle-466722-p5';
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OWNER_STATE = join(process.env.AUTOPILOT_HOME || homedir(), '.owner-signatures');
const TELEGRAM_LIMIT = 4000;

function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch {
		return null;
	}
}

function sh(cmd, args) {
	try {
		return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000 }).trim();
	} catch {
		return '';
	}
}

async function metadataAttr(name) {
	try {
		const res = await fetch(`http://metadata.google.internal/computeMetadata/v1/instance/attributes/${name}`, {
			headers: { 'Metadata-Flavor': 'Google' },
			signal: AbortSignal.timeout(2000),
		});
		return res.ok ? (await res.text()).trim() : '';
	} catch {
		return '';
	}
}

async function chatId() {
	return (
		(await metadataAttr('autopilot-telegram-chat-id')) ||
		sh('node', [join(REPO, 'scripts/read-service-env.mjs'), '^TELEGRAM_ALERTS_CHAT_ID$', '--raw'])
	);
}

function ownerSignatures(triage) {
	return [...new Set((triage?.findings || []).filter((f) => f.class === 'owner').map((f) => f.signature))].sort();
}

function list(title, items) {
	if (!items?.length) return [];
	return [`${title}:`, ...items.map((i) => `- ${typeof i === 'string' ? i : `${i.signature}: ${i.why}`}`)];
}

export function composeMessage({ status, result, triage, ownerChanged }) {
	const lines = [];
	const verdict = result?.verdict || status.verdict_before || 'unknown';
	const failed = status.error || status.rollback || /failed|rejected|conflict/.test(`${status.tests} ${status.push} ${status.deploy}`);
	lines.push(`${failed ? '⚠️' : '🛠'} three.ws autopilot ${status.ts}: ${verdict}`);
	if (status.error) lines.push(`Tick failed: ${status.error}`);
	if (result?.summary) lines.push('', result.summary);
	lines.push(...(result?.fixed?.length ? ['', ...list('Fixed', result.fixed)] : []));
	lines.push(...(result?.config_changes?.length ? ['', ...list('Config applied', result.config_changes)] : []));
	const ship = [status.tests && `tests ${status.tests}`, status.push, status.deploy].filter(Boolean);
	if (ship.length) lines.push('', `Ship: ${ship.join('; ')}`);
	if (status.uncommitted) lines.push(`Uncommitted work ${status.uncommitted}`);
	const owner = result?.owner_items?.length
		? result.owner_items
		: ownerChanged
			? (triage?.findings || []).filter((f) => f.class === 'owner').map((f) => `${f.title} (x${f.count})`)
			: [];
	lines.push(...(owner.length ? ['', ...list('Needs you', owner)] : []));
	lines.push(...(result?.deferred?.length ? ['', ...list('Deferred', result.deferred)] : []));
	if (status.claude_cost_usd) lines.push('', `Claude cost: $${Number(status.claude_cost_usd).toFixed(2)}`);
	lines.push(`Report: gs://three-ws-autopilot/runs/${status.ts}/`);
	const text = lines.join('\n');
	return text.length > TELEGRAM_LIMIT ? `${text.slice(0, TELEGRAM_LIMIT - 20)}\n[truncated]` : text;
}

async function main() {
	const runDir = process.argv[2];
	if (!runDir) {
		console.error('usage: notify.mjs <run-dir>');
		process.exit(2);
	}
	const status = readJson(join(runDir, 'status.json')) || {};
	const result = readJson(join(runDir, 'result.json'));
	const triage = readJson(join(runDir, 'triage.json'));

	const sigs = ownerSignatures(triage).join('\n');
	const previous = existsSync(OWNER_STATE) ? readFileSync(OWNER_STATE, 'utf8') : '';
	const ownerChanged = sigs !== previous;
	const didSomething = Boolean(status.claude_exit !== undefined || status.deploy || status.error || status.push);
	if (!didSomething && !ownerChanged) {
		console.log('[notify] quiet tick, nothing sent');
		return;
	}

	const text = composeMessage({ status, result, triage, ownerChanged });
	writeFileSync(join(runDir, 'message.txt'), text);
	const token = sh('gcloud', ['secrets', 'versions', 'access', 'latest', '--secret=telegram-bot-token', `--project=${PROJECT}`]);
	const chat = await chatId();
	if (!token || !chat) {
		console.log(`[notify] Telegram not configured (${!token ? 'telegram-bot-token secret' : 'autopilot-telegram-chat-id / TELEGRAM_ALERTS_CHAT_ID'} missing); report kept in message.txt`);
		return;
	}
	const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
		signal: AbortSignal.timeout(15_000),
	});
	if (!res.ok) {
		console.error(`[notify] Telegram answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
		process.exit(1);
	}
	writeFileSync(OWNER_STATE, sigs);
	console.log('[notify] sent');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
