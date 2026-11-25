// In-memory Solana RPC that serves Solana Name Service registry accounts.
//
// Tests that exercise our SNS code against the REAL @bonfida/spl-name-service
// library use this instead of mocking the library: a mocked library kept
// answering to v3 export names after the v4 upgrade and hid that every .sol
// lookup on the platform had stopped working. Account keys are derived with the
// library's own helpers, so the library reads back exactly what a mainnet
// registry would hold.
//
// getSlot reports a slot past the SDK's SOL_TLD_CUTOFF_SLOT, which is where
// mainnet is today, so code that still hands ".sol" names to the SDK's
// high-level APIs fails here the same way it fails in production.

import { createRequire } from 'node:module';
import { Keypair, PublicKey } from '@solana/web3.js';

const require = createRequire(import.meta.url);
const sns = require('@bonfida/spl-name-service');

const PAST_SOL_TLD_CUTOFF_SLOT = 999_999_999;

function registryData(parent, owner, cls, extra = Buffer.alloc(0)) {
	return Buffer.concat([parent.toBuffer(), owner.toBuffer(), cls.toBuffer(), extra]);
}

function bareName(name) {
	return String(name).toLowerCase().replace(/\.(sol|sns)$/, '');
}

export function createFakeSnsRpc() {
	const accounts = new Map();
	const sent = [];
	let failing = null;

	const put = (key, data, owner = sns.NAME_PROGRAM_ID) => {
		accounts.set(key.toBase58(), { data, owner, lamports: 1_000_000, executable: false, rentEpoch: 0 });
	};
	const read = (key) => accounts.get(new PublicKey(key).toBase58()) ?? null;
	const guard = () => {
		if (failing) throw failing;
	};

	const connection = {
		rpcEndpoint: 'https://fake-sns-rpc.invalid',
		commitment: 'confirmed',
		async getSlot() {
			guard();
			return PAST_SOL_TLD_CUTOFF_SLOT;
		},
		async getAccountInfo(key) {
			guard();
			return read(key);
		},
		async getMultipleAccountsInfo(keys) {
			guard();
			return keys.map(read);
		},
		async getTokenLargestAccounts() {
			guard();
			return { value: [] };
		},
		async getProgramAccounts() {
			guard();
			return [];
		},
		async getMinimumBalanceForRentExemption() {
			return 2_000_000;
		},
		async getLatestBlockhash() {
			return { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1 };
		},
		async sendRawTransaction(bytes) {
			sent.push(Buffer.from(bytes));
			return `sig${sent.length}`.padEnd(88, '1');
		},
		async confirmTransaction() {
			return { value: { err: null } };
		},
	};

	return {
		connection,
		sent,
		/** Register `name` (e.g. 'threews' or 'nich.threews', with or without a TLD) to `owner`. */
		register(name, owner) {
			const bare = bareName(name);
			const labels = bare.split('.');
			const parent = labels.length > 1
				? sns.getSnsDomainKeySync(labels.slice(1).join('.')).pubkey
				: sns.SNS_ROOT_DOMAIN_ACCOUNT;
			const key = sns.getSnsDomainKeySync(bare).pubkey;
			put(key, registryData(parent, new PublicKey(owner), PublicKey.default, Buffer.alloc(8)));
			const reverse = Buffer.from(labels[0]);
			const len = Buffer.alloc(4);
			len.writeUInt32LE(reverse.length);
			const reverseKey = labels.length > 1
				? sns.getReverseKeyFromDomainKey(key, parent)
				: sns.getReverseKeyFromDomainKey(key);
			put(reverseKey, registryData(PublicKey.default, PublicKey.default, sns.REVERSE_LOOKUP_CLASS, Buffer.concat([len, reverse])));
			return key;
		},
		/** Make `name` the primary (favorite) domain of `owner`. */
		setPrimary(owner, name) {
			const key = sns.getSnsDomainKeySync(bareName(name)).pubkey;
			const [primaryKey] = sns.PrimaryDomain.getKeySync(sns.NAME_OFFERS_ID, new PublicKey(owner));
			put(primaryKey, Buffer.concat([Buffer.from([1]), key.toBuffer()]), sns.NAME_OFFERS_ID);
		},
		/** Make every account read throw `err` (an RPC outage). Pass null to clear. */
		fail(err) {
			failing = err;
		},
		domainKey(name) {
			return sns.getSnsDomainKeySync(bareName(name)).pubkey;
		},
	};
}
