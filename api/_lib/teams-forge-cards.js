// Adaptive Cards for "Create a 3D model" in Teams and Copilot chats
// (api/_lib/teams-forge.js runs the job, api/_lib/teams-bot.js routes the
// invokes). Four cards, each a pure function of the job record:
//
//   forgeFormCard      the task-module form: prompt and quality tier
//   forgeProgressCard  the prompt, who asked, and the job's real state
//   forgeFinishedCard  poster, model name, Open in 3D / Download GLB / Make a variation
//   forgeErrorCard     what failed, with Try again
//
// Schema version 1.5: Teams needs 1.4+ for Action.Execute (Universal Actions)
// and documents 1.5 as the version its Universal Actions support
// (https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/universal-actions-for-adaptive-cards/overview).
// Every card validates against the published 1.5 schema
// (tests/fixtures/adaptive-card-1.5.schema.json, from microsoft/AdaptiveCards).
//
// Live updates: the progress card carries `refresh` with an Action.Execute
// and the requester's MRI in `userIds`. Teams sends that action as an
// `adaptiveCard/action` invoke (trigger "automatic") each time the card is
// displayed to a listed user, never on a timer; `userIds` holds at most 60
// MRIs, and without it a card auto-refreshes only in conversations of 60 or
// fewer members (https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/universal-actions-for-adaptive-cards/work-with-universal-actions-for-adaptive-cards).
// Everyone else gets the "Check progress" button, and the bot replaces the
// message for the whole chat once the job settles (updateActivity).

export const FORGE_CARD_VERSION = '1.5';
export const CARD_CONTENT_TYPE = 'application/vnd.microsoft.card.adaptive';
export const VERB_REFRESH = 'forge.refresh';
export const VERB_VARIATION = 'forge.variation';
export const VERB_RETRY = 'forge.retry';
export const FORGE_VERBS = Object.freeze([VERB_REFRESH, VERB_VARIATION, VERB_RETRY]);
export const TIERS = Object.freeze([
	{ value: 'draft', title: 'Draft: fastest preview' },
	{ value: 'standard', title: 'Standard: balanced detail (recommended)' },
	{ value: 'high', title: 'High: most detail, takes longer' },
]);
export const PROMPT_MAX = 1000;
// Teams accepts at most 60 MRIs in refresh.userIds.
export const REFRESH_USER_LIMIT = 60;

const SCHEMA = 'http://adaptivecards.io/schemas/adaptive-card.json';
const BRAND = 'three.ws';

function card(body, { actions, refresh } = {}) {
	return {
		type: 'AdaptiveCard',
		$schema: SCHEMA,
		version: FORGE_CARD_VERSION,
		...(refresh ? { refresh } : {}),
		body,
		...(actions?.length ? { actions } : {}),
	};
}

function text(value, extra = {}) {
	return { type: 'TextBlock', text: String(value), wrap: true, ...extra };
}

// Adaptive Card TextBlocks render a Markdown subset (emphasis, links, lists);
// a prompt is user text, so the characters that would turn it into emphasis,
// a link or code are backslash-escaped (CommonMark escapes, which the Teams and
// adaptivecards.io renderers both honor) before it reaches a card.
export function escapeMarkdown(value) {
	return String(value ?? '').replace(/([\\`*_[\]])/g, '\\$1');
}

// RFC 3339 without milliseconds: the form the Adaptive Card TIME() and DATE()
// functions accept, so the client renders the timestamp in the viewer's zone.
function cardTime(ms) {
	return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function header(title) {
	return [
		text(BRAND, { size: 'small', weight: 'bolder', color: 'accent', spacing: 'none' }),
		text(title, { size: 'large', weight: 'bolder', spacing: 'small' }),
	];
}

function promptBlock(prompt) {
	return {
		type: 'Container',
		style: 'emphasis',
		bleed: false,
		spacing: 'medium',
		items: [text('Prompt', { size: 'small', isSubtle: true }), text(escapeMarkdown(prompt), { spacing: 'none' })],
	};
}

function byline(record, extra = '') {
	const who = record?.by?.name ? `Requested by ${escapeMarkdown(record.by.name)}` : 'Requested in this chat';
	return text(`${who}${extra}`, { size: 'small', isSubtle: true, spacing: 'small' });
}

/** An Action.Execute with an Action.Submit fallback for hosts older than 1.4. */
function execute(title, verb, data, extra = {}) {
	return {
		type: 'Action.Execute',
		title,
		verb,
		data,
		...extra,
		fallback: { type: 'Action.Submit', title, data: { ...data, verb } },
	};
}

function seconds(n) {
	const s = Math.max(0, Math.round(Number(n) || 0));
	if (s < 90) return `${s}s`;
	const m = Math.floor(s / 60);
	const r = s % 60;
	return r ? `${m}m ${r}s` : `${m}m`;
}

/**
 * The one-line state of a job, from the server's own status fields. Never a
 * percentage: the forge reports a phase, elapsed time and its remaining
 * estimate, and the card says exactly that.
 * @param {object} record a teams-forge job record
 */
export function statusLine(record) {
	const st = record?.status || {};
	if (record?.state === 'starting' || !record?.jobId) return 'Starting: sending the prompt to the 3D generator.';
	if (st.phase === 'submitting') return 'Submitting: the 3D generator is accepting the job.';
	if (st.cold) {
		const left = Number(st.coldBootLeft) > 0 ? ` (about ${seconds(st.coldBootLeft)} of boot left)` : '';
		return `The GPU worker is waking up${left}. Rendering starts the moment it answers.`;
	}
	if (st.phase === 'queued') return 'Queued: waiting for a free GPU worker.';
	const parts = ['Rendering'];
	if (Number(st.elapsed) > 0) parts.push(`${seconds(st.elapsed)} in`);
	const line = parts.join(', ');
	return Number(st.eta) > 0 ? `${line}, about ${seconds(st.eta)} left.` : `${line}. Heavier scenes take a few minutes.`;
}

/**
 * The refresh block for a progress card: automatic for the requester, a
 * manual "Refresh card" menu item for everyone else.
 */
export function refreshFor(record) {
	const userIds = record?.by?.id ? [record.by.id].slice(0, REFRESH_USER_LIMIT) : [];
	return {
		action: { type: 'Action.Execute', title: 'Check progress', verb: VERB_REFRESH, data: { key: record.key } },
		userIds,
	};
}

/** The task-module form for the "Create a 3D model" action command. */
export function forgeFormCard({ prompt = '', tier = 'standard', error = '' } = {}) {
	const body = [
		...header('Create a 3D model'),
		text('Describe one object. three.ws generates a textured 3D model (GLB) you can open, download and share in this chat.', {
			isSubtle: true,
			spacing: 'small',
		}),
		...(error ? [text(error, { color: 'attention', weight: 'bolder', spacing: 'medium' })] : []),
		{
			type: 'Input.Text',
			id: 'prompt',
			label: 'What should the model be?',
			placeholder: 'A weathered brass ship compass with a glass lid',
			isMultiline: true,
			isRequired: true,
			maxLength: PROMPT_MAX,
			errorMessage: 'Describe the model in at least 3 characters.',
			value: String(prompt || '').slice(0, PROMPT_MAX),
			spacing: 'medium',
		},
		{
			type: 'Input.ChoiceSet',
			id: 'tier',
			label: 'Quality',
			style: 'expanded',
			isRequired: true,
			value: TIERS.some((t) => t.value === tier) ? tier : 'standard',
			choices: TIERS.map((t) => ({ title: t.title, value: t.value })),
		},
	];
	return card(body, { actions: [{ type: 'Action.Submit', title: 'Create model', style: 'positive', data: { action: 'createModel' } }] });
}

/** The live card while a job runs. */
export function forgeProgressCard(record, { now = Date.now() } = {}) {
	const body = [
		...header(record.parent ? 'Making a variation' : 'Making a 3D model'),
		promptBlock(record.prompt),
		byline(record),
		{
			type: 'Container',
			spacing: 'medium',
			items: [
				text(statusLine(record), { weight: 'bolder' }),
				text(`Checked {{TIME(${cardTime(now)})}}. The card updates itself for the requester and for the whole chat when the model is ready.`, {
					size: 'small',
					isSubtle: true,
					spacing: 'small',
				}),
			],
		},
	];
	const actions = [execute('Check progress', VERB_REFRESH, { key: record.key })];
	if (record.parent?.viewerUrl) actions.push({ type: 'Action.OpenUrl', title: 'Open previous model', url: record.parent.viewerUrl });
	return card(body, { actions, refresh: refreshFor(record) });
}

/** Stage view in Teams (the model opens full window inside the client). */
function openIn3d(record, origin) {
	const viewer = `${origin}/viewer?src=${encodeURIComponent(record.result.glbUrl)}`;
	return {
		type: 'Action.Submit',
		title: 'Open in 3D',
		data: {
			msteams: {
				type: 'invoke',
				value: {
					type: 'tab/tabInfoAction',
					tabInfo: {
						contentUrl: viewer,
						websiteUrl: record.result.viewerUrl || viewer,
						name: modelName(record.prompt),
						entityId: `forge-${record.key}`,
					},
				},
			},
		},
	};
}

/** A short title for a model: its prompt's first line, cut at a word boundary. */
export function modelName(prompt) {
	const first = String(prompt || '3D model').split('\n')[0].trim() || '3D model';
	if (first.length <= 80) return first;
	const cut = first.slice(0, 80);
	const space = cut.lastIndexOf(' ');
	return `${(space > 40 ? cut.slice(0, space) : cut).trimEnd()}...`;
}

/** The finished card: poster, model name, and the actions on the GLB. */
export function forgeFinishedCard(record, { origin = 'https://three.ws' } = {}) {
	const r = record.result || {};
	const name = modelName(record.prompt);
	const took = record.settledAt && record.createdAt ? ` · made in ${seconds((record.settledAt - record.createdAt) / 1000)}` : '';
	const body = [
		text(BRAND, { size: 'small', weight: 'bolder', color: 'accent', spacing: 'none' }),
		...(r.posterUrl
			? [{ type: 'Image', url: r.posterUrl, altText: `Rendered preview of ${name}`, size: 'stretch', spacing: 'small' }]
			: []),
		text(escapeMarkdown(name), { size: 'large', weight: 'bolder', spacing: 'small' }),
		...(name !== String(record.prompt || '').trim() ? [text(escapeMarkdown(record.prompt), { isSubtle: true, spacing: 'none' })] : []),
		byline(record, took),
	];
	const actions = [
		openIn3d(record, origin),
		{ type: 'Action.OpenUrl', title: 'Download GLB', url: r.glbUrl },
		execute('Make a variation', VERB_VARIATION, { key: record.key }),
		...(r.viewerUrl ? [{ type: 'Action.OpenUrl', title: 'Model page', url: r.viewerUrl }] : []),
	];
	return card(body, { actions });
}

/** The failure card: says what failed and offers a fresh attempt. */
export function forgeErrorCard(record) {
	const message = record?.error || 'The 3D generator did not return a model for this prompt.';
	const body = [
		...header('The 3D model could not be made'),
		text(escapeMarkdown(message), { color: 'attention', spacing: 'small' }),
		...(record?.prompt ? [promptBlock(record.prompt), byline(record)] : []),
		text('Try again starts a fresh generation of the same prompt.', { size: 'small', isSubtle: true, spacing: 'medium' }),
	];
	const actions = record?.prompt ? [execute('Try again', VERB_RETRY, { key: record.key })] : [];
	return card(body, { actions });
}

/** An attachment carrying one of these cards. */
export function cardAttachment(content) {
	return { contentType: CARD_CONTENT_TYPE, content };
}

/** The adaptiveCard/action response that swaps the card in place. */
export function cardInvokeResponse(content) {
	return { statusCode: 200, type: CARD_CONTENT_TYPE, value: content };
}

/** The adaptiveCard/action response for a request the bot refuses. */
export function errorInvokeResponse(statusCode, code, message) {
	return { statusCode, type: 'application/vnd.microsoft.error', value: { code, message } };
}

/** A task-module response that shows the form. */
export function formTaskResponse(form) {
	return {
		task: {
			type: 'continue',
			value: { title: 'Create a 3D model', height: 'medium', width: 'medium', card: cardAttachment(form) },
		},
	};
}
