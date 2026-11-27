// High generation must report what happened to a remembered $THREE proof
// (order 129). The pay sheet reuses an unspent settled proof instead of a second
// charge (src/shared/forge-paid-proofs.js); the Forge page then has to forget it
// once the generation delivered (the server redeemed it), forget it when the
// server refused it, and pay fresh exactly once when the refused proof was a
// reused one. Without this a spent proof is offered again and refused with
// payment_already_used. The page module mounts the whole Forge UI on import, so
// these pin the wiring in both copies (src/forge.js and the Studio copy).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const block = (src, start, end) => {
	const i = src.indexOf(start);
	expect(i, `missing: ${start}`).toBeGreaterThan(-1);
	const j = src.indexOf(end, i + start.length);
	return src.slice(i, j === -1 ? undefined : j);
};

describe.each([['src/forge.js'], ['src/forge-studio/forge.js']])('%s', (path) => {
	const src = readFileSync(path, 'utf8');

	it('imports forgetPaidProof from the pay sheet', () => {
		expect(src).toMatch(/import \{[^}]*\bforgetPaidProof\b[^}]*\} from '\.\/forge-pay\.js'/);
	});

	it('forgets the proof once the generation delivered, before dropping it', () => {
		const done = block(src, 'if (pollAbort || !done) return; // cancelled', 'rememberFromResponse(done);');
		expect(done).toMatch(/forgetPaidProof\(lastJob\??\.payment\??\.paymentId\)[\s\S]*delete lastJob\.payment/);
	});

	it('forgets a refused proof and pays fresh once when it was a reused one', () => {
		for (const kind of ['payment_used', 'payment_invalid']) {
			const branch = block(src, `if (err.kind === '${kind}') {`, 'return;\n\t\t}');
			expect(branch, kind).toMatch(/forgetPaidProof\(/);
			expect(branch, kind).toMatch(/\.reused\b[\s\S]*payThenGenerate\(/);
		}
	});

	it('carries the reused flag and price on the payment it runs with', () => {
		const pay = block(src, 'async function payThenGenerate(', '\n}\n');
		expect(pay).toMatch(/payment: \{[^}]*reused: [^}]*\}/);
		expect(pay).toMatch(/payment: \{[^}]*\busd\b[^}]*\}/);
	});
});
