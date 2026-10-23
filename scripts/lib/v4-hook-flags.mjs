// Uniswap v4 decides which callbacks to run by masking the low 14 bits of a hook's
// address, so these flags are what the protocol will do for any hook, verified source
// or not. Bit order matches HookForge's `permissionsFromAddress` (least significant
// first), which in turn mirrors v4-core `Hooks.sol`.

export const FLAG_BITS = [
	'afterRemoveLiquidityReturnsDelta',
	'afterAddLiquidityReturnsDelta',
	'afterSwapReturnsDelta',
	'beforeSwapReturnsDelta',
	'afterDonate',
	'beforeDonate',
	'afterSwap',
	'beforeSwap',
	'afterRemoveLiquidity',
	'beforeRemoveLiquidity',
	'afterAddLiquidity',
	'beforeAddLiquidity',
	'afterInitialize',
	'beforeInitialize',
];

export const HOOK_NAME_ABI = ['function hookName() view returns (string)'];

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** The low 14 bits of a hook address as a number. */
export function permissionMask(address) {
	if (!ADDRESS_RE.test(address)) throw new Error(`not an address: ${address}`);
	return Number(BigInt(address) & 0x3fffn);
}

/** Names of the callbacks a mask enables, in bit order. */
export function callbacksFromMask(mask) {
	return FLAG_BITS.filter((_, i) => (mask >> i) & 1);
}

/** Permission map keyed by callback name, the shape `decode_hook_address` returns. */
export function permissionsFromAddress(address) {
	const mask = permissionMask(address);
	return Object.fromEntries(FLAG_BITS.map((name, i) => [name, ((mask >> i) & 1) === 1]));
}

/** Mask for a HookForge manifest's `permissions` object. */
export function maskFromPermissions(permissions) {
	return FLAG_BITS.reduce((mask, name, i) => (permissions[name] ? mask | (1 << i) : mask), 0);
}

export function formatMask(mask) {
	return '0x' + mask.toString(16).padStart(4, '0');
}

const normalize = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Identify a HookForge hook from its address (a published deployment) or from the
 * string its `hookName()` returns. `snapshot` is data/hookforge-registry.json.
 */
export function identifyHookForge(snapshot, address, hookName, chainId) {
	const addr = address.toLowerCase();
	for (const hook of snapshot.hooks) {
		if (
			hook.deployments.some(
				(d) => d.address.toLowerCase() === addr && (chainId == null || d.chainId === chainId),
			)
		) {
			return hook;
		}
	}
	if (!hookName) return null;
	const wanted = normalize(hookName);
	return (
		snapshot.hooks.find(
			(h) => normalize(h.slug) === wanted || normalize(h.name) === wanted || normalize(h.contract) === wanted,
		) || null
	);
}
