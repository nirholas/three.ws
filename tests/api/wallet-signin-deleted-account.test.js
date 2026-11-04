// Wallet sign-in against a deleted account, on both sides of the 30-day purge.
//
// Inside the window the account is soft-deleted: its user_wallets link still
// exists, so a returning wallet must be answered with 403 account_deleted, never
// a session on the retired account. After api/_lib/account-purge.js has run, the
// account and its wallet link are gone, so the same wallet signs in to a brand
// new account.
//
// Runs the real SIWS and SIWE handlers, real ed25519 and secp256k1 signatures,
// the real purge and the real account_purge migration against a real Postgres
// (PGlite). Mocked at the boundary only: the session store, rate limiting, the
// default-agent seeder, terms recording and object storage.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { PGlite } from '@electric-sql/pglite';
import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';
import { Wallet } from 'ethers';

process.env.PUBLIC_APP_ORIGIN = 'https://app.test';
process.env.JWT_SECRET ||= 'test-wallet-signin-deleted-secret-32ch';

const dbState = { pg: null };

vi.mock('../../api/_lib/db.js', () => {
	const run = async (text, params) => (await dbState.pg.query(text, params)).rows;
	const lazy = (text, params) => ({
		text,
		params,
		then: (resolve, reject) => run(text, params).then(resolve, reject),
	});
	const sql = (first, ...values) => {
		if (typeof first === 'string') return lazy(first, values[0] || []);
		const text = first.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''), '');
		return lazy(text, values);
	};
	sql.transaction = async (queries) => {
		await dbState.pg.exec('begin');
		try {
			const out = [];
			for (const q of queries) out.push((await dbState.pg.query(q.text, q.params)).rows);
			await dbState.pg.exec('commit');
			return out;
		} catch (err) {
			await dbState.pg.exec('rollback');
			throw err;
		}
	};
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false };
});

const sessionState = { created: [] };
vi.mock('../../api/_lib/auth.js', () => ({
	createSession: vi.fn(async ({ userId }) => {
		sessionState.created.push(userId);
		return `session-${userId}`;
	}),
	destroySession: vi.fn(async () => {}),
	sessionCookie: vi.fn((token) => `__Host-sid=${token}; Path=/; HttpOnly; Secure; SameSite=Lax`),
}));

vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: { authIp: vi.fn(async () => ({ success: true })) },
	clientIp: () => '127.0.0.1',
}));

vi.mock('../../api/_lib/seed-default-agent.js', () => ({ seedDefaultAgent: vi.fn(async () => {}) }));

vi.mock('../../api/_lib/legal.js', () => ({
	tosAcceptanceFromBody: () => null,
	recordTosAcceptance: vi.fn(),
}));

vi.mock('../../api/_lib/r2.js', () => ({
	objectStorageConfigured: () => true,
	keyFromPublicUrl: () => null,
	deleteObject: vi.fn(async () => {}),
}));

const { default: siwsHandler } = await import('../../api/auth/siws/[action].js');
const { default: siweHandler } = await import('../../api/auth/siwe/[action].js');
const { purgeDeletedAccounts } = await import('../../api/_lib/account-purge.js');
const { hmacSha256 } = await import('../../api/_lib/crypto.js');

const MIGRATION = readFileSync(
	new URL('../../api/_lib/migrations/20261104180000_account_purge.sql', import.meta.url),
	'utf8',
);

const SCHEMA = `
create table users (
	id uuid primary key default gen_random_uuid(),
	email text unique,
	display_name text,
	username text,
	wallet_address text unique,
	avatar_url text,
	banner_url text,
	plan text default 'free',
	password_hash text,
	created_at timestamptz default now(),
	deleted_at timestamptz,
	updated_at timestamptz default now()
);
create table user_wallets (
	id bigserial primary key,
	user_id uuid not null references users(id) on delete cascade,
	address text not null unique,
	chain_type text,
	chain_id text,
	is_primary boolean default false,
	last_used_at timestamptz
);
create table sessions (id bigserial primary key, user_id uuid not null references users(id) on delete cascade, revoked_at timestamptz);
create table siws_nonces (nonce text primary key, expires_at timestamptz not null, consumed_at timestamptz, address text);
create table siwe_nonces (nonce text primary key, expires_at timestamptz not null, consumed_at timestamptz, address text);
`;

const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();

async function q(text, params = []) {
	return (await dbState.pg.query(text, params)).rows;
}

function makeReq(path, body, headers) {
	const req = Readable.from([Buffer.from(JSON.stringify(body))]);
	req.method = 'POST';
	req.url = path;
	req.query = { action: 'verify' };
	req.headers = { host: 'app.test', 'content-type': 'application/json', ...headers };
	return req;
}

function makeRes() {
	return {
		statusCode: 200,
		headers: {},
		body: '',
		writableEnded: false,
		setHeader(k, v) {
			this.headers[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return this.headers[k.toLowerCase()];
		},
		end(chunk) {
			if (chunk !== undefined) this.body += chunk;
			this.writableEnded = true;
		},
	};
}

// The same double-submit pair the /nonce endpoint hands a browser.
async function csrfHeaders(kind) {
	const raw = randomBytes(24).toString('hex');
	const token = await hmacSha256(process.env.JWT_SECRET, `csrf-${kind}:${raw}`);
	return { cookie: `__Host-csrf-${kind}=${raw}`, 'x-csrf-token': token };
}

async function call(handler, path, body, kind) {
	const res = makeRes();
	await handler(makeReq(path, body, await csrfHeaders(kind)), res);
	return { status: res.statusCode, body: JSON.parse(res.body) };
}

// A real Solana keypair signing a real SIWS message.
function solanaSigner() {
	const secret = randomBytes(32);
	const address = bs58.encode(ed25519.getPublicKey(secret));
	return {
		address,
		async signIn() {
			const nonce = randomBytes(12).toString('hex');
			await q(`insert into siws_nonces (nonce, expires_at) values ($1, now() + interval '5 minutes')`, [nonce]);
			const message = [
				'app.test wants you to sign in with your Solana account:',
				address,
				'',
				'URI: https://app.test/login',
				'Version: 1',
				'Chain ID: mainnet',
				`Nonce: ${nonce}`,
				`Issued At: ${new Date().toISOString()}`,
			].join('\n');
			const signature = bs58.encode(ed25519.sign(new TextEncoder().encode(message), secret));
			return call(siwsHandler, '/api/auth/siws/verify', { message, signature }, 'siws');
		},
	};
}

// A real Ethereum key signing a real EIP-4361 message.
function ethereumSigner() {
	const wallet = Wallet.createRandom();
	return {
		address: wallet.address.toLowerCase(),
		async signIn() {
			const nonce = randomBytes(12).toString('hex');
			await q(`insert into siwe_nonces (nonce, expires_at) values ($1, now() + interval '5 minutes')`, [nonce]);
			const message = [
				'app.test wants you to sign in with your Ethereum account:',
				wallet.address,
				'',
				'URI: https://app.test/login',
				'Version: 1',
				'Chain ID: 1',
				`Nonce: ${nonce}`,
				`Issued At: ${new Date().toISOString()}`,
			].join('\n');
			const signature = await wallet.signMessage(message);
			return call(siweHandler, '/api/auth/siwe/verify', { message, signature }, 'siwe');
		},
	};
}

// The state DELETE /api/auth/me leaves behind: deleted_at stamped, handle
// released, wallet link still present.
async function softDeletedWalletUser(address, email, deletedDaysAgo) {
	const [user] = await q(
		`insert into users (email, display_name, wallet_address, deleted_at) values ($1, 'gone', $2, $3) returning id`,
		[email, address, ago(deletedDaysAgo)],
	);
	await q(`insert into user_wallets (user_id, address, is_primary) values ($1, $2, true)`, [user.id, address]);
	return user.id;
}

beforeEach(async () => {
	dbState.pg = new PGlite();
	await dbState.pg.exec(SCHEMA);
	await dbState.pg.exec(MIGRATION);
	sessionState.created = [];
});

describe.each([
	['SIWS', solanaSigner, (addr) => `sol-deleted-${addr.slice(0, 8)}@wallet.local`],
	['SIWE', ethereumSigner, (addr) => `wallet-${addr}@wallet.local`],
])('%s sign-in with the wallet of a deleted account', (_name, makeSigner, emailFor) => {
	it('refuses with account_deleted inside the 30-day window and issues no session', async () => {
		const signer = makeSigner();
		await softDeletedWalletUser(signer.address, emailFor(signer.address), 5);

		const { status, body } = await signer.signIn();

		expect(status).toBe(403);
		expect(body.error).toBe('account_deleted');
		expect(sessionState.created).toEqual([]);
	});

	it('signs in to a fresh account once the purge has removed the old one', async () => {
		const signer = makeSigner();
		const oldId = await softDeletedWalletUser(signer.address, emailFor(signer.address), 31);

		const purge = await purgeDeletedAccounts({ olderThanDays: 30 });
		expect(purge.failed).toEqual([]);
		expect(purge.purged).toBe(1);

		const { status, body } = await signer.signIn();

		expect(status).toBe(200);
		expect(body.user.id).not.toBe(oldId);
		const [fresh] = await q(`select deleted_at from users where id = $1`, [body.user.id]);
		expect(fresh.deleted_at).toBeNull();
		const links = await q(`select user_id from user_wallets where address = $1`, [signer.address]);
		expect(links).toEqual([{ user_id: body.user.id }]);
		expect(sessionState.created).toEqual([body.user.id]);
	});
});
