import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toolLogLine } from '../lib/tool-log.mjs';

// The server emits tool arguments as a parsed object (lib/xai.mjs parseArguments),
// so the live script's log line must not treat them as a string.
test('a tool event whose arguments are an object logs them as compact JSON', () => {
	const line = toolLogLine({ name: 'forge_free', status: 'running', arguments: { prompt: 'a small brass desk lamp' } });
	assert.equal(line, 'tool forge_free running {"prompt":"a small brass desk lamp"}');
});

test('long arguments are cut at 160 characters and missing ones print nothing', () => {
	const line = toolLogLine({ name: 'forge_free', status: 'done', arguments: { prompt: 'x'.repeat(400) } });
	assert.equal(line.length, 'tool forge_free done '.length + 160);
	assert.equal(toolLogLine({ name: 'get_job', arguments: undefined }), 'tool get_job');
	assert.equal(toolLogLine({ name: 'get_job', status: 'running', arguments: '{"job_id":"j1"}' }), 'tool get_job running {"job_id":"j1"}');
});
