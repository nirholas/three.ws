// @vitest-environment jsdom
/**
 * <agent-3d voice-provider="grok-realtime">: the mic opens a Grok realtime
 * session, its delayed analyser drives the avatar's lipsync, transcripts land
 * in the chat, and a server without Grok voice (503 grok_voice_not_configured)
 * falls through to the standard voice chain on the same click. Without the
 * attribute nothing changes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const made = vi.hoisted(() => ({ list: [], failWith: null }));

vi.mock('../src/voice/grok-realtime.js', () => {
	class GrokRealtime extends EventTarget {
		constructor(opts) {
			super();
			this.opts = opts;
			this.analyser = { kind: 'delayed-analyser' };
			this.closed = false;
			made.list.push(this);
		}
		async connect() {
			if (made.failWith) {
				const e = new Error(made.failWith.message);
				e.code = made.failWith.code;
				this.dispatchEvent(new CustomEvent('state', { detail: { state: 'error' } }));
				throw e;
			}
			this.dispatchEvent(new CustomEvent('state', { detail: { state: 'listening' } }));
		}
		close() {
			this.closed = true;
			this.dispatchEvent(new CustomEvent('state', { detail: { state: 'closed' } }));
		}
		emit(type, detail) {
			this.dispatchEvent(new CustomEvent(type, { detail }));
		}
	}
	return { GrokRealtime };
});

await import('../src/element.js');

const AGENT_ID = '7b0f3a5e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';

function makeEl({ provider = 'grok-realtime' } = {}) {
	const el = document.createElement('agent-3d');
	el.setAttribute('api-base', 'https://three.ws');
	el.setAttribute('agent-id', AGENT_ID);
	if (provider) el.setAttribute('voice-provider', provider);
	el._micEl = document.createElement('button');
	el._chatEl = document.createElement('div');
	el._avatar = { connectLipSync: vi.fn(), disconnectLipSync: vi.fn() };
	el._runtime = { listen: vi.fn(async () => ''), stt: { stop() {} } };
	const states = [];
	el.addEventListener('voiceStateChange', (e) => states.push(e.detail.state));
	return { el, states };
}

beforeEach(() => {
	made.list.length = 0;
	made.failWith = null;
	Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => ({}) }, configurable: true });
});

describe('voice-provider="grok-realtime"', () => {
	it('opens a Grok session against the API base and drives lipsync from its delayed analyser', async () => {
		const { el, states } = makeEl();
		await el._toggleMic();
		expect(made.list).toHaveLength(1);
		const voice = made.list[0];
		expect(voice.opts.sessionUrl).toBe('https://three.ws/api/voice/grok/session');
		expect(voice.opts.agentId).toBe(AGENT_ID);
		expect(el._avatar.connectLipSync).toHaveBeenCalledWith(voice.analyser);
		expect(states).toContain('listening');
		expect(el._runtime.listen).not.toHaveBeenCalled();
		expect(el._hasActiveSession()).toBe(true);
	});

	it('renders final transcripts and re-emits voice events', async () => {
		const { el } = makeEl();
		const transcripts = [];
		const latencies = [];
		el.addEventListener('voice:transcript', (e) => transcripts.push(e.detail));
		el.addEventListener('voice:latency', (e) => latencies.push(e.detail));
		await el._toggleMic();
		const voice = made.list[0];
		voice.emit('transcript', { role: 'user', text: 'hel', final: false });
		voice.emit('transcript', { role: 'user', text: 'hello', final: true });
		voice.emit('transcript', { role: 'assistant', text: 'Hi there.', final: true });
		voice.emit('latency', { kind: 'response', ms: 610 });
		const bodies = [...el._chatEl.querySelectorAll('.msg .body')].map((n) => n.textContent);
		expect(bodies).toEqual(['hello', 'Hi there.']);
		expect(transcripts).toEqual([
			{ text: 'hel', final: false },
			{ text: 'hello', final: true },
		]);
		expect(latencies).toEqual([{ kind: 'response', ms: 610 }]);
	});

	it('a second click ends the session and returns the mouth to neutral', async () => {
		const { el, states } = makeEl();
		await el._toggleMic();
		await el._toggleMic();
		expect(made.list[0].closed).toBe(true);
		expect(el._grokVoice).toBe(null);
		expect(el._avatar.disconnectLipSync).toHaveBeenCalled();
		expect(states.at(-1)).toBe('idle');
	});

	it('falls through to the standard voice chain when the server has no Grok voice', async () => {
		made.failWith = { code: 'grok_voice_not_configured', message: 'Grok voice is not enabled on this server yet.' };
		const { el } = makeEl();
		await el._toggleMic();
		expect(el._runtime.listen).toHaveBeenCalledTimes(1);
		await el._toggleMic();
		expect(made.list).toHaveLength(1);
		expect(el._runtime.listen).toHaveBeenCalledTimes(2);
	});

	it('shows any other failure in the chat instead of silently switching chains', async () => {
		made.failWith = { code: 'unauthorized', message: 'sign in to start a Grok voice session' };
		const { el } = makeEl();
		await el._toggleMic();
		expect(el._runtime.listen).not.toHaveBeenCalled();
		expect(el._chatEl.textContent).toContain('sign in to start a Grok voice session');
	});

	it('offers the mic whenever the browser can capture audio', () => {
		const { el } = makeEl();
		expect(el._speechInputAvailable()).toBe(true);
	});

	it('closes the session on teardown', async () => {
		const { el } = makeEl();
		await el._toggleMic();
		el._teardown();
		expect(made.list[0].closed).toBe(true);
	});
});

describe('without the attribute', () => {
	it('never touches Grok', async () => {
		const { el } = makeEl({ provider: null });
		await el._toggleMic();
		expect(made.list).toHaveLength(0);
		expect(el._runtime.listen).toHaveBeenCalledTimes(1);
	});
});

describe('lipSyncFrom(analyser)', () => {
	it('drives the visemes from a caller-owned analyser and releases them', () => {
		const { el } = makeEl({ provider: null });
		const analyser = { kind: 'page-analyser' };
		const release = el.lipSyncFrom(analyser);
		expect(el._avatar.connectLipSync).toHaveBeenCalledWith(analyser);
		release();
		expect(el._avatar.disconnectLipSync).toHaveBeenCalled();
	});

	it('makes an older release a no-op once a newer source owns the mouth', () => {
		const { el } = makeEl({ provider: null });
		const first = el.lipSyncFrom({ kind: 'first' });
		el.lipSyncFrom({ kind: 'second' });
		const disconnectsBefore = el._avatar.disconnectLipSync.mock.calls.length;
		first();
		expect(el._avatar.disconnectLipSync.mock.calls.length).toBe(disconnectsBefore);
	});

	it('waits for the avatar when it is still loading', async () => {
		const { el } = makeEl({ provider: null });
		const avatar = el._avatar;
		el._avatar = null;
		el._mounted = false;
		el._booting = true;
		const analyser = { kind: 'late' };
		el.lipSyncFrom(analyser);
		expect(avatar.connectLipSync).not.toHaveBeenCalled();
		el._avatar = avatar;
		el._mounted = true;
		el.dispatchEvent(new CustomEvent('agent:ready'));
		await Promise.resolve();
		expect(avatar.connectLipSync).toHaveBeenCalledWith(analyser);
	});
});
