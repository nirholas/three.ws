#!/usr/bin/env node
// Live check of approval requests in Telegram, with a real throwaway bot.
//
//   TELEGRAM_BOT_TOKEN=<throwaway bot token> npm run approvals:telegram-live-check
//
// What it proves, end to end through the real code (no stand-ins):
//   1. a paired chat receives an approval request with the full confirmation
//      table and signed Approve and Deny buttons;
//   2. Approve decides it once, through the same path as the inbox, and a
//      second press of the same signed button runs nothing;
//   3. a request whose deadline passed fails closed when Approve is pressed.
//
// Isolation, so a live check can never touch production:
//   - Database: an in-process Postgres with the production schema
//     (scripts/lib/isolated-db.mjs). .env.local points at the production
//     database, and the production gateway worker claims every Telegram row in
//     its inbox, so a run against it would race that worker for the test
//     chat's rows. Nothing here reaches Neon.
//   - Bot: refused if it has a webhook set (the production bot always does) or
//     if its id matches the production bot on the three-ws-api service.
//   - Money: SNIPER_MODE=simulate (paper mode) on devnet. An approved trade is
//     quoted and simulated, never signed or broadcast.
//   - Signing secret: a fresh random JWT_SECRET per run, so no button or link
//     minted here verifies anywhere else.
//   - Side channels: Redis, email and push credentials are dropped from this
//     process, so rate limits and cache are in memory and nothing is mailed.
//
// The person running it pairs the chat and presses the buttons; the script
// watches the database and prints what each press did. Flags:
//   --expire-seconds <n>   deadline of the request left to expire (default 120)
//   --pair-timeout <s>     how long to wait for /link (default 600)
//   --step-timeout <s>     how long to wait for each press (default 600)
//   --health-port <n>      the worker's /healthz port (default 8797)
//   --report <file>        also write the JSON report to this file

import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const EXPIRE_SECONDS = Math.max(30, Number(flag('--expire-seconds', 120)));
const PAIR_TIMEOUT_S = Number(flag('--pair-timeout', 600));
const STEP_TIMEOUT_S = Number(flag('--step-timeout', 600));
const HEALTH_PORT = Number(flag('--health-port', 8797));
const REPORT_FILE = flag('--report', null);

// $THREE, the platform coin: the mint the paper trade quotes.
const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const TG = 'https://api.telegram.org';

const token = process.env.TELEGRAM_BOT_TOKEN || '';

function say(...lines) {
	process.stdout.write(`${lines.join('\n')}\n`);
}
function scrub(text) {
	return token ? String(text).split(token).join('<token>') : String(text);
}
function die(message) {
	process.stderr.write(`\nREFUSED: ${scrub(message)}\n`);
	process.exit(2);
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function tg(method, payload = {}) {
	const r = await fetch(`${TG}/bot${token}/${method}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(payload),
		signal: AbortSignal.timeout(15_000),
	});
	const j = await r.json().catch(() => ({}));
	if (!j.ok) throw new Error(`telegram ${method}: ${j.description || `HTTP ${r.status}`}`);
	return j.result;
}

async function waitFor(what, timeoutS, probe, everyMs = 1000) {
	const deadline = Date.now() + timeoutS * 1000;
	while (Date.now() < deadline) {
		const v = await probe();
		if (v) return v;
		await pause(everyMs);
	}
	throw new Error(`timed out after ${timeoutS}s waiting for ${what}`);
}

// ── 1. preflight: the bot must be a throwaway ────────────────────────────────

if (!token) {
	die([
		'TELEGRAM_BOT_TOKEN is not set.',
		'Create a throwaway bot: message @BotFather in Telegram, send /newbot, pick any name,',
		'and copy the token it gives you. Then run:',
		'  TELEGRAM_BOT_TOKEN=<token> npm run approvals:telegram-live-check',
	].join('\n'));
}

const me = await tg('getMe').catch((e) => die(`the token did not authenticate with Telegram (${e.message}).`));
const hook = await tg('getWebhookInfo').catch((e) => die(`could not read the bot's webhook (${e.message}).`));
if (hook.url) {
	die(`@${me.username} has a webhook set (${new URL(hook.url).host}). That is how the production bot is wired, ` +
		'and polling would delete it. Use a fresh throwaway bot from @BotFather.');
}
try {
	const { serviceEnvValue } = await import('./lib/service-env.mjs');
	const prodToken = serviceEnvValue('TELEGRAM_BOT_TOKEN');
	if (prodToken && prodToken.split(':')[0] === String(me.id)) die(`@${me.username} is the production bot. Use a throwaway bot.`);
} catch {
	// gcloud unavailable: the webhook check above already rules out the production bot.
}

// ── 2. isolate this process before any server module loads ───────────────────

process.env.DATABASE_URL = 'postgres://isolated.invalid/live-check';
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.SNIPER_MODE = 'simulate';
process.env.GATEWAY_TELEGRAM_POLLING = '1';
process.env.GATEWAY_PLATFORMS = 'telegram';
process.env.PORT = String(HEALTH_PORT);
process.env.TELEGRAM_BOT_USERNAME = me.username;
for (const k of Object.keys(process.env)) {
	if (/^(UPSTASH_|REDIS_|RESEND_|VAPID_|APNS_|DISCORD_|SLACK_|WHATSAPP_|TWILIO_)/.test(k)) delete process.env[k];
}

const { useIsolatedDb } = await import('./lib/isolated-db.mjs');
say(`Bot @${me.username} (id ${me.id}): no webhook, not the production bot.`, 'Building the isolated database (production schema)...');
const db = await useIsolatedDb();
const needTables = ['users', 'agent_identities', 'approval_requests', 'gateway_inbox', 'gateway_links', 'gateway_pair_codes', 'audit_log'];
const present = new Set((await db.query(`select table_name from information_schema.tables where table_schema = 'public'`)).map((r) => r.table_name));
const missing = needTables.filter((t) => !present.has(t));
if (missing.length) die(`the isolated schema is missing ${missing.join(', ')}; check tests/_helpers/pglite-full-schema.js`);

const { createApprovalRequest, TTL_MS } = await import('../api/_lib/approvals.js');
const { approvalChatText, approvalChoices, loadApprovalRequest } = await import('../api/_lib/gateway/approval-buttons.js');
const { issueSiteCode } = await import('../api/_lib/gateway/store.js');
const { formatPairCode } = await import('../api/_lib/gateway/codes.js');
const { main: startGateway } = await import('../workers/agent-gateway/src/index.js');

// ── 3. a throwaway account and agent ──────────────────────────────────────────

const userId = randomUUID();
await db.query(`insert into users (id, email, display_name) values ($1, $2, $3)`, [userId, `approvals-live-check+${userId.slice(0, 8)}@example.invalid`, 'Approvals live check']);
const [agent] = await db.query(`insert into agent_identities (user_id, name, meta) values ($1, $2, '{}'::jsonb) returning id, name`, [userId, 'Live Check Agent']);

await startGateway();
await waitFor('the gateway worker to report healthy', 60, async () => {
	const r = await fetch(`http://127.0.0.1:${HEALTH_PORT}/healthz`).catch(() => null);
	const j = r ? await r.json().catch(() => null) : null;
	return j?.ok && j.adapters?.telegram ? j : null;
});

// ── 4. pair a chat with /link ─────────────────────────────────────────────────

const site = await issueSiteCode(userId);
say(
	'',
	'STEP 1  Pair a chat',
	`  Open https://t.me/${me.username} in Telegram (a private chat) and send exactly:`,
	'',
	`    /link ${formatPairCode(site.code)}`,
	'',
	`  The code expires in ${site.expiresInMinutes} minutes. Waiting for the pairing...`,
);
const link = await waitFor('the chat to pair', PAIR_TIMEOUT_S, async () => {
	const [row] = await db.query(`select * from gateway_links where user_id = $1 and revoked_at is null order by created_at desc limit 1`, [userId]);
	return row || null;
});
const chatKey = `telegram:${link.chat_id}`;
say(`  Paired: chat ${link.chat_id}, Telegram user ${link.platform_user_id}${link.platform_username ? ` (@${link.platform_username})` : ''}.`);

// ── 5. two paper-mode swap requests, queued through the real fan-out ─────────

function paperSwap({ sol, ttlMs, tag }) {
	const payload = { kind: 'agent_trade', side: 'buy', mint: THREE_MINT, sol_amount: sol, slippage_bps: 500, network: 'devnet' };
	return createApprovalRequest({
		userId,
		agentId: agent.id,
		source: 'agent_trade',
		sourceRef: `live-check:${tag}:${randomUUID()}`,
		actionType: 'trade_buy',
		venue: 'agent_trade',
		payload,
		summary: `${agent.name} wants to buy ${sol} SOL of $THREE (paper mode, devnet)`,
		amount: sol,
		amountUsd: null,
		asset: 'SOL',
		chain: 'solana',
		network: 'devnet',
		recipient: THREE_MINT,
		recipientLabel: 'Token',
		riskNotes: ['Live check: paper mode on devnet. Approving quotes and simulates the trade; nothing is signed or sent.'],
		gateReason: 'Above the agent\'s burner cap',
		idempotencyKey: `live-check:${tag}:${randomUUID()}`,
		ttlMs,
		autoApprovable: false,
	});
}

async function health() {
	const r = await fetch(`http://127.0.0.1:${HEALTH_PORT}/healthz`);
	return r.json();
}

// A queued approval the worker skips (unlinked chat, decided while queued) also
// ends `done`, so delivery is proven by the worker's sent counter moving too.
async function delivered(approvalId) {
	const before = (await health()).approvalsSent ?? 0;
	await waitFor(`request ${approvalId} to be delivered`, 90, async () => {
		const [row] = await db.query(
			`select status, last_error from gateway_inbox where payload->>'kind' = 'approval' and payload->>'approvalId' = $1`, [approvalId]);
		if (row?.status === 'failed') throw new Error(`delivery failed: ${row.last_error}`);
		return row?.status === 'done' ? row : null;
	});
	const h = await health();
	if ((h.approvalsSent ?? 0) <= before) throw new Error(`request ${approvalId} was not sent (skipped ${h.approvalsSkipped} so far); see the worker log above`);
}

const { request: reqA } = await paperSwap({ sol: 0.01, ttlMs: TTL_MS.swap, tag: 'approve' });
await delivered(reqA.id);
const { request: reqB } = await paperSwap({ sol: 0.02, ttlMs: EXPIRE_SECONDS * 1000, tag: 'expire' });
await delivered(reqB.id);

const rowA = await loadApprovalRequest(reqA.id);
const rowB = await loadApprovalRequest(reqB.id);
say(
	'',
	'STEP 2  Two approval requests were sent to the chat. Each should read exactly like this',
	'        (minutes left will differ), with Approve and Deny buttons under it:',
	'',
	...approvalChatText(rowA).split('\n').map((l) => `    | ${l}`),
	'',
	`  The second one is the same for 0.02 SOL and expires in ${EXPIRE_SECONDS}s. Leave it alone for now.`,
);

// ── 6. presses ────────────────────────────────────────────────────────────────

async function callbackRows() {
	return db.query(
		`select id, status, last_error, payload->'callback_query'->>'data' as data from gateway_inbox
		 where chat_key = $1 and payload ? 'callback_query' order by id`, [chatKey]);
}
async function nextPress(seen) {
	return waitFor('a button press', STEP_TIMEOUT_S, async () => {
		const rows = await callbackRows();
		const fresh = rows.filter((r) => !seen.has(r.id));
		const settled = fresh.find((r) => r.status === 'done' || r.status === 'failed');
		if (!settled) return null;
		for (const r of rows) if (r.status === 'done' || r.status === 'failed') seen.add(r.id);
		return settled;
	});
}
async function finalized(approvalId) {
	const rows = await db.query(
		`select action from audit_log where resource_id = $1 and action in ('approval_executed', 'approval_failed')`, [approvalId]);
	return rows.length;
}
const snapshot = async (id) => {
	const [r] = await db.query(
		`select status, decided_via, decided_at, executed_at, signature, result, updated_at from approval_requests where id = $1`, [id]);
	return r;
};

const seen = new Set((await callbackRows()).map((r) => r.id));
const [approveA] = approvalChoices(rowA, link);
const report = { bot: `@${me.username}`, chat_id: link.chat_id, requests: { approve: reqA.id, expire: reqB.id }, steps: [] };

say('', 'STEP 3  Press Approve on the 0.01 SOL request.');
const press1 = await nextPress(seen);
const afterFirst = await snapshot(reqA.id);
const runsAfterFirst = await finalized(reqA.id);
report.steps.push({
	step: 'first approve',
	press_matches_signed_button: press1.data === approveA.id,
	inbox_status: press1.status,
	request_status: afterFirst.status,
	decided_via: afterFirst.decided_via,
	result: afterFirst.result,
	executor_finalizations: runsAfterFirst,
});
say(
	`  Request is now ${afterFirst.status} (decided via ${afterFirst.decided_via}), executor finalized ${runsAfterFirst} time(s).`,
	`  Outcome note: ${afterFirst.result?.note || '(none)'}`,
	'  The message should now end with the outcome and have no buttons.',
);

// The original message lost its buttons, so the second press is made on the
// exact same signed callback data, re-posted. The signature binds the request,
// the link, the presser and the payload hash, not the message, so this is the
// button a fast double tap or a stale client would send.
await tg('sendMessage', {
	chat_id: link.chat_id,
	text: 'Replay check: the buttons below carry the same signed data as the 0.01 SOL request you just approved. Pressing Approve again must run nothing.',
	reply_markup: { inline_keyboard: [approvalChoices(rowA, link).map((c) => ({ text: c.label, callback_data: c.id }))] },
});
say('', 'STEP 4  A "Replay check" message arrived. Press its Approve button.');
const press2 = await nextPress(seen);
const afterSecond = await snapshot(reqA.id);
const runsAfterSecond = await finalized(reqA.id);
const unchanged = String(afterSecond.updated_at) === String(afterFirst.updated_at) && afterSecond.status === afterFirst.status;
report.steps.push({
	step: 'second approve (replay)',
	press_matches_signed_button: press2.data === approveA.id,
	inbox_status: press2.status,
	request_status: afterSecond.status,
	request_unchanged: unchanged,
	executor_finalizations: runsAfterSecond,
	no_op: unchanged && runsAfterSecond === runsAfterFirst,
});
say(`  ${unchanged && runsAfterSecond === runsAfterFirst ? 'No-op confirmed' : 'NOT a no-op'}: status ${afterSecond.status}, executor finalized ${runsAfterSecond} time(s) in total.`);

const msLeft = new Date(rowB.expires_at).getTime() - Date.now();
if (msLeft > 0) {
	say('', `STEP 5  Waiting ${Math.ceil(msLeft / 1000)}s for the 0.02 SOL request to pass its deadline...`);
	await pause(msLeft + 1500);
}
say('', 'STEP 5  The 0.02 SOL request has expired. Press its Approve button now.');
const press3 = await nextPress(seen);
const afterExpiry = await snapshot(reqB.id);
const runsB = await finalized(reqB.id);
const failedClosed = afterExpiry.status === 'expired' && !afterExpiry.executed_at && runsB === 0;
report.steps.push({
	step: 'approve after deadline',
	inbox_status: press3.status,
	request_status: afterExpiry.status,
	executed_at: afterExpiry.executed_at,
	executor_finalizations: runsB,
	failed_closed: failedClosed,
});
say(`  ${failedClosed ? 'Failed closed' : 'DID NOT fail closed'}: status ${afterExpiry.status}, executor finalized ${runsB} time(s).`);

// ── 7. report ─────────────────────────────────────────────────────────────────

report.passed = report.steps[0].press_matches_signed_button && runsAfterFirst === 1 && report.steps[1].no_op && failedClosed;
const out = JSON.stringify(report, null, 2);
say('', 'REPORT', out, '', report.passed ? 'PASS' : 'FAIL',
	'Also note what the chat showed after each press (the toast and the edited message): the database cannot see those.');
if (REPORT_FILE) writeFileSync(REPORT_FILE, `${out}\n`);
// The worker's SIGINT handler stops polling cleanly and then calls
// process.exit(0); the exit listener restores the verdict as the exit code.
const verdict = report.passed ? 0 : 1;
process.on('exit', () => { process.exitCode = verdict; });
process.kill(process.pid, 'SIGINT');
