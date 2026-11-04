// The concierge widget speaks each completed sentence while the answer streams.
// A URL such as https://three.ws/x must never be cut at its dots.
import { describe, it, expect } from 'vitest';
import { drainSentences } from '../concierge-sdk/src/sentences.js';

describe('drainSentences', () => {
	it('never splits a URL at its dots while streaming', () => {
		let out = drainSentences('See [the docs](https://three.');
		expect(out.sentences).toEqual([]);
		out = drainSentences(out.rest + 'ws/x) for details. Next one');
		expect(out.sentences).toEqual(['See [the docs](https://three.ws/x) for details.']);
		expect(out.rest).toBe('Next one');
	});

	it('splits on sentence ends and newlines', () => {
		const out = drainSentences('One. Two? Three!\nFour');
		expect(out.sentences).toEqual(['One.', 'Two?', 'Three!']);
		expect(out.rest).toBe('Four');
	});
});
