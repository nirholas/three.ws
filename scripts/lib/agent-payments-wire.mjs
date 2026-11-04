// Pure text transforms behind scripts/wire-agent-payments-addresses.mjs.

import { getAddress } from 'viem';

const IDS = [1, 8453, 42161, 137, 56, 43114];

export function parseWiring(entries) {
	const wiring = {};
	for (const e of entries) {
		const [id, address] = String(e).split('=');
		const chainId = Number(id);
		if (!IDS.includes(chainId)) throw new Error(`unsupported chain id: ${id}`);
		if (!/^0x[0-9a-fA-F]{40}$/.test(address || '')) throw new Error(`invalid address for chain ${id}: ${address}`);
		const checksummed = getAddress(address);
		if (/^0x0{40}$/i.test(checksummed)) throw new Error(`refusing the zero address for chain ${id}`);
		wiring[chainId] = checksummed;
	}
	return wiring;
}

/** Set `agentPayments` inside each chain block of addresses.ts. */
export function wireAddressesTs(src, wiring) {
	let out = src;
	for (const [id, address] of Object.entries(wiring)) {
		const block = new RegExp(`(\\n  ${id}: \\{[\\s\\S]*?\\n    agentPayments: )[^,\\n]+(,)`);
		if (!block.test(out)) throw new Error(`no agentPayments entry for chain ${id} in addresses.ts`);
		out = out.replace(block, `$1"${address}"$2`);
	}
	return out;
}

/** Fill the AgentPayments table row of DEPLOYMENTS.md for each chain. */
export function wireDeploymentsMd(md, wiring, details = {}) {
	let out = md;
	for (const [id, address] of Object.entries(wiring)) {
		const row = new RegExp(`^(\\| [^|]+ \\| ${id} \\| )[^|]+\\|[^|]+\\|[^|]+\\|[^|]+\\|$`, 'm');
		if (!row.test(out)) throw new Error(`no DEPLOYMENTS.md row for chain ${id}`);
		const d = details[id] || {};
		const cells = [`\`${address}\``, d.owner || 'see tx', d.routers || 'none yet', d.tx || 'see explorer'];
		out = out.replace(row, `$1${cells.join(' | ')} |`);
	}
	return out;
}
