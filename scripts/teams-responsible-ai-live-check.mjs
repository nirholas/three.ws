#!/usr/bin/env node
// Live check of the Teams bot's Responsible AI paths on the full production
// schema, through the real code.
//
//   node scripts/teams-responsible-ai-live-check.mjs   [--report <file>]
//
// What it proves, end to end through api/_lib/teams-bot.js handleActivity:
//   1. a feedback invoke (`message/submitAction`, actionName 'feedback') on a
//      labelled agent reply stores one teams_ai_feedback row linked to the
//      agent, the message and the tenant, and a second vote replaces it;
//   2. the Report button on a generated 3D model card (task/fetch, then
//      task/submit) stores a content_reports row and raises an ops alert
//      through the real sendOpsAlert, which lands in ops_alerts;
//   3. the Report message action (composeExtension/submitAction, commandId
//      reportContent) on an agent reply stores a report with the excerpt, a
//      repeat is a duplicate, and a person's message is refused;
//   4. the admin queue (listReports, reviewReport, feedbackSummary) reads and
//      closes those reports.
//
// Isolation: the database is in-process PGlite built from schema.sql plus every
// migration (scripts/lib/isolated-db.mjs); DATABASE_URL points at a .invalid
// host so nothing can reach Neon. Alert transports (Telegram, email) and Redis
// are dropped from this process, so the alert is persisted to the isolated
// ops_alerts table and sent nowhere. The payloads are the activities Teams
// sends; ids are synthetic.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const REPORT_FILE = args.includes('--report') ? args[args.indexOf('--report') + 1] : null;

process.env.DATABASE_URL = 'postgres://isolated.invalid/threews';
for (const key of Object.keys(process.env)) {
	if (/^(TELEGRAM_|ALERT_|OPS_ALERT|RESEND_|SMTP_|SENDGRID_|UPSTASH_|REDIS_|KV_)/.test(key)) delete process.env[key];
}
process.env.VERCEL_ENV = 'live-check';

const { useIsolatedDb } = await import('./lib/isolated-db.mjs');
const db = await useIsolatedDb();
const { handleActivity } = await import('../api/_lib/teams-bot.js');
const forge = await import('../api/_lib/teams-forge.js');
const { recordAiMessage, listReports, reviewReport, feedbackSummary } = await import('../api/_lib/teams-ai-store.js');
const { hashId } = await import('../api/_lib/teams-ai.js');

const BOT_APP_ID = '5d1c2b3a-0000-4000-8000-00000000b071';
const TENANT = '72f988bf-86f1-41af-91ab-2d7cd011db47';
const SERVICE = 'https://smba.trafficmanager.net/amer/';
const PERSONAL = 'a:1Hk3pQ-personal-chat-livecheck';
const GROUP = '19:meeting_livecheck@thread.v2';
const USER = { id: '29:1Xq2-teams-user-livecheck', name: 'Live Check', aadObjectId: 'a1b2c3d4-0000-4000-8000-00000000e0c1' };
const AGENT = '00000000-0000-4000-8000-00000000c0a1';
const ctx = { origin: 'https://three.ws', deps: { botAppId: BOT_APP_ID } };

let seq = 0;
const activity = (conversation, over) => ({
	channelId: 'msteams',
	serviceUrl: SERVICE,
	id: `1731771${String(++seq).padStart(6, '0')}`,
	timestamp: new Date().toISOString(),
	from: USER,
	recipient: { id: `28:${BOT_APP_ID}`, name: 'three.ws 3D Studio' },
	conversation: conversation === 'personal'
		? { conversationType: 'personal', tenantId: TENANT, id: PERSONAL }
		: { conversationType: 'groupChat', tenantId: TENANT, id: GROUP, isGroup: true },
	channelData: { tenant: { id: TENANT } },
	...over,
});

const report = { steps: [] };
const step = (name, data) => {
	report.steps.push({ name, ...data });
	console.log(`\n== ${name}`);
	console.log(JSON.stringify(data, null, 2));
};

// agent_identities.user_id references users, so the agent gets a real owner row.
const [owner] = await db.sql`
	insert into users (email, display_name) values ('teams-rai-owner@live-check.invalid', 'Live Check Owner') returning id
`;
await db.sql`insert into agent_identities (id, name, user_id) values (${AGENT}, 'Live Check Agent', ${owner.id})`;

// 1. Feedback on a labelled agent reply.
await recordAiMessage({ conversationId: PERSONAL, activityId: '1:lc-reply-1', tenantId: TENANT, kind: 'agent_reply', agentId: AGENT, model: 'llama-3.3-70b' });
const feedback = (reaction, feedbackText) => activity('personal', {
	type: 'invoke', name: 'message/submitAction', replyToId: '1:lc-reply-1',
	value: { actionName: 'feedback', actionValue: { reaction, feedback: JSON.stringify({ feedbackText }) } },
});
const fb1 = await handleActivity(feedback('dislike', 'It missed the shipping section'), ctx);
const fb2 = await handleActivity(feedback('like', 'Better after the follow-up'), ctx);
const fbRows = await db.query('select activity_id, reaction, comment, kind, agent_id, tenant_id, conversation_hash, reporter_hash from teams_ai_feedback');
assert.equal(fb1, null);
assert.equal(fb2, null);
assert.equal(fbRows.length, 1);
assert.equal(fbRows[0].reaction, 'like');
assert.equal(fbRows[0].agent_id, AGENT);
assert.equal(fbRows[0].reporter_hash, hashId(USER.aadObjectId));
assert.ok(!JSON.stringify(fbRows).includes(PERSONAL));
step('feedback invoke -> teams_ai_feedback', { invokeResponses: [fb1, fb2], rows: fbRows });

// 2. Report on a generated 3D model card, with the real ops alert path.
const key = forge.forgeKey(GROUP, 'lc-card');
await forge.claimJob({ key, prompt: 'a weathered brass ship compass', tier: 'standard', by: { id: USER.id, name: USER.name, tenantId: TENANT }, conversation: { id: GROUP, serviceUrl: SERVICE }, origin: 'https://three.ws' });
await forge.patchJob(key, { state: 'done', activityId: '1:lc-card-msg', result: { glbUrl: 'https://three.ws/cdn/forge/lc/model.glb', viewerUrl: 'https://three.ws/viewer?model=lc' } });
const cardTask = (name, data) => activity('group', { type: 'invoke', name, replyToId: '1:lc-card-msg', value: { type: 'task/fetch', data } });
const dialog = await handleActivity(cardTask('task/fetch', { msteams: { type: 'task/fetch' }, verb: 'threews.report', kind: 'forge_model', key }), ctx);
assert.equal(dialog.task.type, 'continue');
const cardDone = await handleActivity(cardTask('task/submit', { verb: 'threews.report', kind: 'forge_model', key, reason: 'copyright', comment: 'Looks like a registered logo' }), ctx);
assert.equal(cardDone.task.type, 'message');
const cardReports = await db.query("select id, subject_kind, forge_key, model_url, reason, comment, excerpt, status, tenant_id from content_reports where subject_kind = 'forge_model'");
assert.equal(cardReports.length, 1);
const alertRows = await db.query('select signature, title, detail, severity, environment, count from ops_alerts');
assert.equal(alertRows.length, 1);
// ops_alerts keys rows by the sha256 prefix of the signature (api/_lib/alerts.js).
const alertKey = (sig) => createHash('sha256').update(sig).digest('hex').slice(0, 16);
assert.equal(alertRows[0].signature, alertKey(`content_report:${cardReports[0].id}`));
step('card Report -> content_reports + ops_alerts', {
	dialogTitle: dialog.task.value.title,
	confirmation: cardDone.task.value,
	rows: cardReports,
	opsAlerts: alertRows,
});

// 3. Report message action on an agent reply.
await recordAiMessage({ conversationId: PERSONAL, activityId: '1:lc-reply-2', tenantId: TENANT, kind: 'agent_reply', agentId: AGENT, model: 'llama-3.3-70b' });
const messageAction = (from, id = '1:lc-reply-2') => activity('personal', {
	type: 'invoke', name: 'composeExtension/submitAction',
	value: {
		commandId: 'reportContent', commandContext: 'message',
		data: { reason: 'misinformation', comment: 'The refund window is 30 days, not 90' },
		messagePayload: { id, messageType: 'message', from, body: { contentType: 'html', content: '<p>Refunds are accepted for 90 days.</p>' } },
	},
});
const botFrom = { application: { id: BOT_APP_ID, displayName: 'three.ws 3D Studio' } };
const msgDone = await handleActivity(messageAction(botFrom), ctx);
const msgAgain = await handleActivity(messageAction(botFrom), ctx);
const human = await handleActivity(messageAction({ user: { id: USER.aadObjectId, displayName: USER.name } }, '1:lc-human'), ctx);
const msgReports = await db.query("select id, subject_kind, agent_id, reason, comment, excerpt, status from content_reports where subject_kind = 'agent_reply'");
assert.equal(msgReports.length, 1);
assert.equal(msgReports[0].agent_id, AGENT);
const alertCount = await db.query('select count(*)::int as n from ops_alerts');
assert.equal(alertCount[0].n, 2);
step('message action Report -> content_reports', {
	confirmation: msgDone.task.value,
	repeat: msgAgain.task.value,
	humanMessage: human.task.value,
	rows: msgReports,
	opsAlertsTotal: alertCount[0].n,
});

// 4. The admin queue.
const open = await listReports({ status: 'open' });
const closed = await reviewReport(cardReports[0].id, { status: 'actioned', resolution: 'Model removed from the CDN and the card retired', reviewedBy: 'live-check' });
const summary = await feedbackSummary({ days: 30 });
assert.equal(open.length, 2);
assert.equal(closed.status, 'actioned');
assert.equal(summary.reports.open, 1);
assert.ok(!JSON.stringify(open).includes('reporter_hash'));
step('admin queue', { open: open.map((r) => ({ id: r.id, subject_kind: r.subject_kind, reason_title: r.reason_title, agent_name: r.agent_name })), closed, summary });

report.ok = true;
console.log('\nOK: feedback, card report, message-action report and the ops alert path all wrote real rows.');
if (REPORT_FILE) writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
process.exit(0);
