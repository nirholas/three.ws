/**
 * ValidationRegistry bridge — turn a glTF-Validator report into an on-chain
 * validation record.
 *
 * Usage:
 *   import { recordValidation } from './erc8004/validation-recorder.js';
 *   await recordValidation({ agentId, report, signer, pinToIPFS, apiToken });
 */

import { Contract, keccak256, toUtf8Bytes } from 'ethers';
import { REGISTRY_DEPLOYMENTS, VALIDATION_REGISTRY_ABI } from './abi.js';
import { pinFile } from './agent-registry.js';

const KIND_GLB_SCHEMA = 'glb-schema';

/**
 * Derive a deterministic pass/fail flag from a glTF-Validator report.
 * Pass = zero errors (warnings/infos/hints are allowed).
 */
export function reportPassed(report) {
	const errs = (report && report.issues && report.issues.numErrors) || 0;
	return errs === 0;
}

/**
 * keccak256 hash of the canonicalized JSON report, suitable for on-chain proof.
 * @param {object} report
 * @returns {string} 0x-prefixed 32-byte hex.
 */
export function hashReport(report) {
	const json = JSON.stringify(report);
	return keccak256(toUtf8Bytes(json));
}

/**
 * Record a validation result on-chain. Optionally pin the full report to IPFS
 * first so verifiers can fetch the details behind the hash.
 *
 * @param {object} opts
 * @param {number|bigint} opts.agentId
 * @param {object} opts.report                   glTF-Validator report
 * @param {import('ethers').Signer} opts.signer  Must be an allow-listed validator
 * @param {number} [opts.chainId]                Defaults to signer's network
 * @param {string} [opts.apiToken]               IPFS pinning token (optional)
 * @param {boolean} [opts.pin=true]              Pin report to IPFS before recording
 * @param {string} [opts.kind='glb-schema']
 * @returns {Promise<{txHash: string, proofHash: string, proofURI: string, passed: boolean}>}
 */
export async function recordValidation({
	agentId,
	report,
	signer,
	chainId,
	apiToken,
	pin = true,
	kind = KIND_GLB_SCHEMA,
}) {
	if (!signer) throw new Error('signer is required');
	if (!report) throw new Error('report is required');

	const resolvedChainId = chainId ?? Number((await signer.provider.getNetwork()).chainId);
	const deployment = REGISTRY_DEPLOYMENTS[resolvedChainId];
	if (!deployment || !deployment.validationRegistry) {
		throw new Error(`No Validation Registry deployed on chain ${resolvedChainId}.`);
	}

	const proofHash = hashReport(report);
	const passed = reportPassed(report);

	let proofURI = '';
	if (pin && apiToken) {
		const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
		const cid = await pinFile(blob, apiToken);
		proofURI = `ipfs://${cid}`;
	}

	const contract = new Contract(deployment.validationRegistry, VALIDATION_REGISTRY_ABI, signer);
	const tx = await contract.recordValidation(agentId, passed, proofHash, proofURI, kind);
	await tx.wait();

	return { txHash: tx.hash, proofHash, proofURI, passed };
}

/**
 * Read the most recent validation of a given kind.
 * @param {object} opts
 * @param {number|bigint} opts.agentId
 * @param {import('ethers').Provider | import('ethers').Signer} opts.runner
 * @param {number} opts.chainId
 * @param {string} [opts.kind='glb-schema']
 */
export async function getLatestValidation({ agentId, runner, chainId, kind = KIND_GLB_SCHEMA }) {
	const deployment = REGISTRY_DEPLOYMENTS[chainId];
	if (!deployment || !deployment.validationRegistry) {
		throw new Error(`No Validation Registry deployed on chain ${chainId}.`);
	}
	const contract = new Contract(deployment.validationRegistry, VALIDATION_REGISTRY_ABI, runner);
	return contract.getLatestByKind(agentId, kind);
}
