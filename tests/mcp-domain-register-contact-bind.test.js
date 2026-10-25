import { describe, it, expect } from 'vitest';
import { createPolicy, allowListEnablement } from '@three-ws/mcp-policy';

const contact = (email) => ({ name: 'A Owner', email, phone: '+14155550100', address: '1 Main', city: 'SF', postal_code: '94105', country: 'US' });
const quoteArgs = { domain: 'orbit.app', contact: contact('owner@example.com'), auto_renew: false, privacy: 'REDACTED_CONTACT_DATA' };

async function quoted() {
	const policy = createPolicy({ serverId: 'three.ws' });
	const en = allowListEnablement(['domain_register_quote', 'domain_register']);
	const done = await policy.afterCall({ name: 'domain_register_quote', args: quoteArgs, principal: 'u1', result: { content: [] } });
	const id = done._meta['three.ws/preview'].quote_id;
	return { policy, en, id };
}

describe('domain_register binds the registrant contact to the approved quote', () => {
	it('refuses a call whose contact differs from the quoted one', async () => {
		const { policy, en, id } = await quoted();
		const gate = await policy.beforeCall({
			name: 'domain_register', en, principal: 'u1',
			args: { ...quoteArgs, contact: contact('attacker@example.net'), quote_id: id, confirm_spend: true },
		});
		expect(gate.ok).toBe(false);
		expect(gate.result.structuredContent.reason).toBe('preview_mismatch');
	});

	it('accepts the same contact', async () => {
		const { policy, en, id } = await quoted();
		const gate = await policy.beforeCall({
			name: 'domain_register', en, principal: 'u1',
			args: { ...quoteArgs, quote_id: id, confirm_spend: true },
		});
		expect(gate.ok).toBe(true);
	});
});
