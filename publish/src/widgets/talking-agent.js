/**
 * Talking Agent Widget — embodied chat panel wired to /api/widgets/:id/chat.
 *
 * The chat endpoint owns brain dispatch (Anthropic / custom proxy / none) plus
 * visitor rate limiting, so the widget never sees an API key. We post the
 * visitor's turn + history, parse the SSE response for { reply, actions }, and
 * surface actions on the SceneController (wave / lookAt / playClip / remember).
 *
 * Action shape from the endpoint (camelCase, single layer):
 *   { type: 'wave' }
 *   { type: 'lookAt', target: 'user'|'camera'|'model' }
 *   { type: 'playClip', name: '<clip-name>' }
 *   { type: 'remember', content: '<note>' }
 */

import { NichAgent } from '../nich-agent.js';
import { ACTION_TYPES } from '../agent-protocol.js';

/**
 * @param {import('../viewer.js').Viewer} viewer
 * @param {object} config  Talking-agent config (see widget-types.js).
 * @param {HTMLElement} container  Root container (usually document.body).
 * @param {{
 *   widgetId: string,
 *   getSceneCtrl: () => (import('../runtime/scene.js').SceneController|null),
 *   protocol?: import('../agent-protocol.js').AgentProtocol,
 *   identity?: import('../agent-identity.js').AgentIdentity,
 * }} ctx
 * @returns {Promise<{ destroy: () => void }>}
 */
export async function mountTalkingAgent(viewer, config, container, ctx) {
	const { widgetId, getSceneCtrl, protocol = null, identity = null } = ctx || {};
	const isPreview = !widgetId;

	const history = [];
	let destroyed = false;

	const agent = new NichAgent(container, protocol, null, identity, null, {
		layout: 'embedded',
		position: config.chatPosition || 'right',
		greeting: config.greeting || 'Hi! Ask me anything.',
		title: config.agentName || undefined,
		theme: { accent: config.accent, background: config.background, caption: config.caption },
		showPoweredBy: config.poweredByBadge !== false,
		voiceInput: config.voiceInput !== false,
		voiceOutput: config.voiceOutput !== false,
		skipDefaultListeners: true,
		onSend: async (text) => {
			if (isPreview) {
				return { reply: 'Preview mode — save your widget to enable live chat.' };
			}
			try {
				const result = await dispatchChat(widgetId, text, history.slice(-20));
				if (result.reply) {
					history.push({ role: 'user', content: text });
					history.push({ role: 'assistant', content: result.reply });
				}
				queueMicrotask(() => runActions(result.actions, getSceneCtrl, protocol));
				return { reply: result.reply, error: result.error };
			} catch (err) {
				console.warn('[talking-agent] chat dispatch failed', err.message);
				return { error: 'Chat is unavailable right now.' };
			}
		},
	});

	return {
		destroy() {
			if (destroyed) return;
			destroyed = true;
			try {
				agent.panel?.remove();
				agent.toggleBtn?.remove();
			} catch {}
		},
	};
}

// ── SSE round-trip ─────────────────────────────────────────────────────────

async function dispatchChat(widgetId, message, history) {
	const res = await fetch(`/api/widgets/${encodeURIComponent(widgetId)}/chat`, {
		method: 'POST',
		credentials: 'include',
		headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
		body: JSON.stringify({ message, history }),
	});

	if (res.status === 429) {
		const data = await res.json().catch(() => ({}));
		const wait = data.retry_after ? ` Try again in ${data.retry_after}s.` : '';
		return { reply: '', actions: [], error: `Slow down a moment.${wait}` };
	}
	if (!res.ok) {
		const data = await res.json().catch(() => ({}));
		return { reply: '', actions: [], error: data.error_description || 'Chat backend error.' };
	}

	const text = await res.text();
	return parseSse(text);
}

function parseSse(text) {
	let reply = '';
	const actions = [];
	let error = null;
	for (const block of text.split(/\n\n+/)) {
		if (!block.trim()) continue;
		let event = 'message';
		let data = '';
		for (const line of block.split('\n')) {
			if (line.startsWith('event:')) event = line.slice(6).trim();
			else if (line.startsWith('data:')) data += line.slice(5).trim();
		}
		if (!data) continue;
		let payload;
		try {
			payload = JSON.parse(data);
		} catch {
			continue;
		}
		if (event === 'message') {
			if (typeof payload.reply === 'string') reply += payload.reply;
			if (Array.isArray(payload.actions)) actions.push(...payload.actions);
		} else if (event === 'error') {
			error = payload.message || 'Chat backend error.';
		}
	}
	return { reply, actions, error };
}

// ── Action dispatch ────────────────────────────────────────────────────────

function runActions(actions, getSceneCtrl, protocol) {
	if (!Array.isArray(actions) || !actions.length) return;
	const sceneCtrl = getSceneCtrl?.();
	for (const action of actions) {
		if (!action || typeof action.type !== 'string') continue;
		try {
			runOne(action, sceneCtrl, protocol);
		} catch (err) {
			console.warn('[talking-agent] action failed', action.type, err.message);
		}
	}
}

function runOne(action, sceneCtrl, protocol) {
	switch (action.type) {
		case 'wave':
			sceneCtrl?.playAnimationByHint?.('wave', { duration: 1500 });
			return;
		case 'lookAt': {
			const target = action.target === 'model' ? 'center' : action.target;
			sceneCtrl?.lookAt?.(target);
			return;
		}
		case 'playClip':
			if (typeof action.name === 'string') sceneCtrl?.playClipByName?.(action.name);
			return;
		case 'remember':
			if (protocol && typeof action.content === 'string') {
				protocol.emit({
					type: ACTION_TYPES.REMEMBER,
					payload: { type: 'user', content: action.content },
				});
			}
			return;
		default:
			console.warn('[talking-agent] unknown action type:', action.type);
	}
}
