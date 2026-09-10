// GET /api/x402/onchain-identity-verify?identity=<id>&address=<addr>&chain=<caip2>
//
// Cross-platform on-chain identity-claim verifier. Paid endpoint cataloged by
// the CDP x402 Bazaar. For $0.005 USDC the server returns cryptographic /
// on-chain EVIDENCE that a claim "identity X controls address Y" is real — for
// ANY claimed identity↔address link, not just three.ws agents.
//
// `identity` may be an ENS name (vitalik.eth), an SNS name (bonfida.sol), an EVM
// wallet (0x…), a Solana wallet (base58), an ERC-8004 agent id
// (eip155:<chainId>:<agentId>), or a three.ws agent_id (uuid). `address` is the
// mint / contract / wallet the identity asserts control of.
//
// Agent use-case: before Agent A pays / trades / delegates to a counterparty
// that says "I am the deployer of contract X" or "I own wallet W / name N", A
// calls this once and gets deploy-tx + signer + ownership / name-resolution
// proof. It never asserts verified:true without concrete on-chain evidence;
// when it cannot read enough it returns verified:'unverifiable' with exactly
// what is missing — never a false positive.
//
// Evidence sources are REAL: ENS resolution (Ethereum RPC), SNS resolution
// (Solana RPC + Bonfida), EVM contract creation + deployer (Etherscan V2),
// contract owner() reads, Solana SPL mint/metadata authorities, the ERC-8004
// Identity Registry, and three.ws's canonical meta.onchain deploy index.
// See api/_lib/x402/identity-claim-verify.js for the full evidence model.

import { paidEndpoint } from '../_lib/x402-paid-endpoint.js';
import { buildBazaarSchema } from '../_lib/x402-spec.js';
import { installAccessControl } from '../_lib/x402/access-control.js';
import { withService } from '../_lib/x402/bazaar-helpers.js';
import { priceFor } from '../_lib/x402-prices.js';
import { verifyClaim } from '../_lib/x402/identity-claim-verify.js';
import onchainIdentityVerifyListing from '../_lib/service-catalog/services/onchain-identity-verify.js';

const ROUTE = '/api/x402/onchain-identity-verify';

// Single source of truth:
// api/_lib/service-catalog/services/onchain-identity-verify.js is the
// storefront listing copy — importing it here keeps the live 402 challenge
// from drifting from what /.well-known/x402.json and the OKX projection
// advertise (same pattern as forge.js → forge-listing.js).
const DESCRIPTION = onchainIdentityVerifyListing.description;

export const INPUT_EXAMPLE = {
	identity: 'vitalik.eth',
	address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
	chain: 'eip155:1',
};

export const INPUT_SCHEMA = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	type: 'object',
	required: ['identity', 'address'],
	properties: {
		identity: {
			type: 'string',
			description:
				'The claimed identity: an ENS name (vitalik.eth), SNS name (bonfida.sol), ' +
				'EVM wallet (0x…), Solana wallet (base58), ERC-8004 id (eip155:8453:42), ' +
				'or three.ws agent_id (uuid).',
		},
		address: {
			type: 'string',
			description: 'The contract / mint / wallet the identity claims to control.',
		},
		chain: {
			type: 'string',
			description:
				'Optional CAIP-2 chain hint. Examples: eip155:1, eip155:8453, ' +
				'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp. Inferred from the identity/address ' +
				'shape when omitted.',
		},
	},
};

export const OUTPUT_EXAMPLE = {
	claim: {
		identity: 'vitalik.eth',
		address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
		chain: 'eip155:1',
	},
	identity_type: 'ens',
	verified: true,
	method: 'ens-resolution',
	evidence: [
		{
			kind: 'ens_forward_resolution',
			ref: 'vitalik.eth',
			detail: 'resolves to 0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
		},
	],
	caveats: [],
	ts: '2026-07-07T00:00:00.000Z',
};

export const OUTPUT_SCHEMA = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	type: 'object',
	required: ['claim', 'verified', 'evidence', 'method', 'ts'],
	properties: {
		claim: {
			type: 'object',
			required: ['identity', 'address'],
			properties: {
				identity: { type: 'string' },
				address: { type: 'string' },
				chain: { type: ['string', 'null'] },
			},
		},
		identity_type: {
			type: 'string',
			enum: ['ens', 'sns', 'evm_address', 'solana_address', 'erc8004', 'threews_agent_id', 'unknown'],
		},
		verified: {
			description: 'true (proven), false (disproven), or "unverifiable" (insufficient on-chain data).',
			oneOf: [{ type: 'boolean' }, { type: 'string', const: 'unverifiable' }],
		},
		method: { type: 'string' },
		evidence: {
			type: 'array',
			items: {
				type: 'object',
				required: ['kind', 'ref', 'detail'],
				properties: {
					kind: { type: 'string' },
					ref: { type: 'string' },
					detail: { type: 'string' },
				},
			},
		},
		caveats: { type: 'array', items: { type: 'string' } },
		ts: { type: 'string', format: 'date-time' },
	},
};

export const BAZAAR = {
	discoverable: true,
	info: {
		input: {
			type: 'http',
			method: 'GET',
			queryParams: INPUT_EXAMPLE,
		},
		output: { type: 'json', example: OUTPUT_EXAMPLE },
	},
	schema: buildBazaarSchema({
		method: 'GET',
		queryParamsSchema: INPUT_SCHEMA,
		outputSchema: OUTPUT_SCHEMA,
	}),
};

export default paidEndpoint({
	route: ROUTE,
	method: 'GET',
	priceAtomics: priceFor('onchain-identity-verify', '5000'),
	description: DESCRIPTION,
	bazaar: BAZAAR,
	service: withService({
		serviceName: 'three.ws Identity Verify',
		tags: ['identity', 'verification', 'agent', 'trust', 'onchain'],
	}),
	requiredScope: 'x402:bypass',
	accessControl: installAccessControl({ requiredScope: 'x402:bypass' }),
	async handler({ req }) {
		// Accept the generalized params, and stay backward-compatible with the
		// original three.ws-only shape (agent_id + contract_or_mint).
		const identity = String(req.query?.identity || req.query?.agent_id || '').trim();
		const address = String(req.query?.address || req.query?.contract_or_mint || '').trim();
		const chain = String(req.query?.chain || '').trim() || undefined;

		if (!identity || !address) {
			const err = new Error('query params identity and address are required');
			err.status = 400;
			err.code = 'missing_params';
			throw err;
		}
		if (identity.length > 256 || address.length > 128) {
			const err = new Error('identity or address is unreasonably long');
			err.status = 400;
			err.code = 'invalid_input';
			throw err;
		}

		// verifyClaim never throws — it degrades to verified:'unverifiable' with a
		// caveat, so this endpoint never 500s on a bad upstream.
		return verifyClaim({ identity, address, chain });
	},
});
