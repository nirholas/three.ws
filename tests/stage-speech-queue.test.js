// The per-stage speaking queue is what keeps two agents on one <agent-stage>
// from talking over each other. Everything it promises is ordering under
// pressure: who goes next, what is dropped when the queue is full, and that a
// broken or removed speaker never stalls the agents behind it. The speaker is
// injected, so each utterance is a promise the test settles by hand and no
// browser audio is involved.
import { describe, expect, it, vi } from 'vitest';
import { createStageSpeechQueue, SPEECH_PRIORITIES } from '../src/stage-speech-queue.js';

/** A speaker whose utterances finish only when the test says so. */
function manualSpeaker() {
	const calls = [];
	const speak = vi.fn((agentId, text) => {
		let finish;
		let fail;
		const done = new Promise((res, rej) => {
			finish = res;
			fail = rej;
		});
		calls.push({ agentId, text, finish, fail });
		return done;
	});
	const said = () => calls.map((c) => `${c.agentId}:${c.text}`);
	// Settle the utterance currently playing, then let the queue start the next.
	const finishCurrent = async () => {
		calls.at(-1).finish();
		await flush();
	};
	return { speak, calls, said, finishCurrent };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createStageSpeechQueue', () => {
	it('exposes the three priority levels, highest first', () => {
		expect(SPEECH_PRIORITIES).toEqual(['user', 'broadcast', 'ambient']);
	});

	it('plays one utterance at a time, first in first out', async () => {
		const s = manualSpeaker();
		const q = createStageSpeechQueue({ speak: s.speak });
		const a = q.enqueue('leo', 'one');
		const b = q.enqueue('mira', 'two');
		const c = q.enqueue('leo', 'three');
		await flush();
		expect(s.said()).toEqual(['leo:one']);
		expect(q.speaking).toMatchObject({ agentId: 'leo', text: 'one', priority: 'ambient' });
		expect(q.pending.map((p) => p.text)).toEqual(['two', 'three']);

		await s.finishCurrent();
		expect(s.said()).toEqual(['leo:one', 'mira:two']);
		await s.finishCurrent();
		await s.finishCurrent();
		expect(s.said()).toEqual(['leo:one', 'mira:two', 'leo:three']);
		expect(q.speaking).toBeNull();
		expect(await a).toMatchObject({ status: 'spoken', agentId: 'leo', text: 'one' });
		expect(await b).toMatchObject({ status: 'spoken', agentId: 'mira' });
		expect(await c).toMatchObject({ status: 'spoken' });
	});

	it('lets a higher priority jump queued items but never cuts off the current speaker', async () => {
		const s = manualSpeaker();
		const q = createStageSpeechQueue({ speak: s.speak });
		q.enqueue('leo', 'ambient line', { priority: 'ambient' });
		q.enqueue('mira', 'ambient queued', { priority: 'ambient' });
		q.enqueue('ivy', 'broadcast queued', { priority: 'broadcast' });
		q.enqueue('mira', 'user directed', { priority: 'user' });
		await flush();
		// The ambient line already playing keeps the floor.
		expect(s.said()).toEqual(['leo:ambient line']);
		expect(s.calls[0].agentId).toBe('leo');
		expect(q.pending.map((p) => p.text)).toEqual(['user directed', 'broadcast queued', 'ambient queued']);

		await s.finishCurrent();
		await s.finishCurrent();
		await s.finishCurrent();
		await s.finishCurrent();
		expect(s.said()).toEqual([
			'leo:ambient line',
			'mira:user directed',
			'ivy:broadcast queued',
			'mira:ambient queued',
		]);
	});

	it('keeps first-in-first-out order inside one priority level', async () => {
		const s = manualSpeaker();
		const q = createStageSpeechQueue({ speak: s.speak });
		q.enqueue('leo', 'playing');
		q.enqueue('a', 'b1', { priority: 'broadcast' });
		q.enqueue('b', 'b2', { priority: 'broadcast' });
		q.enqueue('c', 'u1', { priority: 'user' });
		q.enqueue('d', 'b3', { priority: 'broadcast' });
		q.enqueue('e', 'u2', { priority: 'user' });
		expect(q.pending.map((p) => p.text)).toEqual(['u1', 'u2', 'b1', 'b2', 'b3']);
	});

	it('de-duplicates the same line from the same agent and shares one outcome', async () => {
		const s = manualSpeaker();
		const q = createStageSpeechQueue({ speak: s.speak });
		q.enqueue('leo', 'playing');
		const first = q.enqueue('mira', 'Hello  there', { priority: 'ambient' });
		const again = q.enqueue('mira', 'hello there', { priority: 'ambient' });
		const other = q.enqueue('ivy', 'hello there');
		expect(q.pending.map((p) => `${p.agentId}:${p.text}`)).toEqual(['mira:Hello  there', 'ivy:hello there']);
		// A duplicate at a higher priority promotes the queued line instead of adding one.
		q.enqueue('mira', 'Hello there', { priority: 'user' });
		expect(q.pending.map((p) => `${p.agentId}:${p.priority}`)).toEqual(['mira:user', 'ivy:ambient']);

		// A repeat of the line that is playing right now joins it rather than replaying it.
		const replay = q.enqueue('leo', 'playing');
		await s.finishCurrent();
		expect(await replay).toMatchObject({ status: 'spoken', agentId: 'leo', text: 'playing' });
		await s.finishCurrent();
		await s.finishCurrent();
		expect(s.said()).toEqual(['leo:playing', 'mira:Hello  there', 'ivy:hello there']);
		expect(await first).toBe(await again);
		expect(await other).toMatchObject({ status: 'spoken', agentId: 'ivy' });
	});

	it('drops the oldest queued ambient line when the queue is full', async () => {
		const s = manualSpeaker();
		const q = createStageSpeechQueue({ speak: s.speak, maxDepth: 3 });
		q.enqueue('leo', 'playing');
		const oldAmbient = q.enqueue('a', 'ambient 1');
		q.enqueue('b', 'broadcast 1', { priority: 'broadcast' });
		q.enqueue('c', 'ambient 2');
		expect(q.size).toBe(3);

		q.enqueue('d', 'user 1', { priority: 'user' });
		expect(q.size).toBe(3);
		expect(await oldAmbient).toMatchObject({ status: 'dropped', agentId: 'a', text: 'ambient 1' });
		expect(q.pending.map((p) => p.text)).toEqual(['user 1', 'broadcast 1', 'ambient 2']);

		// A new ambient line in a full queue evicts the older ambient line.
		q.enqueue('e', 'ambient 3');
		expect(q.pending.map((p) => p.text)).toEqual(['user 1', 'broadcast 1', 'ambient 3']);
	});

	it('when no ambient line is left, a user line evicts the oldest broadcast and a broadcast line is refused', async () => {
		const s = manualSpeaker();
		const q = createStageSpeechQueue({ speak: s.speak, maxDepth: 2 });
		q.enqueue('leo', 'playing');
		const b1 = q.enqueue('a', 'b1', { priority: 'broadcast' });
		q.enqueue('b', 'b2', { priority: 'broadcast' });

		const refused = await q.enqueue('c', 'b3', { priority: 'broadcast' });
		expect(refused).toMatchObject({ status: 'dropped', agentId: 'c', text: 'b3' });
		expect(q.pending.map((p) => p.text)).toEqual(['b1', 'b2']);

		q.enqueue('d', 'u1', { priority: 'user' });
		expect(await b1).toMatchObject({ status: 'dropped' });
		expect(q.pending.map((p) => p.text)).toEqual(['u1', 'b2']);

		// A queue full of user lines refuses the next one rather than dropping a user line.
		q.enqueue('e', 'u2', { priority: 'user' });
		expect(await q.enqueue('f', 'u3', { priority: 'user' })).toMatchObject({ status: 'dropped', text: 'u3' });
		expect(q.pending.map((p) => p.text)).toEqual(['u1', 'u2']);
	});

	it('advances past an utterance whose speaker throws or rejects', async () => {
		const speak = vi.fn(async (agentId, text) => {
			if (text === 'rejects') throw new Error('tts down');
			if (text === 'throws') return Promise.reject(new TypeError('no voice'));
		});
		const q = createStageSpeechQueue({ speak });
		const bad = q.enqueue('leo', 'rejects');
		const worse = q.enqueue('mira', 'throws');
		const good = q.enqueue('leo', 'works');
		expect(await bad).toMatchObject({ status: 'error', agentId: 'leo', error: 'tts down' });
		expect(await worse).toMatchObject({ status: 'error', error: 'no voice' });
		expect(await good).toMatchObject({ status: 'spoken' });
		expect(speak.mock.calls.map((c) => c[1])).toEqual(['rejects', 'throws', 'works']);
		expect(q.speaking).toBeNull();
	});

	it('also advances past a speaker that throws synchronously', async () => {
		const speak = vi.fn((agentId) => {
			if (agentId === 'gone') throw new Error('agent left');
			return Promise.resolve();
		});
		const q = createStageSpeechQueue({ speak });
		const bad = q.enqueue('gone', 'hi');
		const good = q.enqueue('leo', 'hi');
		expect(await bad).toMatchObject({ status: 'error', error: 'agent left' });
		expect(await good).toMatchObject({ status: 'spoken' });
	});

	it('cancels a removed agent: drops its queued lines, stops its current line, and moves on', async () => {
		const s = manualSpeaker();
		const cancel = vi.fn();
		const q = createStageSpeechQueue({ speak: s.speak, cancel });
		const playing = q.enqueue('leo', 'playing');
		const leoLater = q.enqueue('leo', 'later');
		const mira = q.enqueue('mira', 'next');
		await flush();

		expect(q.cancelAgent('leo')).toBe(2);
		expect(cancel).toHaveBeenCalledWith('leo');
		expect(await playing).toMatchObject({ status: 'cancelled', agentId: 'leo' });
		expect(await leoLater).toMatchObject({ status: 'cancelled' });
		await flush();
		// Mira starts without waiting for Leo's cancelled utterance to settle.
		expect(q.speaking).toMatchObject({ agentId: 'mira', text: 'next' });

		// Leo's audio finishing late must not end Mira's turn.
		s.calls[0].finish();
		await flush();
		expect(q.speaking).toMatchObject({ agentId: 'mira' });
		await s.finishCurrent();
		expect(await mira).toMatchObject({ status: 'spoken' });
		expect(s.said()).toEqual(['leo:playing', 'mira:next']);
	});

	it('cancelling an agent with nothing queued is a no-op that reports zero', () => {
		const q = createStageSpeechQueue({ speak: async () => {} });
		expect(q.cancelAgent('nobody')).toBe(0);
	});

	it('reports every change of speaker, ending with null when the stage falls silent', async () => {
		const s = manualSpeaker();
		const changes = [];
		const q = createStageSpeechQueue({
			speak: s.speak,
			onChange: (speaking, previous) =>
				changes.push(`${previous?.agentId ?? '-'}>${speaking?.agentId ?? '-'}`),
		});
		q.enqueue('leo', 'one');
		q.enqueue('mira', 'two');
		await flush();
		await s.finishCurrent();
		await s.finishCurrent();
		expect(changes).toEqual(['->leo', 'leo>mira', 'mira>-']);
	});

	it('gives up on an utterance that never ends, cancels it, and continues', async () => {
		vi.useFakeTimers();
		try {
			const cancel = vi.fn();
			const speak = vi.fn((agentId) => (agentId === 'stuck' ? new Promise(() => {}) : Promise.resolve()));
			const q = createStageSpeechQueue({ speak, cancel, timeoutMs: () => 5000 });
			const stuck = q.enqueue('stuck', 'never ends');
			const next = q.enqueue('leo', 'after');
			await vi.advanceTimersByTimeAsync(4999);
			expect(q.speaking).toMatchObject({ agentId: 'stuck' });
			await vi.advanceTimersByTimeAsync(1);
			expect(await stuck).toMatchObject({ status: 'timeout', agentId: 'stuck' });
			expect(cancel).toHaveBeenCalledWith('stuck');
			expect(await next).toMatchObject({ status: 'spoken' });
		} finally {
			vi.useRealTimers();
		}
	});

	it('clear() cancels everything and leaves an idle queue', async () => {
		const s = manualSpeaker();
		const cancel = vi.fn();
		const q = createStageSpeechQueue({ speak: s.speak, cancel });
		const a = q.enqueue('leo', 'one');
		const b = q.enqueue('mira', 'two');
		await flush();
		q.clear();
		expect(await a).toMatchObject({ status: 'cancelled' });
		expect(await b).toMatchObject({ status: 'cancelled' });
		expect(cancel).toHaveBeenCalledWith('leo');
		expect(q.speaking).toBeNull();
		expect(q.size).toBe(0);
	});

	it('refuses an unknown priority and an empty line', async () => {
		const q = createStageSpeechQueue({ speak: async () => {} });
		expect(() => q.enqueue('leo', 'hi', { priority: 'urgent' })).toThrow(RangeError);
		expect(await q.enqueue('leo', '   ')).toMatchObject({ status: 'dropped', reason: 'empty' });
		expect(() => createStageSpeechQueue({})).toThrow(TypeError);
	});
});
