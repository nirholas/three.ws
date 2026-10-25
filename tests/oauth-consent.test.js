// The consent page tells the person where the authorization code will go. An
// unverified client_uri from open dynamic registration must not replace that.

import { describe, it, expect, vi } from 'vitest';

process.env.JWT_SECRET ||= 'vitest-ephemeral-jwt-secret-00000000000000';
vi.mock('../api/_lib/db.js', () => ({ sql: async () => [] }));
vi.mock('../api/_lib/zauth.js', () => ({ instrument: () => {}, drain: async () => {} }));
vi.mock('../api/_lib/sentry.js', () => ({ captureException: () => {} }));

const { clientHost } = await import('../api/oauth/[action].js');

describe('clientHost', () => {
	it('shows the redirect host, not a spoofed client_uri', () => {
		const shown = clientHost({ client_uri: 'https://claude.ai' }, 'https://attacker.example/cb');
		expect(shown).toBe('attacker.example');
		expect(shown).not.toContain('claude.ai');
	});

	it('does not accept a lookalike that merely contains the real domain', () => {
		expect(clientHost({ client_uri: 'https://claude.ai' }, 'https://claude.ai.attacker.example/cb')).toBe('claude.ai.attacker.example');
	});

	it('shows the site beside the redirect host when both share a domain', () => {
		expect(clientHost({ client_uri: 'https://example.com' }, 'https://app.example.com/cb')).toBe('app.example.com (registered as example.com)');
	});

	it('shows just the redirect host when the site is the same host', () => {
		expect(clientHost({ client_uri: 'https://app.example.com' }, 'https://app.example.com/cb')).toBe('app.example.com');
	});

	it('works without a client_uri and reports an unusable redirect', () => {
		expect(clientHost({}, 'http://localhost:8123/cb')).toBe('localhost:8123');
		expect(clientHost({ client_uri: 'https://claude.ai' }, 'not a url')).toBe('unknown host');
	});
});
