import { describe, it, expect } from 'vitest';
import { isReadyPlayerMeOrigin } from '../src/rpm-origin.js';

// The creator trusts postMessage events from the Ready Player Me iframe. An
// unanchored /readyplayer\.me/ test also matched https://readyplayer.me.evil.example.
describe('isReadyPlayerMeOrigin', () => {
	it('accepts readyplayer.me and its subdomains over https', () => {
		expect(isReadyPlayerMeOrigin('https://readyplayer.me')).toBe(true);
		expect(isReadyPlayerMeOrigin('https://demo.readyplayer.me')).toBe(true);
	});

	it('rejects lookalike hosts', () => {
		for (const o of [
			'https://readyplayer.me.evil.example',
			'https://evil.example/readyplayer.me',
			'https://notreadyplayer.me',
			'https://evilreadyplayer.me',
			'https://readyplayer.me@evil.example',
			'http://readyplayer.me',
			'null',
			'',
			undefined,
		]) {
			expect(isReadyPlayerMeOrigin(o), String(o)).toBe(false);
		}
	});
});
