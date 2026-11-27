// Both Forge submit handlers (api/forge.js and its clone api/gpt-forge.js) must
// run the submit inside the paid-generation scope and note every charge they
// take, or a job that fails after the 200 cannot be made whole (order 129). The
// handlers are thousands of lines with live provider wiring, so this pins the
// wiring at the source, the same way the other handler-wiring tests do.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const HANDLERS = ['api/forge.js', 'api/gpt-forge.js'];

describe.each(HANDLERS)('%s paid-generation wiring', (file) => {
	const src = readFileSync(file, 'utf8');

	it('imports the scope helpers', () => {
		expect(src).toMatch(
			/import \{ withPaidGenerationScope, notePaidGeneration \} from '\.\/_lib\/forge-paid-generation\.js';/,
		);
	});

	it('runs the submit inside the scope', () => {
		expect(src).toMatch(/withPaidGenerationScope\(\(\) => startJob\(req, res\)\)/);
	});

	it('notes the claimed $THREE payment right after the claim wins', () => {
		expect(src).toMatch(
			/paidHigh\.redeemed = true;\n\s*notePaidGeneration\(\{ highPaymentId: paidHigh\.paymentId \}\);/,
		);
	});

	it('notes a real credit spend, never an idempotent replay of an older one', () => {
		expect(src).toMatch(
			/if \(charged\.chargedUsd > 0\) notePaidGeneration\(\{ creditLedgerId: charged\.ledgerId \}\);/,
		);
	});

	it('passes retry_after through when a proof is still settling', () => {
		expect(src).toMatch(/\.\.\.\(err\.retryAfter \? \{ retry_after: err\.retryAfter \} : \{\}\)/);
	});
});
