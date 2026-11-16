// What the three.ws 3D Studio bot says when it is installed, greeted, asked
// for help, or sent a command it does not know. Teams Store validation
// requires each of these (welcome once on install in every scope, naming the
// app as the manifest does and who added it in a team or chat; hi, hello and
// help answered; a valid reply to an invalid command; help that never sends
// the person outside Teams). Nothing here contains a link, so every answer
// keeps the person in the conversation.
//
// https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/appsource/prepare/teams-store-validation-guidelines#bots

import * as defaultConnector from './teams-connector.js';
import { plainText } from './teams-forge-bot.js';
import { PROMPT_MAX } from './teams-forge-cards.js';
import { STUDIO_LIMITS } from './rate-limit.js';

/** The app's short name, kept equal to manifest.template.json name.short (a test pins it). */
export const APP_NAME = 'three.ws 3D Studio';

const CAPABILITIES = [
	'**forge** followed by a description generates a 3D model and posts it here as a live card, for example: forge a weathered brass ship compass.',
	'**Create a 3D model** in the message extension menu does the same from a form, with a quality choice.',
	'**Agents** in the message extension menu lets you search agents and share one as a card; pasting a three.ws agent link unfurls it too.',
	'The **3D Viewer** and **Agents** tabs in your app bar open models and agents without leaving Teams.',
	'In a meeting, add the **3D review stage** tab to share a model to the stage and pin comments on it together.',
	'**link** followed by the code from three.ws notification settings sends your finished models to your Teams activity feed.',
];

const LIMITS =
	`Limits: each person can start ${STUDIO_LIMITS.genBurst.limit} models a minute and ${STUDIO_LIMITS.genHourly.limit} an hour, a model takes about one to three minutes, ` +
	`descriptions are 3 to ${PROMPT_MAX} characters, and adult, violent, hateful or weapon content is declined. Anyone with a model's link can open it.`;

/** Full help, as Markdown the Teams client renders. */
export const HELP_TEXT = `Here is what ${APP_NAME} can do:\n\n${CAPABILITIES.map((c) => `- ${c}`).join('\n')}\n\n${LIMITS}\n\nType **help** at any time to see this again.`;

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

/** 'help', 'greeting' or null for what a person typed (mentions and punctuation ignored). */
export function conversationalIntent(text) {
	const words = plainText(text).toLowerCase().replace(/[!?.,]+/g, ' ').trim();
	if (/^\/?help$/.test(words) || words === '?') return 'help';
	if (/^(hi|hello|hey|hiya|good (morning|afternoon|evening))( there)?$/.test(words)) return 'greeting';
	return null;
}

/** The reply to hi or hello. */
export function greetingText(name) {
	const who = firstName(name);
	return `Hi${who ? ` ${who}` : ''}, I am ${APP_NAME}. Type **forge** and a description to make a 3D model, or **help** to see everything I can do.`;
}

/** The reply to a command the bot does not know. */
export function unknownCommandText(text) {
	const said = plainText(text).slice(0, 60);
	return `I did not recognise "${said}". Type **forge** and a description to make a 3D model, or **help** to see everything I can do.`;
}

/** The install welcome for the conversation's scope. */
export function welcomeText(activity) {
	const scope = activity?.conversation?.conversationType || 'personal';
	if (scope === 'personal') {
		const who = firstName(activity?.from?.name);
		return `Welcome to ${APP_NAME}${who ? `, ${who}` : ''}. I turn a text description into a 3D model you can view, share and review together.\n\n${HELP_TEXT}`;
	}
	const adder = String(activity?.from?.name || '').trim() || 'Someone';
	const where = scope === 'channel' ? 'this team' : 'this chat';
	return `${adder} added ${APP_NAME} to ${where}. Anyone here can mention me with **forge** and a description to generate a 3D model everyone can see and review.\n\n${HELP_TEXT}`;
}

/** True when a conversationUpdate says the bot itself was just added. */
export function botWasAdded(activity) {
	if (activity?.type !== 'conversationUpdate') return false;
	const self = activity.recipient?.id;
	return Boolean(self) && (activity.membersAdded || []).some((m) => m?.id === self);
}

/** Send the welcome when the bot is added; always resolves to null (no invoke body). */
export async function handleConversationUpdate(activity, ctx = {}) {
	if (!botWasAdded(activity)) return null;
	const connector = ctx.deps?.connector || defaultConnector;
	if (!connector.connectorConfigured()) {
		console.warn('[teams-bot] the bot was installed but MS_TEAMS_BOT_APP_PASSWORD is not set, so it cannot send the welcome');
		return null;
	}
	try {
		await connector.sendToConversation({
			serviceUrl: activity.serviceUrl,
			conversationId: activity.conversation?.id,
			activity: { type: 'message', textFormat: 'markdown', text: welcomeText(activity) },
		});
	} catch (err) {
		console.error(`[teams-bot] welcome failed: ${err?.message || err}`);
	}
	return null;
}
