// `three-ws wallet`: the local Solana key that `three-ws pay` signs with.
//   wallet init [--storage auto|keychain|file]   create a key; keychain first, sealed file otherwise
//   wallet address                               address and where the key is held
//   wallet export-public                         the bare address, for scripts and funding
// There is no command that prints the private key. Back it up by holding the
// keychain entry or the sealed file plus its passphrase.

import { c, errorLine, line, printJson, rows, sym, tildify } from '../ui.js';
import { EXIT, PayError } from '../pay/errors.js';
import { walletSealedPath } from '../pay/keystore.js';
import { keystoreFor } from './pay.js';

const STORAGE = ['auto', 'keychain', 'file'];

export async function wallet(ctx) {
	const [sub] = ctx.positionals;
	const store = keystoreFor(ctx);
	if (sub === 'init') {
		const storage = ctx.flags.storage ?? 'auto';
		if (!STORAGE.includes(storage)) throw new PayError(EXIT.USAGE, 'invalid_storage', `--storage must be one of ${STORAGE.join(', ')}.`);
		const made = await store.init({ storage });
		if (ctx.flags.json) printJson(made);
		else {
			line(`${c.green(sym.ok)} Wallet created.`);
			rows(
				[
					['address', made.address],
					['key held in', made.storage === 'keychain' ? 'the OS keychain' : `a passphrase-sealed file (${tildify(walletSealedPath(ctx.env))})`],
				],
				'  ',
			);
			line(`Fund it with USDC on Solana, then set limits with \`three-ws pay init\`. The private key is never printed.`);
		}
		return EXIT.OK;
	}
	if (sub === 'address') {
		const a = store.address();
		if (ctx.flags.json) printJson(a);
		else rows([['address', a.address], ['key held in', a.storage]]);
		return EXIT.OK;
	}
	if (sub === 'export-public') {
		const a = store.address();
		if (ctx.flags.json) printJson({ address: a.address });
		else line(a.address);
		return EXIT.OK;
	}
	errorLine('usage: three-ws wallet <init [--storage auto|keychain|file]|address|export-public>');
	return EXIT.USAGE;
}
