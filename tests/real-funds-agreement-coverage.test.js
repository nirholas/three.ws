// Coverage guard for the real-funds agreement.
//
// Every route under api/ (outside api/_lib and api/cron) that decrypts a
// custodial key, or imports an api/_lib module that does, must either enforce
// the signed agreements (requireRealFundsAgreement, or currentSignatureFor in
// tool handlers that have no HTTP response) or be listed in EXEMPT below with
// the reason no path in it moves a user's real funds on request. A new money
// endpoint that forgets the gate fails here instead of shipping.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const API = join(ROOT, 'api');

const KEY_USE = /\b(recoverSolanaAgentKeypair|recoverAgentKey|loadAgentKeypairForUser|loadAgentForSigning)\b/;
// Engines a route arms and a cron later executes with a decrypted key: the
// route itself never touches the key, so it is matched by what it imports.
const ARMS_ENGINE = /['"][./]+_lib\/orders\.js['"]/;
const GATE = /\b(requireRealFundsAgreement|currentSignatureFor)\b/;

const EXEMPT = {
	'api/agents.js': 'creates agents and their empty wallets; no funds move',
	'api/genome/breed.js': 'provisions a fresh empty wallet for the child agent',
	'api/launcher/me.js': 'reads wallet balances only',
	'api/stage/index.js': 'ensures a wallet exists for a stage; no funds move',
	'api/user/wallet/index.js': 'creates the master wallet and reads balances; sends go through the gated send.js',
	'api/agent-memory.js': 'signs memory records with the agent key; no transfer',
	'api/agents/_id/_sub.js': 'config, reads, and message signing; no transfer',
	'api/agents/_id/brain.js': 'agent key signs a digest; anchor gas is paid by the platform validator key',
	'api/agents/alpha.js': 'read-only candidates and analysis',
	'api/_mcp/resources.js': 'read-only MCP resources: lists orders and intents and reads the latest wallet signature over RPC; never signs',
	'api/autopilot/activity.js': 'read-only activity feed',
	'api/cli/[action].js': 'CLI device-link sign-in and whoami; reads the x402 wallet address, balances and caps only',
	'api/avatars/fork.js': 'creates a fresh empty wallet for the fork; no funds move',
	'api/irl/world-lines.js': 'agent key signs a proof-of-presence message; no transfer',
	'api/labor/bid.js': 'bids move no money',
	'api/labor/deliver.js': 'settlement pays the worker; the payer signed when posting',
	'api/labor/release.js': 'moderator-only admin path',
	'api/labor/tick.js': 'cron-only (requireCron)',
	'api/swarms/[id].js': 'read-only state and stream',
	'api/trading/scan.js': 'read-only candidate preview; never loads a key',
	'api/user/wallet/history.js': 'read-only history',
};

function walk(dir, out = []) {
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) walk(full, out);
		else if (name.endsWith('.js')) out.push(full);
	}
	return out;
}

const all = walk(API);
const rel = (f) => relative(ROOT, f).split('\\').join('/');
const libKeyModules = new Set(
	all.filter((f) => rel(f).startsWith('api/_lib/') && KEY_USE.test(readFileSync(f, 'utf8'))).map((f) => resolve(f)),
);

function importsKeyModule(file, src) {
	for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.[^'"]+)['"]/g)) {
		const target = resolve(dirname(file), m[1]);
		if (libKeyModules.has(target) || libKeyModules.has(`${target}.js`)) return true;
	}
	return false;
}

const routes = all.filter((f) => {
	const r = rel(f);
	return !r.startsWith('api/_lib/') && !r.startsWith('api/cron/');
});

const keyRoutes = routes
	.map((f) => ({ file: rel(f), src: readFileSync(f, 'utf8'), abs: f }))
	.filter(({ abs, src }) => KEY_USE.test(src) || ARMS_ENGINE.test(src) || importsKeyModule(abs, src));

describe('real-funds agreement coverage', () => {
	it('finds the custodial key routes it is guarding', () => {
		expect(keyRoutes.length).toBeGreaterThan(20);
		expect(keyRoutes.map((r) => r.file)).toContain('api/agents/solana-wallet.js');
	});

	it.each(keyRoutes.map((r) => [r.file, r]))('%s enforces the signed agreements or is exempt with a reason', (file, { src }) => {
		if (EXEMPT[file]) return;
		expect(GATE.test(src), `${file} uses a custodial key but never calls requireRealFundsAgreement. Gate its money paths, or add it to EXEMPT with the reason none move funds.`).toBe(true);
	});

	it('has no stale exemptions', () => {
		const keyFiles = new Set(keyRoutes.map((r) => r.file));
		for (const [file, reason] of Object.entries(EXEMPT)) {
			expect(existsSync(join(ROOT, file)), `${file} no longer exists`).toBe(true);
			expect(reason.length).toBeGreaterThan(8);
			expect(keyFiles.has(file), `${file} no longer touches a custodial key; drop the exemption`).toBe(true);
			expect(GATE.test(readFileSync(join(ROOT, file), 'utf8')), `${file} is gated now; drop the exemption`).toBe(false);
		}
	});
});
