// Streaming a bot reply into a Teams chat over the Bot Connector REST API.
//
// Protocol (https://learn.microsoft.com/en-us/microsoftteams/platform/bots/streaming-ux):
//   open      POST a `typing` activity with a streaminfo entity
//             { streamType: 'informative' | 'streaming', streamSequence: 1 }.
//             The id Teams answers with is the streamId, and becomes the id of
//             the final message.
//   update    more `typing` activities naming that streamId with the next
//             streamSequence. Streaming text is cumulative: each update holds
//             everything sent so far, or Teams answers 403.
//   final     a `message` activity with the full text and a streaminfo entity
//             { streamId, streamType: 'final' } and no sequence. Attachments,
//             the AI label and the feedback buttons render only on it.
//   limits    one request per second per stream; informative text up to 1000
//             characters; a stream must close within 10 minutes.
//
// Teams streams only in personal (one to one) chats here; a group chat or a
// channel gets one ordinary reply when the answer is complete. Any refusal
// from Teams degrades to that same single reply, so the person always gets
// the answer.

export const MIN_INTERVAL_MS = 1000;
export const INFORMATIVE_MAX = 1000;

const STREAMINFO = 'streaminfo';

function isPersonal(activity) {
	return activity?.conversation?.conversationType === 'personal';
}

/**
 * A reply stream for one incoming message.
 * @param {object} activity the message being answered
 * @param {object} o
 * @param {object} o.connector api/_lib/teams-connector.js (or the same shape)
 */
export function createReplyStream(activity, { connector, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), minIntervalMs = MIN_INTERVAL_MS } = {}) {
	const target = { serviceUrl: activity.serviceUrl, conversationId: activity.conversation.id };
	const streaming = isPersonal(activity);
	let streamId = null;
	let sequence = 0;
	let lastSentAt = -Infinity;
	let text = '';
	let sentText = '';
	let broken = false;
	let pending = Promise.resolve();

	const serial = (fn) => {
		pending = pending.then(fn, fn);
		return pending;
	};

	async function waitTurn() {
		const wait = lastSentAt + minIntervalMs - now();
		if (wait > 0) await sleep(wait);
	}

	async function post(type, body, streamType) {
		sequence += 1;
		const info = streamId
			? { type: STREAMINFO, streamId, streamType, streamSequence: sequence }
			: { type: STREAMINFO, streamType, streamSequence: sequence };
		const act = streamId
			? { type, text: body, entities: [info] }
			: { type, text: body, replyToId: activity.id, entities: [info] };
		lastSentAt = now();
		try {
			const res = await connector.sendToConversation({ ...target, activity: act });
			if (!streamId) {
				if (!res?.id) throw new Error('Teams did not return a stream id');
				streamId = res.id;
			}
			return true;
		} catch (err) {
			broken = true;
			console.warn(`[teams-stream] ${streamId ? 'update' : 'open'} refused (${err?.status || ''} ${err?.code || err?.message || err}); finishing as one reply`);
			return false;
		}
	}

	async function flush() {
		if (!streaming || broken || text === sentText || !text.trim()) return;
		if (now() - lastSentAt < minIntervalMs) return;
		const body = text;
		if (await post('typing', body, 'streaming')) sentText = body;
	}

	async function singleReply(message) {
		const res = await connector.replyToActivity({ ...target, activityId: activity.id, activity: message });
		return { id: res?.id || null, streamed: false };
	}

	return {
		streaming,
		get text() {
			return text;
		},

		/** A status line ("Searching documents") shown until content starts. */
		informative(line) {
			return serial(async () => {
				if (!streaming || broken || sentText) return;
				await waitTurn();
				await post('typing', String(line).slice(0, INFORMATIVE_MAX), 'informative');
			});
		},

		/** Add generated text; sends an update when the rate limit allows. */
		append(chunk) {
			text += String(chunk ?? '');
			return serial(flush);
		},

		/**
		 * Close the stream with the final message (its text defaults to
		 * everything appended). Resolves { id, streamed }.
		 */
		finish(final = {}) {
			return serial(async () => {
				const full = final.text || text;
				const entities = (final.entities || []).filter((e) => e?.type !== STREAMINFO);
				const message = { ...final, type: 'message', text: full };
				if (!streaming || broken || !streamId) {
					return singleReply({ ...message, ...(entities.length ? { entities } : {}) });
				}
				await waitTurn();
				try {
					lastSentAt = now();
					await connector.sendToConversation({
						...target,
						activity: { ...message, entities: [{ type: STREAMINFO, streamId, streamType: 'final' }, ...entities] },
					});
					return { id: streamId, streamed: true };
				} catch (err) {
					console.warn(`[teams-stream] final refused (${err?.status || ''} ${err?.code || err?.message || err}); sending one reply`);
					return singleReply({ ...message, ...(entities.length ? { entities } : {}) });
				}
			});
		},
	};
}
