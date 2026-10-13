// Tests run against the LIVE three.ws API (https://three.ws), per repo policy:
// no mocks. `render` and `agentChat` hit free, stable endpoints and assert a
// real success. `forge`/`rig` hit the free GPU-worker-fleet generation path,
// which can genuinely fail independently of this package (queue load, a
// provider outage), those two assert the tool returns a well-formed result
// shape either way, without fabricating success. `animate` is paid and
// x402-gated; it asserts the real PaymentRequired challenge comes back
// unpaid, since this package must never sign a payment itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createThreeWsTools } from '../src/index.js';

const DUCK_GLB = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Duck/glTF-Binary/Duck.glb';

const tools = createThreeWsTools();

test('render: turntable preview of a public GLB', async () => {
	const result = await tools.render.execute({ glbUrl: DUCK_GLB, views: ['front'], size: 256 });
	assert.equal(result.ok, true);
	assert.match(result.text, /Rendered this model/);
});

test('agentChat: the default agent replies to a message', async () => {
	const result = await tools.agentChat.execute({ message: 'Reply with exactly the word: pong' });
	assert.equal(result.ok, true);
	assert.equal(typeof result.reply, 'string');
	assert.ok(result.reply.length > 0);
});

test('forge: generates a model from text, or reports the real failure', async () => {
	const result = await tools.forge.execute({ prompt: 'a small red toy cube', tier: 'draft' });
	assert.equal(typeof result.ok, 'boolean');
	if (result.ok) assert.equal(typeof result.text, 'string');
	else assert.equal(typeof result.error, 'string');
});

test('rig: rigs a static GLB, or reports the real failure', async () => {
	const result = await tools.rig.execute({ glbUrl: DUCK_GLB });
	assert.equal(typeof result.ok, 'boolean');
	if (result.ok) assert.equal(typeof result.text, 'string');
	else assert.equal(typeof result.error, 'string');
});

test('animate: unpaid call returns a real x402 PaymentRequired challenge', async () => {
	const result = await tools.animate.execute({ glbUrl: DUCK_GLB, prompt: 'wave hello' });
	assert.equal(result.ok, false);
	assert.equal(result.paymentRequired, true);
	assert.ok(Array.isArray(result.challenge?.accepts) && result.challenge.accepts.length > 0);
});
