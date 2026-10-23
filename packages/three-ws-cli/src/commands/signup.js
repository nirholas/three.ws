// `three-ws signup --agent`: an agent signs itself up for three.ws.
//
// No email, no browser, no human. The local Solana key from `three-ws wallet`
// (created here when it does not exist yet) proves it owns its address by
// signing a challenge the server issues; the server answers with an account, a
// custodial agent wallet and an API key, which this command stores so every other
// `three-ws` command works at once.
//
//   three-ws signup --agent [--name <label>] [--storage auto|keychain|file]
//
// The account starts on the free plan in paper mode. Buying a plan is a separate,
// explicit x402 payment (printed at the end, never made here).

import { getBase58Decoder } from '@solana/kit';
import * as p from '@clack/prompts';
import { createKeystore } from '../pay/keystore.js';
import { PayError, EXIT } from '../pay/errors.js';
import { requestJson } from '../http.js';
import { readStore, updateStore } from '../store.js';
import { credentialsPath } from '../paths.js';
import { answer } from './common.js';
import { c, line, printJson, rows, sym, tildify } from '../ui.js';

const interactive = (ctx) => Boolean(process.stdin.isTTY && process.stderr.isTTY && !ctx.flags.json);

function keystoreFor(ctx) {
	return createKeystore({
		env: ctx.env,
		askPassphrase: interactive(ctx) ? async (question) => answer(await p.password({ message: question })) : undefined,
	});
}

/** Sign `message` (UTF-8 text) with the wallet key; returns the base58 signature. */
export async function signChallenge(signer, message) {
	const content = new TextEncoder().encode(message);
	const [signatures] = await signer.signMessages([{ content, signatures: {} }]);
	const bytes = signatures[signer.address];
	if (!bytes) throw new Error('the wallet did not return a signature');
	return getBase58Decoder().decode(bytes);
}

/** Wallet to use: the existing one, or a freshly created one. */
async function ensureWallet(ctx, keystore) {
	if (keystore.meta()) return { ...keystore.address(), created: false };
	const storage = ctx.flags.storage ?? 'auto';
	const made = await keystore.init({ storage });
	return { ...made, created: true };
}

/**
 * Run the two-call flow against `origin` and return the server's 201 body.
 * Exported so tests drive it against a real local server.
 */
export async function runAgentSignup({ origin, signer, name }) {
	const url = `${origin}/api/auth/agent-signup`;
	const publicKey = signer.address;
	const { challenge } = await requestJson(url, { method: 'POST', json: { public_key: publicKey } });
	const signature = await signChallenge(signer, challenge.message);
	return requestJson(url, { method: 'POST', json: { public_key: publicKey, nonce: challenge.nonce, signature, ...(name ? { name } : {}) } });
}

export async function signup(ctx) {
	const { flags } = ctx;
	if (flags.agent === undefined) {
		throw new Error('signup is for autonomous agents: run `three-ws signup --agent`. To sign a person in, run `three-ws login`.');
	}
	const store = readStore(ctx.env);
	if (store.auth && !flags.yes) {
		throw new Error(`already signed in (${tildify(credentialsPath(ctx.env))}). Pass --yes to sign up a new account and replace those credentials.`);
	}
	if (flags.name && flags.name.length > 100) throw new Error('--name must be 1-100 characters');

	const keystore = keystoreFor(ctx);
	let wallet;
	try {
		wallet = await ensureWallet(ctx, keystore);
	} catch (err) {
		if (err instanceof PayError) throw err;
		throw new PayError(EXIT.WALLET_UNAVAILABLE, 'wallet_unavailable', err.message);
	}
	const signer = await keystore.signer();
	const body = await runAgentSignup({ origin: ctx.origin, signer, name: flags.name });

	updateStore((s) => {
		s.origin = ctx.origin;
		s.account = { user_id: body.account.id, email: null };
		s.auth = {
			type: 'apikey',
			key: body.credentials.api_key,
			prefix: body.credentials.api_key_prefix,
			scope: body.credentials.scope,
			key_id: null,
		};
		s.agent_signup = {
			account_id: body.account.id,
			agent_id: body.agent.id,
			public_key: signer.address,
			claim_code: body.claim?.code ?? null,
			claim_expires_at: body.claim?.expires_at ?? null,
		};
		return s;
	}, ctx.env);

	const upgradeCommand = `three-ws pay "${body.upgrade.endpoint.replace('<plan>', 'builder')}" --method POST -H "Authorization: Bearer $THREE_WS_API_KEY" --dry-run`;
	if (flags.json) {
		printJson({
			account: body.account,
			agent: body.agent,
			wallets: body.wallets,
			wallet_created: wallet.created,
			credential: { type: 'apikey', prefix: body.credentials.api_key_prefix, scope: body.credentials.scope },
			store: credentialsPath(ctx.env),
			upgrade: body.upgrade,
		});
		return 0;
	}
	line(`${c.green(sym.ok)} Signed up. Account ${c.bold(body.account.id)}`);
	rows(
		[
			['agent', `${body.agent.name} (${body.agent.url})`],
			['identity key', `${signer.address}${wallet.created ? ' (new)' : ''}`],
			['agent wallet', body.wallets.agent_solana || 'none'],
			['plan', `${body.account.plan}, paper mode`],
			['credentials', tildify(credentialsPath(ctx.env))],
		],
		'  ',
	);
	line(c.dim('  The API key is stored owner-only and is not shown again.'));
	line(c.dim(`  Buy a plan with an x402 payment: preview with \`${upgradeCommand}\`.`));
	return 0;
}
