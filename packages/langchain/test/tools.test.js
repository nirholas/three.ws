// Tests run against the LIVE three.ws API (https://three.ws), per repo policy:
// no mocks. `render` and `agentChat` hit free, stable endpoints and assert a
// real success. `forge`/`rig` hit the free GPU-worker-fleet generation path,
// which can genuinely fail independently of this package (queue load, a
// provider outage), those two assert the tool returns a well-formed artifact
// either way, without fabricating success. `animate` is paid and x402-gated;
// it asserts the real PaymentRequired challenge comes back unpaid, since this
// package must never sign a payment itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createThreeWsTools } from '../src/index.js';

const DUCK_GLB = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Duck/glTF-Binary/Duck.glb';

const [forgeTool, rigTool, renderTool, animateTool, agentChatTool] = createThreeWsTools();

// `tool.invoke(rawArgs)` returns only the string content; invoking with a
// ToolCall shape (name/args/id/type) returns the full ToolMessage, whose
// `.artifact` carries the structured half of `content_and_artifact`.
function asToolCall(name, args) {
	return { name, args, id: `test-${name}`, type: 'tool_call' };
}

test('three_ws_render: turntable preview of a public GLB', async () => {
	const msg = await renderTool.invoke(asToolCall('three_ws_render', { glbUrl: DUCK_GLB, views: ['front'], size: 256 }));
	assert.match(msg.content, /Rendered this model/);
	assert.equal(msg.artifact.ok, true);
});

test('three_ws_agent_chat: the default agent replies to a message', async () => {
	const msg = await agentChatTool.invoke(asToolCall('three_ws_agent_chat', { message: 'Reply with exactly the word: pong' }));
	assert.equal(typeof msg.content, 'string');
	assert.ok(msg.content.length > 0);
	assert.equal(msg.artifact.ok, true);
});

test('three_ws_forge: generates a model from text, or reports the real failure', async () => {
	const msg = await forgeTool.invoke(asToolCall('three_ws_forge', { prompt: 'a small red toy cube', tier: 'draft' }));
	assert.equal(typeof msg.artifact.ok, 'boolean');
});

test('three_ws_rig: rigs a static GLB, or reports the real failure', async () => {
	const msg = await rigTool.invoke(asToolCall('three_ws_rig', { glbUrl: DUCK_GLB }));
	assert.equal(typeof msg.artifact.ok, 'boolean');
});

test('three_ws_animate: unpaid call returns a real x402 PaymentRequired challenge', async () => {
	const msg = await animateTool.invoke(asToolCall('three_ws_animate', { glbUrl: DUCK_GLB, prompt: 'wave hello' }));
	assert.equal(msg.artifact.ok, false);
	assert.equal(msg.artifact.paymentRequired, true);
	assert.ok(Array.isArray(msg.artifact.challenge?.accepts) && msg.artifact.challenge.accepts.length > 0);
});
