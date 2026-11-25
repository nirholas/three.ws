// @vitest-environment jsdom
//
// A public agent can wear a private avatar. GET /api/agents/:id reports that as
// `avatar_visibility: 'private'` and withholds the model URL, and every
// /api/avatars/:id read (the record and the /glb proxy) answers 404 to anyone
// but the owner. Production logged 200+ such 404s an hour on 2026-11-25 from the
// agent profile, classic, AR and walk views, because each surface still handed
// the private avatar id to something that fetched it: the <avatar-actions> fork
// card (twice per page), the inline /walk-embed preview, the /walk, /xr and /irl
// deep links, the walk and assistant embeds resolving ?agent=, and /agents/:id/ar.
// For a visitor those requests can only fail; the body is the mannequin.

import { describe, it, expect, beforeEach } from 'vitest';
import { normalize, walkEmbedSrc, walkAppHref, xrHref, irlHref } from '../src/agent-detail.js';
import { agentBodyGlbPath, agentBodyArBlocker } from '../src/shared/agent-body-access.js';

const AGENT = '4a0fd5db-eded-406f-ba75-455a7eb29ddb';
const AVATAR = '0d83e90f-5e39-45d5-8ac1-7207f497ebd4';

const privateForVisitor = {
	id: AGENT,
	name: 'Private body',
	avatar_id: AVATAR,
	avatar_visibility: 'private',
	avatar_model_url: null,
	is_owner: false,
};

describe('agent detail links for a public agent wearing a private body', () => {
	it('never sends the private avatar id to the walk embed, walk app, xr or irl', () => {
		const agent = normalize(privateForVisitor, null);
		for (const href of [walkEmbedSrc(agent), walkAppHref(agent), xrHref(agent), irlHref(agent)]) {
			expect(href).not.toContain(AVATAR);
		}
		expect(walkEmbedSrc(agent)).toContain(`agent=${AGENT}`);
		expect(xrHref(agent)).toBe('/xr');
	});

	it('keeps the avatar id in the links for the owner', () => {
		const agent = normalize({ ...privateForVisitor, is_owner: true }, null);
		expect(walkEmbedSrc(agent)).toContain(`avatar=${AVATAR}`);
		expect(xrHref(agent)).toBe(`/xr?avatar=${AVATAR}`);
	});

	it('keeps the avatar id in the links for a public body', () => {
		const agent = normalize({ ...privateForVisitor, avatar_visibility: 'public' }, null);
		expect(walkAppHref(agent)).toContain(`avatar=${AVATAR}`);
		expect(irlHref(agent)).toContain(`avatar=${AVATAR}`);
	});
});

describe('agentBodyGlbPath (walk and assistant embeds resolving ?agent=)', () => {
	it('returns null for a private body the visitor cannot read', () => {
		expect(agentBodyGlbPath(privateForVisitor)).toBeNull();
	});

	it('proxies a readable body through the same-origin GLB route', () => {
		expect(agentBodyGlbPath({ ...privateForVisitor, avatar_visibility: 'public' })).toBe(`/api/avatars/${AVATAR}/glb`);
		expect(agentBodyGlbPath({ ...privateForVisitor, is_owner: true })).toBe(`/api/avatars/${AVATAR}/glb`);
	});

	it('returns null for an agent with no body', () => {
		expect(agentBodyGlbPath({ id: AGENT, avatar_id: null })).toBeNull();
	});
});

describe('agentBodyArBlocker (/agents/:id/ar)', () => {
	it('reports a private body instead of letting the page fetch it and fail', () => {
		expect(agentBodyArBlocker(privateForVisitor)).toBe('private');
	});

	it('reports a missing body', () => {
		expect(agentBodyArBlocker({ id: AGENT, avatar_id: null })).toBe('none');
	});

	it('lets a readable body through', () => {
		expect(agentBodyArBlocker({ ...privateForVisitor, is_owner: true })).toBeNull();
		expect(agentBodyArBlocker({ ...privateForVisitor, avatar_visibility: 'unlisted' })).toBeNull();
	});
});

describe('<avatar-actions> fetches its avatar once per id', () => {
	beforeEach(() => {
		document.body.innerHTML = '';
	});

	it('does not issue a second avatar request when upgrade fires attributeChanged and connected', async () => {
		const calls = [];
		globalThis.fetch = async (url) => {
			calls.push(String(url));
			if (String(url).includes('/api/avatars/')) {
				return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
			}
			if (String(url).includes('/api/auth/me') || String(url).endsWith('/api/me')) {
				return new Response(JSON.stringify({}), { status: 401 });
			}
			return new Response(JSON.stringify({ agents: [] }), { status: 200 });
		};
		// Same order as the agent page: the attribute is set before the element
		// definition loads, so the upgrade runs attributeChangedCallback and then
		// connectedCallback.
		const el = document.createElement('avatar-actions');
		el.setAttribute('avatar-id', AVATAR);
		document.body.appendChild(el);
		await import('../public/avatar-actions.js');
		await customElements.whenDefined('avatar-actions');
		for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
		const avatarCalls = calls.filter((u) => u.includes(`/api/avatars/${AVATAR}`));
		expect(avatarCalls).toHaveLength(1);
	});
});
