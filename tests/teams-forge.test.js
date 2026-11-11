// "Create a 3D model" in Teams (api/_lib/teams-forge-bot.js, teams-forge.js,
// teams-forge-cards.js). Real Bot Framework activity shapes go through
// handleActivity, and every card that comes back is validated against the
// published Adaptive Cards 1.5 schema (tests/fixtures/adaptive-card-1.5.schema.json,
// microsoft/AdaptiveCards schemas/1.5.0/adaptive-card.json, MIT).
//
// Activity shapes are Microsoft's documented examples:
//   composeExtension/submitAction (initial, edit, send):
//     https://learn.microsoft.com/en-us/microsoftteams/platform/messaging-extensions/how-to/action-commands/respond-to-task-module-submit
//   composeExtension/fetchTask:
//     https://learn.microsoft.com/en-us/microsoftteams/platform/messaging-extensions/how-to/action-commands/create-task-module
//   adaptiveCard/action (Action.Execute, trigger manual/automatic):
//     https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/universal-actions-for-adaptive-cards/work-with-universal-actions-for-adaptive-cards
//   message activity (Bot Framework activity schema):
//     https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-activities
// The generator and the Bot Connector are the only stand-ins: they are network
// boundaries, injected through the documented deps seam. The job store is the
// real cache module (its in-memory backend when no Redis is configured).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import draft06 from 'ajv/dist/refs/json-schema-draft-06.json' with { type: 'json' };
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from 'jose';
import { handleActivity, verifyBotToken, BOTFRAMEWORK_ISSUER, TeamsBotError } from '../api/_lib/teams-bot.js';
import {
	forgeKey,
	loadJob,
	claimJob,
	patchJob,
	runTeamsForge,
	outcomeOf,
	statusFromFrame,
} from '../api/_lib/teams-forge.js';
import { statusLine, escapeMarkdown, modelName, forgeFormCard, REFRESH_USER_LIMIT } from '../api/_lib/teams-forge-cards.js';
import { commandPrompt, plainText, promptProblem } from '../api/_lib/teams-forge-bot.js';
import { assertServiceUrl, connectorConfigured } from '../api/_lib/teams-connector.js';
import { startForge } from '../api/_mcp-studio/gpt-forge-client.js';

// The published file names itself with draft-04's `id`; Ajv reads `$id`.
const { id: schemaId, ...schemaBody } = JSON.parse(readFileSync(new URL('./fixtures/adaptive-card-1.5.schema.json', import.meta.url), 'utf8'));
const schema = { $id: schemaId, ...schemaBody };
const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
ajv.addMetaSchema(draft06);
const validateCard = ajv.compile(schema);

function expectValidCard(card) {
	const ok = validateCard(card);
	if (!ok) throw new Error(`card fails the Adaptive Cards 1.5 schema: ${JSON.stringify(validateCard.errors.slice(0, 5))}`);
	expect(card.version).toBe('1.5');
}

const SERVICE = 'https://smba.trafficmanager.net/amer/';
const ORIGIN = 'https://three.ws';
const SELF = 'https://three-ws-api.example.run.app';
const CONVERSATION = '19:7705841b240044b297123ad7f9c99217@thread.skype';
const USER = { id: '29:1yzCpmVa2GvH7R2kVqMU8kK7W5dwKDGNvnP3lZvI2BGo', name: 'Bob Smith', aadObjectId: 'c4e3f5b2-6a2a-4e3e-9f43-1d3b2c5f6a7b' };
const GLB = 'https://media.three.ws/forge/9b2f/model.glb';
const POSTER = 'https://media.three.ws/forge/9b2f/poster.png';

let seq = 0;
const nextId = () => `f:${Date.now()}${++seq}`;

// Microsoft's documented initial submitAction, with this app's command and form data.
function submitAction(data, extra = {}) {
	return {
		type: 'invoke',
		name: 'composeExtension/submitAction',
		id: nextId(),
		imdisplayname: USER.name,
		serviceUrl: SERVICE,
		from: USER,
		value: { commandId: 'createModel', commandContext: 'compose', context: { theme: 'default' }, data, ...extra },
		conversation: { id: CONVERSATION },
		channelId: 'msteams',
	};
}

// Microsoft's documented adaptiveCard/action invoke for an Action.Execute.
function cardAction(verb, data, { trigger = 'manual', replyToId = '1:1msgid', from = USER } = {}) {
	return {
		type: 'invoke',
		name: 'adaptiveCard/action',
		id: nextId(),
		replyToId,
		serviceUrl: SERVICE,
		from,
		conversation: { id: CONVERSATION },
		channelId: 'msteams',
		value: { action: { type: 'Action.Execute', id: 'actionId', verb, data }, trigger },
	};
}

function pending(jobId, { phase = 'running', elapsed = 42, eta = 80, cold = false, boot = null } = {}) {
	return {
		content: [{ type: 'text', text: 'still rendering' }],
		structuredContent: {
			status: 'pending',
			jobId,
			job_id: jobId,
			phase,
			progress: 0.34,
			eta_seconds: eta,
			elapsed_seconds: elapsed,
			...(cold ? { coldStart: true, ...(boot ? { coldStartRemainingSeconds: boot } : {}) } : {}),
		},
	};
}

const done = (jobId) => ({
	content: [{ type: 'text', text: 'done' }],
	structuredContent: {
		kind: 'model',
		status: 'done',
		glbUrl: GLB,
		glb_url: GLB,
		viewerUrl: `${ORIGIN}/viewer?src=${encodeURIComponent(GLB)}`,
		viewer_url: `${ORIGIN}/viewer?src=${encodeURIComponent(GLB)}`,
		poster_png_url: POSTER,
		job_id: jobId,
	},
});

const failed = (jobId) => ({
	isError: true,
	content: [{ type: 'text', text: 'Generation failed: the mesh came back empty. Start a new generation.' }],
	structuredContent: { status: 'failed', job_id: jobId, reason: 'generation_failed', remedy: 'Start a new generation.' },
});

function harness({ connector = false, collect = async () => pending('job-1'), forge, rateLimit = async () => null } = {}) {
	const calls = { dispatch: [], send: [], reply: [], update: [], collect: [], forge: [] };
	let posted = 0;
	const deps = {
		dispatch: async (key, base) => calls.dispatch.push({ key, base }),
		collect: async (origin, jobId, shape) => {
			calls.collect.push({ origin, jobId, shape });
			return collect(origin, jobId, shape);
		},
		forge: forge
			? async (args, ctx, origin) => {
					calls.forge.push({ args, ctx, origin });
					return forge(args, ctx, origin);
				}
			: undefined,
		rateLimit,
		sleep: async () => {},
		connector: {
			connectorConfigured: () => connector,
			sendToConversation: async (a) => {
				calls.send.push(a);
				return { id: `1:posted${++posted}` };
			},
			replyToActivity: async (a) => {
				calls.reply.push(a);
				return { id: `1:reply${++posted}` };
			},
			updateActivity: async (a) => {
				calls.update.push(a);
				return {};
			},
		},
	};
	if (!deps.forge) delete deps.forge;
	return { calls, ctx: { origin: ORIGIN, selfBase: SELF, deps } };
}

const cardOf = (r) => r.composeExtension?.attachments?.[0]?.content || r.composeExtension?.activityPreview?.attachments?.[0]?.content || r.value;

describe('fetchTask: the Create a 3D model form', () => {
	it('opens a task module with a valid 1.5 form card', async () => {
		const { ctx } = harness();
		const r = await handleActivity(
			{ type: 'invoke', name: 'composeExtension/fetchTask', id: nextId(), from: USER, serviceUrl: SERVICE, conversation: { id: CONVERSATION }, value: { commandId: 'createModel', commandContext: 'compose', context: { theme: 'default' } } },
			ctx,
		);
		expect(r.task.type).toBe('continue');
		expect(r.task.value.title).toBe('Create a 3D model');
		const form = r.task.value.card.content;
		expectValidCard(form);
		expect(form.body.find((b) => b.id === 'prompt')).toMatchObject({ type: 'Input.Text', isRequired: true, maxLength: 1000 });
		expect(form.body.find((b) => b.id === 'tier').choices.map((c) => c.value)).toEqual(['draft', 'standard', 'high']);
	});

	it('starts from the message text when invoked from a message menu', async () => {
		const { ctx } = harness();
		const r = await handleActivity(
			{
				type: 'invoke',
				name: 'composeExtension/fetchTask',
				id: nextId(),
				from: USER,
				value: { commandId: 'createModel', commandContext: 'message', messagePayload: { body: { contentType: 'html', content: '<p>a <b>red</b> vintage rotary phone</p>' } } },
			},
			ctx,
		);
		expect(r.task.value.card.content.body.find((b) => b.id === 'prompt').value).toBe('a red vintage rotary phone');
	});
});

describe('submitAction: starting a job', () => {
	it('without the Bot Connector, inserts the live card and dispatches one job per activity (Teams retries dedupe)', async () => {
		const { ctx, calls } = harness();
		const activity = submitAction({ prompt: 'a weathered brass ship compass', tier: 'draft', action: 'createModel' });
		const r = await handleActivity(activity, ctx);
		expect(r.composeExtension.type).toBe('result');
		const card = cardOf(r);
		expectValidCard(card);
		const key = forgeKey(CONVERSATION, activity.id);
		expect(card.refresh).toEqual({
			action: { type: 'Action.Execute', title: 'Check progress', verb: 'forge.refresh', data: { key } },
			userIds: [USER.id],
		});
		expect(JSON.stringify(card)).toContain('a weathered brass ship compass');
		expect(JSON.stringify(card)).toContain('Requested by Bob Smith');
		expect(calls.dispatch).toEqual([{ key, base: SELF }]);
		const record = await loadJob(key);
		expect(record).toMatchObject({ key, prompt: 'a weathered brass ship compass', tier: 'draft', state: 'starting', origin: ORIGIN });
		// Teams retries a submit that took over 5 seconds with the same activity.
		await handleActivity(activity, ctx);
		expect(calls.dispatch).toHaveLength(1);
	});

	it('re-shows the form with the reason when the prompt is too short or unsafe', async () => {
		const { ctx, calls } = harness();
		const r = await handleActivity(submitAction({ prompt: 'x', tier: 'standard' }), ctx);
		expect(r.task.type).toBe('continue');
		const form = r.task.value.card.content;
		expectValidCard(form);
		expect(JSON.stringify(form)).toContain('at least 3 characters');
		expect(calls.dispatch).toHaveLength(0);
	});

	it('re-shows the form when the requester is over the generation quota', async () => {
		const { ctx, calls } = harness({ rateLimit: async () => 'You started several models in the last minute. Wait a minute, then try again.' });
		const r = await handleActivity(submitAction({ prompt: 'a ceramic teapot', tier: 'standard' }), ctx);
		expect(JSON.stringify(r.task.value.card.content)).toContain('several models in the last minute');
		expect(calls.dispatch).toHaveLength(0);
	});

	it('with the Bot Connector, previews; Send posts on the requester\'s behalf and starts the job; Edit reopens the form', async () => {
		const { ctx, calls } = harness({ connector: true });
		const first = submitAction({ prompt: 'a low poly fox', tier: 'standard' });
		const preview = await handleActivity(first, ctx);
		expect(preview.composeExtension.type).toBe('botMessagePreview');
		const previewCard = cardOf(preview);
		expectValidCard(previewCard);
		expect(calls.dispatch).toHaveLength(0);
		const key = forgeKey(CONVERSATION, first.id);

		const edit = await handleActivity(
			submitAction(undefined, { botMessagePreviewAction: 'edit', botActivityPreview: [{ attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: previewCard }] }] }),
			ctx,
		);
		expect(edit.task.value.card.content.body.find((b) => b.id === 'prompt').value).toBe('a low poly fox');

		const sendActivity = submitAction(undefined, {
			botMessagePreviewAction: 'send',
			botActivityPreview: [{ attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: previewCard }] }],
		});
		expect(await handleActivity(sendActivity, ctx)).toEqual({});
		expect(calls.send).toHaveLength(1);
		expect(calls.send[0]).toMatchObject({ serviceUrl: SERVICE, conversationId: CONVERSATION });
		expect(calls.send[0].activity.channelData.onBehalfOf[0]).toEqual({ itemId: 0, mentionType: 'person', mri: USER.id, displayName: USER.name });
		expectValidCard(calls.send[0].activity.attachments[0].content);
		expect(calls.dispatch).toEqual([{ key, base: SELF }]);
		expect((await loadJob(key)).activityId).toBe('1:posted1');
		// A retried Send does not post twice.
		await handleActivity(sendActivity, ctx);
		expect(calls.send).toHaveLength(1);
	});
});

async function seedJob(patch = {}) {
	const key = forgeKey(CONVERSATION, nextId());
	await claimJob({ key, prompt: 'a weathered brass ship compass', tier: 'standard', by: USER, conversation: { id: CONVERSATION, serviceUrl: SERVICE }, origin: ORIGIN });
	await patchJob(key, patch);
	return key;
}

describe('adaptiveCard/action: refresh', () => {
	it('mid-job, answers the progress card with the server phase, elapsed time and ETA, never a percentage', async () => {
		const key = await seedJob({ state: 'running', jobId: 'job-mid', activityId: '1:posted' });
		const { ctx, calls } = harness({ connector: true, collect: async () => pending('job-mid', { elapsed: 42, eta: 80 }) });
		const r = await handleActivity(cardAction('forge.refresh', { key }, { trigger: 'automatic' }), ctx);
		expect(r).toMatchObject({ statusCode: 200, type: 'application/vnd.microsoft.card.adaptive' });
		expectValidCard(r.value);
		const text = JSON.stringify(r.value);
		expect(text).toContain('Rendering, 42s in, about 80s left.');
		expect(text).not.toMatch(/\d+%/);
		expect(r.value.refresh.userIds).toEqual([USER.id]);
		expect(calls.collect[0]).toMatchObject({ origin: ORIGIN, jobId: 'job-mid' });
		expect(calls.update).toHaveLength(0);
	});

	it('reports a cold GPU boot honestly', async () => {
		const key = await seedJob({ state: 'queued', jobId: 'job-cold' });
		const { ctx } = harness({ collect: async () => pending('job-cold', { phase: 'queued', elapsed: 20, eta: null, cold: true, boot: 70 }) });
		const r = await handleActivity(cardAction('forge.refresh', { key }), ctx);
		expect(JSON.stringify(r.value)).toContain('The GPU worker is waking up (about 70s of boot left).');
	});

	it('after success, answers the finished card and replaces the posted message for the whole chat once', async () => {
		const key = await seedJob({ state: 'running', jobId: 'job-ok', activityId: '1:posted' });
		const { ctx, calls } = harness({ connector: true, collect: async () => done('job-ok') });
		const r = await handleActivity(cardAction('forge.refresh', { key }, { trigger: 'automatic' }), ctx);
		const card = r.value;
		expectValidCard(card);
		expect(card.refresh).toBeUndefined();
		expect(card.body.find((b) => b.type === 'Image')).toMatchObject({ url: POSTER, size: 'stretch' });
		expect(card.actions.map((a) => a.title)).toEqual(['Open in 3D', 'Download GLB', 'Make a variation', 'Model page']);
		expect(card.actions[0].data.msteams.value).toMatchObject({
			type: 'tab/tabInfoAction',
			tabInfo: { contentUrl: `${ORIGIN}/viewer?src=${encodeURIComponent(GLB)}`, name: 'a weathered brass ship compass' },
		});
		expect(card.actions[1]).toEqual({ type: 'Action.OpenUrl', title: 'Download GLB', url: GLB });
		expect(card.actions[2]).toMatchObject({ type: 'Action.Execute', verb: 'forge.variation', data: { key } });
		expect(calls.update).toHaveLength(1);
		expect(calls.update[0]).toMatchObject({ serviceUrl: SERVICE, conversationId: CONVERSATION, activityId: '1:posted' });
		expectValidCard(calls.update[0].activity.attachments[0].content);
		const record = await loadJob(key);
		expect(record).toMatchObject({ state: 'done', broadcast: true, result: { glbUrl: GLB, posterUrl: POSTER } });
		await handleActivity(cardAction('forge.refresh', { key }), ctx);
		expect(calls.update).toHaveLength(1);
		expect(calls.collect).toHaveLength(1);
	});

	it('answers an expired job with a card that says so', async () => {
		const { ctx } = harness();
		const r = await handleActivity(cardAction('forge.refresh', { key: forgeKey('gone', 'gone') }), ctx);
		expectValidCard(r.value);
		expect(JSON.stringify(r.value)).toContain('no longer tracked');
	});

	it('rejects a verb this bot does not define', async () => {
		const { ctx } = harness();
		const r = await handleActivity(cardAction('approvalRequestSubmit', {}), ctx);
		expect(r).toEqual({ statusCode: 400, type: 'application/vnd.microsoft.error', value: { code: 'unknown_verb', message: 'This card action (approvalRequestSubmit) is not supported.' } });
	});
});

describe('adaptiveCard/action: variation', () => {
	const finished = { state: 'done', jobId: 'job-ok', result: { glbUrl: GLB, viewerUrl: `${ORIGIN}/viewer?src=x`, posterUrl: POSTER }, settledAt: Date.now() };

	it('without the connector, turns the card into the variation\'s progress card with a new seed and a link back', async () => {
		const key = await seedJob(finished);
		const { ctx, calls } = harness();
		const action = cardAction('forge.variation', { key });
		const r = await handleActivity(action, ctx);
		expectValidCard(r.value);
		const text = JSON.stringify(r.value);
		expect(text).toContain('Making a variation');
		expect(r.value.actions.find((a) => a.title === 'Open previous model').url).toBe(`${ORIGIN}/viewer?src=x`);
		const nextKey = forgeKey(CONVERSATION, action.id);
		expect(calls.dispatch).toEqual([{ key: nextKey, base: SELF }]);
		const next = await loadJob(nextKey);
		expect(next).toMatchObject({ prompt: 'a weathered brass ship compass', tier: 'standard', state: 'starting', parent: { key } });
		expect(Number.isInteger(next.seed)).toBe(true);
	});

	it('with the connector, posts a new progress message and leaves the finished card as it is', async () => {
		const key = await seedJob(finished);
		const { ctx, calls } = harness({ connector: true });
		const action = cardAction('forge.variation', { key });
		const r = await handleActivity(action, ctx);
		expect(r.value.actions.map((a) => a.title)).toContain('Download GLB');
		expect(calls.send).toHaveLength(1);
		expectValidCard(calls.send[0].activity.attachments[0].content);
		const nextKey = forgeKey(CONVERSATION, action.id);
		expect((await loadJob(nextKey)).activityId).toBe('1:posted1');
		expect(calls.dispatch).toEqual([{ key: nextKey, base: SELF }]);
	});
});

describe('failure', () => {
	it('a failed generation settles the job and the card says what failed, with Try again', async () => {
		const key = await seedJob({ activityId: '1:posted' });
		const { ctx, calls } = harness({ connector: true, forge: async () => pending('job-bad', { phase: 'queued' }), collect: async () => failed('job-bad') });
		const final = await runTeamsForge(key, ctx.deps);
		expect(final.state).toBe('failed');
		expect(final.error).toBe('Generation failed: the mesh came back empty.');
		const card = calls.update[0].activity.attachments[0].content;
		expectValidCard(card);
		expect(JSON.stringify(card)).toContain('Generation failed: the mesh came back empty.');
		expect(card.actions[0]).toMatchObject({ type: 'Action.Execute', title: 'Try again', verb: 'forge.retry', data: { key } });

		const retry = cardAction('forge.retry', { key });
		const r = await handleActivity(retry, ctx);
		expectValidCard(r.value);
		expect(JSON.stringify(r.value)).toContain('Making a 3D model');
		const nextKey = forgeKey(CONVERSATION, retry.id);
		expect(await loadJob(nextKey)).toMatchObject({ prompt: 'a weathered brass ship compass', activityId: '1:posted', state: 'starting' });
		expect(calls.dispatch.at(-1)).toEqual({ key: nextKey, base: SELF });
	});

	it('a generator that cannot be reached fails the job instead of hanging', async () => {
		const key = await seedJob();
		const { ctx } = harness({ forge: async () => { throw new Error('fetch failed'); } });
		const final = await runTeamsForge(key, ctx.deps);
		expect(final).toMatchObject({ state: 'failed', error: 'The 3D generator could not be reached: fetch failed' });
	});
});

describe('runTeamsForge', () => {
	it('runs forge_free with the job key as its idempotency key, polls the job, and settles with the model', async () => {
		const key = await seedJob({ activityId: '1:posted' });
		const results = [pending('job-run', { elapsed: 90, eta: 60 }), done('job-run')];
		const { ctx, calls } = harness({
			connector: true,
			forge: async (_args, c) => {
				c.onProgress({ status: 'queued', job_id: 'job-run', elapsed_seconds: 3, eta_seconds: 150 }, 'model');
				return pending('job-run', { phase: 'queued', elapsed: 30 });
			},
			collect: async () => results.shift(),
		});
		const final = await runTeamsForge(key, ctx.deps);
		expect(calls.forge[0].args).toEqual({ prompt: 'a weathered brass ship compass', tier: 'standard', idempotency_key: key });
		expect(calls.forge[0].ctx.caller).toBe(`teams:${USER.id}`);
		expect(calls.forge[0].ctx.seed).toBeUndefined();
		expect(calls.collect).toHaveLength(2);
		expect(final).toMatchObject({ state: 'done', jobId: 'job-run', broadcast: true, result: { glbUrl: GLB } });
		expect(calls.update).toHaveLength(1);
		// A second run of a settled job is a no-op.
		await runTeamsForge(key, ctx.deps);
		expect(calls.forge).toHaveLength(1);
	});

	it('passes a variation\'s seed to the generator', async () => {
		const key = forgeKey(CONVERSATION, nextId());
		await claimJob({ key, prompt: 'a ceramic teapot', tier: 'draft', by: USER, conversation: { id: CONVERSATION, serviceUrl: SERVICE }, origin: ORIGIN, seed: 12345 });
		const { ctx, calls } = harness({ forge: async () => done('job-seed') });
		await runTeamsForge(key, ctx.deps);
		expect(calls.forge[0].ctx.seed).toBe(12345);
	});
});

describe('the variation seed reaches /api/gpt-forge', () => {
	const realFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	it('sends a non-negative integer seed and drops anything else', async () => {
		const bodies = [];
		globalThis.fetch = async (_url, init) => {
			bodies.push(JSON.parse(init.body));
			return { ok: true, status: 200, json: async () => ({ status: 'queued', job_id: 'job-s' }) };
		};
		await startForge(ORIGIN, { prompt: 'a lamp', tier: 'standard', seed: 987654 });
		await startForge(ORIGIN, { prompt: 'a lamp', tier: 'standard', seed: -1 });
		await startForge(ORIGIN, { prompt: 'a lamp', tier: 'standard' });
		expect(bodies[0].seed).toBe(987654);
		expect('seed' in bodies[1]).toBe(false);
		expect('seed' in bodies[2]).toBe(false);
	});
});

describe('the forge bot command', () => {
	it('replies to "forge <prompt>" with the live card and starts the job', async () => {
		const { ctx, calls } = harness({ connector: true });
		const message = {
			type: 'message',
			id: nextId(),
			text: '<at>three.ws</at> forge a glass chess knight',
			from: USER,
			serviceUrl: SERVICE,
			conversation: { id: CONVERSATION },
			channelId: 'msteams',
		};
		expect(await handleActivity(message, ctx)).toBeNull();
		expect(calls.reply).toHaveLength(1);
		expect(calls.reply[0]).toMatchObject({ serviceUrl: SERVICE, conversationId: CONVERSATION, activityId: message.id });
		expectValidCard(calls.reply[0].activity.attachments[0].content);
		const key = forgeKey(CONVERSATION, message.id);
		expect(await loadJob(key)).toMatchObject({ prompt: 'a glass chess knight', activityId: '1:reply1' });
		expect(calls.dispatch).toEqual([{ key, base: SELF }]);
	});

	it('answers a bare command with how to use it, and stays silent without the connector', async () => {
		const withConnector = harness({ connector: true });
		await handleActivity({ type: 'message', id: nextId(), text: 'forge', from: USER, serviceUrl: SERVICE, conversation: { id: CONVERSATION } }, withConnector.ctx);
		expect(withConnector.calls.reply[0].activity.text).toContain('followed by a description');
		const without = harness();
		expect(await handleActivity({ type: 'message', id: nextId(), text: 'forge a lamp', from: USER, serviceUrl: SERVICE, conversation: { id: CONVERSATION } }, without.ctx)).toBeNull();
		expect(without.calls.dispatch).toHaveLength(0);
	});

	it('reads the command out of Teams message HTML', () => {
		expect(commandPrompt('<at>three.ws</at> forge   a <b>red</b> kettle')).toBe('a red kettle');
		expect(commandPrompt('/forge')).toBe('');
		expect(commandPrompt('hello')).toBeNull();
		expect(plainText('a&nbsp;b &amp; c<br/>d')).toBe('a b & c\nd');
		expect(promptProblem('  ')).toMatch(/at least 3/);
		expect(promptProblem('x'.repeat(1001))).toMatch(/under 1000/);
		expect(promptProblem('a ceramic teapot')).toBeNull();
	});
});

describe('cards and status mapping', () => {
	it('maps forge frames and results without inventing progress', () => {
		expect(statusFromFrame({ status: 'queued', cold_start: true, cold_start_seconds: 90, elapsed_seconds: 30 })).toMatchObject({ phase: 'queued', cold: true, coldBootLeft: 60 });
		expect(outcomeOf({ isError: true, content: [{ text: 'busy' }], structuredContent: { retryable: true } })).toBeNull();
		expect(statusLine({ state: 'starting' })).toBe('Starting: sending the prompt to the 3D generator.');
		expect(statusLine({ state: 'running', jobId: 'j', status: { phase: 'running', elapsed: 200, eta: null } })).toBe('Rendering, 3m 20s in. Heavier scenes take a few minutes.');
	});

	it('escapes Markdown in prompts and names long prompts at a word boundary', () => {
		expect(escapeMarkdown('a *bold* [link](x) `code`')).toBe('a \\*bold\\* \\[link\\](x) \\`code\\`');
		const long = 'a very detailed antique wooden sailing ship with full rigging and canvas sails, brass fittings and a carved figurehead';
		expect(modelName(long).length).toBeLessThanOrEqual(83);
		expect(modelName(long).endsWith('...')).toBe(true);
	});

	it('the schema check is real: it rejects malformed cards', () => {
		expect(validateCard({ type: 'AdaptiveCard', version: '1.5', body: [{ type: 'Image', url: 'x', size: 'huge' }] })).toBe(false);
		expect(validateCard({ type: 'AdaptiveCard', version: '1.5', body: [], actions: [{ type: 'Action.Execute', verb: 3 }] })).toBe(false);
		expect(validateCard({ type: 'AdaptiveCard', version: '1.5', body: [], refresh: { action: { type: 'Action.OpenUrl', url: 'x' } } })).toBe(false);
	});

	it('keeps refresh.userIds within the Teams limit of 60 MRIs', () => {
		expect(REFRESH_USER_LIMIT).toBe(60);
		expectValidCard(forgeFormCard({ prompt: 'p', tier: 'nonsense', error: 'e' }));
	});
});

describe('Bot Connector guard rails', () => {
	it('only sends the bot token to Bot Connector hosts over https', () => {
		expect(assertServiceUrl('https://smba.trafficmanager.net/amer/')).toBe('https://smba.trafficmanager.net/amer');
		expect(() => assertServiceUrl('https://attacker.example/')).toThrow(/unrecognized/);
		expect(() => assertServiceUrl('http://smba.trafficmanager.net/amer/')).toThrow(/unrecognized/);
		expect(() => assertServiceUrl('not a url')).toThrow(/serviceUrl/);
	});

	it('is configured only with both the app id and the secret', () => {
		expect(connectorConfigured({ MS_TEAMS_BOT_APP_ID: 'a' })).toBe(false);
		expect(connectorConfigured({ MS_TEAMS_BOT_APP_ID: 'a', MS_TEAMS_BOT_APP_PASSWORD: 's' })).toBe(true);
	});
});

describe('verifyBotToken covers every new invoke type', () => {
	const APP = '5d1c2b3a-0000-4000-8000-00000000b071';
	let keys;
	let privateKey;
	let otherKey;
	beforeEach(async () => {
		process.env.MS_TEAMS_BOT_APP_ID = APP;
		const pair = await generateKeyPair('RS256');
		privateKey = pair.privateKey;
		otherKey = (await generateKeyPair('RS256')).privateKey;
		keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' }] });
	});
	const sign = (key, claims = {}) =>
		new SignJWT({ serviceurl: SERVICE, ...claims })
			.setProtectedHeader({ alg: 'RS256', kid: 'k1' })
			.setIssuer(BOTFRAMEWORK_ISSUER)
			.setAudience(APP)
			.setIssuedAt()
			.setExpirationTime('5m')
			.sign(key);

	for (const [label, activity] of [
		['composeExtension/fetchTask', { type: 'invoke', name: 'composeExtension/fetchTask', serviceUrl: SERVICE }],
		['composeExtension/submitAction', submitAction({ prompt: 'a fox' })],
		['adaptiveCard/action', cardAction('forge.refresh', { key: 'k' })],
		['message (forge command)', { type: 'message', text: 'forge a fox', serviceUrl: SERVICE }],
	]) {
		it(`accepts a signed Bot Framework token and rejects a forged one for ${label}`, async () => {
			await expect(verifyBotToken(`Bearer ${await sign(privateKey)}`, { serviceUrl: activity.serviceUrl, keys })).resolves.toMatchObject({ aud: APP });
			await expect(verifyBotToken(`Bearer ${await sign(otherKey)}`, { serviceUrl: activity.serviceUrl, keys })).rejects.toBeInstanceOf(TeamsBotError);
			await expect(verifyBotToken(undefined, { serviceUrl: activity.serviceUrl, keys })).rejects.toMatchObject({ code: 'missing_token' });
			await expect(verifyBotToken(`Bearer ${await sign(privateKey, { serviceurl: 'https://attacker.example/' })}`, { serviceUrl: activity.serviceUrl, keys })).rejects.toMatchObject({ code: 'invalid_token' });
		});
	}
});
