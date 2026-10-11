#!/usr/bin/env node
// Render one branded 1600x900 card for an X post, in the same visual system as the
// Android launch cards (scripts/make-x-thread-cards.mjs): black ground, soft blue and
// violet glow, the three.ws lockup, a Space Grotesk headline, and the product shown
// inside a device frame instead of as a raw screenshot. The renderer itself lives in
// scripts/lib/x-card.mjs, shared with the X content heads (`x:content -- remix`).
//
// Raw screenshots read as noise in a timeline. The posts that moved the most $THREE
// volume all carried either a video or a clean card that says one thing in large type,
// so every queued post gets one of these.
//
//   node scripts/make-x-post-card.mjs --spec data/x-content/cards/<id>.json
//
// Spec: { "out": "public/x-media/<id>/card.png", "headline": "Line one\nLine two",
//         "body": "One or two plain sentences.", "code": ["<line>", "<line>"],
//         "frame": "browser" | "phone" | "panel", "shot": "path/to.png" | "https://three.ws/page",
//         "label": "yoursite.com", "scrollBy": 400, "settleMs": 12000,
//         "hide": [".sticky-toolbar"] }
// `hide` lists extra selectors to drop from a live capture, e.g. a sticky bar that
// would otherwise sit on top of the content once the page is scrolled.
// `shot` is a local PNG (a capture of the feature really running) or a live URL that is
// captured on the spot. A capture that comes back blank fails the run, so a card can
// never ship showing nothing.

import sharp from 'sharp';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CARD_HEIGHT, CARD_WIDTH, capturePage, renderCard } from './lib/x-card.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const specPath = args[args.indexOf('--spec') + 1];
if (!specPath || !existsSync(specPath)) throw new Error('pass --spec <file.json>');
const spec = JSON.parse(readFileSync(specPath, 'utf8'));

const shot = /^https?:/.test(spec.shot)
	? await capturePage(spec.shot, { frame: spec.frame, hide: spec.hide || [], scrollBy: spec.scrollBy, settleMs: spec.settleMs ?? 9000 })
	: readFileSync(path.resolve(ROOT, spec.shot));
const png = await renderCard(spec, { root: ROOT, shot });
const out = path.resolve(ROOT, spec.out);
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, await sharp(png).png({ compressionLevel: 9 }).toBuffer());
console.log(`[x-card] wrote ${spec.out} (${CARD_WIDTH}x${CARD_HEIGHT})`);
