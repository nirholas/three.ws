// Teams activity routing for "Create a 3D model" (api/_lib/teams-bot.js hands
// these activities here after the Bot Framework token is verified).
//
//   composeExtension/fetchTask   (commandId createModel)  the form
//   composeExtension/submitAction (commandId createModel) start the job; with
//       the Bot Connector configured, preview the card, and on Send post it
//       into the chat for the requester and run the job; without it, insert
//       the card into the compose box and run the job at once
//   adaptiveCard/action  forge.refresh | forge.variation | forge.retry
//   message              `forge <prompt>` (the bot command), replied to with
//                        the live card
//
// Activity and response shapes follow Microsoft's documentation:
// https://learn.microsoft.com/en-us/microsoftteams/platform/messaging-extensions/how-to/action-commands/respond-to-task-module-submit
// https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/universal-actions-for-adaptive-cards/work-with-universal-actions-for-adaptive-cards
// A message-extension submit has 5 seconds to answer before Teams retries it,
// so nothing here waits on the generator: the job runs in its own request
// (teams-forge.js dispatchRun) and the record key, derived from the activity
// id, makes a retried submit land on the job already started.

import { randomInt } from 'node:crypto';
import { limits } from './rate-limit.js';
import { checkPromptSafety } from '../_mcp-studio/safety.js';
import {
	FORGE_VERBS,
	PROMPT_MAX,
	TIERS,
	VERB_REFRESH,
	VERB_RETRY,
	VERB_VARIATION,
	cardAttachment,
	cardInvokeResponse,
	errorInvokeResponse,
	forgeErrorCard,
	forgeFormCard,
	formTaskResponse,
} from './teams-forge-cards.js';
import { cardFor, claimJob, claimOnce, depsWith, forgeKey, loadJob, patchJob, refreshStatus } from './teams-forge.js';

export const CREATE_COMMAND_ID = 'createModel';
export const BOT_COMMAND = 'forge';
const SEED_MAX = 4_294_967_295;
const MESSAGE_TYPE = 'application/vnd.microsoft.activity.message';

const HELP_TEXT =
	`Type **${BOT_COMMAND}** followed by a description to generate a 3D model, for example: ` +
	`${BOT_COMMAND} a weathered brass ship compass. ` +
	'You can also use Create a 3D model from the message extension menu.';

/** True for the activities this module answers. */
export function isForgeActivity(activity) {
	if (!activity) return false;
	if (activity.type === 'message') return true;
	if (activity.type !== 'invoke') return false;
	if (activity.name === 'adaptiveCard/action') return true;
	if (activity.name === 'composeExtension/fetchTask' || activity.name === 'composeExtension/submitAction') {
		return activity.value?.commandId === CREATE_COMMAND_ID;
	}
	return false;
}

/** The prompt rules the form and the bot command share; null when valid. */
export function promptProblem(prompt) {
	const p = String(prompt || '').trim();
	if (p.length < 3) return 'Describe the model in at least 3 characters.';
	if (p.length > PROMPT_MAX) return `Keep the description under ${PROMPT_MAX} characters.`;
	const safety = checkPromptSafety(p);
	if (!safety.allowed) return safety.message;
	return null;
}

function tierOf(value) {
	return TIERS.some((t) => t.value === value) ? value : 'standard';
}

// Teams message HTML (a message action's payload, a bot command) to text.
export function plainText(html) {
	return String(html || '')
		.replace(/<at>[^<]*<\/at>/gi, ' ')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/[ \t]+/g, ' ')
		.trim();
}

/** The prompt in a `forge <prompt>` message, '' for a bare command, null for any other text. */
export function commandPrompt(text) {
	const m = /^\/?forge(?:\s+([\s\S]*))?$/i.exec(plainText(text));
	if (!m) return null;
	return (m[1] || '').trim();
}

function requester(activity) {
	const from = activity?.from || {};
	return from.id ? { id: String(from.id), name: String(from.name || activity.imdisplayname || '') } : null;
}

function conversationOf(activity) {
	return activity?.conversation?.id ? { id: activity.conversation.id, serviceUrl: activity.serviceUrl } : null;
}

// Attribute a bot-posted card to the person who asked ("<name> via three.ws").
function onBehalfOf(by) {
	return by?.id ? { onBehalfOf: [{ itemId: 0, mentionType: 'person', mri: by.id, displayName: by.name || '' }] } : {};
}

function cardMessage(record, deps, extra = {}) {
	return { type: 'message', attachments: [cardAttachment(cardFor(record, { now: deps.now() }))], ...extra };
}

// The same quota the free studio charges its MCP callers, keyed per Teams
// user, plus the platform-wide breaker over every free-lane caller.
async function defaultRateLimit(userKey) {
	const burst = await limits.studioGenBurst(userKey);
	if (!burst.success) return 'You started several models in the last minute. Wait a minute, then try again.';
	const hourly = await limits.studioGenHourly(userKey);
	if (!hourly.success) return 'You reached the hourly limit for free 3D models. Try again within the hour.';
	const global = await limits.studioGenerateGlobal();
	if (!global.success) return 'The free 3D generator is at capacity right now. Try again in a few minutes.';
	return null;
}

function forgeDeps(ctx) {
	const deps = depsWith(ctx.deps || {});
	return { ...deps, rateLimit: ctx.deps?.rateLimit || defaultRateLimit, connectorOn: () => deps.connector.connectorConfigured() };
}

async function startJob({ key, prompt, tier, by, conversation, parent = null, seed = null, activityId = null }, ctx, deps) {
	const { record, created } = await claimJob(
		{ key, prompt, tier, by, conversation, origin: ctx.origin, parent, seed },
		{ now: deps.now() },
	);
	let current = record;
	if (created && activityId) current = (await patchJob(key, { activityId })) || { ...record, activityId };
	return { record: current, created };
}

function dispatch(key, ctx, deps) {
	return Promise.resolve(deps.dispatch(key, ctx.selfBase || ctx.origin)).catch((err) => {
		console.error(`[teams-forge] dispatch of ${key} failed: ${err?.message || err}`);
	});
}

/** Handle one verified forge activity; the return value is the invoke response body. */
export async function handleForgeActivity(activity, ctx = {}) {
	const deps = forgeDeps(ctx);
	if (activity.type === 'message') return onMessage(activity, ctx, deps);
	switch (activity.name) {
		case 'composeExtension/fetchTask':
			return formTaskResponse(forgeFormCard({ prompt: messageActionPrompt(activity) }));
		case 'composeExtension/submitAction':
			return onSubmit(activity, ctx, deps);
		case 'adaptiveCard/action':
			return onCardAction(activity, ctx, deps);
		default:
			return {};
	}
}

// "Create a 3D model" from a message's ... menu starts from that message's text.
function messageActionPrompt(activity) {
	if (activity.value?.commandContext !== 'message') return '';
	return plainText(activity.value?.messagePayload?.body?.content).slice(0, PROMPT_MAX);
}

function keyOfCard(content) {
	return content?.refresh?.action?.data?.key || content?.actions?.find((a) => a?.data?.key)?.data?.key || null;
}

async function onSubmit(activity, ctx, deps) {
	const value = activity.value || {};
	const previewAction = value.botMessagePreviewAction;
	if (previewAction) {
		const previewCard = value.botActivityPreview?.[0]?.attachments?.[0]?.content;
		const record = await loadJob(keyOfCard(previewCard));
		if (previewAction === 'edit') return formTaskResponse(forgeFormCard({ prompt: record?.prompt, tier: record?.tier }));
		if (!record) return formTaskResponse(forgeFormCard({ error: 'That preview expired. Describe the model again.' }));
		return sendPreview(record, activity, ctx, deps);
	}

	const prompt = String(value.data?.prompt || '').trim();
	const tier = tierOf(value.data?.tier);
	const problem = promptProblem(prompt);
	if (problem) return formTaskResponse(forgeFormCard({ prompt, tier, error: problem }));
	const by = requester(activity);
	const key = forgeKey(activity.conversation?.id, activity.id);
	const existing = await loadJob(key);
	if (!existing) {
		const limited = await deps.rateLimit(`teams:${by?.id || activity.conversation?.id || 'anon'}`);
		if (limited) return formTaskResponse(forgeFormCard({ prompt, tier, error: limited }));
	}
	const { record, created } = existing ? { record: existing, created: false } : await startJob({ key, prompt, tier, by, conversation: conversationOf(activity) }, ctx, deps);

	if (deps.connectorOn()) {
		// Preview first; the job starts when the requester presses Send.
		return {
			composeExtension: {
				type: 'botMessagePreview',
				activityPreview: { type: 'message', attachments: [cardAttachment(cardFor(record, { now: deps.now() }))] },
			},
		};
	}
	if (created) await dispatch(key, ctx, deps);
	return { composeExtension: { type: 'result', attachmentLayout: 'list', attachments: [cardAttachment(cardFor(record, { now: deps.now() }))] } };
}

async function sendPreview(record, activity, ctx, deps) {
	// Teams retries a slow Send; only the first one posts.
	if (!record.activityId && (await claimOnce('send', record.key))) {
		const conversation = record.conversation || conversationOf(activity);
		const posted = await deps.connector.sendToConversation({
			serviceUrl: conversation.serviceUrl,
			conversationId: conversation.id,
			activity: cardMessage(record, deps, { channelData: onBehalfOf(record.by) }),
		});
		if (posted?.id) await patchJob(record.key, { activityId: posted.id });
		await dispatch(record.key, ctx, deps);
	}
	return {};
}

async function onCardAction(activity, ctx, deps) {
	const action = activity.value?.action || {};
	const verb = action.verb;
	if (!FORGE_VERBS.includes(verb)) return errorInvokeResponse(400, 'unknown_verb', `This card action (${verb || 'none'}) is not supported.`);
	const key = action.data?.key;
	const record = verb === VERB_REFRESH ? await refreshStatus(key, ctx.deps || {}) : await loadJob(key);
	if (!record) {
		return cardInvokeResponse(forgeErrorCard({ error: 'This 3D job is no longer tracked (jobs are kept for 3 days). Start a new one from the message extension menu.' }));
	}
	if (verb === VERB_REFRESH) return cardInvokeResponse(cardFor(record, { now: deps.now() }));
	if (verb === VERB_VARIATION && record.state !== 'done') return cardInvokeResponse(cardFor(record, { now: deps.now() }));
	if (verb === VERB_RETRY && record.state !== 'failed') return cardInvokeResponse(cardFor(record, { now: deps.now() }));

	const by = requester(activity);
	const limited = await deps.rateLimit(`teams:${by?.id || activity.conversation?.id || 'anon'}`);
	if (limited) return { statusCode: 200, type: MESSAGE_TYPE, value: limited };

	const key2 = forgeKey(activity.conversation?.id, activity.id);
	const conversation = conversationOf(activity) || record.conversation;
	if (verb === VERB_VARIATION) {
		const parent = { key: record.key, viewerUrl: record.result?.viewerUrl || null };
		const seed = randomInt(0, SEED_MAX);
		if (deps.connectorOn() && conversation) {
			// A new message for the variation; the finished original stays as it is.
			const { record: next, created } = await startJob({ key: key2, prompt: record.prompt, tier: record.tier, by, conversation, parent, seed }, ctx, deps);
			if (created) {
				const posted = await deps.connector.sendToConversation({
					serviceUrl: conversation.serviceUrl,
					conversationId: conversation.id,
					activity: cardMessage(next, deps, { channelData: onBehalfOf(by) }),
				});
				if (posted?.id) await patchJob(key2, { activityId: posted.id });
				await dispatch(key2, ctx, deps);
			}
			return cardInvokeResponse(cardFor(record, { now: deps.now() }));
		}
		// No connector: the card itself becomes the variation's progress card,
		// linking back to the original model.
		const { record: next, created } = await startJob(
			{ key: key2, prompt: record.prompt, tier: record.tier, by, conversation, parent, seed, activityId: record.activityId },
			ctx,
			deps,
		);
		if (created) await dispatch(key2, ctx, deps);
		return cardInvokeResponse(cardFor(next, { now: deps.now() }));
	}
	// Try again: a fresh job of the same prompt in the same message.
	const { record: next, created } = await startJob(
		{ key: key2, prompt: record.prompt, tier: record.tier, by: record.by || by, conversation, activityId: record.activityId },
		ctx,
		deps,
	);
	if (created) await dispatch(key2, ctx, deps);
	return cardInvokeResponse(cardFor(next, { now: deps.now() }));
}

async function onMessage(activity, ctx, deps) {
	const prompt = commandPrompt(activity.text);
	const fallbackVerb = activity.value?.verb;
	if (prompt === null && !FORGE_VERBS.includes(fallbackVerb)) {
		if (deps.connectorOn() && plainText(activity.text)) await reply(activity, { type: 'message', text: HELP_TEXT }, deps);
		return null;
	}
	if (!deps.connectorOn()) {
		console.warn('[teams-forge] a bot message arrived but MS_TEAMS_BOT_APP_PASSWORD is not set, so the bot cannot reply');
		return null;
	}
	// An Action.Submit fallback from a host without Action.Execute: answer with
	// the job's current card as a reply.
	if (prompt === null) {
		const record = await refreshStatus(activity.value?.key, ctx.deps || {});
		await reply(activity, record ? cardMessage(record, deps) : { type: 'message', text: 'This 3D job is no longer tracked. Start a new one with forge <description>.' }, deps);
		return null;
	}
	if (!prompt) {
		await reply(activity, { type: 'message', text: HELP_TEXT }, deps);
		return null;
	}
	const problem = promptProblem(prompt);
	if (problem) {
		await reply(activity, { type: 'message', text: problem }, deps);
		return null;
	}
	const by = requester(activity);
	const key = forgeKey(activity.conversation?.id, activity.id);
	if (await loadJob(key)) return null;
	const limited = await deps.rateLimit(`teams:${by?.id || activity.conversation?.id || 'anon'}`);
	if (limited) {
		await reply(activity, { type: 'message', text: limited }, deps);
		return null;
	}
	const { record, created } = await startJob({ key, prompt, tier: 'standard', by, conversation: conversationOf(activity) }, ctx, deps);
	if (!created) return null;
	const posted = await reply(activity, cardMessage(record, deps), deps);
	if (posted?.id) await patchJob(key, { activityId: posted.id });
	await dispatch(key, ctx, deps);
	return null;
}

function reply(activity, message, deps) {
	return deps.connector.replyToActivity({
		serviceUrl: activity.serviceUrl,
		conversationId: activity.conversation.id,
		activityId: activity.id,
		activity: message,
	});
}
