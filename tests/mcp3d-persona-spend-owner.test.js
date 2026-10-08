// persona_tip / persona_send on an OWNED persona move funds only for the owner.
//
// The persona_id rides in every embodiment embed URL, so it cannot double as
// the key to an owned persona's wallet. These tests drive the real tool
// handlers with the store and the settlement path stubbed at the module edge,
// and prove a stranger is refused before any settlement is attempted.
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET ||= 'test-jwt-secret-not-a-real-secret-0123456789';
process.env.PERSONA_WALLET_SECRET ||= 'test-persona-wallet-secret-0123456789';

const state = vi.hoisted(() => ({ record: null, sends: [] }));

vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: new Proxy({}, { get: () => async () => ({ success: true, reset: Date.now() }) }),
	clientIp: () => '127.0.0.1',
}));

vi.mock('../api/_lib/persona-store.js', async (importOriginal) => {
	const real = await importOriginal();
	return { ...real, getPersona: async () => state.record };
});

vi.mock('../api/_lib/persona-wallet.js', async (importOriginal) => {
	const real = await importOriginal();
	return {
		...real,
		sendPersonaUsdc: async (input) => {
			state.sends.push(input);
			return {
				status: 'sent',
				usdc: input.usdc,
				to: input.to,
				signature: 'sig',
				explorer: 'https://explorer.example/tx/sig',
				session_spent_usdc: input.usdc,
				session_cap_usdc: 5,
			};
		},
	};
});

const { toolDefs, personaSpendForbidden } = await import('../api/_mcp3d/tools/persona-identity.js');

const PERSONA_ID = 'persona_abcdefghijklmnop';
const TO = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const OWNER = '11111111-1111-4111-8111-111111111111';
const STRANGER = '22222222-2222-4222-8222-222222222222';

function persona(ownerId) {
	return {
		id: PERSONA_ID,
		owner_id: ownerId,
		name: 'Test Persona',
		glb_url: 'https://three.ws/x.glb',
		look: {},
		emotion_baseline: 'neutral',
	};
}

const call = (name, auth) =>
	toolDefs.find((t) => t.name === name).handler({ persona_id: PERSONA_ID, to: TO, usdc: 0.1 }, auth);

beforeEach(() => {
	state.sends = [];
});

describe('personaSpendForbidden', () => {
	it('lets anyone holding the id spend an unowned persona (its creation model)', () => {
		expect(personaSpendForbidden({ owner_id: null }, { userId: null })).toBe(false);
	});
	it('refuses an anonymous or different caller on an owned persona', () => {
		expect(personaSpendForbidden({ owner_id: OWNER }, { userId: null, source: 'x402' })).toBe(true);
		expect(personaSpendForbidden({ owner_id: OWNER }, { userId: STRANGER })).toBe(true);
	});
	it('allows the owner', () => {
		expect(personaSpendForbidden({ owner_id: OWNER }, { userId: OWNER })).toBe(false);
	});
});

describe('persona value tools enforce ownership before settlement', () => {
	for (const name of ['persona_tip', 'persona_send']) {
		it(`${name}: a stranger cannot drain an owned persona`, async () => {
			state.record = persona(OWNER);
			const out = await call(name, { userId: STRANGER, scope: 'all' });
			expect(out.isError).toBe(true);
			expect(out.structuredContent.code).toBe('not_owner');
			expect(state.sends).toHaveLength(0);
		});

		it(`${name}: an anonymous x402 payer cannot drain an owned persona`, async () => {
			state.record = persona(OWNER);
			const out = await call(name, { userId: null, source: 'x402', rateKey: 'payer', scope: '' });
			expect(out.structuredContent.code).toBe('not_owner');
			expect(state.sends).toHaveLength(0);
		});

		it(`${name}: the owner can send`, async () => {
			state.record = persona(OWNER);
			const out = await call(name, { userId: OWNER, scope: 'all' });
			expect(out.isError).toBeUndefined();
			expect(state.sends).toHaveLength(1);
		});
	}
});
