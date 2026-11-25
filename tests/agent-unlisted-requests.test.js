// @vitest-environment jsdom
//
// An agent that is not published to the marketplace answers 404 on
// /api/marketplace/agents/:id and /api/agents/:id/alpha/candidates for anyone
// but its owner. The public agent record never said whether the agent was
// listed, so every visitor to an unlisted agent's profile fired both requests
// and logged both 404s (production, 2026-11-25), and the Alpha Co-pilot panel
// advertised a deep link that 404s the same way. GET /api/agents/:id now carries
// `is_listed`, and the profile skips those reads for a visitor when it is false.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { decorate } from '../api/agents.js';
import { normalize } from '../src/agent-detail.js';
import { enrichAgentDetail } from '../src/agent-detail-market.js';
import { mountAlphaPanel } from '../src/shared/alpha-copilot-link.js';

const AGENT = '4a0fd5db-eded-406f-ba75-455a7eb29ddb';

function row(extra = {}) {
	return { id: AGENT, user_id: 'u1', name: 'A', meta: {}, skills: [], ...extra };
}

describe('GET /api/agents/:id public projection', () => {
	it('tells a visitor whether the agent is listed', () => {
		expect(decorate(row({ is_published: false }), false).is_listed).toBe(false);
		expect(decorate(row({ is_published: true }), false).is_listed).toBe(true);
	});

	it('omits the flag when the row did not select it, so callers never misread it as unlisted', () => {
		expect('is_listed' in decorate(row(), false)).toBe(false);
	});
});

describe('agent profile skips listing-only reads for an unlisted agent', () => {
	let calls;
	beforeEach(() => {
		calls = [];
		globalThis.fetch = vi.fn(async (url) => {
			calls.push(String(url));
			return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
		});
		document.body.innerHTML = '<div id="host"></div>';
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('normalize carries the listing flag', () => {
		expect(normalize({ id: AGENT, is_listed: false }, null).listed).toBe(false);
		expect(normalize({ id: AGENT, is_published: false }, null).listed).toBe(false);
		expect(normalize({ id: AGENT }, null).listed).toBe(true);
	});

	it('does not ask the marketplace for an unlisted agent a visitor is viewing', async () => {
		await enrichAgentDetail({ id: AGENT, isOwner: false, listed: false });
		expect(calls.filter((u) => u.includes('/marketplace/agents/'))).toEqual([]);
	});

	it('still asks for the owner, who can see their own unlisted agent', async () => {
		await enrichAgentDetail({ id: AGENT, isOwner: true, listed: false });
		expect(calls.filter((u) => u.includes('/marketplace/agents/'))).toHaveLength(1);
	});

	it('does not mount the Alpha Co-pilot panel for an unlisted agent a visitor is viewing', async () => {
		const container = document.getElementById('host');
		const out = await mountAlphaPanel({ agentId: AGENT, isOwner: false, listed: false, container });
		expect(out).toBeNull();
		expect(container.children).toHaveLength(0);
		expect(calls).toEqual([]);
	});

	it('mounts the panel for a listed agent and for the owner', async () => {
		const container = document.getElementById('host');
		expect(await mountAlphaPanel({ agentId: AGENT, isOwner: false, listed: true, container })).not.toBeNull();
		expect(await mountAlphaPanel({ agentId: AGENT, isOwner: true, listed: false, container })).not.toBeNull();
	});
});
