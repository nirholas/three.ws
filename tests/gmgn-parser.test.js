import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGmgnSmartWallets } from '../src/kol/gmgn-parser.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const rawDump = JSON.parse(
	await readFile(path.join(HERE, 'fixtures/gmgn-dump.json'), 'utf8'),
);
const normalizedDump = JSON.parse(
	await readFile(path.join(HERE, 'fixtures/gmgn-normalized.json'), 'utf8'),
);

describe('parseGmgnSmartWallets — raw gmgn API shape', () => {
	it('extracts all three wallets', () => {
		const result = parseGmgnSmartWallets(rawDump);
		expect(result).toHaveLength(3);
	});

	it('maps fields correctly for first entry', () => {
		const [first] = parseGmgnSmartWallets(rawDump);
		expect(first).toEqual({
			wallet: 'So11111111111111111111111111111111111111112',
			label: 'SmartTrader1',
			pnlUsd: 12345.67,
			winRate: 0.75,
			source: 'gmgn',
		});
	});

	it('falls back to realized_profit_7d and win_rate for third entry', () => {
		const result = parseGmgnSmartWallets(rawDump);
		const third = result.find((w) => w.wallet === 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');
		expect(third.pnlUsd).toBe(3200.0);
		expect(third.winRate).toBe(0.55);
		expect(third.label).toBeUndefined();
	});

	it('accepts a JSON string', () => {
		const result = parseGmgnSmartWallets(JSON.stringify(rawDump));
		expect(result).toHaveLength(3);
		expect(result[0].source).toBe('gmgn');
	});
});

describe('parseGmgnSmartWallets — scrape-smart-wallets normalized shape', () => {
	it('extracts wallets from smartMoney and kol sections', () => {
		const result = parseGmgnSmartWallets(normalizedDump);
		expect(result).toHaveLength(3);
	});

	it('maps fields correctly', () => {
		const result = parseGmgnSmartWallets(normalizedDump);
		const kol = result.find((w) => w.wallet === 'H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG');
		expect(kol).toEqual({
			wallet: 'H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG',
			label: 'kolAlpha',
			pnlUsd: 7500.0,
			winRate: 0.65,
			source: 'gmgn',
		});
	});

	it('sets source to gmgn on all entries', () => {
		const result = parseGmgnSmartWallets(normalizedDump);
		expect(result.every((w) => w.source === 'gmgn')).toBe(true);
	});
});

describe('parseGmgnSmartWallets — error cases', () => {
	it('throws on unrecognized format', () => {
		expect(() => parseGmgnSmartWallets({ foo: 'bar' })).toThrow('Unrecognized');
	});

	it('throws on invalid JSON string', () => {
		expect(() => parseGmgnSmartWallets('not json')).toThrow();
	});
});
