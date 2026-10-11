// Signing keys for local agents. Generated on this machine, stored only inside
// the OS keychain through the secure store (Electron safeStorage), never
// written to a log, never sent to the cloud. The renderer and the cloud only
// ever see the public address; signing happens in-process via sign().

import { Keypair, VersionedTransaction } from '@solana/web3.js';

export function createKeystore({ store }) {
	const load = () => store.read() || { wallets: {} };

	function create(agentId) {
		const data = load();
		if (data.wallets[agentId]) return { address: data.wallets[agentId].address, created: false };
		const kp = Keypair.generate();
		data.wallets[agentId] = { address: kp.publicKey.toBase58(), secret: Array.from(kp.secretKey) };
		store.write(data);
		return { address: data.wallets[agentId].address, created: true };
	}

	function address(agentId) {
		return load().wallets[agentId]?.address || null;
	}

	function remove(agentId) {
		const data = load();
		if (!data.wallets[agentId]) return false;
		delete data.wallets[agentId];
		store.write(data);
		return true;
	}

	/** Sign a base64 VersionedTransaction. Returns the signed transaction, base64. */
	function signTransaction(agentId, txBase64) {
		const w = load().wallets[agentId];
		if (!w) throw new Error(`no signing key for agent ${agentId}`);
		const kp = Keypair.fromSecretKey(Uint8Array.from(w.secret));
		const tx = VersionedTransaction.deserialize(Buffer.from(txBase64, 'base64'));
		tx.sign([kp]);
		return Buffer.from(tx.serialize()).toString('base64');
	}

	function list() {
		return Object.entries(load().wallets).map(([agentId, w]) => ({ agentId, address: w.address }));
	}

	return { create, address, remove, signTransaction, list, encrypted: () => Boolean(store.encrypted?.()) };
}
