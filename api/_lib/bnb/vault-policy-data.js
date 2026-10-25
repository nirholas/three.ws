/**
 * Builds the `policyData` bytes `GreenfieldVault.buy(objectId, policyData)`
 * (prompt 10, `contracts/src/GreenfieldVault.sol`) forwards untouched to the
 * real `PermissionHub.createPolicy` cross-chain syn-package (prompt 10's own
 * comment: "GNFD protobuf-encoded principal/resource/statements, built
 * off-chain by the unlock API using bnb-chain's greenfield-js-sdk permission
 * codec against this object's real GRN and msg.sender as principal") — the
 * one piece of that design prompts 09/10/11 all deferred building. Prompt 12
 * (vault UI) is the first caller that actually needs real bytes to submit
 * with `buy()`, so it lands here.
 *
 * Wire-format provenance (verified live 2026-07-08 against
 * `bnb-chain/greenfield-contracts` `master`): `AdditionalPermissionHub.
 * _prepareCreatePolicy` embeds the caller-supplied `_data` verbatim as
 * `createPolicySynPackage.data` — the syn-package's OTHER fields (operator,
 * extraData) are populated by the hub itself, never by the caller. So `_data`
 * IS the real Greenfield-side permission payload; the on-chain effect of a
 * settled create is exactly a `greenfield.permission.Policy` object (see
 * `Policy.id`'s doc-comment: "unique u256 sequence... also used as NFT
 * tokenID" — the exact value `GreenfieldVault.sales[saleId].policyId` records
 * on `PolicyGranted`). This module encodes that same `Policy` shape (every
 * field except `id`, which Greenfield assigns on settlement) using the REAL
 * generated protobuf encoder from `@bnb-chain/greenfield-cosmos-types`
 * (`Policy.encode`/`.finish()` — CLAUDE.md: never hand-roll a wire format;
 * this is the identical codegen `@bnb-chain/greenfield-js-sdk`'s own
 * `putObjectPolicy` builds its `MsgPutPolicy.resource`/`statements` from).
 *
 * Honest caveat this module does NOT paper over: the exact byte-for-byte
 * acceptance of this encoding by the live PermissionHub's GNFD-side keeper
 * has not been independently confirmed against a real relayed transaction in
 * this session — that confirmation needs a real deployed `GreenfieldVault`
 * AND a real Greenfield-mirrored object (both blocked on the same funded-key
 * wall as 07/09/10/11/13/14/18). `resourceId` below is never fabricated: it
 * is read live from `getObjectMeta` (the object's real on-chain Greenfield
 * id), so this function can ONLY ever succeed for an object that has
 * genuinely completed real Greenfield upload+mirroring — which, as of this
 * writing, no vault listing in this campaign has (prompt 11's own proof
 * documents the same gap). Until then this returns a typed, honest error
 * rather than inventing a resourceId. Closing this wire-format confirmation
 * is prompt 13's (vault-e2e-proof) job once funding lands.
 */

import { createRequire } from 'node:module';
import { getObjectMeta, GreenfieldError } from './greenfield.js';

// Same CJS-interop reasoning as greenfield-write.js: the ESM build of
// `@bnb-chain/greenfield-cosmos-types` resolves fine under Vite (bundled) but
// this module also runs under plain Node (Cloud Run) via `api/vault/*`, where
// deep-import specifiers into sibling packages have previously broken (see
// greenfield-write.js's docstring). `createRequire` sidesteps that risk here.
const require = createRequire(import.meta.url);
const { Policy } = require('@bnb-chain/greenfield-cosmos-types/greenfield/permission/types.js');
const {
	ActionType,
	Effect,
	PrincipalType,
} = require('@bnb-chain/greenfield-cosmos-types/greenfield/permission/common.js');
const { ResourceType } = require('@bnb-chain/greenfield-cosmos-types/greenfield/resource/types.js');

/** Typed error. `code` ∈ object_not_found | greenfield_unavailable | bad_input. */
export class VaultPolicyDataError extends Error {
	/** @param {string} message @param {{ code?: string, cause?: unknown }} [info] */
	constructor(message, info = {}) {
		super(message);
		this.name = 'VaultPolicyDataError';
		this.code = info.code || 'bad_input';
		if (info.cause) this.cause = info.cause;
	}
}

/**
 * Build the real `policyData` bytes for `GreenfieldVault.buy(objectId, policyData)`:
 * a protobuf-encoded `greenfield.permission.Policy` granting `buyer`
 * `ACTION_GET_OBJECT` on the real Greenfield object backing this listing.
 * @param {{ bucket:string, object:string, buyer:`0x${string}`, network?:'testnet'|'mainnet' }} p
 * @returns {Promise<{ policyDataHex:`0x${string}`, resourceId:string }>}
 */
export async function buildBuyPolicyData({ bucket, object, buyer, network }) {
	if (!bucket || !object)
		throw new VaultPolicyDataError('bucket and object are required', { code: 'bad_input' });
	if (!buyer || typeof buyer !== 'string')
		throw new VaultPolicyDataError('buyer address is required', { code: 'bad_input' });

	let meta;
	try {
		meta = await getObjectMeta(bucket, object, { network });
	} catch (err) {
		if (err instanceof GreenfieldError) {
			throw new VaultPolicyDataError(
				`could not read this object's real Greenfield metadata: ${err.message}`,
				{
					code: err.code === 'not_found' ? 'object_not_found' : 'greenfield_unavailable',
					cause: err,
				},
			);
		}
		throw err;
	}

	const resourceId = String(meta.id ?? meta.Id ?? '');
	if (!resourceId || resourceId === '0') {
		throw new VaultPolicyDataError(
			'object metadata has no resolvable Greenfield resource id yet',
			{ code: 'object_not_found' },
		);
	}

	const policyMsg = Policy.fromPartial({
		id: '0', // assigned by Greenfield on settlement — never fabricated here.
		principal: { type: PrincipalType.PRINCIPAL_TYPE_GNFD_ACCOUNT, value: buyer.toLowerCase() },
		resourceType: ResourceType.RESOURCE_TYPE_OBJECT,
		resourceId,
		statements: [
			{ effect: Effect.EFFECT_ALLOW, actions: [ActionType.ACTION_GET_OBJECT], resources: [] },
		],
	});
	const bytes = Policy.encode(policyMsg).finish();

	return { policyDataHex: `0x${Buffer.from(bytes).toString('hex')}`, resourceId };
}
