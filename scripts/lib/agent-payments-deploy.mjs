// Planning and execution core for the AgentPayments CREATE2 deploy. The RPC is
// injected (`rpc(method, params) -> result`) so the same code runs against a
// live node, an anvil fork, or recorded responses in tests.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { concat, encodeAbiParameters, encodeFunctionData, getAddress, getContractAddress, hexToBigInt, keccak256, toHex } from 'viem';

export const FACTORY = '0x00000000D49195AE81759cd247cFeDD9D0B479df';
export const SALT = keccak256(toHex('three.ws/AgentPayments/v1'));
/** The deployer EOA that already owns the live ThreeWSPayments on BSC, Base and Arbitrum. */
export const DEFAULT_OWNER = '0x4022de2D36C334E73C7a108805Cea11C0564f402';

export const CHAINS = [
	{ id: 1, name: 'Ethereum', native: 'ETH' },
	{ id: 8453, name: 'Base', native: 'ETH' },
	{ id: 42161, name: 'Arbitrum One', native: 'ETH' },
	{ id: 137, name: 'Polygon', native: 'POL' },
	{ id: 56, name: 'BNB Smart Chain', native: 'BNB' },
	{ id: 43114, name: 'Avalanche', native: 'AVAX' },
];

export const FACTORY_ABI = [
	{ type: 'function', name: 'deploy', stateMutability: 'nonpayable', inputs: [{ name: 'salt', type: 'bytes32' }, { name: 'initCode', type: 'bytes' }], outputs: [{ name: 'addr', type: 'address' }] },
	{ type: 'function', name: 'predict', stateMutability: 'view', inputs: [{ name: 'salt', type: 'bytes32' }, { name: 'initCodeHash', type: 'bytes32' }], outputs: [{ type: 'address' }] },
];

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Creation bytecode from the forge build output. */
export function loadCreationCode(artifactPath = join(root, 'contracts', 'out', 'AgentPayments.sol', 'AgentPayments.json')) {
	let artifact;
	try {
		artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
	} catch {
		throw new Error(`forge artifact not found at ${artifactPath}. Run \`forge build\` in contracts/ first.`);
	}
	const code = artifact?.bytecode?.object;
	if (!code || code === '0x') throw new Error('forge artifact has no creation bytecode');
	return code.startsWith('0x') ? code : `0x${code}`;
}

export function buildInitCode(creationCode, owner) {
	return concat([creationCode, encodeAbiParameters([{ type: 'address' }], [owner])]);
}

/** CREATE2 address, identical to ThreeWSFactory.predict and the forge script. */
export function predictAddress(initCode, factory = FACTORY, salt = SALT) {
	return getContractAddress({ opcode: 'CREATE2', from: factory, salt, bytecode: initCode });
}

export function deployCalldata(initCode, salt = SALT) {
	return encodeFunctionData({ abi: FACTORY_ABI, functionName: 'deploy', args: [salt, initCode] });
}

/**
 * Plan one chain: factory present, target address free, gas and cost estimate.
 * Never signs. `status` is ready | already_deployed | factory_missing | error.
 */
export async function planChain({ chain, rpc, initCode, owner }) {
	const predicted = predictAddress(initCode);
	const row = { chain: chain.id, name: chain.name, native: chain.native, factory: FACTORY, predicted, owner, status: 'error', gas: null, gasPrice: null, costWei: null };
	try {
		const [factoryCode, targetCode] = await Promise.all([
			rpc('eth_getCode', [FACTORY, 'latest']),
			rpc('eth_getCode', [predicted, 'latest']),
		]);
		if (!factoryCode || factoryCode === '0x') return { ...row, status: 'factory_missing' };
		if (targetCode && targetCode !== '0x') return { ...row, status: 'already_deployed' };
		const data = deployCalldata(initCode);
		const [gasHex, priceHex] = await Promise.all([
			rpc('eth_estimateGas', [{ from: owner, to: FACTORY, data }]),
			rpc('eth_gasPrice', []),
		]);
		const gas = hexToBigInt(gasHex);
		const gasPrice = hexToBigInt(priceHex);
		return { ...row, status: 'ready', gas, gasPrice, costWei: gas * gasPrice };
	} catch (err) {
		return { ...row, error: err.message };
	}
}

export function formatNative(wei) {
	if (wei == null) return '-';
	const whole = wei / 10n ** 18n;
	const frac = (wei % 10n ** 18n).toString().padStart(18, '0').slice(0, 6);
	return `${whole}.${frac}`;
}

/** Fixed-width confirmation table. */
export function renderTable(rows) {
	const head = ['chain', 'id', 'factory', 'predicted address', 'owner', 'status', 'est. cost'];
	const body = rows.map((r) => [
		r.name,
		String(r.chain),
		r.status === 'factory_missing' ? 'MISSING' : short(r.factory),
		r.predicted,
		short(r.owner),
		r.status === 'error' ? `error: ${r.error}` : r.status,
		r.status === 'ready' ? `${formatNative(r.costWei)} ${r.native}` : '-',
	]);
	const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
	const line = (cells) => `| ${cells.map((c, i) => c.padEnd(widths[i])).join(' | ')} |`;
	return [line(head), `|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`, ...body.map(line)].join('\n');
}

function short(a) {
	return `${a.slice(0, 8)}...${a.slice(-4)}`;
}

/** A chain whose only endpoint is local (anvil fork) never needs --confirm-mainnet. */
export function isLocalEndpoint(url) {
	try {
		const h = new URL(url).hostname;
		return h === '127.0.0.1' || h === 'localhost' || h === '::1';
	} catch {
		return false;
	}
}

export function assertOwner(owner) {
	return getAddress(owner);
}
