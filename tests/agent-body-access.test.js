// Whether an agent profile may ask /api/avatars/:id for the body the agent
// wears. A public agent can wear a private avatar; GET /api/agents/:id already
// says so (`avatar_visibility: 'private'`) and withholds the model URL, and
// /api/avatars/:id answers 404 to everyone but its owner. Both agent profiles
// asked anyway, about 200 guaranteed 404s every twelve hours in production.

import { describe, it, expect } from 'vitest';
import { agentBodyReadable } from '../src/shared/agent-body-access.js';

const ID = '0d83e90f-5e39-45d5-8ac1-7207f497ebd4';

describe('agentBodyReadable', () => {
	it('skips a private body for a visitor', () => {
		expect(agentBodyReadable({ avatar_id: ID, avatar_visibility: 'private', is_owner: false })).toBe(false);
	});

	it('reads a private body for the agent owner', () => {
		expect(agentBodyReadable({ avatar_id: ID, avatar_visibility: 'private', is_owner: true })).toBe(true);
		// Owner responses carry user_id; that alone marks the owner on older shapes.
		expect(agentBodyReadable({ avatar_id: ID, avatar_visibility: 'private', user_id: 'u1' })).toBe(true);
	});

	it('reads public, unlisted and unreported bodies', () => {
		expect(agentBodyReadable({ avatar_id: ID, avatar_visibility: 'public' })).toBe(true);
		expect(agentBodyReadable({ avatar_id: ID, avatar_visibility: 'unlisted' })).toBe(true);
		expect(agentBodyReadable({ avatar_id: ID })).toBe(true);
	});

	it('has nothing to read without an avatar id', () => {
		expect(agentBodyReadable({ avatar_visibility: 'public' })).toBe(false);
		expect(agentBodyReadable(null)).toBe(false);
	});
});
