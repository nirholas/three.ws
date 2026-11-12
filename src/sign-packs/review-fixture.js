// A review-flow fixture: NOT a sign language.
//
// This pack exists so the review machinery (queue, verdicts, approval counting,
// serving only approved signs) can be exercised end to end before any real
// second language has a fluent signer attached. Its entries are copies of
// existing ASL signs, so no sign content is invented for it, and it is never in
// listPacks(): tests import it directly, and the review API offers it only
// outside production when SIGN_REVIEW_FIXTURE=1 (api/_lib/sign-review.js).
//
// It uses an ISO 639-3 local-use code (qaa-qtz are reserved for exactly this),
// so it can never collide with a real language's code.

import ASL from './asl.js';

const KEYS = ['HELLO', 'THANK', 'PLEASE', 'SORRY', 'YES', 'NO'];

/** @type {import('./index.js').SignPack} */
export default Object.freeze({
	id: 'qfx',
	name: 'Review flow fixture (not a sign language)',
	bcp47: 'qfx',
	signs: Object.freeze(Object.fromEntries(KEYS.map((k) => [k, ASL.signs[k]]))),
	aliases: Object.freeze({ HI: 'HELLO', THANKS: 'THANK' }),
	alphabet: null,
	status: 'review',
	requiredApprovals: 2,
	reviews: Object.freeze([]),
});
