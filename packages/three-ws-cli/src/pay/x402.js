// Settles one x402 offer: signs a Solana "exact" payment with @x402/svm and
// returns the header that retries the request. v2 servers get PAYMENT-SIGNATURE,
// v1 servers get X-PAYMENT, whichever the core client emits for the version.

import { x402Client, x402HTTPClient } from '@x402/core/client';
import { ExactSvmScheme } from '@x402/svm/exact/client';
import { ExactSvmSchemeV1 } from '@x402/svm/exact/v1/client';
import { EXIT, PayError, REASON } from './errors.js';
import { SOLANA_DEVNET } from './permissions.js';

export function rpcUrlFor(network, env) {
	const override = env.vars.THREE_WS_SOLANA_RPC_URL;
	if (override) return override;
	return network === SOLANA_DEVNET ? 'https://api.devnet.solana.com' : 'https://api.mainnet-beta.solana.com';
}

/**
 * @param {{ offer: object, signer: object, rpcUrl: string }} args
 * @returns {Promise<{ headers: Record<string,string>, httpClient: x402HTTPClient }>}
 */
export async function signX402({ offer, signer, rpcUrl }) {
	const client = new x402Client();
	if (offer.version === 1) client.registerV1(offer.raw.network, new ExactSvmSchemeV1(signer, { rpcUrl }));
	else client.register(offer.network, new ExactSvmScheme(signer, { rpcUrl }));
	// Only the chosen option is offered to the client, so it cannot pay any other one.
	const required = { ...offer.required, accepts: [offer.raw] };
	let payload;
	try {
		payload = await client.createPaymentPayload(required);
	} catch (err) {
		throw new PayError(EXIT.ERROR, 'sign_failed', `Could not sign the x402 payment: ${err.message}`);
	}
	const httpClient = new x402HTTPClient(client);
	return { headers: httpClient.encodePaymentSignatureHeader(payload), httpClient };
}

/** The settlement receipt from a paid response, when the server sent one. */
export function readX402Receipt(httpClient, response) {
	try {
		return httpClient.getPaymentSettleResponse((name) => response.headers.get(name));
	} catch {
		return undefined;
	}
}

export { REASON };
