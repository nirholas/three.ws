/**
 * POST /api/agents/register-confirm
 *
 * Verifies on-chain registration tx, confirms metadata CID matches prep record,
 * then upserts the agent_identities row.
 *
 * Requires: session auth, valid prepId, txHash, chainId, agentId
 * Returns: { ok: true, agentId } or { ok: false, error }
 */

import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { cors, json, method, wrap, error, readJson } from '../_lib/http.js';
import { parse } from '../_lib/validate.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { SERVER_CHAIN_META } from '../_lib/onchain.js';
import { z } from 'zod';
import { AbiCoder, getAddress, keccak256, toUtf8Bytes } from 'ethers';

const bodySchema = z.object({
	prepId: z.string().uuid(),
	chainId: z.number().int().positive(),
	agentId: z.union([z.string(), z.number()]),
	txHash: z.string().regex(/^0x[a-f0-9]{64}$/i),
});

// ERC-721 Transfer event (emitted when token is minted)
const REGISTERED_EVENT_ABI = 'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const session = await getSessionUser(req);
	if (!session) return error(res, 401, 'unauthorized', 'sign in required');

	const ip = clientIp(req);
	const rl = await limits.authIp(ip);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = parse(bodySchema, await readJson(req));
	const chainMeta = SERVER_CHAIN_META[body.chainId];
	if (!chainMeta) return error(res, 400, 'bad_request', `unsupported chain ${body.chainId}`);

	// Verify prep record exists, belongs to user, not expired
	const [prep] = await sql`
		select id, cid, metadata_uri, payload from agent_registrations_pending
		where id = ${body.prepId} and user_id = ${session.id} and expires_at > now()
		limit 1
	`;
	if (!prep) return error(res, 404, 'not_found', 'prep record not found or expired');

	// Fetch tx receipt from RPC
	let receipt;
	try {
		receipt = await fetchTransactionReceipt(chainMeta.rpc, body.txHash);
	} catch (err) {
		return error(res, 400, 'bad_request', `tx verification failed: ${err.message}`);
	}

	if (!receipt) {
		return error(res, 400, 'bad_request', 'tx not found or still pending');
	}

	if (receipt.status !== 1) {
		return error(res, 400, 'bad_request', 'tx failed on-chain');
	}

	// Parse Registered event from logs
	let agentURI;
	try {
		agentURI = parseRegisteredEvent(receipt.logs, chainMeta.registry);
	} catch (err) {
		return error(res, 400, 'bad_request', `failed to parse event: ${err.message}`);
	}

	// Verify metadataURI matches prep record
	if (agentURI !== prep.metadata_uri) {
		return error(res, 409, 'conflict', `metadata URI mismatch: expected ${prep.metadata_uri} got ${agentURI}`);
	}

	// Upsert agent_identities
	const agentId = String(body.agentId);
	const [updated] = await sql`
		insert into agent_identities (
			user_id, name, description, avatar_id,
			chain_id, erc8004_agent_id, erc8004_registry, registration_cid
		)
		values (
			${session.id},
			${(prep.payload.name || 'Unnamed Agent').slice(0, 255)},
			${(prep.payload.description || '').slice(0, 1000)},
			null,
			${body.chainId},
			${agentId},
			${chainMeta.registry},
			${prep.cid}
		)
		on conflict (user_id) do update set
			name = excluded.name,
			description = excluded.description,
			chain_id = excluded.chain_id,
			erc8004_agent_id = excluded.erc8004_agent_id,
			erc8004_registry = excluded.erc8004_registry,
			registration_cid = excluded.registration_cid,
			updated_at = now()
		returning id
	`;

	// Consume the prep record so it can't be reused
	await sql`delete from agent_registrations_pending where id = ${body.prepId}`;

	return json(res, 200, {
		ok: true,
		agentId: updated.id,
	});
});

/**
 * Fetch transaction receipt from JSON-RPC.
 * @param {string} rpcUrl
 * @param {string} txHash
 * @returns {Promise<object|null>}
 */
async function fetchTransactionReceipt(rpcUrl, txHash) {
	const res = await fetch(rpcUrl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			method: 'eth_getTransactionReceipt',
			params: [txHash],
		}),
	});

	const data = await res.json();
	if (data.error) throw new Error(`RPC error: ${data.error.message}`);
	return data.result;
}

/**
 * Parse Registered event from receipt logs.
 * Returns the agentURI (metadataURI) from the event.
 *
 * Event signature: Registered(uint256 indexed agentId, string agentURI, address indexed owner)
 * Topic hash: keccak256('Registered(uint256,string,address)')
 *
 * @param {array} logs
 * @param {string} registryAddress
 * @returns {string} agentURI
 */
function parseRegisteredEvent(logs, registryAddress) {
	const registryAddr = getAddress(registryAddress);
	const topic0 = eventSignatureHash('Registered(uint256,string,address)');

	for (const log of logs) {
		// Match registry address and Registered event topic
		if (
			getAddress(log.address) === registryAddr &&
			log.topics[0] === topic0
		) {
			// Decode the data field which contains the string agentURI
			// For Registered(uint256 indexed agentId, string agentURI, address indexed owner),
			// the data field contains (agentURI). The string is ABI-encoded as offset + length + data.
			const abi = ['string'];
			const coder = AbiCoder.defaultAbiCoder();
			const decoded = coder.decode(abi, log.data);
			return decoded[0];
		}
	}

	throw new Error('Registered event not found in receipt');
}

/**
 * Compute keccak256 hash of event signature string.
 * Used to match event topic0.
 *
 * @param {string} signature e.g., 'Registered(uint256,string,address)'
 * @returns {string} hex digest with 0x prefix
 */
function eventSignatureHash(signature) {
	return keccak256(toUtf8Bytes(signature));
}
