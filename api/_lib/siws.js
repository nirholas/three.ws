// Sign-In with Solana (CAIP-122 / SIP-0) message parser and signature verifier.
// Message format mirrors SIWE but uses a base58 Solana address and string Chain ID.

import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';

// ─── Parser ─────────────────────────────────────────────────────────────────

export function parseSiwsMessage(msg) {
	const lines = msg.split('\n');
	if (lines.length < 6) return null;

	const header = lines[0];
	const m = /^([^\s]+) wants you to sign in with your Solana account:$/.exec(header);
	if (!m) return null;
	const domain = m[1];

	const address = (lines[1] || '').trim();
	if (!isValidBase58Address(address)) return null;

	const out = { domain, address };
	for (let i = 2; i < lines.length; i++) {
		const line = lines[i];
		const kv = /^([A-Za-z -]+):\s*(.*)$/.exec(line);
		if (!kv) continue;
		const key = kv[1].trim();
		const val = kv[2].trim();
		switch (key) {
			case 'URI':
				out.uri = val;
				break;
			case 'Version':
				out.version = val;
				break;
			case 'Chain ID':
				out.chainId = val;
				break; // string: 'mainnet'|'devnet'|'testnet'
			case 'Nonce':
				out.nonce = val;
				break;
			case 'Issued At':
				out.issuedAt = val;
				break;
			case 'Expiration Time':
				out.expirationTime = val;
				break;
			case 'Not Before':
				out.notBefore = val;
				break;
			case 'Request ID':
				out.requestId = val;
				break;
		}
	}
	if (!out.uri || !out.nonce || !out.version) return null;
	return out;
}

// ─── Signature verifier ──────────────────────────────────────────────────────

// Verifies that `signature` (base58 or base64) over `message` (UTF-8 text)
// was produced by the ed25519 private key corresponding to `address` (base58).
// Returns true on valid, false on invalid, throws on malformed input.
export function verifySiwsSignature(message, signature, address) {
	const msgBytes = new TextEncoder().encode(message);
	const pubBytes = bs58.decode(address);

	// Wallets encode the 64-byte signature as base58 (Phantom) or base64 (some others).
	let sigBytes;
	if (/^[A-HJ-NP-Za-km-z1-9]{87,88}$/.test(signature)) {
		sigBytes = bs58.decode(signature);
	} else {
		sigBytes = Uint8Array.from(Buffer.from(signature, 'base64'));
	}

	if (sigBytes.length !== 64) return false;
	if (pubBytes.length !== 32) return false;

	return ed25519.verify(sigBytes, msgBytes, pubBytes);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Solana base58 addresses are 32 bytes → 43-44 base58 chars (no 0x prefix).
function isValidBase58Address(addr) {
	if (!/^[A-HJ-NP-Za-km-z1-9]{32,44}$/.test(addr)) return false;
	try {
		return bs58.decode(addr).length === 32;
	} catch {
		return false;
	}
}
