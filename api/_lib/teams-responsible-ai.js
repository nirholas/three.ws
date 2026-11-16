// The Teams bot activities that carry Microsoft's AI app requirements:
//
//   feedback   `message/submitAction` with actionName 'feedback': the thumbs
//              up or down (and optional comment) a person gave a labelled
//              reply. Stored per person per message; answered with an empty
//              200 as the protocol asks.
//   report     the "Report" button on a generated 3D model card (a task/fetch
//              Action.Submit), and the Report message action (commandId
//              reportContent) on any message the bot posted: a dialog asks
//              for a reason, the report is stored in content_reports, ops is
//              alerted, and the person sees a confirmation.
//   chat       the `chat <agent>` command and the turns of a conversation
//              bound to an agent (teams-agent-chat.js).
//
// handleResponsibleAiActivity resolves { handled, body }; teams-bot.js calls
// it before the 3D Studio handler, which otherwise claims every message.

import { loadJob, isForgeKey } from './teams-forge.js';
import { plainText } from './teams-forge-bot.js';
import { handleAgentChatMessage } from './teams-agent-chat.js';
import {
	REPORT_COMMAND_ID, REPORT_VERB, isFeedbackInvoke, parseFeedbackInvoke, parseReportForm, personOf,
	reportExcerpt, reportTaskResponse, tenantOf,
} from './teams-ai.js';
import { recordFeedback, recordReport } from './teams-ai-store.js';

export const REPORT_THANKS =
	'Thanks for the report. A three.ws reviewer will look at this content, usually within one business day, and remove it if it breaks the rules. Reports are anonymous to the agent owner.';
const REPORT_AGAIN = 'You already reported this. A three.ws reviewer will look at it.';
const NOT_OURS = 'Report covers messages that three.ws 3D Studio posted. To report a person\'s message, use Teams\' own Report option.';

const handled = (body = null) => ({ handled: true, body });
const NOT_HANDLED = { handled: false, body: null };

function taskMessage(text) {
	return { task: { type: 'message', value: text } };
}

function invokeData(activity) {
	const v = activity?.value || {};
	return v.data && typeof v.data === 'object' ? v.data : v;
}

function isReportTask(activity) {
	return activity?.type === 'invoke'
		&& (activity.name === 'task/fetch' || activity.name === 'task/submit')
		&& invokeData(activity)?.verb === REPORT_VERB;
}

function isReportCommand(activity) {
	return activity?.type === 'invoke'
		&& (activity.name === 'composeExtension/fetchTask' || activity.name === 'composeExtension/submitAction')
		&& activity.value?.commandId === REPORT_COMMAND_ID;
}

// Only the bot's own messages can be reported here: everything else is a
// person's message, which Teams' built-in reporting covers.
function isBotMessage(payload, botAppId) {
	const app = payload?.from?.application;
	if (!app?.id) return false;
	return botAppId ? app.id === botAppId : true;
}

async function onFeedback(activity) {
	const fb = parseFeedbackInvoke(activity);
	if (!fb || !activity.conversation?.id) return handled(null);
	try {
		await recordFeedback({
			conversationId: activity.conversation.id,
			activityId: fb.messageId,
			personId: personOf(activity),
			tenantId: tenantOf(activity),
			reaction: fb.reaction,
			comment: fb.comment,
		});
	} catch (err) {
		console.error(`[teams-ai] feedback not stored: ${err?.message || err}`);
	}
	return handled(null);
}

// A report from the Report button on a 3D model card.
async function onCardReport(activity, deps) {
	const data = invokeData(activity);
	const subject = { kind: 'forge_model', ...(isForgeKey(data.key) ? { key: data.key } : {}) };
	if (activity.name === 'task/fetch') return handled(reportTaskResponse(subject));
	const form = parseReportForm(data);
	if (form.error) return handled(reportTaskResponse(subject, { error: form.error }));
	const record = subject.key ? await loadJob(subject.key).catch(() => null) : null;
	const activityId = record?.activityId || activity.replyToId || subject.key;
	if (!activityId || !activity.conversation?.id) return handled(taskMessage('This card can no longer be reported. Use Report in the message menu instead.'));
	const { duplicate } = await recordReport({
		conversationId: record?.conversation?.id || activity.conversation.id,
		activityId,
		personId: personOf(activity),
		tenantId: tenantOf(activity),
		subjectKind: 'forge_model',
		forgeKey: subject.key || null,
		modelUrl: record?.result?.viewerUrl || record?.result?.glbUrl || null,
		reason: form.reason,
		comment: form.comment,
		excerpt: record?.prompt ? `Prompt: ${record.prompt}` : null,
		alert: deps.alert,
	});
	return handled(taskMessage(duplicate ? REPORT_AGAIN : REPORT_THANKS));
}

// A report from the message menu (...), on any message the bot posted.
async function onMessageReport(activity, deps) {
	const payload = activity.value?.messagePayload;
	if (!isBotMessage(payload, deps.botAppId)) return handled(taskMessage(NOT_OURS));
	if (activity.name === 'composeExtension/fetchTask') return handled(reportTaskResponse({ kind: 'message' }));
	const form = parseReportForm(activity.value?.data || {});
	if (form.error) return handled(reportTaskResponse({ kind: 'message' }, { error: form.error }));
	const cardText = (payload.attachments || [])
		.map((a) => (a?.content && typeof a.content === 'string' ? a.content : ''))
		.join('\n');
	const { duplicate } = await recordReport({
		conversationId: activity.conversation.id,
		activityId: payload.id,
		personId: personOf(activity),
		tenantId: tenantOf(activity),
		subjectKind: null,
		reason: form.reason,
		comment: form.comment,
		excerpt: reportExcerpt(payload.body?.content || cardText),
		alert: deps.alert,
	});
	return handled(taskMessage(duplicate ? REPORT_AGAIN : REPORT_THANKS));
}

/**
 * Handle the activity when it belongs to this module.
 * @param {object} activity a verified Bot Framework activity
 * @param {object} ctx { origin, selfBase, deps: { connector, alert, botAppId, runReply, chatLimit } }
 */
export async function handleResponsibleAiActivity(activity, ctx = {}) {
	const deps = {
		alert: ctx.deps?.alert,
		botAppId: ctx.deps?.botAppId !== undefined ? ctx.deps.botAppId : (process.env.MS_TEAMS_BOT_APP_ID || '').trim() || null,
	};
	if (isFeedbackInvoke(activity)) return onFeedback(activity);
	if (isReportTask(activity)) return onCardReport(activity, deps);
	if (isReportCommand(activity)) return onMessageReport(activity, deps);
	if (activity?.type === 'message' && activity.conversation?.id && !activity.value) {
		const text = plainText(activity.text);
		if (text && (await handleAgentChatMessage(activity, text, ctx))) return handled(null);
	}
	return NOT_HANDLED;
}
