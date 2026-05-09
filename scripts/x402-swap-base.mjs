import { readFileSync } from 'node:fs';
import {
  createPublicClient, createWalletClient, http, parseEther, formatUnits,
  encodeFunctionData, encodePacked,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

const PK = readFileSync('/home/codespace/.config/x402-test-wallets/base.privkey.txt', 'utf8').trim();
const account = privateKeyToAccount(PK);

const RPC = 'https://mainnet.base.org';
const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const SWAP_ROUTER_02 = '0x2626664c2603336E57B271c5C0b26F421741e481';
const FEE = 500;

const pub = createPublicClient({ chain: base, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: base, transport: http(RPC) });

const ROUTER_ABI = [
  { type: 'function', name: 'exactInputSingle', stateMutability: 'payable',
    inputs: [{ type: 'tuple', name: 'params', components: [
      { type: 'address', name: 'tokenIn' },
      { type: 'address', name: 'tokenOut' },
      { type: 'uint24', name: 'fee' },
      { type: 'address', name: 'recipient' },
      { type: 'uint256', name: 'amountIn' },
      { type: 'uint256', name: 'amountOutMinimum' },
      { type: 'uint160', name: 'sqrtPriceLimitX96' },
    ]}],
    outputs: [{ type: 'uint256', name: 'amountOut' }] },
  { type: 'function', name: 'multicall', stateMutability: 'payable',
    inputs: [{ type: 'bytes[]', name: 'data' }],
    outputs: [{ type: 'bytes[]' }] },
  { type: 'function', name: 'refundETH', stateMutability: 'payable', inputs: [], outputs: [] },
];

const USDC_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view',
    inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
];

const ethBal = await pub.getBalance({ address: account.address });
console.log('Address:', account.address);
console.log('ETH balance:', Number(ethBal) / 1e18);

const reserveForGas = parseEther('0.0001');
const amountIn = ethBal - reserveForGas;
if (amountIn <= 0n) throw new Error('insufficient ETH after gas reserve');
console.log('Swapping (ETH):', Number(amountIn) / 1e18);

const minOut = 3_500_000n;
console.log('Min USDC out:', Number(minOut) / 1e6);

const swapData = encodeFunctionData({
  abi: ROUTER_ABI,
  functionName: 'exactInputSingle',
  args: [{
    tokenIn: WETH,
    tokenOut: USDC,
    fee: FEE,
    recipient: account.address,
    amountIn,
    amountOutMinimum: minOut,
    sqrtPriceLimitX96: 0n,
  }],
});
const refundData = encodeFunctionData({ abi: ROUTER_ABI, functionName: 'refundETH', args: [] });

console.log('Sending multicall(exactInputSingle + refundETH)...');
const hash = await wallet.writeContract({
  address: SWAP_ROUTER_02,
  abi: ROUTER_ABI,
  functionName: 'multicall',
  args: [[swapData, refundData]],
  value: amountIn,
});
console.log('tx hash:', hash);

const rcpt = await pub.waitForTransactionReceipt({ hash });
console.log('status:', rcpt.status, 'gas used:', rcpt.gasUsed.toString());

const usdcBal = await pub.readContract({ address: USDC, abi: USDC_ABI, functionName: 'balanceOf', args: [account.address] });
const ethAfter = await pub.getBalance({ address: account.address });
console.log('--- after swap ---');
console.log('ETH:', Number(ethAfter) / 1e18);
console.log('USDC:', formatUnits(usdcBal, 6));
