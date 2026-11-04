// @vitest-environment jsdom
//
// Two agents on one <agent-stage> must take turns speaking. This drives the
// real AgentStageElement, two real Runtimes and the real say_to_agent tool;
// only the language model and the audio engine are scripted, because those are
// the two things that need a network and a sound card. Each fake TTS records
// when it started and stopped so the test can prove the utterances never
// overlap and come out in the order the stage promised.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom has no WebGL: the real Viewer throws here exactly as it does on a
// browser that refuses a context, and the stage already degrades to a null
// viewer for that case. Model that path without loading three.js.
vi.mock('../src/viewer.js', () => ({
	Viewer: class {
		constructor() {
			throw new Error('Error creating WebGL context.');
		}
	},
}));

const { AgentStageElement } = await import('../src/stage-element.js');
const { Runtime } = await import('../src/runtime/index.js');

const NO_VOICE = { tts: { provider: 'none' }, stt: { provider: 'none' } };
const flush = () => new Promise((r) => setTimeout(r, 0));

/** Scripted model: returns the queued responses in order. */
function scriptedProvider(responses) {
	let i = 0;
	return {
		complete: vi.fn(async () => responses[Math.min(i++, responses.length - 1)]),
		formatAssistantWithToolCalls(text, toolCalls) {
			const content = [];
			if (text) content.push({ type: 'text', text });
			for (const c of toolCalls) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
			return { role: 'assistant', content };
		},
		formatToolResults(results) {
			return {
				role: 'user',
				content: results.map((r) => ({
					type: 'tool_result',
					tool_use_id: r.id,
					content: JSON.stringify(r.output),
				})),
			};
		},
	};
}
const text = (t) => ({ text: t, toolCalls: [], thinking: '', stopReason: 'end_turn' });
const tool = (name, input) => ({
	text: '',
	toolCalls: [{ id: `call_${name}`, name, input }],
	thinking: '',
	stopReason: 'tool_use',
});

/**
 * A TTS whose lines end only when the test releases them, logging each start
 * and end on a shared timeline so overlap is checkable.
 */
function recordingTTS(name, timeline) {
	const open = [];
	return {
		open,
		speak: vi.fn(
			(line) =>
				new Promise((resolve) => {
					timeline.push(`start ${name}: ${line}`);
					open.push(() => {
						timeline.push(`end ${name}`);
						resolve();
					});
				}),
		),
		cancel: vi.fn(() => {
			while (open.length) open.shift()();
		}),
	};
}

/**
 * Mount an agent on the stage the way <agent-3d> does: the element's say()
 * runs a turn on its own Runtime and resolves with the reply, and the element
 * registers its voice with the stage, so speech goes through the queue.
 */
function mountAgent(stage, id, responses, timeline) {
	const element = document.createElement('div');
	element.id = id;
	stage.appendChild(element);
	const runtime = new Runtime({
		manifest: { name: id },
		providerConfig: { provider: 'none' },
		voiceConfig: NO_VOICE,
	});
	runtime.provider = scriptedProvider(responses);
	const tts = recordingTTS(id, timeline);
	runtime.tts = tts;
	element.say = (line, opts = {}) => runtime.send(line, { voice: true, priority: opts.priority });
	const agentId = stage.registerAgent(element, {
		id,
		manifest: { name: id },
		speak: (line) => runtime.speakNow(line),
		stopSpeaking: () => runtime.tts.cancel(),
	});
	runtime.attachStage(stage, agentId);
	return { element, runtime, tts, agentId };
}

/** Release whichever line is playing, then let the queue start the next. */
async function endCurrent(...agents) {
	for (const a of agents) {
		if (a.tts.open.length) {
			a.tts.open.shift()();
			break;
		}
	}
	await flush();
}

let stage;
let timeline;

beforeEach(() => {
	timeline = [];
	stage = document.createElement('agent-stage');
	document.body.appendChild(stage);
});

afterEach(() => {
	stage.remove();
	document.body.innerHTML = '';
});

describe('<agent-stage> speaking queue', () => {
	it('is the element registered as agent-stage, with nobody speaking yet', () => {
		expect(stage).toBeInstanceOf(AgentStageElement);
		expect(stage.speaking).toBeNull();
		expect(stage.speechQueue).toEqual([]);
	});

	it('serialises a broadcast both agents answer, and reports each change of speaker', async () => {
		const leo = mountAgent(stage, 'leo', [], timeline);
		const mira = mountAgent(stage, 'mira', [], timeline);
		const changes = [];
		stage.addEventListener('stage:speaking-change', (e) =>
			changes.push([e.detail.previous?.agentId ?? null, e.detail.speaking?.agentId ?? null]),
		);
		for (const a of [leo, mira]) {
			a.element.addEventListener('stage:message', (e) => {
				stage.speak(a.agentId, `${a.agentId} heard ${e.detail.event.text}`, { priority: 'broadcast' });
			});
		}

		stage.broadcast('director', { kind: 'cue', text: 'action' });
		await flush();
		expect(timeline).toEqual(['start leo: leo heard action']);
		expect(stage.speaking).toMatchObject({ agentId: 'leo', priority: 'broadcast' });
		expect(stage.speechQueue.map((l) => l.agentId)).toEqual(['mira']);

		await endCurrent(leo, mira);
		await endCurrent(leo, mira);
		expect(timeline).toEqual([
			'start leo: leo heard action',
			'end leo',
			'start mira: mira heard action',
			'end mira',
		]);
		expect(changes).toEqual([
			[null, 'leo'],
			['leo', 'mira'],
			['mira', null],
		]);
	});

	it('routes the runtime voice through the stage and fires the agent speech events at play time', async () => {
		const leo = mountAgent(stage, 'leo', [text('Hi from Leo.')], timeline);
		const mira = mountAgent(stage, 'mira', [], timeline);
		const events = [];
		leo.runtime.addEventListener('voice:speech-start', (e) => events.push(`speech-start ${e.detail.text}`));
		leo.runtime.addEventListener('voice:speech-end', () => events.push('speech-end'));

		stage.speak('mira', 'Mira first.', { priority: 'user' });
		const turn = leo.runtime.send('say hi', { voice: true });
		await flush();
		// Leo's reply is queued behind Mira, and his speech events wait with it.
		expect(timeline).toEqual(['start mira: Mira first.']);
		expect(events).toEqual([]);

		await endCurrent(mira);
		expect(timeline.at(-1)).toBe('start leo: Hi from Leo.');
		expect(events).toEqual(['speech-start Hi from Leo.']);
		await endCurrent(leo);
		const reply = await turn;
		expect(reply.text).toBe('Hi from Leo.');
		expect(events).toEqual(['speech-start Hi from Leo.', 'speech-end']);
	});

	it('say_to_agent: the target reply is queued behind the caller and comes back to the caller', async () => {
		const leo = mountAgent(
			stage,
			'leo',
			[tool('say_to_agent', { agentId: 'mira', text: 'How are you?' }), text('Mira says she is well.')],
			timeline,
		);
		const mira = mountAgent(stage, 'mira', [text('I am well, thanks.')], timeline);
		expect(leo.runtime.tools.map((t) => t.name)).toEqual(
			expect.arrayContaining(['observe_agents', 'say_to_agent']),
		);
		const seenByStage = [];
		stage.addEventListener('stage:message', (e) => seenByStage.push(e.detail));

		// Leo already holds the floor with a line from the user's earlier turn.
		stage.speak('leo', 'Let me ask Mira.', { priority: 'user' });
		const turn = leo.runtime.send('Ask Mira how she is.', { voice: true, priority: 'user' });
		await flush();
		await flush();

		// Mira's turn ran and her reply is waiting, not playing over Leo.
		expect(mira.runtime.messages[0].content).toBe('[from leo] How are you?');
		expect(timeline).toEqual(['start leo: Let me ask Mira.']);
		expect(stage.speechQueue).toEqual([
			{ agentId: 'mira', text: 'I am well, thanks.', priority: 'user' },
		]);

		await endCurrent(leo);
		expect(timeline.at(-1)).toBe('start mira: I am well, thanks.');
		await endCurrent(mira);
		await flush();
		expect(timeline.at(-1)).toBe('start leo: Mira says she is well.');
		await endCurrent(leo);
		const reply = await turn;

		expect(reply.text).toBe('Mira says she is well.');
		// The tool result Leo's model saw carries Mira's actual words.
		const toolResult = leo.runtime.messages.find(
			(m) => m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result',
		);
		expect(JSON.parse(toolResult.content[0].content)).toEqual({ ok: true, reply: 'I am well, thanks.' });
		expect(seenByStage).toContainEqual({ from: 'leo', event: { kind: 'direct', to: 'mira', text: 'How are you?' } });
		expect(timeline).toEqual([
			'start leo: Let me ask Mira.',
			'end leo',
			'start mira: I am well, thanks.',
			'end mira',
			'start leo: Mira says she is well.',
			'end leo',
		]);
	});

	it('say_to_agent reports a target that never replied instead of claiming an empty reply', async () => {
		mountAgent(stage, 'leo', [], timeline);
		const silent = document.createElement('div');
		stage.appendChild(silent);
		silent.say = async () => null;
		stage.registerAgent(silent, { id: 'statue', manifest: { name: 'statue' } });
		expect(await stage.routeMessage('leo', 'statue', 'hello?')).toEqual({
			ok: false,
			error: 'Agent "statue" did not reply',
		});
		expect(await stage.routeMessage('leo', 'ghost', 'hello?')).toEqual({
			ok: false,
			error: 'No agent "ghost" on stage',
		});
	});

	it('removing an agent cancels its lines and hands the floor to the next agent', async () => {
		const leo = mountAgent(stage, 'leo', [], timeline);
		const mira = mountAgent(stage, 'mira', [], timeline);
		const leoLine = stage.speak('leo', 'A long speech.', { priority: 'ambient' });
		const leoMore = stage.speak('leo', 'And more.', { priority: 'ambient' });
		const miraLine = stage.speak('mira', 'My turn.', { priority: 'ambient' });
		await flush();

		stage.unregisterAgent(leo.element);
		expect(leo.tts.cancel).toHaveBeenCalled();
		expect(await leoLine).toMatchObject({ status: 'cancelled' });
		expect(await leoMore).toMatchObject({ status: 'cancelled' });
		await flush();
		expect(stage.speaking).toMatchObject({ agentId: 'mira' });
		await endCurrent(mira);
		expect(await miraLine).toMatchObject({ status: 'spoken' });
		expect(stage.getAgents().map((a) => a.agentId)).toEqual(['mira']);
	});

	it('refuses to queue a line for an agent that is not on the stage', async () => {
		expect(await stage.speak('ghost', 'boo')).toMatchObject({
			status: 'error',
			agentId: 'ghost',
			error: 'No agent "ghost" on stage',
		});
		expect(stage.speaking).toBeNull();
	});

	it('registering the same element twice keeps one record and refreshes its voice', async () => {
		const first = vi.fn(async () => {});
		const second = vi.fn(async () => {});
		const el = document.createElement('div');
		stage.appendChild(el);
		const id = stage.registerAgent(el, { id: 'leo', manifest: { name: 'leo' }, speak: first });
		expect(stage.registerAgent(el, { id: 'leo', manifest: { name: 'leo' }, speak: second })).toBe(id);
		expect(stage.getAgents()).toHaveLength(1);
		await stage.speak(id, 'hello');
		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledWith('hello');
	});

	it('a solo runtime with no stage speaks directly, exactly as before', async () => {
		const timelineSolo = [];
		const rt = new Runtime({ manifest: {}, providerConfig: { provider: 'none' }, voiceConfig: NO_VOICE });
		rt.provider = scriptedProvider([text('Solo line.')]);
		rt.tts = recordingTTS('solo', timelineSolo);
		expect(rt.tools.map((t) => t.name)).not.toContain('say_to_agent');
		const turn = rt.send('hi', { voice: true });
		await flush();
		expect(timelineSolo).toEqual(['start solo: Solo line.']);
		rt.tts.open.shift()();
		expect((await turn).text).toBe('Solo line.');
	});
});
