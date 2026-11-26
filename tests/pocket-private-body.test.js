// /pocket boots each roster agent's body in a /walk-embed screen, addressed by
// avatar id so the GLB streams through the same-origin proxy. A public agent can
// wear a private avatar: GET /api/agents/:id says so (avatar_visibility
// 'private', no model URL) and /api/avatars/:id/glb answers 404 to everyone but
// the owner, so handing that id to the screen could only fail. On 2026-11-26,
// 13 of the 24 agents on the /pocket roster wore private bodies and each one
// logged a 404 for /api/avatars/<id>/glb. A visitor gets the agent resolved
// server-side instead (its default body); the owner still gets their own body.

import { describe, it, expect } from 'vitest';
import { pocketFrameSrc, pocketSwapAvatarId } from '../src/pocket-screen.js';

const AGENT = '4a0fd5db-eded-406f-ba75-455a7eb29ddb';
const AVATAR = '0d83e90f-5e39-45d5-8ac1-7207f497ebd4';
const privateForVisitor = { id: AGENT, avatar_id: AVATAR, avatar_visibility: 'private', avatar_model_url: null, is_owner: false };

describe('/pocket screen for a public agent wearing a private body', () => {
	it('boots the visitor through the agent id, never the private avatar id', () => {
		const src = pocketFrameSrc({ agentId: AGENT, detail: privateForVisitor, env: 'studio' });
		expect(src).not.toContain(AVATAR);
		expect(new URL(src, 'https://three.ws').searchParams.get('agent')).toBe(AGENT);
	});

	it('does not swap a visitor to the private avatar id', () => {
		expect(pocketSwapAvatarId(privateForVisitor)).toBeNull();
	});

	it('keeps the avatar id for the owner and for a public body', () => {
		for (const detail of [{ ...privateForVisitor, is_owner: true }, { ...privateForVisitor, avatar_visibility: 'public' }]) {
			const src = new URL(pocketFrameSrc({ agentId: AGENT, detail, env: 'studio' }), 'https://three.ws');
			expect(src.pathname).toBe('/walk-embed');
			expect(src.searchParams.get('avatar')).toBe(AVATAR);
			expect(src.searchParams.get('agent')).toBeNull();
			expect(pocketSwapAvatarId(detail)).toBe(AVATAR);
		}
	});

	it('frames the screen tighter than a full-bleed embed with no controls', () => {
		const src = new URL(pocketFrameSrc({ agentId: AGENT, detail: null, env: 'night' }), 'https://three.ws');
		expect(Object.fromEntries(src.searchParams)).toEqual({
			controls: 'none', orbit: 'false', badge: 'false', click: 'false', gestures: 'false', zoom: '0.74', env: 'night', agent: AGENT,
		});
	});
});
