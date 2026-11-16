// Bot reply streaming in Teams (api/_lib/teams-stream.js), checked against the
// documented REST protocol: a typing activity with a streaminfo entity opens
// the stream and its id is the streamId, every update repeats the text so far
// with the next streamSequence, the final is a message with streamType final
// and no sequence, and a group or channel chat gets one ordinary reply.
// https://learn.microsoft.com/en-us/microsoftteams/platform/bots/streaming-ux

import { describe, it, expect } from 'vitest';
import { createReplyStream } from '../api/_lib/teams-stream.js';
import { withAiContent } from '../api/_lib/teams-ai.js';

const TENANT = '72f988bf-86f1-41af-91ab-2d7cd011db47';

const message = (conversationType, over = {}) => ({
	type: 'message',
	id: '1731770000123',
	channelId: 'msteams',
	serviceUrl: 'https://smba.trafficmanager.net/amer/',
	from: { id: '29:1Xq2-teams-user', name: 'Megan Bowen', aadObjectId: 'a1b2c3d4-0000-4000-8000-00000000e001' },
	conversation: conversationType === 'personal'
		? { conversationType: 'personal', tenantId: TENANT, id: 'a:1Hk3-personal-chat' }
		: { conversationType: 'groupChat', tenantId: TENANT, id: '19:meeting_abc@thread.v2', isGroup: true },
	recipient: { id: '28:5d1c2b3a-0000-4000-8000-00000000b071', name: 'three.ws 3D Studio' },
	text: 'What is the returns window?',
	...over,
});

// Records each Bot Connector call the way the REST API answers it: the first
// activity a conversation receives gets an id, which streaming reuses.
function recordingConnector({ failOn = null } = {}) {
	const calls = [];
	let n = 0;
	const answer = (kind, args) => {
		calls.push({ kind, ...args });
		if (failOn?.(kind, args, calls.length)) {
			throw Object.assign(new Error('Content stream is not allowed'), { status: 403, code: 'ContentStreamNotAllowed' });
		}
		n += 1;
		return { id: `stream-${n}` };
	};
	return {
		calls,
		connectorConfigured: () => true,
		sendToConversation: async (args) => answer('send', args),
		replyToActivity: async (args) => answer('reply', args),
		updateActivity: async (args) => answer('update', args),
	};
}

function clock() {
	let t = 1_000_000;
	return { now: () => t, sleep: async (ms) => { t += ms; }, tick: (ms) => { t += ms; } };
}

describe('personal chat', () => {
	it('opens with an informative typing activity, streams cumulative text, and closes with a final message', async () => {
		const connector = recordingConnector();
		const c = clock();
		const stream = createReplyStream(message('personal'), { connector, now: c.now, sleep: c.sleep });
		expect(stream.streaming).toBe(true);

		await stream.informative('Searching Atlas\'s documents');
		await stream.informative('Writing the answer');
		c.tick(1200);
		await stream.append('Returns are accepted ');
		await stream.append('for 30 days');
		c.tick(1200);
		await stream.append(' [1].');
		const final = withAiContent({ type: 'message', text: stream.text, textFormat: 'markdown' });
		const posted = await stream.finish(final);

		const acts = connector.calls.map((x) => x.activity);
		expect(connector.calls.every((x) => x.kind === 'send' && x.conversationId === 'a:1Hk3-personal-chat')).toBe(true);
		// 1. the open: typing, informative, sequence 1, no streamId yet
		expect(acts[0]).toEqual({
			type: 'typing',
			text: 'Searching Atlas\'s documents',
			replyToId: '1731770000123',
			entities: [{ type: 'streaminfo', streamType: 'informative', streamSequence: 1 }],
		});
		// 2. a second informative on the same stream
		expect(acts[1].entities).toEqual([{ type: 'streaminfo', streamId: 'stream-1', streamType: 'informative', streamSequence: 2 }]);
		expect(acts[1].text).toBe('Writing the answer');
		// 3 and 4. content updates carry everything streamed so far
		expect(acts[2]).toMatchObject({ type: 'typing', text: 'Returns are accepted ', entities: [{ type: 'streaminfo', streamId: 'stream-1', streamType: 'streaming', streamSequence: 3 }] });
		expect(acts[3]).toMatchObject({ type: 'typing', text: 'Returns are accepted for 30 days [1].', entities: [{ type: 'streaminfo', streamId: 'stream-1', streamType: 'streaming', streamSequence: 4 }] });
		// 5. the final: a message, the full text, streamType final and no sequence,
		// with the AI label and feedback controls (they render only after close)
		const last = acts[4];
		expect(last.type).toBe('message');
		expect(last.text).toBe('Returns are accepted for 30 days [1].');
		expect(last.entities[0]).toEqual({ type: 'streaminfo', streamId: 'stream-1', streamType: 'final' });
		expect(last.entities[1].additionalType).toEqual(['AIGeneratedContent']);
		expect(last.channelData.feedbackLoopEnabled).toBe(true);
		expect(posted).toEqual({ id: 'stream-1', streamed: true });
		expect(acts).toHaveLength(5);
	});

	it('never sends more than one request a second on a stream', async () => {
		const connector = recordingConnector();
		const c = clock();
		const sentAt = [];
		const wrapped = { ...connector, sendToConversation: async (a) => { sentAt.push(c.now()); return connector.sendToConversation(a); } };
		const stream = createReplyStream(message('personal'), { connector: wrapped, now: c.now, sleep: c.sleep });
		await stream.informative('one');
		await stream.informative('two');
		for (let i = 0; i < 50; i++) { c.tick(37); await stream.append(`w${i} `); }
		await stream.finish({ type: 'message' });
		for (let i = 1; i < sentAt.length; i++) expect(sentAt[i] - sentAt[i - 1]).toBeGreaterThanOrEqual(1000);
		expect(connector.calls.at(-1).activity.text).toBe(stream.text);
	});

	it('falls back to one reply when Teams refuses to open a stream', async () => {
		const connector = recordingConnector({ failOn: (kind, _a, i) => kind === 'send' && i === 1 });
		const c = clock();
		const stream = createReplyStream(message('personal'), { connector, now: c.now, sleep: c.sleep });
		await stream.informative('Writing the answer');
		await stream.append('All done.');
		const posted = await stream.finish(withAiContent({ type: 'message' }));
		const last = connector.calls.at(-1);
		expect(last.kind).toBe('reply');
		expect(last.activityId).toBe('1731770000123');
		expect(last.activity.text).toBe('All done.');
		expect(last.activity.entities.some((e) => e.type === 'streaminfo')).toBe(false);
		expect(posted.streamed).toBe(false);
	});

	it('still delivers the answer as a reply when the final stream message is refused', async () => {
		const connector = recordingConnector({ failOn: (kind, args) => kind === 'send' && args.activity.type === 'message' });
		const c = clock();
		const stream = createReplyStream(message('personal'), { connector, now: c.now, sleep: c.sleep });
		await stream.append('Partial answer');
		const posted = await stream.finish({ type: 'message' });
		expect(connector.calls.at(-1)).toMatchObject({ kind: 'reply', activity: { type: 'message', text: 'Partial answer' } });
		expect(posted.streamed).toBe(false);
	});
});

describe('group and channel chats', () => {
	it('send a single reply with no typing or streaminfo activities', async () => {
		const connector = recordingConnector();
		const c = clock();
		const stream = createReplyStream(message('groupChat'), { connector, now: c.now, sleep: c.sleep });
		expect(stream.streaming).toBe(false);
		await stream.informative('Searching');
		await stream.append('Returns are accepted for 30 days.');
		const posted = await stream.finish(withAiContent({ type: 'message', textFormat: 'markdown' }));
		expect(connector.calls).toHaveLength(1);
		const [only] = connector.calls;
		expect(only.kind).toBe('reply');
		expect(only.conversationId).toBe('19:meeting_abc@thread.v2');
		expect(only.activity.type).toBe('message');
		expect(only.activity.text).toBe('Returns are accepted for 30 days.');
		expect(only.activity.entities).toHaveLength(1);
		expect(only.activity.entities[0].additionalType).toEqual(['AIGeneratedContent']);
		expect(posted).toEqual({ id: 'stream-1', streamed: false });
	});
});
