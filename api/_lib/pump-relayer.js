// Hot-wallet relayer for pump.fun trades.
//
// Loads PUMP_RELAYER_SECRET_KEY_B64 from env. The keypair is the *server's*
// custodial trading bot — not a user wallet. A user authorizes it via SIWS
// (see api/pump/relay-authorize.js) up to a capped cumulative spend, after
// which /api/pump/relay-trade can submit buys/sells without further user action.
//
// Security tradeoffs (read before deploying):
//  1. The env-stored key is a single point of failure. Rotate by setting a
//     new env var and revoking outstanding delegations.
//  2. Cumulative spend cap is enforced in pg via SELECT … FOR UPDATE; if the
//     caller bypasses this helper, no enforcement.
//  3. Per-trade direction/mint filters reduce blast radius if the key leaks.
//
// Deploy alternative: swap loadRelayer() for a KMS-signed remote signer.

let CACHED = null;

export async function loadRelayer() {
	if (CACHED) return CACHED;
	const b64 = process.env.PUMP_RELAYER_SECRET_KEY_B64;
	if (!b64) {
		const e = new Error('PUMP_RELAYER_SECRET_KEY_B64 not configured');
		e.status = 503;
		e.code = 'relayer_not_configured';
		throw e;
	}
	const { Keypair } = await import('@solana/web3.js');
	const kp = Keypair.fromSecretKey(Buffer.from(b64, 'base64'));
	CACHED = kp;
	return kp;
}

export async function relayerPubkeyString() {
	const kp = await loadRelayer();
	return kp.publicKey.toBase58();
}
