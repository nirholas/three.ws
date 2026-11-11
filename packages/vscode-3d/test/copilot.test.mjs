// GitHub Copilot integration: the @threews participant, the agent-mode tools and
// the MCP server provider.
//
// Routing and the manifest are checked as pure code. Everything else runs the
// shipped dist/extension.cjs against the stand-in host and the live studio at
// THREEWS_ORIGIN (default https://three.ws): the catalog search, a real free
// generation collected through check_job, an <agent-3d> release lookup, and the
// local inspect and optimize tools over a real catalog GLB. Set THREEWS_OFFLINE=1
// to skip only the network cases.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import Module from 'node:module';

import { COMMANDS, PARTICIPANT_ID, findSubject, followupsFor, forgeSubject, kindFromText, routeRequest, urlIn } from '../src/chat-routing.js';
import { TOOL_SPECS, contributionOf } from '../src/copilot-tools.js';
import { MCP_PROVIDER_ID, serverList, validateApiKey } from '../src/mcp-servers.js';

const require = createRequire(import.meta.url);
const { vscode, state } = require('./fake-vscode.cjs');
const load = Module._load;
Module._load = function (request, parent, isMain) {
	if (request === 'vscode') return vscode;
	return load.call(this, request, parent, isMain);
};

const ORIGIN = (process.env.THREEWS_ORIGIN || 'https://three.ws').replace(/\/+$/, '');
const live = { skip: process.env.THREEWS_OFFLINE === '1' ? 'THREEWS_OFFLINE=1' : false };
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const extension = require('../dist/extension.cjs');

state.config['origin'] = ORIGIN;
// Only files the tests wrote exist, so path resolution is checked for real.
state.strictStat = true;
const memento = () => {
	const store = new Map();
	return { get: (k, d) => (store.has(k) ? store.get(k) : d), update: (k, v) => (v === undefined ? store.delete(k) : store.set(k, v), Promise.resolve()) };
};
const secrets = new Map();
const context = {
	subscriptions: [],
	extensionUri: vscode.Uri.file('/ext'),
	globalStorageUri: vscode.Uri.file('/global'),
	extension: { packageJSON: manifest },
	workspaceState: memento(),
	globalState: memento(),
	secrets: {
		get: (k) => Promise.resolve(secrets.get(k)),
		store: (k, v) => (secrets.set(k, v), Promise.resolve()),
		delete: (k) => (secrets.delete(k), Promise.resolve()),
	},
};
extension.activate(context);

/** A chat response stream that records what the participant sent. */
function recorder() {
	const parts = [];
	return {
		parts,
		markdown: (value) => parts.push({ kind: 'markdown', value: String(value?.value ?? value) }),
		progress: (value) => parts.push({ kind: 'progress', value }),
		button: (command) => parts.push({ kind: 'button', command }),
		anchor: (value, title) => parts.push({ kind: 'anchor', value, title }),
		reference: (value) => parts.push({ kind: 'reference', value }),
		text: () => parts.filter((p) => p.kind === 'markdown').map((p) => p.value).join(''),
		buttons: () => parts.filter((p) => p.kind === 'button').map((p) => p.command),
	};
}

function token() {
	const listeners = new Set();
	return {
		isCancellationRequested: false,
		onCancellationRequested: (fn) => (listeners.add(fn), { dispose: () => listeners.delete(fn) }),
		cancel() {
			this.isCancellationRequested = true;
			for (const fn of listeners) fn();
		},
	};
}

const chat = (prompt, command) => {
	const stream = recorder();
	const t = token();
	const run = state.participants.get(PARTICIPANT_ID).handler({ prompt, command, references: [], toolReferences: [] }, { history: [] }, stream, t);
	return { stream, token: t, run };
};

const invoke = (name, input) => state.tools.get(name).invoke({ input, toolInvocationToken: undefined }, token());
const textOf = (result) => result.content.map((p) => p.value).join('');

// ----------------------------------------------------------------- routing

test('a slash command always wins and keeps the request text as the subject', () => {
	assert.deepEqual(routeRequest({ command: 'forge', prompt: 'make me a low-poly lantern for my scene' }), { command: 'forge', subject: 'a low-poly lantern', inferred: false });
	assert.deepEqual(routeRequest({ command: 'find', prompt: 'is there a wooden chair?' }), { command: 'find', subject: 'wooden chair', inferred: false });
	assert.equal(routeRequest({ command: 'rig', prompt: 'https://x.test/a.glb' }).subject, 'https://x.test/a.glb');
});

test('a request without a command is routed by what it asks for', () => {
	const cases = [
		['find a rigged character', 'find'],
		['are there any ready-made trees', 'find'],
		['rig the robot so I can animate it', 'rig'],
		['give me the <agent-3d> snippet', 'embed'],
		['embed this model on my page', 'embed'],
		['generate a brass telescope', 'forge'],
		['create a 3d model of a toaster', 'forge'],
		['what time is it', 'help'],
		['', 'help'],
	];
	for (const [prompt, command] of cases) assert.equal(routeRequest({ prompt }).command, command, prompt);
	assert.equal(routeRequest({ prompt: 'make a cat' }).inferred, true);
	assert.equal(routeRequest({ command: 'nope', prompt: 'make a cat' }).command, 'forge', 'an unknown command falls back to intent');
});

test('subjects lose the request framing', () => {
	assert.equal(forgeSubject('Please make me a 3D model of a red fire hydrant for my game.'), 'a red fire hydrant');
	assert.equal(forgeSubject('a glossy white robot'), 'a glossy white robot');
	assert.equal(findSubject('search for some oak tree models'), 'oak tree');
	assert.equal(findSubject('do you have a ready-made sofa?'), 'sofa');
	assert.equal(kindFromText('a walk cycle animation'), 'animation');
	assert.equal(kindFromText('a rigged knight character'), 'character');
	assert.equal(kindFromText('a lamp'), undefined);
	assert.equal(urlIn('rig https://cdn.test/m/robot.glb, please.'), 'https://cdn.test/m/robot.glb');
	assert.equal(urlIn('rig my robot'), null);
});

test('follow-ups chain the next useful command to @threews', () => {
	const forged = followupsFor({ command: 'forge', glbUrl: 'https://cdn.test/a.glb', subject: 'a lantern' });
	assert.deepEqual(forged.map((f) => f.command), ['rig', 'embed', 'find']);
	assert.ok(forged.every((f) => f.participant === PARTICIPANT_ID));
	assert.equal(forged[0].prompt, 'https://cdn.test/a.glb');
	assert.deepEqual(followupsFor({ command: 'rig', glbUrl: 'https://cdn.test/b.glb' }).map((f) => f.command), ['embed']);
	assert.deepEqual(followupsFor({ command: 'find', subject: 'unicorn lamp', found: 0 }).map((f) => f.command), ['forge']);
	assert.deepEqual(followupsFor({ command: 'find', subject: 'chair', found: 3, firstGlbUrl: 'https://cdn.test/c.glb' }).map((f) => f.command), ['embed', 'forge']);
	assert.equal(followupsFor({ command: 'help' }).length, 2);
	assert.deepEqual(followupsFor({ command: 'forge', failed: true }), []);
});

// ---------------------------------------------------------------- manifest

test('package.json declares exactly the participant, tools and provider the code registers', () => {
	const [participant] = manifest.contributes.chatParticipants;
	assert.equal(participant.id, PARTICIPANT_ID);
	assert.equal(participant.name, 'threews');
	assert.deepEqual(participant.commands.map((c) => c.name), COMMANDS.map((c) => c.name));
	assert.deepEqual(manifest.contributes.languageModelTools, TOOL_SPECS.map(contributionOf));
	assert.deepEqual(manifest.contributes.mcpServerDefinitionProviders.map((p) => p.id), [MCP_PROVIDER_ID]);
	for (const spec of TOOL_SPECS) assert.ok(manifest.activationEvents.includes(`onLanguageModelTool:${spec.name}`), spec.name);
	assert.ok(manifest.activationEvents.includes(`onChatParticipant:${PARTICIPANT_ID}`));
	assert.ok(manifest.activationEvents.includes(`onMcpCollection:${MCP_PROVIDER_ID}`));
});

test('engines.vscode covers the finalized chat, tool and MCP APIs (1.101)', () => {
	const [major, minor] = manifest.engines.vscode.replace(/^\^/, '').split('.').map(Number);
	assert.ok(major > 1 || minor >= 101, manifest.engines.vscode);
	const types = manifest.devDependencies['@types/vscode'].replace(/^\^/, '');
	assert.equal(types, manifest.engines.vscode.replace(/^\^/, ''), '@types/vscode must not offer APIs newer than engines allows');
});

test('every tool schema is a closed, documented object schema', () => {
	for (const spec of TOOL_SPECS) {
		const schema = spec.inputSchema;
		assert.equal(schema.type, 'object', spec.name);
		assert.ok(spec.name.length <= 64 && /^[a-z0-9_]+$/.test(spec.name), `${spec.name} is not a valid tool name`);
		assert.ok(schema.required.length > 0, `${spec.name} requires nothing`);
		for (const key of schema.required) assert.ok(schema.properties[key], `${spec.name} requires undeclared ${key}`);
		for (const [key, prop] of Object.entries(schema.properties)) {
			assert.ok(prop.type, `${spec.name}.${key} has no type`);
			assert.ok(prop.description?.length > 10, `${spec.name}.${key} is undocumented`);
		}
		assert.ok(spec.modelDescription.length > 80, `${spec.name} tells the model too little`);
	}
});

// ------------------------------------------------------------ registration

test('activation registers the participant, all five tools and the MCP provider', () => {
	const participant = state.participants.get(PARTICIPANT_ID);
	assert.ok(participant, 'no @threews participant');
	assert.equal(typeof participant.followupProvider.provideFollowups, 'function');
	assert.deepEqual([...state.tools.keys()].sort(), TOOL_SPECS.map((s) => s.name).sort());
	assert.ok(state.mcpProviders.has(MCP_PROVIDER_ID));
	assert.ok(state.commands.has('threews3d.signIn') && state.commands.has('threews3d.signOut'));
});

test('tools that spend quota or write files ask first; read-only tools do not', () => {
	const prepare = (name, input) => state.tools.get(name).prepareInvocation({ input }, token());
	const generate = prepare('threews_generate_model', { prompt: 'a brass lantern' });
	assert.match(generate.confirmationMessages.title, /Generate/);
	assert.match(generate.confirmationMessages.message.value, /free generation quota/);
	assert.match(generate.confirmationMessages.message.value, /saves the GLB/);
	assert.doesNotMatch(prepare('threews_generate_model', { prompt: 'x lamp', saveToWorkspace: false }).confirmationMessages.message.value, /saves the GLB/);
	assert.ok(prepare('threews_optimize_glb', { path: 'models/a.glb' }).confirmationMessages);
	assert.ok(prepare('threews_check_job', { jobId: 'abcdefgh' }).confirmationMessages, 'saving a checked job writes a file');
	assert.equal(prepare('threews_check_job', { jobId: 'abcdefgh', saveToWorkspace: false }).confirmationMessages, undefined);
	assert.equal(prepare('threews_find_asset', { query: 'chair' }).confirmationMessages, undefined);
	assert.equal(prepare('threews_inspect_glb', { path: 'models/a.glb' }).confirmationMessages, undefined);
	assert.match(prepare('threews_find_asset', { query: 'chair' }).invocationMessage, /chair/);
});

test('local tools refuse paths outside the workspace and non-model files', async () => {
	await assert.rejects(invoke('threews_inspect_glb', { path: '../secrets/a.glb' }), /climb out/);
	await assert.rejects(invoke('threews_inspect_glb', { path: 'notes.txt' }), /not a \.glb/);
	await assert.rejects(invoke('threews_optimize_glb', { path: '/etc/model.glb' }), /outside the open workspace/);
});

test('the MCP provider always offers the free studio and adds the account server after sign-in', async () => {
	const provider = state.mcpProviders.get(MCP_PROVIDER_ID);
	let fired = 0;
	provider.onDidChangeMcpServerDefinitions(() => fired++);

	let servers = await provider.provideMcpServerDefinitions(token());
	assert.deepEqual(servers.map((s) => s.uri.toString()), [vscode.Uri.parse(`${ORIGIN}/api/mcp-studio`).toString()]);
	assert.equal(servers[0].label, 'three.ws Studio (free)');
	assert.equal(servers[0].version, manifest.version);

	state.quickPick = (items) => items.find((i) => i.mode === 'oauth');
	await state.commands.get('threews3d.signIn')();
	servers = await provider.provideMcpServerDefinitions(token());
	assert.equal(servers.length, 2);
	assert.equal(servers[1].uri.toString(), vscode.Uri.parse(`${ORIGIN}/api/mcp`).toString());
	assert.deepEqual(servers[1].headers, {}, 'OAuth mode leaves the token to VS Code');
	assert.equal(fired, 1);

	await state.commands.get('threews3d.signOut')();
	assert.equal((await provider.provideMcpServerDefinitions(token())).length, 1);
	assert.equal(fired, 2);
	state.quickPick = null;
});

test('serverList attaches a pasted key as a bearer header', () => {
	const servers = serverList({ origin: 'https://three.ws/', account: { mode: 'key', key: 'sk_live_abcdefgh123' }, version: '0.3.0' });
	assert.deepEqual(servers.map((s) => s.uri), ['https://three.ws/api/mcp-studio', 'https://three.ws/api/mcp']);
	assert.deepEqual(servers[1].headers, { Authorization: 'Bearer sk_live_abcdefgh123' });
	assert.equal(serverList({ origin: 'https://three.ws', account: { mode: 'key', key: '' } }).length, 1);
});

// --------------------------------------------------------------- live calls

test('a wrong API key is rejected by the live account server and never stored', live, async () => {
	assert.equal((await validateApiKey(ORIGIN, 'not-a-key')).ok, false);
	const check = await validateApiKey(ORIGIN, 'sk_' + 'live_threewsVscodeTestKeyThatDoesNotExist');
	assert.equal(check.ok, false);
	assert.match(check.message, /rejected that key/);

	state.quickPick = (items) => items.find((i) => i.mode === 'key');
	state.inputBox = () => 'sk_' + 'live_threewsVscodeTestKeyThatDoesNotExist';
	const before = state.messages.length;
	await state.commands.get('threews3d.signIn')();
	assert.equal(secrets.size, 0);
	assert.match(state.messages.slice(before).map((m) => m[1]).join(' '), /rejected that key/);
	assert.equal((await state.mcpProviders.get(MCP_PROVIDER_ID).provideMcpServerDefinitions(token())).length, 1);
	state.quickPick = null;
	state.inputBox = null;
});

test('the free studio MCP server the provider registers answers tools/list', live, async () => {
	const [studio] = await state.mcpProviders.get(MCP_PROVIDER_ID).provideMcpServerDefinitions(token());
	const res = await fetch(`${ORIGIN}/api/mcp-studio`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', accept: 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
	});
	assert.equal(res.status, 200);
	const names = (await res.json()).result.tools.map((t) => t.name);
	for (const name of ['forge_free', 'check_job', 'rig_mesh', 'search_catalog']) assert.ok(names.includes(name), `${studio.label} lacks ${name}`);
});

let catalogGlb = null;

test('threews_find_asset searches the live catalog and returns usable URLs', live, async () => {
	const text = textOf(await invoke('threews_find_asset', { query: 'chair', kind: 'object', limit: 3 }));
	assert.match(text, /match(es)? for "chair"/);
	catalogGlb = /glb_url: (\S+\.glb)/.exec(text)?.[1];
	assert.ok(catalogGlb, `no GLB URL in:\n${text}`);
	assert.match(text, /viewer_url: https:\/\//);
	const none = textOf(await invoke('threews_find_asset', { query: 'zzqxv nonexistent widget' }));
	assert.match(none, /No catalog items match/);
	assert.match(none, /threews_generate_model/);
});

test('threews_inspect_glb and threews_optimize_glb work on a real catalog model in the workspace', live, async () => {
	assert.ok(catalogGlb, 'the catalog test found no GLB');
	const res = await fetch(catalogGlb);
	assert.equal(res.status, 200);
	state.fileBytes.set('/workspace/models/chair.glb', new Uint8Array(await res.arrayBuffer()));

	const report = textOf(await invoke('threews_inspect_glb', { path: 'models/chair.glb' }));
	assert.match(report, /^models\/chair\.glb/);
	assert.match(report, /Triangles: [\d,]+/);
	assert.match(report, /Materials: \d+/);

	const optimized = textOf(await invoke('threews_optimize_glb', { path: 'workspace/models/chair.glb', preset: 'balanced' }));
	assert.match(optimized, /Wrote models\/chair\.web\.glb \(balanced preset\)/);
	assert.match(optimized, /original models\/chair\.glb is unchanged/);
	const written = state.fileBytes.get('/workspace/models/chair.web.glb');
	assert.ok(written?.byteLength > 0);
	assert.equal(new TextDecoder().decode(written.slice(0, 4)), 'glTF');
});

test('@threews /find lists live catalog hits with viewer and save buttons', live, async () => {
	const { stream, run } = chat('wooden chair', 'find');
	const result = await run;
	assert.equal(result.errorDetails, undefined, result.errorDetails?.message);
	assert.match(stream.text(), /match(es)? for \*\*wooden chair\*\*/);
	const [open, save] = stream.buttons();
	assert.equal(open.command, 'threews3d.previewUrl');
	assert.equal(save.command, 'threews3d.importGalleryItem');
	assert.equal(save.arguments[0].glbUrl, open.arguments[0]);
	assert.equal(result.metadata.firstGlbUrl, open.arguments[0]);
	const followups = state.participants.get(PARTICIPANT_ID).followupProvider.provideFollowups(result);
	assert.deepEqual(followups.map((f) => f.command), ['embed', 'forge']);
});

test('@threews /embed inserts a live, SRI-pinned <agent-3d> snippet into the open file', live, async () => {
	const edits = [];
	vscode.window.activeTextEditor = {
		document: { uri: vscode.Uri.file('/workspace/index.html') },
		selections: [{ start: 0, end: 0 }],
		edit: (fn) => (fn({ replace: (sel, text) => edits.push(text) }), Promise.resolve(true)),
	};
	try {
		const { stream, run } = chat('https://three.ws/avatars/default.glb', 'embed');
		const result = await run;
		assert.equal(result.errorDetails, undefined, result.errorDetails?.message);
		assert.equal(edits.length, 1);
		assert.match(edits[0], /<agent-3d[^>]+body="https:\/\/three\.ws\/avatars\/default\.glb"/);
		assert.match(edits[0], /<script[^>]+src="https:\/\/three\.ws\/agent-3d\/[\d.]+\/agent-3d\.js"/);
		assert.match(edits[0], /integrity="sha384-/);
		assert.match(stream.text(), /Inserted the embed .* into `index\.html`/);
	} finally {
		vscode.window.activeTextEditor = undefined;
	}
});

test('@threews /rig without a model explains how to point at one, without spending quota', async () => {
	const { stream, run } = chat('rig my character', 'rig');
	const result = await run;
	assert.equal(result.metadata.needsSource, true);
	assert.match(stream.text(), /Which model\?/);
	assert.equal(stream.buttons().length, 0);
});

test('a cancelled request stops cleanly and says so', live, async () => {
	const { stream, token: t, run } = chat('wooden chair', 'find');
	t.cancel();
	const result = await run;
	assert.equal(result.metadata.cancelled, true);
	assert.match(stream.text(), /Stopped/);
});

test('an unreachable studio is explained in chat with a recovery step', async () => {
	state.config['origin'] = 'http://127.0.0.1:9';
	try {
		const { run } = chat('wooden chair', 'find');
		const result = await run;
		assert.match(result.errorDetails.message, /^Searching the catalog failed: could not reach/);
		assert.match(result.errorDetails.message, /threews3d\.origin/);
	} finally {
		state.config['origin'] = ORIGIN;
	}
});

test('a studio refusal is explained with the studio words, not misread as a rate limit', async () => {
	const { createServer } = await import('node:http');
	const reply = 'Could not generate the model right now. Please try again.';
	const server = createServer((req, res) => {
		res.setHeader('content-type', 'application/json');
		res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: reply }] } }));
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	state.config['origin'] = `http://127.0.0.1:${server.address().port}`;
	try {
		const { run } = chat('a brass lantern', 'forge');
		const result = await run;
		assert.match(result.errorDetails.message, /^Generating the model failed: Could not generate the model right now/);
		assert.doesNotMatch(result.errorDetails.message, /share is used up/);
		assert.match(result.errorDetails.message, /Try again in a moment/);
	} finally {
		state.config['origin'] = ORIGIN;
		server.close();
	}
});

test('threews_generate_model and threews_check_job collect a real free generation', { ...live, timeout: 12 * 60_000 }, async () => {
	const prompt = 'a small wooden treasure chest with brass corners';
	let text = textOf(await invoke('threews_generate_model', { prompt, tier: 'draft', saveToWorkspace: true }));
	const seen = [text];
	const deadline = Date.now() + 10 * 60_000;
	while (text.startsWith('status: pending')) {
		const jobId = /jobId: (\S+)/.exec(text)?.[1];
		assert.ok(jobId, text);
		assert.match(text, /Call threews_check_job with this jobId/);
		assert.ok(Date.now() < deadline, `still pending after 10 minutes:\n${text}`);
		await new Promise((r) => setTimeout(r, 15_000));
		text = textOf(await invoke('threews_check_job', { jobId, prompt, saveToWorkspace: true }));
		seen.push(text);
	}
	assert.match(text, /^status: done/, seen.join('\n---\n'));
	assert.match(text, /glb_url: https:\/\//);
	const saved = /saved_to: (\S+)/.exec(text)?.[1];
	assert.ok(saved, text);
	const bytes = state.fileBytes.get(`/workspace/${saved}`);
	assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'glTF', `${saved} is not a GLB`);
});

test('@threews /forge streams honest status and ends with open and save buttons', { ...live, timeout: 12 * 60_000 }, async () => {
	const { stream, run } = chat('make me a small wooden treasure chest with brass corners for my game', 'forge');
	const result = await run;
	assert.equal(result.errorDetails, undefined, result.errorDetails?.message);
	assert.equal(result.metadata.subject, 'a small wooden treasure chest with brass corners');
	const progress = stream.parts.filter((p) => p.kind === 'progress').map((p) => p.value);
	assert.match(progress[0], /free three\.ws text to 3D lane/);
	for (const line of progress.slice(1)) assert.match(line, /rendering|rigging|waking up/i, `invented status: ${line}`);
	assert.match(stream.text(), /is ready/);
	const [open, save] = stream.buttons();
	assert.equal(open.command, 'threews3d.previewUrl');
	assert.match(open.arguments[0], /^https:\/\//);
	assert.deepEqual(save.arguments[0], { glbUrl: open.arguments[0], prompt: result.metadata.subject });
	const followups = state.participants.get(PARTICIPANT_ID).followupProvider.provideFollowups(result);
	assert.deepEqual(followups.map((f) => f.command), ['rig', 'embed', 'find']);
});
