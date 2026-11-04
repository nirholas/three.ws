// Open the TUI on a context and wait until the person quits.

import React from 'react';
import { render } from 'ink';
import { App, loadAvatar } from './app.js';
import { createSession } from '../session.js';

/**
 * @param {object} o
 * @param {object} o.ctx           createAgentContext()
 * @param {string} [o.resume]      a session id or prefix to continue
 * @param {string|boolean} [o.avatar] a GLB path, URL or three.ws avatar/agent id; `true` uses config.avatar.source
 * @param {object} [o.overrides]
 */
export async function runTui({ ctx, resume = null, avatar = null, overrides = {}, stdin, stdout }) {
	const session = createSession(ctx, { resume });
	const notes = [];
	let avatarLoaded = null;
	const source = avatar === true ? ctx.config.avatar?.source || ctx.config.agentId : avatar || (ctx.config.avatar?.enabled ? ctx.config.avatar.source : null);
	if (source) {
		try {
			avatarLoaded = await loadAvatar(source, { origin: ctx.config.origin });
		} catch (err) {
			notes.push(`Avatar not shown: ${err.message}`);
		}
	} else if (avatar === true) {
		notes.push('Avatar not shown: pass --avatar <glb path | url | avatar id>, or select an agent with /agent first.');
	}
	if (ctx.modelError) notes.push(`${ctx.modelError.message}`);
	notes.unshift(
		`three.ws agent: ${ctx.modelLabel}. ${resume ? `Resumed session ${session.id}` : `Session ${session.id}`}. /help lists commands; Ctrl+C stops a turn.`,
	);
	let exitInfo = { sessionId: session.id };
	const app = render(
		React.createElement(App, {
			ctx,
			session,
			avatar: avatarLoaded,
			overrides,
			initialItems: notes,
			onExit: (info) => {
				exitInfo = info;
			},
		}),
		{ exitOnCtrlC: false, stdin, stdout },
	);
	await app.waitUntilExit();
	return exitInfo;
}
