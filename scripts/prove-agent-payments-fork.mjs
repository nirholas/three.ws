// End-to-end proof of the AgentPayments CREATE2 deploy on an anvil FORK of a
// live chain. Nothing touches mainnet: every transaction goes to the local fork
// and is signed by anvil's built-in test accounts (public, valueless keys).
//
//   anvil --fork-url https://mainnet.base.org --port 18545 &
//   node scripts/prove-agent-payments-fork.mjs --chain 8453 --rpc http://127.0.0.1:18545 --router 0x...
//
// Steps: deploy through ThreeWSFactory, createAgent, setRouterAllowed for the
// chain's canonical router, then acceptPayment, distributePayments and withdraw
// built by the SDK's EvmAgent. Prints a transcript summary (no keys).

import {
	createPublicClient,
	createWalletClient,
	encodeAbiParameters,
	encodeFunctionData,
	getAddress,
	http,
	keccak256,
	parseAbi,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { buildInitCode, deployCalldata, FACTORY, loadCreationCode, predictAddress } from './lib/agent-payments-deploy.mjs';
import { EVM_CHAINS, EvmAgent } from '../agent-payments-sdk/dist/evm/index.js';

function flag(name) {
	const i = process.argv.indexOf(name);
	return i >= 0 ? process.argv[i + 1] : null;
}
const chainId = Number(flag('--chain'));
const rpcUrl = flag('--rpc');
const router = flag('--router');
if (!chainId || !rpcUrl || !router) {
	console.error('usage: --chain <id> --rpc <fork url> --router <canonical router address>');
	process.exit(2);
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(rpcUrl)) {
	console.error('Refusing: --rpc must be a local anvil fork.');
	process.exit(2);
}

// anvil's well-known development keys (public; hold no real value).
const DEV_KEYS = [
	'0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
	'0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
	'0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdd5f5f6',
];
const [deployer, agentAuth, payer] = DEV_KEYS.map((k) => privateKeyToAccount(k));
const chain = EVM_CHAINS[chainId];
if (!chain) throw new Error(`unsupported chain ${chainId}`);

const transport = http(rpcUrl);
const pub = createPublicClient({ transport });
const wallet = (account) => createWalletClient({ account, transport, chain: { id: chainId, name: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: { default: { http: [rpcUrl] } } } });
const send = async (account, tx) => {
	const hash = await wallet(account).sendTransaction({ to: tx.to, data: tx.data, value: tx.value ?? 0n });
	const receipt = await pub.waitForTransactionReceipt({ hash });
	if (receipt.status !== 'success') throw new Error(`tx reverted: ${hash}`);
	return receipt;
};
const log = [];
const step = (name, detail) => {
	log.push([name, detail]);
	console.log(`ok  ${name}${detail ? `  ${detail}` : ''}`);
};

const rpcChain = Number(await pub.getChainId());
if (rpcChain !== chainId) throw new Error(`fork reports chain ${rpcChain}, expected ${chainId}`);
await pub.request({ method: 'anvil_setBalance', params: [deployer.address, '0x56BC75E2D63100000'] });
await pub.request({ method: 'anvil_setBalance', params: [payer.address, '0x56BC75E2D63100000'] });
await pub.request({ method: 'anvil_setBalance', params: [agentAuth.address, '0x56BC75E2D63100000'] });

// 1. Deploy through the live factory at the predicted CREATE2 address.
const initCode = buildInitCode(loadCreationCode(), deployer.address);
const predicted = predictAddress(initCode);
const factoryCode = await pub.getCode({ address: FACTORY });
if (!factoryCode || factoryCode === '0x') throw new Error('ThreeWSFactory missing on this fork');
await send(deployer, { to: FACTORY, data: deployCalldata(initCode) });
const code = await pub.getCode({ address: predicted });
if (!code || code === '0x') throw new Error('no code at the predicted address after deploy');
const ENGINE = parseAbi([
	'function owner() view returns (address)',
	'function allowedRouters(address) view returns (bool)',
	'function setRouterAllowed(address router, bool allowed)',
]);
const owner = await pub.readContract({ address: predicted, abi: ENGINE, functionName: 'owner' });
if (getAddress(owner) !== getAddress(deployer.address)) throw new Error('owner mismatch');
step('deploy via factory', `${predicted} (${(code.length - 2) / 2} bytes)`);

// 2. Point the SDK at the fork deployment (in memory only; the table is not edited).
chain.agentPayments = predicted;
const agentToken = getAddress('0x0000000000000000000000000000000000007e57');
const agent = new EvmAgent(agentToken, chainId, rpcUrl);
await send(deployer, agent.buildCreateAgentTx({ agentToken, agentAuthority: agentAuth.address, buybackBps: 2000 }));
step('createAgent', 'buybackBps 2000');

// 3. Router allow-list.
const routerCode = await pub.getCode({ address: router });
if (!routerCode || routerCode === '0x') throw new Error('router has no code on this fork');
await send(deployer, { to: predicted, data: encodeFunctionData({ abi: ENGINE, functionName: 'setRouterAllowed', args: [router, true] }) });
const allowed = await pub.readContract({ address: predicted, abi: ENGINE, functionName: 'allowedRouters', args: [router] });
if (!allowed) throw new Error('router was not allow-listed');
step('setRouterAllowed', `${router} allowed=${allowed}`);

// 4. Fund the payer with the chain's USDC on the fork, then pay through the SDK.
const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)']);
const usdc = chain.usdc;
const amount = 100n * 10n ** BigInt(await pub.readContract({ address: usdc, abi: erc20, functionName: 'decimals' }));
await fundErc20(usdc, payer.address, amount * 2n);
const window = { memo: 4242n, startTime: 0n, endTime: BigInt(Math.floor(Date.now() / 1000) + 3600) };
const bundle = agent.buildAcceptPaymentTx({ agentToken, currencyToken: usdc, amount, ...window }, payer.address);
if (bundle.approval) await send(payer, bundle.approval);
await send(payer, bundle.tx);
let bal = await agent.getBalances(usdc);
if (bal.paymentVault !== amount) throw new Error(`payment vault ${bal.paymentVault} != ${amount}`);
step('acceptPayment', `${amount} USDC base units in the payment vault`);

// 5. Distribute: 20% to the buyback vault, 80% to the withdraw vault.
await send(payer, agent.buildDistributePaymentsTx({ agentToken, currencyToken: usdc }));
bal = await agent.getBalances(usdc);
if (bal.buybackVault !== amount / 5n || bal.withdrawVault !== amount - amount / 5n || bal.paymentVault !== 0n) {
	throw new Error(`unexpected split ${JSON.stringify(bal, (_, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
}
step('distributePayments', `buyback ${bal.buybackVault}, withdraw ${bal.withdrawVault}`);

// 6. The agent authority withdraws its share to a fresh receiver.
const receiver = privateKeyToAccount(keccak256(encodeAbiParameters([{ type: 'string' }], ['fork-receiver']))).address;
await send(agentAuth, agent.buildWithdrawTx({ agentToken, currencyToken: usdc, receiver }));
const received = await pub.readContract({ address: usdc, abi: erc20, functionName: 'balanceOf', args: [receiver] });
if (received !== amount - amount / 5n) throw new Error(`receiver got ${received}`);
step('withdraw', `${received} USDC base units to the receiver`);

console.log(`\nPROVED chain ${chainId} (${chain.name}) at ${predicted}: ${log.length} steps passed on a local fork.`);

async function fundErc20(token, holder, value) {
	for (let slot = 0; slot < 20; slot++) {
		const key = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [holder, BigInt(slot)]));
		const padded = `0x${value.toString(16).padStart(64, '0')}`;
		await pub.request({ method: 'anvil_setStorageAt', params: [token, key, padded] });
		const now = await pub.readContract({ address: token, abi: erc20, functionName: 'balanceOf', args: [holder] });
		if (now === value) return;
	}
	throw new Error('could not locate the ERC-20 balance slot on the fork');
}
