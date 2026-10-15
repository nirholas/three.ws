// Tests for GET /.well-known/skill.md: the SKILL-MD 1.0 document generated
// from the live OpenAPI catalog (api/_lib/skill-md.js), validated with the
// upstream x402-skill-md package so this suite fails the moment the
// generated document stops conforming to the published format.
//
// Base (EVM) stays unconfigured in this test on purpose: this checkout has
// no CDP facilitator credentials, matching most real deployments that run
// Solana-only. SM005 ("no EVM rail documented") is therefore an expected,
// tolerated finding; every other error is not.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { validateSkillMd } from 'x402-skill-md';
import { generateSkillMd } from '../api/_lib/skill-md.js';
import skillMdHandler from '../api/skill-md.js';

const SYNTHETIC_SOLANA_ADDRESS = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump'; // $THREE mint, used only as a valid base58 stand-in

const ENV_KEYS = ['X402_PAY_TO_SOLANA', 'X402_ASSET_MINT_SOLANA', 'X402_FEE_PAYER_SOLANA'];

function mockRes() {
	return {
		statusCode: 200,
		_headers: {},
		_body: '',
		setHeader(k, v) {
			this._headers[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return this._headers[k.toLowerCase()];
		},
		end(b) {
			this._body = b || '';
		},
		get headersSent() {
			return false;
		},
		get writableEnded() {
			return false;
		},
	};
}

function mockReq() {
	return {
		method: 'GET',
		url: '/.well-known/skill.md',
		headers: { accept: 'text/markdown', origin: 'https://three.ws' },
		socket: { remoteAddress: '127.0.0.1' },
	};
}

describe('GET /.well-known/skill.md', () => {
	const prevEnv = {};
	let md;
	let report;

	beforeAll(() => {
		for (const key of ENV_KEYS) prevEnv[key] = process.env[key];
		process.env.X402_PAY_TO_SOLANA = SYNTHETIC_SOLANA_ADDRESS;
		process.env.X402_ASSET_MINT_SOLANA = SYNTHETIC_SOLANA_ADDRESS;
		process.env.X402_FEE_PAYER_SOLANA = SYNTHETIC_SOLANA_ADDRESS;
		// Base/EVM intentionally left unset: no CDP_API_KEY_ID/SECRET, no
		// X402_ADVERTISE_BASE, so baseSettleable() stays false in this suite.

		md = generateSkillMd('https://three.ws');
		report = validateSkillMd(md);
	});

	afterAll(() => {
		for (const key of ENV_KEYS) {
			if (prevEnv[key] === undefined) delete process.env[key];
			else process.env[key] = prevEnv[key];
		}
	});

	it('produces zero validator errors other than SM005 (no EVM rail) while Base is not settleable', () => {
		const errors = report.findings.filter((f) => f.severity === 'error');
		const unexpected = errors.filter((f) => f.rule !== 'SM005');
		expect(unexpected, JSON.stringify(unexpected, null, 2)).toEqual([]);
		expect(errors.some((f) => f.rule === 'SM005')).toBe(true);
	});

	it('documents the Solana rail', () => {
		expect(report.service.rails.solana).toBe(true);
	});

	it('documents at least one priced endpoint per the live OpenAPI catalog', () => {
		expect(report.service.endpoints.length).toBeGreaterThan(50);
		expect(report.service.endpoints.some((e) => e.path === '/api/x402/model-check')).toBe(true);
	});

	it('names the base URL', () => {
		expect(report.service.baseUrl).toBe('https://three.ws');
	});

	it('serves as text/markdown with a real body over the HTTP handler', async () => {
		const res = mockRes();
		await skillMdHandler(mockReq(), res);
		expect(res.statusCode).toBe(200);
		expect(res._headers['content-type']).toMatch(/text\/markdown/);
		expect(res._body).toBe(md);
	});
});
