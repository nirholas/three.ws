/**
 * Agent commerce: invoices, offers, sends and limit proposals.
 *
 * Pins the pure rules the money paths rest on, with no network and no database:
 *   - amounts parse to exact base units and refuse anything ambiguous,
 *   - $THREE is mainnet-only, so a devnet $THREE invoice is refused,
 *   - the Solana Pay link asks for what is still due and percent-encodes text,
 *   - a transaction counts toward an invoice only if it actually credited the
 *     invoice address with the invoice asset and its memo (when present) names
 *     this invoice, so a stray or mislabeled transfer is never booked,
 *   - status follows received vs due vs the clock (underpaid, expired, paid
 *     late),
 *   - a spending-limit proposal is validated, and every change that gives the
 *     agent more room is flagged as loosening for the owner's review,
 *   - every commerce MCP tool has a policy row, and the two tools that move
 *     funds are financial with a confirm flag and a preview step.
 */
import { describe, it, expect } from 'vitest';

const { parseAmount, formatAtomics, assetSpec, normalizeAsset, normalizeNetwork, CommerceError } = await import(
	'../api/_lib/agent-commerce/assets.js'
);
const { solanaPayUrl, classifyPayment, creditedAtomics, memosOf, invoiceChainMemo, explorerTxUrl } = await import(
	'../api/_lib/agent-commerce/solana-pay.js'
);
const { nextStatus, resolveDueAt, newInvoiceNumber, MIN_DUE_MINUTES } = await import('../api/_lib/agent-commerce/invoices.js');
const { normalizePatch, diffRows } = await import('../api/_lib/agent-commerce/limit-requests.js');
const { commerceToolDefs } = await import('../api/_mcpagent/commerce-tools.js');
const POLICY = (await import('../packages/mcp-policy/src/table.js')).POLICY['threews-agent'];

// Clearly synthetic base58 strings, never real accounts.
const RECIPIENT = 'THREEsyntheticRecipient11111111111111111111';
const PAYER = 'THREEsyntheticPayer1111111111111111111111111';
const MINT = 'THREEsyntheticMint11111111111111111111111111';
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

function code(fn) {
	try {
		fn();
	} catch (err) {
		return err instanceof CommerceError ? err.code : `unexpected:${err?.message}`;
	}
	return null;
}

describe('amounts and assets', () => {
	it('parses decimals to exact base units', () => {
		expect(parseAmount('12.5', 6)).toBe(12_500_000n);
		expect(parseAmount('0.000001', 6)).toBe(1n);
		expect(parseAmount(0.1, 9)).toBe(100_000_000n);
		expect(parseAmount('1', 9)).toBe(1_000_000_000n);
	});

	it('refuses zero, negatives, exponents and excess precision', () => {
		for (const bad of ['0', '0.0', '-1', '1e3', 'abc', '', '1.0000001']) {
			expect(code(() => parseAmount(bad, 6))).toBe('invalid_amount');
		}
	});

	it('formats base units back to an exact decimal', () => {
		expect(formatAtomics(1_500_000n, 6)).toBe('1.5');
		expect(formatAtomics(1n, 9)).toBe('0.000000001');
		expect(formatAtomics(5_000_000n, 6)).toBe('5');
	});

	it('accepts the $THREE spelling and rejects unknown assets and networks', () => {
		expect(normalizeAsset('$three')).toBe('THREE');
		expect(normalizeAsset('usdc')).toBe('USDC');
		expect(code(() => normalizeAsset('DOGE'))).toBe('invalid_asset');
		expect(normalizeNetwork(undefined)).toBe('mainnet');
		expect(code(() => normalizeNetwork('testnet'))).toBe('invalid_network');
	});

	it('keeps $THREE on mainnet only', () => {
		expect(assetSpec('THREE', 'mainnet').mint).toBe('FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump');
		expect(code(() => assetSpec('THREE', 'devnet'))).toBe('asset_unavailable');
		expect(assetSpec('SOL', 'devnet')).toMatchObject({ native: true, decimals: 9 });
		expect(assetSpec('USDC', 'devnet').mint).not.toBe(assetSpec('USDC', 'mainnet').mint);
	});
});

const invoice = (over = {}) => ({
	number: 'INV-TEST0001',
	recipient_address: RECIPIENT,
	asset: 'USDC',
	mint: MINT,
	decimals: 6,
	amount_atomics: '10000000',
	paid_atomics: '0',
	reference: 'THREEsyntheticReference111111111111111111111',
	memo: 'Logo design & two revisions',
	...over,
});

describe('Solana Pay link', () => {
	it('asks for the amount still due, with reference, token and memo', () => {
		const url = solanaPayUrl(invoice({ paid_atomics: '4000000' }));
		expect(url.startsWith(`solana:${RECIPIENT}?`)).toBe(true);
		const q = new URLSearchParams(url.split('?')[1]);
		expect(q.get('amount')).toBe('6');
		expect(q.get('spl-token')).toBe(MINT);
		expect(q.get('reference')).toBe(invoice().reference);
		expect(q.get('memo')).toBe(invoiceChainMemo('INV-TEST0001'));
	});

	it('percent-encodes spaces instead of plus signs and omits spl-token for SOL', () => {
		const url = solanaPayUrl(invoice({ asset: 'SOL', decimals: 9, amount_atomics: '250000000' }));
		expect(url).not.toContain('+');
		expect(url).toContain('three.ws%20invoice%20INV-TEST0001');
		expect(url).not.toContain('spl-token');
		expect(new URLSearchParams(url.split('?')[1]).get('amount')).toBe('0.25');
	});

	it('links devnet transactions to the devnet cluster', () => {
		expect(explorerTxUrl('sig', 'devnet')).toBe('https://solscan.io/tx/sig?cluster=devnet');
		expect(explorerTxUrl('sig', 'mainnet')).toBe('https://solscan.io/tx/sig');
	});
});

/** A parsed SPL transfer of `amount` base units into the recipient's account. */
function tokenTx({ amount, owner = RECIPIENT, mint = MINT, memo = invoiceChainMemo('INV-TEST0001'), err = null, pre = 0n }) {
	const ixs = memo == null ? [] : [{ programId: MEMO_PROGRAM, parsed: memo }];
	return {
		meta: {
			err,
			preTokenBalances: pre ? [{ accountIndex: 2, mint, owner, uiTokenAmount: { amount: String(pre) } }] : [],
			postTokenBalances: [{ accountIndex: 2, mint, owner, uiTokenAmount: { amount: String(pre + amount) } }],
			innerInstructions: [],
		},
		transaction: {
			message: {
				accountKeys: [{ pubkey: PAYER, signer: true }, { pubkey: 'ata-src', signer: false }, { pubkey: 'ata-dst', signer: false }],
				instructions: ixs,
			},
		},
	};
}

describe('payment matching', () => {
	it('counts a transfer that credits the invoice address with the memo', () => {
		const r = classifyPayment(tokenTx({ amount: 10_000_000n }), invoice());
		expect(r).toMatchObject({ counted: true, amount: 10_000_000n, payer: PAYER, reason: null });
	});

	it('counts the credited delta, not the account balance', () => {
		expect(creditedAtomics(tokenTx({ amount: 3_000_000n, pre: 50_000_000n }), { recipient: RECIPIENT, mint: MINT, native: false })).toBe(3_000_000n);
	});

	it('accepts a payment without a memo (the reference already binds it)', () => {
		expect(classifyPayment(tokenTx({ amount: 1n, memo: null }), invoice()).counted).toBe(true);
	});

	it('rejects a memo naming another invoice', () => {
		const r = classifyPayment(tokenTx({ amount: 10_000_000n, memo: 'three.ws invoice INV-OTHER999' }), invoice());
		expect(r).toMatchObject({ counted: false, reason: 'memo_mismatch' });
	});

	it('rejects the wrong asset, the wrong recipient and a failed transaction', () => {
		expect(classifyPayment(tokenTx({ amount: 10_000_000n, mint: 'otherMint' }), invoice()).reason).toBe('no_transfer_to_recipient');
		expect(classifyPayment(tokenTx({ amount: 10_000_000n, owner: PAYER }), invoice()).reason).toBe('no_transfer_to_recipient');
		expect(classifyPayment(tokenTx({ amount: 10_000_000n, err: { InstructionError: [0, 'x'] } }), invoice()).reason).toBe('transaction_failed');
	});

	it('reads native SOL from the lamport delta and ignores the recipient paying its own fee', () => {
		const tx = (pre, post) => ({
			meta: { err: null, preBalances: [5_000_000_000, pre], postBalances: [4_000_000_000, post] },
			transaction: { message: { accountKeys: [PAYER, RECIPIENT], instructions: [] } },
		});
		const inv = invoice({ asset: 'SOL', decimals: 9 });
		expect(classifyPayment(tx(1_000, 250_001_000), inv)).toMatchObject({ counted: true, amount: 250_000_000n });
		expect(classifyPayment(tx(1_000, 500), inv).reason).toBe('no_transfer_to_recipient');
	});

	it('finds memos in inner instructions too', () => {
		const tx = tokenTx({ amount: 1n, memo: null });
		tx.meta.innerInstructions = [{ instructions: [{ programId: MEMO_PROGRAM, parsed: 'hello' }] }];
		expect(memosOf(tx)).toEqual(['hello']);
	});
});

describe('invoice status', () => {
	const dueAt = new Date('2026-10-10T12:00:00Z');
	const before = new Date('2026-10-10T11:00:00Z');
	const after = new Date('2026-10-10T13:00:00Z');
	const st = (paid, now, status = 'open') => nextStatus({ status, due: 100n, paid, dueAt, now });

	it('moves open to underpaid to paid as payments land', () => {
		expect(st(0n, before)).toBe('open');
		expect(st(40n, before)).toBe('underpaid');
		expect(st(100n, before)).toBe('paid');
		expect(st(150n, before)).toBe('paid');
	});

	it('expires an unpaid or underpaid invoice past its due date', () => {
		expect(st(0n, after)).toBe('expired');
		expect(st(40n, after, 'underpaid')).toBe('expired');
	});

	it('still settles an expired invoice paid late, but never a cancelled one', () => {
		expect(st(100n, after, 'expired')).toBe('paid');
		expect(st(100n, before, 'cancelled')).toBe('cancelled');
	});

	it('bounds the due date', () => {
		const now = new Date('2026-10-10T00:00:00Z');
		expect(resolveDueAt({}, now).getTime() - now.getTime()).toBe(72 * 3600_000);
		expect(resolveDueAt({ due_in_hours: 1 }, now).toISOString()).toBe('2026-10-10T01:00:00.000Z');
		expect(code(() => resolveDueAt({ due_at: new Date(now.getTime() + (MIN_DUE_MINUTES - 1) * 60_000).toISOString() }, now))).toBe('invalid_due_at');
		expect(code(() => resolveDueAt({ due_in_hours: 24 * 91 }, now))).toBe('invalid_due_at');
		expect(code(() => resolveDueAt({ due_at: 'tomorrow' }, now))).toBe('invalid_due_at');
	});

	it('issues unambiguous invoice numbers', () => {
		const n = newInvoiceNumber();
		expect(n).toMatch(/^INV-[0-9A-HJKMNP-TV-Z]{8}$/);
		expect(newInvoiceNumber()).not.toBe(n);
	});
});

describe('spending-limit proposals', () => {
	it('validates keys and values', () => {
		expect(normalizePatch({ daily_usd: '250.555', frozen: false })).toEqual({ daily_usd: 250.56, frozen: false });
		expect(normalizePatch({ per_tx_usd: null })).toEqual({ per_tx_usd: null });
		expect(code(() => normalizePatch({ withdraw_allowlist: ['x'] }))).toBe('invalid_changes');
		expect(code(() => normalizePatch({ daily_usd: -1 }))).toBe('invalid_changes');
		expect(code(() => normalizePatch({ frozen: 'no' }))).toBe('invalid_changes');
		expect(code(() => normalizePatch({}))).toBe('invalid_changes');
	});

	it('flags every change that gives the agent more room as loosening', () => {
		const before = { daily_usd: 100, per_tx_usd: 25, per_counterparty_daily_usd: null, frozen: true, require_capabilities: true };
		const rows = diffRows(before, { daily_usd: 500, per_tx_usd: 10, per_counterparty_daily_usd: 50, frozen: false, require_capabilities: false });
		const by = Object.fromEntries(rows.map((r) => [r.key, r]));
		expect(by.daily_usd).toMatchObject({ from: '$100.00', to: '$500.00', loosens: true });
		expect(by.per_tx_usd.loosens).toBe(false);
		expect(by.per_counterparty_daily_usd).toMatchObject({ from: 'no cap', loosens: false });
		expect(by.frozen.loosens).toBe(true);
		expect(by.require_capabilities.loosens).toBe(true);
		expect(diffRows({ daily_usd: 100 }, { daily_usd: null })[0].loosens).toBe(true);
	});
});

describe('commerce MCP tools', () => {
	const names = commerceToolDefs.map((t) => t.name);

	it('ships every tool the brief names', () => {
		for (const n of ['invoice_create', 'invoice_details', 'invoice_list', 'invoice_verify', 'invoice_cancel', 'agent_send', 'agent_buy', 'agent_buy_confirm', 'agent_sell', 'spending_setup', 'spending_check']) {
			expect(names).toContain(n);
		}
	});

	it('has a policy row matching each tool, in the commerce group', () => {
		for (const t of commerceToolDefs) {
			const row = POLICY[t.name];
			expect(row, t.name).toBeTruthy();
			expect(row.group).toBe('commerce');
			expect(row.tier).toBe(t.tier);
		}
	});

	it('gates the two fund-moving tools behind a confirm flag and a preview', () => {
		expect(POLICY.agent_send).toMatchObject({ tier: 'financial', confirmFlag: 'confirm_send', previewTool: 'agent_send_preview' });
		expect(POLICY.agent_buy_confirm).toMatchObject({ tier: 'financial', confirmFlag: 'confirm_payment', previewTool: 'agent_buy' });
		for (const n of ['agent_send', 'agent_buy_confirm']) {
			const t = commerceToolDefs.find((d) => d.name === n);
			expect(t.inputSchema.required).toContain(t.confirmFlag);
			expect(t.annotations.destructiveHint).toBe(true);
		}
	});

	it('lets spending_setup propose but never apply a change', () => {
		expect(POLICY.spending_setup.tier).toBe('write');
		const t = commerceToolDefs.find((d) => d.name === 'spending_setup');
		expect(t.description.toLowerCase()).toMatch(/owner/);
	});
});
