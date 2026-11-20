import assert from 'node:assert/strict';
import { test } from 'node:test';
import { followJob, runTurn } from '../lib/chat.mjs';
import { MAX_ROUNDS, continuationPrompt, pendingJobs, planNextRound, pollDelayMs } from '../lib/continuation.mjs';
import { interpretToolResult } from '../lib/tool-results.mjs';
import { capturedResult, fakeUpstreams, fixture, jsonResponse, noSleep, recorder, streamingResponse, testConfig } from './helpers.mjs';

const ROBOT_GLB = 'https://three.ws/cdn/forge/anon/e0fb27ab-1064-4237-bf6a-53fa58a83349.glb';
const rpc = (path) => ({ jsonrpc: '2.0', result: capturedResult(path) });
const robotJob = () => interpretToolResult({ name: 'forge_free', output: capturedResult('three-ws/robot-forge-free-pending.json') });

test('pendingJobs keeps the newest result per job and drops jobs that finished in the same round', () => {
	const a1 = { kind: 'pending', jobId: 'a', progress: 0.1 };
	const a2 = { kind: 'pending', jobId: 'a', progress: 0.5 };
	const b = { kind: 'pending', jobId: 'b' };
	assert.deepEqual(pendingJobs([a1, b, a2]), [a2, b]);
	assert.deepEqual(pendingJobs([a1, { kind: 'model', jobId: 'a' }]), []);
	assert.deepEqual(pendingJobs([{ kind: 'catalog' }, null]), []);
});

test('planNextRound waits on a running render, and stops when nothing runs or the budget is spent', () => {
	const job = robotJob();
	assert.deepEqual(planNextRound({ results: [], round: 1 }), { action: 'done', reason: 'complete' });
	assert.deepEqual(planNextRound({ results: [job], round: 1 }), { action: 'wait', job });
	assert.deepEqual(planNextRound({ results: [job], round: MAX_ROUNDS }), { action: 'done', reason: 'round_budget', job });
});

test('continuationPrompt names the job and passes a refinement\'s refine object unchanged', () => {
	const plain = continuationPrompt({ jobId: 'f1.abc' });
	assert.match(plain, /job_id f1\.abc/);
	assert.match(plain, /check_job/);
	assert.doesNotMatch(plain, /refine object/);
	const refine = { parent_glb_url: 'https://three.ws/cdn/a.glb', instruction: 'make it chrome' };
	assert.ok(continuationPrompt({ jobId: 'r1', refine }).includes(JSON.stringify(refine)));
});

test('pollDelayMs follows the job\'s own estimate and stays between 3 and 15 seconds', () => {
	assert.equal(pollDelayMs({ etaSeconds: 10 }), 5000);
	assert.equal(pollDelayMs({ etaSeconds: 1 }), 3000);
	assert.equal(pollDelayMs({ etaSeconds: 600 }), 15000);
	assert.equal(pollDelayMs({}, 0), 4000);
	assert.equal(pollDelayMs({}, 3), 7000);
	assert.equal(pollDelayMs(null, 50), 15000);
});

test('followJob replays the captured render: get_job pending, then get_job done', async () => {
	const config = testConfig();
	const up = fakeUpstreams({ config, mcpAnswers: [rpc('three-ws/get-job-pending.json'), rpc('three-ws/robot-get-job-done.json')] });
	const rec = recorder();
	const delays = [];
	const outcome = await followJob({ config, job: robotJob(), emit: rec.emit, fetchImpl: up.fetchImpl, sleep: async (ms) => delays.push(ms) });

	assert.equal(outcome.status, 'done');
	assert.equal(outcome.model.glbUrl, ROBOT_GLB);
	assert.equal(rec.of('job').length, 1);
	assert.equal(rec.of('job')[0].source, 'server');
	assert.equal(delays.length, 2);
	for (const req of up.requests) {
		assert.equal(req.url, 'https://three.ws/api/mcp-grok');
		assert.equal(req.headers.authorization, 'Bearer sk_test_unit');
		assert.equal(req.body.method, 'tools/call');
		assert.equal(req.body.params.name, 'get_job');
		assert.equal(req.body.params.arguments.job_id, robotJob().jobId);
	}
});

test('followJob passes a refinement\'s refine object to get_job', async () => {
	const config = testConfig();
	const up = fakeUpstreams({ config, mcpAnswers: [rpc('three-ws/robot-get-job-done.json')] });
	const refine = { parent_glb_url: ROBOT_GLB, instruction: 'make it chrome' };
	await followJob({ config, job: { jobId: 'r1', refine }, emit: () => {}, fetchImpl: up.fetchImpl, sleep: noSleep });
	assert.deepEqual(up.requests[0].body.params.arguments, { job_id: 'r1', refine });
});

test('followJob survives one failed check with a notice, then collects the model', async () => {
	const config = testConfig();
	const up = fakeUpstreams({ config, mcpAnswers: [new TypeError('fetch failed'), rpc('three-ws/robot-get-job-done.json')] });
	const rec = recorder();
	const outcome = await followJob({ config, job: robotJob(), emit: rec.emit, fetchImpl: up.fetchImpl, sleep: noSleep });
	assert.equal(outcome.status, 'done');
	assert.match(rec.of('notice')[0].message, /Checking the render failed once/);
});

test('followJob reports a failed render and gives up at the wait budget', async () => {
	const config = testConfig({ MAX_RENDER_WAIT_SECONDS: '60' });
	const failed = { jsonrpc: '2.0', result: { content: [{ type: 'text', text: 'The render failed: the GPU worker ran out of memory.' }], isError: true } };
	const up = fakeUpstreams({ config, mcpAnswers: [failed] });
	const outcome = await followJob({ config, job: robotJob(), emit: () => {}, fetchImpl: up.fetchImpl, sleep: noSleep });
	assert.equal(outcome.status, 'failed');
	assert.match(outcome.message, /ran out of memory/);

	let clock = 0;
	const pending = Array.from({ length: 20 }, () => rpc('three-ws/get-job-pending.json'));
	const slow = fakeUpstreams({ config, mcpAnswers: pending });
	const timeout = await followJob({ config, job: robotJob(), emit: () => {}, fetchImpl: slow.fetchImpl, sleep: async (ms) => { clock += ms; }, now: () => clock });
	assert.equal(timeout.status, 'timeout');
	assert.ok(clock >= 60_000);
});

test('followJob stops at once when three.ws rejects the key', async () => {
	const config = testConfig();
	const { response, _fixture } = fixture('three-ws/mcp-401-bad-key.json');
	const up = fakeUpstreams({ config, mcpAnswers: [jsonResponse(response, _fixture.httpStatus)] });
	await assert.rejects(followJob({ config, job: robotJob(), emit: () => {}, fetchImpl: up.fetchImpl, sleep: noSleep }), { code: 'three_ws_bad_key' });
});

test('runTurn over the documented xAI stream: Grok starts the render, the server follows it, Grok collects it', async () => {
	const config = testConfig();
	const { rounds, _fixture } = fixture('xai/responses-stream-forge.json');
	assert.equal(_fixture.source, 'documented');
	assert.ok(_fixture.docs.every((url) => url.startsWith('https://docs.x.ai/')));

	const up = fakeUpstreams({ config, xaiRounds: rounds, mcpAnswers: [rpc('three-ws/get-job-pending.json'), rpc('three-ws/robot-get-job-done.json')] });
	const rec = recorder();
	const result = await runTurn({ config, input: { message: 'A friendly round robot mascot in glossy white plastic', previousResponseId: null, stage: null }, emit: rec.emit, fetchImpl: up.fetchImpl, sleep: noSleep, safetyIdentifier: 'visitor-1' });

	assert.deepEqual(result, { responseId: 'resp_doc_round2' });
	assert.deepEqual(up.remaining(), { xai: 0, mcp: 0 });

	const names = rec.names();
	assert.equal(names[0], 'round');
	assert.equal(names.at(-1), 'done');
	assert.ok(names.indexOf('tool') < names.indexOf('tool_result'));
	assert.ok(names.indexOf('model') > names.indexOf('job'));

	const tools = rec.of('tool');
	assert.deepEqual(tools[0], { id: 'mcp_doc_1', name: 'forge_free', arguments: {}, status: 'running' });
	assert.deepEqual(tools[1].arguments, { prompt: 'A friendly round robot mascot in glossy white plastic', tier: 'draft' });
	assert.equal(tools[1].status, 'done');
	assert.equal(rec.of('tool_result')[0].kind, 'pending');
	assert.deepEqual(rec.of('job').map((j) => j.source), ['grok', 'server']);

	const models = rec.of('model');
	assert.equal(models.length, 1, 'the model collected by the server and again by check_job is shown once');
	assert.equal(models[0].glbUrl, ROBOT_GLB);
	assert.equal(rec.of('text').map((t) => t.delta).join(''), 'Your robot is rendering now; the page will show it the moment it is done.Your robot mascot is ready.');

	const [first, poll1, poll2, second] = up.requests;
	assert.equal(first.url, 'https://api.x.ai/v1/responses');
	assert.equal(first.headers.authorization, 'Bearer xai-test-key-for-unit-tests');
	assert.ok(first.body.instructions);
	assert.equal(first.body.previous_response_id, undefined);
	assert.equal(first.body.safety_identifier, 'visitor-1');
	assert.equal(poll1.body.params.name, 'get_job');
	assert.equal(poll2.body.params.name, 'get_job');
	assert.equal(second.body.previous_response_id, 'resp_doc_round1');
	assert.equal(second.body.instructions, undefined, 'xAI rejects instructions next to previous_response_id');
	assert.ok(second.body.input[0].content.includes(robotJob().jobId));
});

test('a follow-up turn continues the conversation and names the model on the stage', async () => {
	const config = testConfig();
	const done = [
		{ type: 'response.created', response: { id: 'resp_next' } },
		{ type: 'response.completed', response: { id: 'resp_next', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Making it chrome.' }] }] } },
	];
	const up = fakeUpstreams({ config, xaiRounds: [done] });
	await runTurn({ config, input: { message: 'make it chrome', previousResponseId: 'resp_doc_round2', stage: { glbUrl: ROBOT_GLB, label: 'Robot mascot' } }, emit: () => {}, fetchImpl: up.fetchImpl, sleep: noSleep });
	const body = up.requests[0].body;
	assert.equal(body.previous_response_id, 'resp_doc_round2');
	assert.equal(body.input[0].content, `[Model on the stage (Robot mascot): glb_url ${ROBOT_GLB}]\nmake it chrome`);
});

test('runTurn stops with three_ws_sign_in when the tool answers sign_in_required', async () => {
	const config = testConfig();
	const signIn = JSON.stringify(capturedResult('three-ws/forge-free-sign-in-required.json'));
	const round = [
		{ type: 'response.created', response: { id: 'resp_s' } },
		{ type: 'response.output_item.done', item: { type: 'mcp_call', id: 'c1', name: 'three-ws___forge_free', arguments: '{"prompt":"a stool"}', output: signIn } },
		{ type: 'response.completed', response: { id: 'resp_s', output: [] } },
	];
	const up = fakeUpstreams({ config, xaiRounds: [round] });
	await assert.rejects(runTurn({ config, input: { message: 'a stool' }, emit: () => {}, fetchImpl: up.fetchImpl, sleep: noSleep }), { code: 'three_ws_sign_in' });
});

test('runTurn maps the captured xAI 401 and reports a stream that fails partway', async () => {
	const config = testConfig();
	const { response, _fixture } = fixture('xai/401-no-key.json');
	const up = fakeUpstreams({ config, xaiRounds: [jsonResponse(response, _fixture.httpStatus)] });
	await assert.rejects(runTurn({ config, input: { message: 'hi' }, emit: () => {}, fetchImpl: up.fetchImpl, sleep: noSleep }), { code: 'xai_unauthorized' });

	const failing = fakeUpstreams({ config, xaiRounds: [[{ type: 'response.created', response: { id: 'r' } }, { type: 'response.failed', response: { error: { code: 'server_error', message: 'upstream reset' } } }]] });
	await assert.rejects(runTurn({ config, input: { message: 'hi' }, emit: () => {}, fetchImpl: failing.fetchImpl, sleep: noSleep }), { code: 'xai_stream_failed' });

	const cut = fakeUpstreams({ config, xaiRounds: [streamingResponse('data: {"type":"response.output_text.delta","delta":"x"}\n\n')] });
	await assert.rejects(runTurn({ config, input: { message: 'hi' }, emit: () => {}, fetchImpl: cut.fetchImpl, sleep: noSleep }), { code: 'xai_stream_failed' });
});

test('a failed courtesy round after the model arrived ends the turn with a notice, not an error', async () => {
	const config = testConfig();
	const { rounds } = fixture('xai/responses-stream-forge.json');
	const up = fakeUpstreams({ config, xaiRounds: [rounds[0], jsonResponse({ code: 'internal', error: 'boom' }, 500)], mcpAnswers: [rpc('three-ws/robot-get-job-done.json')] });
	const rec = recorder();
	await runTurn({ config, input: { message: 'robot' }, emit: rec.emit, fetchImpl: up.fetchImpl, sleep: noSleep });
	assert.equal(rec.of('model').length, 1);
	assert.match(rec.of('notice')[0].message, /The model is ready/);
	assert.equal(rec.names().at(-1), 'done');
});
