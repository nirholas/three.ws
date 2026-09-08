import { describe, it, expect } from 'vitest';
import { viewerErrorText } from '../../src/shared/viewer-error-text.js';

// The strings on the left are what three's FileLoader actually rejects with
// (`fetch for "<url>" responded with <status>: <statusText>`), which is what
// /embed/avatar used to paint straight into its error slot.
describe('viewerErrorText', () => {
	it('turns a 5xx transport failure into a retry instruction', () => {
		const raw = 'fetch for "https://three.ws/api/avatars/abc/glb" responded with 502: Bad Gateway';
		expect(viewerErrorText(new Error(raw))).toBe(
			'The avatar service is unavailable. Refresh to try again.',
		);
	});

	it('tells a signed-out visitor which account they need', () => {
		for (const status of [401, 403]) {
			const raw = `fetch for "https://three.ws/api/avatars/abc/glb" responded with ${status}: Forbidden`;
			expect(viewerErrorText(new Error(raw))).toBe(
				'This avatar is private. Sign in with the account that owns it.',
			);
		}
	});

	it('reports a missing avatar as gone, not as a permission problem', () => {
		const raw = 'fetch for "https://three.ws/api/avatars/abc/glb" responded with 404: Not Found';
		expect(viewerErrorText(new Error(raw))).toBe('This avatar is no longer available.');
	});

	it('names the network when the request never reached a server', () => {
		expect(viewerErrorText(new TypeError('Failed to fetch'))).toBe(
			'Connection lost. Check your network and refresh.',
		);
	});

	it('reports an unreadable model file', () => {
		expect(viewerErrorText(new Error('Unexpected token < in JSON at position 0'))).toBe(
			"This avatar's 3D file could not be read.",
		);
	});

	it('keeps a message that was already written for a person', () => {
		const written = 'avatar 00000000-0000-4000-8000-000000000000 not found';
		expect(viewerErrorText(new Error(written))).toBe(written);
	});

	it('never returns an empty string', () => {
		expect(viewerErrorText(undefined)).toBe('Could not load avatar.');
		expect(viewerErrorText(new Error(''))).toBe('Could not load avatar.');
	});
});
