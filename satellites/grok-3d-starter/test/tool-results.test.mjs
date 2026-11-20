import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bareToolName, interpretToolResult, modelFromText, parseToolOutput } from '../lib/tool-results.mjs';
import { capturedResult, fixture } from './helpers.mjs';

function textOnly(result) {
	return result.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
}

test('every captured fixture is labelled captured, with where and when it came from', () => {
	for (const name of ['forge-free-pending', 'check-job-pending', 'get-job-pending', 'check-job-done', 'search-catalog', 'forge-free-sign-in-required', 'mcp-401-bad-key', 'robot-forge-free-pending', 'robot-get-job-done', 'robot-refine-chrome-pending', 'robot-refine-chrome-done']) {
		const meta = fixture(`three-ws/${name}.json`)._fixture;
		assert.equal(meta.source, 'captured', name);
		assert.match(meta.from, /^https:\/\/three\.ws\/api\/mcp-grok /, name);
		assert.ok(!Number.isNaN(Date.parse(meta.capturedAt)), name);
	}
});

test('bareToolName strips the server label xAI puts in front', () => {
	assert.equal(bareToolName('three-ws___forge_free'), 'forge_free');
	assert.equal(bareToolName('three-ws.refine_model'), 'refine_model');
	assert.equal(bareToolName('get_job'), 'get_job');
	assert.equal(bareToolName(''), '');
});

test('a captured forge_free that is still rendering is a pending job', () => {
	const r = interpretToolResult({ name: 'three-ws___forge_free', output: capturedResult('three-ws/forge-free-pending.json') });
	assert.equal(r.kind, 'pending');
	assert.equal(r.tool, 'forge_free');
	assert.match(r.jobId, /^f1\./);
	assert.match(r.viewerUrl, /^https:\/\/three\.ws\/viewer\?job=/);
});

test('captured pending answers from check_job and get_job carry the same job id', () => {
	const a = interpretToolResult({ name: 'check_job', output: capturedResult('three-ws/check-job-pending.json') });
	const b = interpretToolResult({ name: 'get_job', output: capturedResult('three-ws/get-job-pending.json') });
	assert.equal(a.kind, 'pending');
	assert.equal(b.kind, 'pending');
	assert.equal(a.jobId, b.jobId);
});

test('a captured finished job is a model with GLB, viewer and poster links', () => {
	const r = interpretToolResult({ name: 'check_job', output: capturedResult('three-ws/check-job-done.json') });
	assert.equal(r.kind, 'model');
	assert.match(r.glbUrl, /^https:\/\/three\.ws\/cdn\/forge\/.+\.glb$/);
	assert.match(r.viewerUrl, /^https:\/\/three\.ws\/viewer\?src=/);
	assert.match(r.posterUrl, /^https:\/\/three\.ws\/api\/render\/glb\?/);
});

test('the result is the same whether xAI passes the full MCP result, its JSON text, or only its text content', () => {
	const result = capturedResult('three-ws/robot-get-job-done.json');
	const full = interpretToolResult({ name: 'get_job', output: result });
	const json = interpretToolResult({ name: 'get_job', output: JSON.stringify(result) });
	const text = interpretToolResult({ name: 'get_job', output: textOnly(result) });
	for (const r of [full, json, text]) {
		assert.equal(r.kind, 'model');
		assert.equal(r.glbUrl, 'https://three.ws/cdn/forge/anon/e0fb27ab-1064-4237-bf6a-53fa58a83349.glb');
		assert.ok(r.viewerUrl);
		assert.ok(r.posterUrl);
	}
	assert.equal(interpretToolResult({ name: 'forge_free', output: textOnly(capturedResult('three-ws/robot-forge-free-pending.json')) }).kind, 'pending');
});

test('a captured refine ("make it chrome") is a pending job, then a new model with its own GLB', () => {
	const start = interpretToolResult({ name: 'three-ws___refine_model', output: capturedResult('three-ws/robot-refine-chrome-pending.json') });
	assert.equal(start.kind, 'pending');
	assert.equal(start.tool, 'refine_model');
	assert.match(start.jobId, /^f1\./);
	const done = interpretToolResult({ name: 'get_job', output: capturedResult('three-ws/robot-refine-chrome-done.json') });
	assert.equal(done.kind, 'model');
	assert.equal(done.glbUrl, 'https://three.ws/cdn/forge/anon/f1f862ef-20f9-449a-b1d1-8c0bf16ebe72.glb');
	assert.notEqual(done.glbUrl, interpretToolResult({ name: 'get_job', output: capturedResult('three-ws/robot-get-job-done.json') }).glbUrl);
	assert.match(done.posterUrl, /^https:\/\/three\.ws\/api\/render\/glb\?/);
});

test('a captured catalog search is a list of loadable items', () => {
	const r = interpretToolResult({ name: 'search_catalog', output: capturedResult('three-ws/search-catalog.json') });
	assert.equal(r.kind, 'catalog');
	assert.ok(r.items.length >= 1);
	for (const item of r.items) {
		assert.match(item.glbUrl, /^https:\/\//);
		assert.ok(item.title);
	}
	const fromText = interpretToolResult({ name: 'search_catalog', output: textOnly(capturedResult('three-ws/search-catalog.json')) });
	assert.equal(fromText.kind, 'catalog');
	assert.deepEqual(fromText.items.map((i) => i.glbUrl), r.items.map((i) => i.glbUrl));
});

test('the captured sign_in_required answer is recognised, with the key page link', () => {
	const r = interpretToolResult({ name: 'forge_free', output: capturedResult('three-ws/forge-free-sign-in-required.json') });
	assert.equal(r.kind, 'sign_in_required');
	assert.equal(r.apiKeysUrl, 'https://three.ws/dashboard/api-keys');
});

test('three.ws\'s captured 401 text, passed on as a call error, reads as a rejected key', () => {
	const { response } = fixture('three-ws/mcp-401-bad-key.json');
	const r = interpretToolResult({ name: 'forge_free', error: `${response.error}: ${response.error_description}` });
	assert.equal(r.kind, 'bad_key');
});

test('an MCP error result is a failure with its message', () => {
	const r = interpretToolResult({ name: 'forge_free', output: { content: [{ type: 'text', text: 'The GPU worker crashed.' }], isError: true } });
	assert.equal(r.kind, 'failed');
	assert.equal(r.message, 'The GPU worker crashed.');
});

test('parseToolOutput unwraps a JSON-RPC envelope and keeps plain text as text', () => {
	assert.equal(parseToolOutput({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'hi' }] } }).text, 'hi');
	assert.deepEqual(parseToolOutput('just words'), { structured: null, text: 'just words', isError: false });
	assert.deepEqual(parseToolOutput('{not json'), { structured: null, text: '{not json', isError: false });
});

test('modelFromText reads a three.ws viewer link or a bare GLB link, and nothing else', () => {
	const viewer = modelFromText('Here: https://three.ws/viewer?src=https%3A%2F%2Fthree.ws%2Fcdn%2Fa.glb done');
	assert.equal(viewer.glbUrl, 'https://three.ws/cdn/a.glb');
	assert.equal(modelFromText('get it at https://example.com/x/model.glb.').glbUrl, 'https://example.com/x/model.glb');
	assert.equal(modelFromText('no links here'), null);
});
