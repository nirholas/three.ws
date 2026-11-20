// Unit tests against the response shapes xAI documents for the Responses API
// (x_search tool calls as custom_tool_call items, url_citation annotations,
// usage.server_side_tool_usage_details) and structured output.
import assert from 'node:assert/strict';
import test from 'node:test';
import { BRIEF_SCHEMA, buildRequest, busyWaitSeconds, fillLink, parseArgs, readBrief } from './index.mjs';

test('busyWaitSeconds reads the wait from a busy generator, and ignores other errors', () => {
	assert.equal(busyWaitSeconds('forge_free: The 3D generator is busy right now. Try again in about 10s.'), 10);
	assert.equal(busyWaitSeconds('forge_free: The 3D generator is busy right now. Please try again in a moment.'), 15);
	assert.equal(busyWaitSeconds('forge_free: Generation failed for this prompt.'), null);
});

test('the request asks x_search for the last 7 days with a strict JSON answer', () => {
	const req = buildRequest('lunar landers', new Date('2026-11-20T12:00:00Z'));
	assert.deepEqual(req.tools, [{ type: 'x_search', from_date: '2026-11-13', to_date: '2026-11-20' }]);
	assert.equal(req.text.format.type, 'json_schema');
	assert.equal(req.text.format.strict, true);
	assert.deepEqual(req.text.format.schema.required, ['topic_summary', 'prop_prompt', 'draft_post']);
	assert.deepEqual(req.include, ['no_inline_citations']);
	assert.ok(req.max_turns > 0);
	assert.match(req.input[0].content, /lunar landers/);
	assert.equal(BRIEF_SCHEMA.additionalProperties, false);
});

test('readBrief parses the answer, citations, searches and fetched posts', () => {
	const brief = { topic_summary: 'People are excited.', prop_prompt: 'a chrome lander', draft_post: 'Look: {link}' };
	const response = {
		output: [
			{ type: 'custom_tool_call', name: 'x_keyword_search', input: '{"query":"lunar landers"}' },
			{ type: 'custom_tool_call', name: 'x_semantic_search', input: '{"query":"moon landing"}' },
			{
				type: 'message',
				content: [
					{
						type: 'output_text',
						text: JSON.stringify(brief),
						annotations: [
							{ type: 'url_citation', url: 'https://x.com/i/status/1' },
							{ type: 'url_citation', url: 'https://x.com/i/status/1' },
							{ type: 'url_citation', url: 'https://x.com/i/status/2' },
						],
					},
				],
			},
		],
		usage: { server_side_tool_usage_details: { x_posts_fetched: 23 } },
	};
	const out = readBrief(response);
	assert.deepEqual(out.brief, brief);
	assert.deepEqual(out.citations, ['https://x.com/i/status/1', 'https://x.com/i/status/2']);
	assert.equal(out.searches, 2);
	assert.equal(out.postsFetched, 23);
});

test('readBrief refuses an answer missing a field', () => {
	const response = { output: [{ type: 'message', content: [{ type: 'output_text', text: '{"topic_summary":"x","prop_prompt":"","draft_post":"y"}' }] }] };
	assert.throws(() => readBrief(response), /prop_prompt/);
});

test('fillLink fills the slot, or appends when Grok left none', () => {
	assert.equal(fillLink('New prop {link} enjoy', 'https://v'), 'New prop https://v enjoy');
	assert.equal(fillLink('New prop', 'https://v'), 'New prop https://v');
});

test('parseArgs reads the topic and flags', () => {
	assert.deepEqual(parseArgs(['lunar', 'landers']).topic, 'lunar landers');
	assert.equal(parseArgs(['--prop', 'a lamp']).prop, 'a lamp');
	assert.equal(parseArgs(['--check']).check, true);
});
