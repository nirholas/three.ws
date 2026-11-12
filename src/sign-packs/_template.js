// Template for a new sign language pack. Copy this file to src/sign-packs/<id>.js
// (the ISO 639-3 code: `rms` Romanian Sign Language, `bfi` British Sign
// Language, and so on), fill it in with a fluent signer, then add it to PACKS in
// src/sign-packs/index.js.
//
// It is never registered itself: listPacks() does not include it.
//
// What a pack needs:
//   signs      one entry per sign, written exactly like src/sign-packs/asl.js:
//              phases of { t, hold, right/left/both: { shape, at|touch, fingers,
//              palm }, face, head }. Handshapes come from src/sign-handshapes.js
//              and places from the anchors in src/sign-clip.js; add a handshape
//              there first if the language uses one ASL does not.
//   aliases    everyday words that map onto a sign key.
//   alphabet   null until the language's own manual alphabet exists. With null,
//              words without an approved sign are reported as unsupported and
//              are never fingerspelled with the ASL alphabet.
//   status     'review'. Only ASL is 'native'.
//   requiredApprovals  distinct fluent reviewers who must approve each sign's
//              exact content before it is served. Two is the floor.
//   reviews    the committed ledger: import it from ./reviews/<id>.js, which
//              `npm run sign:export-reviews -- <id>` writes from the review
//              workspace at /sign-review.
//
// Check it with `npm run sign:validate-pack -- <id>` before every commit.

/** @type {import('./index.js').SignPack} */
export default Object.freeze({
	id: 'qaa',
	name: 'Name of the sign language',
	bcp47: 'qaa',
	signs: Object.freeze({}),
	aliases: Object.freeze({}),
	alphabet: null,
	status: 'review',
	requiredApprovals: 2,
	reviews: Object.freeze([]),
});
