#!/usr/bin/env node
// End-to-end check of the Teams "Create a 3D model" flow against a real forge.
//
// Runs the bot handler in this process (api/_lib/teams-bot.js handleActivity)
// exactly as the messaging endpoint calls it after token verification, with a
// real free-lane generation on the target deployment (STUDIO_API_BASE, default
// https://three.ws). No Teams tenant or bot secret is needed: without
// MS_TEAMS_BOT_APP_PASSWORD the action takes its compose-box path, and the run
// is awaited here instead of being dispatched to /api/microsoft-teams/forge-run.
//
// Steps: submitAction (the task-module submit) -> runTeamsForge -> an
// adaptiveCard/action refresh -> the finished card, validated against the
// Adaptive Cards 1.5 schema, and its GLB and poster URLs fetched.
//
//   node scripts/teams-forge-e2e.mjs ["a prompt"] [--tier draft|standard|high]

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Ajv from 'ajv';
import draft06 from 'ajv/dist/refs/json-schema-draft-06.json' with { type: 'json' };

process.env.STUDIO_API_BASE ||= 'https://three.ws';
delete process.env.MS_TEAMS_BOT_APP_PASSWORD;

const { handleActivity } = await import('../api/_lib/teams-bot.js');
const { runTeamsForge, loadJob } = await import('../api/_lib/teams-forge.js');

const args = process.argv.slice(2);
const tierAt = args.indexOf('--tier');
const tier = tierAt >= 0 ? args[tierAt + 1] : 'draft';
const prompt = args.find((a, i) => !a.startsWith('--') && i !== tierAt + 1) || `a brass desk lamp with a green glass shade, e2e ${new Date().toISOString().slice(0, 10)}`;

const origin = process.env.STUDIO_API_BASE.replace(/\/$/, '');
const user = { id: `29:threews-e2e-${randomUUID().slice(0, 8)}`, name: 'three.ws e2e', aadObjectId: randomUUID() };
const conversation = { id: `a:threews-e2e-${randomUUID()}` };
const serviceUrl = 'https://smba.trafficmanager.net/amer/';

const schema = JSON.parse(readFileSync(new URL('../tests/fixtures/adaptive-card-1.5.schema.json', import.meta.url), 'utf8'));
schema.$id = schema.id;
delete schema.id;
const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
ajv.addMetaSchema(draft06);
const validate = ajv.compile(schema);

const log = (...m) => console.log(`[teams-forge-e2e ${new Date().toISOString().slice(11, 19)}]`, ...m);
const fail = (msg) => {
	console.error(`FAIL: ${msg}`);
	process.exit(1);
};
const cardOf = (res) => res?.composeExtension?.attachments?.[0]?.content || res?.value;

let dispatched = null;
const ctx = { origin, selfBase: origin, deps: { dispatch: (key) => (dispatched = key) } };

log(`forge at ${origin}, tier ${tier}, prompt "${prompt}"`);
const submit = await handleActivity(
	{
		type: 'invoke',
		name: 'composeExtension/submitAction',
		id: `f:${randomUUID()}`,
		serviceUrl,
		from: user,
		conversation,
		channelId: 'msteams',
		value: { commandId: 'createModel', commandContext: 'compose', data: { prompt, tier } },
	},
	ctx,
);
const progress = cardOf(submit);
if (!progress) fail(`submitAction returned no card: ${JSON.stringify(submit)}`);
if (!validate(progress)) fail(`progress card is not valid AC 1.5: ${ajv.errorsText(validate.errors)}`);
if (!dispatched) fail('submitAction did not dispatch a job');
log(`progress card valid (AC ${progress.version}), job key ${dispatched}`);

const started = Date.now();
const final = await runTeamsForge(dispatched);
log(`run settled as "${final?.state}" in ${Math.round((Date.now() - started) / 1000)}s`);

const refreshed = await handleActivity(
	{
		type: 'invoke',
		name: 'adaptiveCard/action',
		id: `f:${randomUUID()}`,
		replyToId: '1:e2e',
		serviceUrl,
		from: user,
		conversation,
		channelId: 'msteams',
		value: { action: { type: 'Action.Execute', verb: 'forge.refresh', data: { key: dispatched } }, trigger: 'automatic' },
	},
	ctx,
);
const card = cardOf(refreshed);
if (refreshed?.statusCode !== 200 || !card) fail(`refresh returned ${JSON.stringify(refreshed)}`);
if (!validate(card)) fail(`finished card is not valid AC 1.5: ${ajv.errorsText(validate.errors)}`);
const record = await loadJob(dispatched);
if (record?.state !== 'done') fail(`job ended "${record?.state}": ${record?.error?.message || JSON.stringify(record?.error)}`);

const glb = card.actions?.find((a) => a.title === 'Download GLB')?.url;
const poster = card.body?.find((b) => b.type === 'Image')?.url;
const titles = (card.actions || []).map((a) => a.title);
log(`finished card valid, actions: ${titles.join(' | ')}`);

async function head(url, label) {
	const res = await fetch(url, { method: 'GET', headers: { range: 'bytes=0-15' } });
	const buf = Buffer.from(await res.arrayBuffer());
	log(`${label} ${res.status} ${res.headers.get('content-type')} ${url}`);
	if (!res.ok) fail(`${label} did not resolve (${res.status})`);
	return buf;
}
if (!glb) fail('finished card has no Download GLB url');
const magic = (await head(glb, 'GLB')).subarray(0, 4).toString('latin1');
if (magic !== 'glTF') fail(`GLB url did not return a glTF binary (magic "${magic}")`);
log('GLB magic "glTF" confirmed');
if (poster) await head(poster, 'poster');
log('PASS');
console.log(JSON.stringify({ key: dispatched, state: record.state, glbUrl: glb, posterUrl: poster || null, actions: titles }, null, 2));
process.exit(0);
