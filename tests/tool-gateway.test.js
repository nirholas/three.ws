// The tool gateway: the SSRF-safe downloader, the credit meter (one debit per call,
// settle to measured units, full refund on failure, idempotent replay), the price
// list, the HTML extractor, document parsing, and the registry every surface
// (REST, MCP, agents) dispatches through.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';

const ledger = vi.hoisted(() => ({
	debits: [],
	refunds: [],
	balance: 1,
	seen: new Set(),
	failDebit: null,
}));

vi.mock('../api/_lib/credits.js', () => ({
	debitCredits: vi.fn(async (o) => {
		if (ledger.failDebit) throw ledger.failDebit;
		const replay = ledger.seen.has(o.idempotencyKey);
		ledger.seen.add(o.idempotencyKey);
		if (!replay) {
			ledger.debits.push(o);
			ledger.balance -= o.amountUsd;
		}
		return { replay, balanceUsd: ledger.balance };
	}),
	refundCredits: vi.fn(async (o) => {
		const replay = ledger.seen.has(o.idempotencyKey);
		ledger.seen.add(o.idempotencyKey);
		if (!replay) {
			ledger.refunds.push(o);
			ledger.balance += o.amountUsd;
		}
		return { balanceUsd: ledger.balance };
	}),
	getCreditAccount: vi.fn(async () => ({ balanceUsd: ledger.balance })),
}));
vi.mock('../api/_lib/inference-billing.js', () => ({ assertInferenceAllowed: vi.fn(async () => {}) }));
vi.mock('../api/_lib/usage.js', () => ({ recordEvent: vi.fn(), logger: () => ({ info() {}, warn() {}, error() {} }) }));

import { downloadPublic, decodeBase64Input } from '../api/_lib/tool-gateway/download.js';
import { meteredCall } from '../api/_lib/tool-gateway/meter.js';
import { GATEWAY_PRICES, GATEWAY_TOOL_NAMES, priceGatewayCall, gatewayPricing } from '../api/_lib/tool-gateway/pricing.js';
import { extractReadable, htmlToText } from '../api/_lib/tool-gateway/html-text.js';
import { parseDocument, sniffDocument } from '../api/_lib/tool-gateway/documents.js';
import { GATEWAY_TOOLS, callGatewayTool } from '../api/_lib/tool-gateway/index.js';
import { GATEWAY_INPUTS } from '../api/_lib/tool-gateway/schemas.js';
import { GatewayError } from '../api/_lib/tool-gateway/errors.js';

const principal = { userId: 'user-1', apiKeyId: 'key-1', surface: 'test' };

beforeEach(() => {
	ledger.debits = [];
	ledger.refunds = [];
	ledger.balance = 1;
	ledger.seen = new Set();
	ledger.failDebit = null;
});

describe('download: SSRF refusal', () => {
	for (const url of [
		'http://127.0.0.1/',
		'http://localhost/',
		'http://10.0.0.5/admin',
		'http://192.168.1.1/',
		'http://169.254.169.254/computeMetadata/v1/',
		'http://[::1]/',
		'http://0.0.0.0/',
	]) {
		it(`refuses ${url}`, async () => {
			await expect(downloadPublic(url, { maxBytes: 1024 })).rejects.toMatchObject({ status: 400, code: 'url_not_public' });
		});
	}

	it('rejects empty and oversized base64 inputs with typed errors', () => {
		expect(() => decodeBase64Input('', { maxBytes: 10, field: 'audio' })).toThrow(GatewayError);
		expect(() => decodeBase64Input(Buffer.alloc(100).toString('base64'), { maxBytes: 10, field: 'audio' })).toThrow(/larger than/);
		expect(decodeBase64Input(`data:audio/wav;base64,${Buffer.from('abc').toString('base64')}`, { maxBytes: 10, field: 'audio' }).toString()).toBe('abc');
	});
});

describe('meter: charge, settle, refund', () => {
	it('debits once up front and books one ledger row per call', async () => {
		const out = await meteredCall({
			principal,
			tool: 'web_fetch',
			estimateUnits: 1,
			callId: 'c1',
			run: async () => ({ result: { ok: true }, units: 1, provider: 'direct' }),
		});
		expect(ledger.debits).toHaveLength(1);
		expect(ledger.debits[0]).toMatchObject({ userId: 'user-1', action: 'gateway.web_fetch', amountUsd: 0.002, idempotencyKey: 'gateway:c1' });
		expect(ledger.refunds).toHaveLength(0);
		expect(out.billing).toMatchObject({ charged_usd: 0.002, units: 1, unit: 'page' });
	});

	it('refunds the whole charge when the provider fails, and rethrows', async () => {
		await expect(
			meteredCall({
				principal,
				tool: 'image_generate',
				estimateUnits: 1,
				callId: 'c2',
				run: async () => {
					throw new GatewayError(502, 'generation_failed', 'lane down');
				},
			}),
		).rejects.toMatchObject({ code: 'generation_failed' });
		expect(ledger.debits).toHaveLength(1);
		expect(ledger.refunds).toHaveLength(1);
		expect(ledger.refunds[0].amountUsd).toBe(ledger.debits[0].amountUsd);
		expect(ledger.balance).toBeCloseTo(1, 9);
	});

	it('refunds the surplus when the tool produced less than was estimated', async () => {
		const out = await meteredCall({
			principal,
			tool: 'parse_document',
			estimateUnits: 10,
			callId: 'c3',
			run: async () => ({ result: {}, units: 2, provider: 'unpdf' }),
		});
		expect(ledger.debits[0].amountUsd).toBe(0.02);
		expect(ledger.refunds[0].amountUsd).toBeCloseTo(0.016, 9);
		expect(out.billing.charged_usd).toBe(0.004);
	});

	it('debits the overage when the tool produced more than was estimated', async () => {
		const out = await meteredCall({
			principal,
			tool: 'parse_document',
			estimateUnits: 1,
			callId: 'c4',
			run: async () => ({ result: {}, units: 5, provider: 'unpdf' }),
		});
		expect(ledger.debits.map((d) => d.amountUsd)).toEqual([0.002, 0.008]);
		expect(out.billing.charged_usd).toBe(0.01);
	});

	it('refuses with 402 before running anything when credits are short', async () => {
		ledger.failDebit = Object.assign(new Error('short'), { code: 'insufficient_credits', available_usd: 0, required_usd: 0.01 });
		const run = vi.fn();
		await expect(meteredCall({ principal, tool: 'web_search', estimateUnits: 1, callId: 'c5', run })).rejects.toMatchObject({ status: 402, code: 'insufficient_credits' });
		expect(run).not.toHaveBeenCalled();
	});

	it('does not charge twice for a replayed call id', async () => {
		const run = async () => ({ result: {}, units: 1 });
		await meteredCall({ principal, tool: 'web_fetch', estimateUnits: 1, callId: 'same', run });
		const again = await meteredCall({ principal, tool: 'web_fetch', estimateUnits: 1, callId: 'same', run });
		expect(ledger.debits).toHaveLength(1);
		expect(again.billing.replay).toBe(true);
		expect(again.billing.charged_usd).toBe(0);
	});

	it('requires an account and a known tool', async () => {
		const run = vi.fn();
		await expect(meteredCall({ principal: {}, tool: 'web_fetch', estimateUnits: 1, callId: 'x', run })).rejects.toMatchObject({ status: 401 });
		await expect(meteredCall({ principal, tool: 'nope', estimateUnits: 1, callId: 'x', run })).rejects.toMatchObject({ status: 404 });
		expect(run).not.toHaveBeenCalled();
	});

	it('books agent spend against the agent so its budget counts tool calls', async () => {
		await meteredCall({ principal: { ...principal, agentId: 'agent-9' }, tool: 'web_fetch', estimateUnits: 1, callId: 'a1', run: async () => ({ result: {}, units: 1 }) });
		expect(ledger.debits[0]).toMatchObject({ refType: 'agent', refId: 'agent-9' });
	});
});

describe('pricing', () => {
	it('prices every tool, never below its minimum, and every tool has a schema and an implementation', () => {
		expect(GATEWAY_TOOL_NAMES.length).toBeGreaterThan(0);
		for (const tool of GATEWAY_TOOL_NAMES) {
			expect(priceGatewayCall(tool, 0)).toBe(GATEWAY_PRICES[tool].min_usd);
			expect(priceGatewayCall(tool, 1000)).toBeGreaterThan(GATEWAY_PRICES[tool].min_usd - 1e-9);
			expect(GATEWAY_INPUTS[tool], `${tool} schema`).toBeTruthy();
			expect(Object.hasOwn(GATEWAY_TOOLS, tool), `${tool} implementation`).toBe(true);
		}
		expect(Object.keys(GATEWAY_TOOLS).sort()).toEqual([...GATEWAY_TOOL_NAMES].sort());
		expect(gatewayPricing().map((p) => p.tool)).toEqual(GATEWAY_TOOL_NAMES);
	});

	it('rejects an unknown tool', () => {
		expect(() => priceGatewayCall('nope', 1)).toThrow(/unknown gateway tool/);
	});
});

describe('html-text', () => {
	const html = `<!doctype html><html lang="en"><head><title>Doc</title><meta name="description" content="About it">
		<script>window.evil = 1</script><style>.x{color:red}</style></head>
		<body><nav>menu</nav><main><h1>Heading</h1><p>First para.</p><p>Second para.</p><script>alert(1)</script>
		<a href="/next">Next page</a></main></body></html>`;

	it('strips scripts and styles and keeps paragraph breaks', () => {
		const page = extractReadable(html, 'https://example.com/a');
		expect(page.title).toBe('Doc');
		expect(page.description).toBe('About it');
		expect(page.text).toContain('First para.');
		expect(page.text).not.toMatch(/alert|evil|color:red/);
		expect(page.text).toMatch(/First para\.\s*\n+\s*Second para\./);
		expect(page.links.some((l) => l.url === 'https://example.com/next')).toBe(true);
	});

	it('htmlToText drops scripts', () => {
		expect(htmlToText('<p>hi</p><script>bad()</script>')).toBe('hi');
	});
});

describe('parse_document', () => {
	it('reads a CSV given inline', async () => {
		const csv = 'name,qty\n"Widget, large",3\nBolt,10\n';
		const out = await parseDocument({ document: Buffer.from(csv).toString('base64'), filename: 'stock.csv' });
		expect(out.result.format).toBe('csv');
		expect(out.result.tables[0].rows).toEqual([['name', 'qty'], ['Widget, large', '3'], ['Bolt', '10']]);
		expect(out.units).toBe(1);
	});

	it('reads an XLSX workbook with one table per sheet and bills a page per sheet', async () => {
		const wb = new ExcelJS.Workbook();
		wb.addWorksheet('Q1').addRows([['sku', 'units'], ['A1', 4]]);
		wb.addWorksheet('Q2').addRows([['sku', 'units'], ['B2', 9]]);
		const buf = Buffer.from(await wb.xlsx.writeBuffer());
		expect(sniffDocument(buf, 'book.xlsx')).toBe('xlsx');
		const out = await parseDocument({ document: buf.toString('base64'), filename: 'book.xlsx' });
		expect(out.result.format).toBe('xlsx');
		expect(out.result.tables.map((t) => t.sheet)).toEqual(['Q1', 'Q2']);
		expect(out.result.tables[1].rows).toEqual([['sku', 'units'], ['B2', '9']]);
		expect(out.units).toBe(2);
	});

	it('reads the text layer of a PDF and bills per page', async () => {
		const pdf = Buffer.from(
			'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
				'3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n' +
				'4 0 obj<</Length 66>>stream\nBT /F1 12 Tf 10 50 Td (Quarterly revenue grew twelve percent) Tj ET\nendstream endobj\n' +
				'5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n' +
				'trailer<</Root 1 0 R/Size 6>>\n%%EOF',
		);
		const out = await parseDocument({ document: pdf.toString('base64'), filename: 'r.pdf' });
		expect(out.result.format).toBe('pdf');
		expect(out.result.text).toContain('Quarterly revenue grew twelve percent');
		expect(out.units).toBe(1);
	});

	it('refuses bytes it cannot read and a request with no input', async () => {
		await expect(parseDocument({ document: Buffer.from([0, 1, 2, 3, 0, 0, 9]).toString('base64') })).rejects.toMatchObject({ status: 415 });
		await expect(parseDocument({})).rejects.toMatchObject({ status: 400 });
	});

	it('truncates to max_chars and says so', async () => {
		const out = await parseDocument({ document: Buffer.from('word '.repeat(2000)).toString('base64'), max_chars: 500 });
		expect(out.result.truncated).toBe(true);
		expect(out.result.text.length).toBe(500);
	});
});

describe('registry', () => {
	it('bills a real tool end to end through callGatewayTool', async () => {
		const csv = Buffer.from('a,b\n1,2\n').toString('base64');
		const out = await callGatewayTool({ principal, tool: 'parse_document', args: { document: csv, filename: 'x.csv' }, callId: 'r1' });
		expect(out.result.format).toBe('csv');
		expect(ledger.debits).toHaveLength(1);
		expect(ledger.debits[0].action).toBe('gateway.parse_document');
	});

	it('validates arguments before charging anything', async () => {
		await expect(callGatewayTool({ principal, tool: 'image_generate', args: { prompt: 'x' } })).rejects.toMatchObject({ status: 400 });
		await expect(callGatewayTool({ principal, tool: 'tts', args: {} })).rejects.toMatchObject({ status: 400 });
		expect(ledger.debits).toHaveLength(0);
	});

	it('refunds when the tool refuses a private URL', async () => {
		await expect(callGatewayTool({ principal, tool: 'web_fetch', args: { url: 'http://169.254.169.254/' } })).rejects.toMatchObject({ code: 'url_not_public' });
		expect(ledger.debits).toHaveLength(1);
		expect(ledger.refunds).toHaveLength(1);
	});

	it('404s an unknown tool, including inherited object keys', async () => {
		await expect(callGatewayTool({ principal, tool: 'nope' })).rejects.toMatchObject({ status: 404 });
		await expect(callGatewayTool({ principal, tool: 'constructor' })).rejects.toMatchObject({ status: 404 });
	});
});
