# three.ws Uniswap v4 hooks

Hooks that three.ws owns on Uniswap v4. Every hook here is an EVM surface; Solana is
the home chain, and each product built on a hook here has or will have a Solana leg.

| Hook | Source | Flags | Status |
| --- | --- | --- | --- |
| `SkinHook` | [`src/SkinHook.sol`](./src/SkinHook.sol) | `0x20CC` | Not deployed |

Background, prior art, and why these hooks: [`docs/uniswap-v4-hooks.md`](../../docs/uniswap-v4-hooks.md).

## SkinHook: wearable 3D items as coins

Every wearable is a fixed-supply ERC-20 ([`SkinToken`](./src/SkinToken.sol)) with its own
ETH pool, all launched through one singleton hook.

- **Wear-to-lock.** `equip(token)` locks exactly one whole token in the hook and
  `unequip(token)` returns it. A supply of 10,000 means at most 10,000 people can wear the
  item at once, and every wearer takes a token out of the float.
- **A royalty that cannot be skipped.** 2% of the ETH side of every swap is taken inside
  the swap: half to the creator, a quarter to the referrer, a quarter to the platform
  treasury. With no referrer, that quarter goes to the creator.
- **Embed-to-earn.** A swap names its referrer by passing `abi.encode(address)` as
  `hookData`. Anything else is ignored, and a swap with empty `hookData` works normally,
  so any router can trade these pools.
- **Fair launch by construction.** `launch` mints the whole supply into one permanent
  single-sided position that sells from the start price upward. Nothing is held back for
  the creator or the platform, and the position can never be withdrawn.
- **The model is pinned.** `SkinToken.modelHash` is the keccak256 of the GLB, fixed at
  launch. A renderer must refuse a file that does not match it.

Design decisions that matter to a reviewer:

- The hook is its own factory. v4 skips hook callbacks for calls a hook makes itself, so
  `beforeInitialize` only ever runs for an outsider, and it always reverts. Every pool
  that names this hook was launched by it.
- Fees are booked as ERC-6909 claims on the PoolManager and paid out by `claim(to)`.
  A swap never pushes ETH to anyone, so no recipient can block trading, and the first
  buy works even when the PoolManager holds no ETH.
- The fee is always in ETH. When ETH is the specified side of the swap it is taken in
  `beforeSwap` out of the specified amount; otherwise `afterSwap` takes it from the ETH
  that moved. Creators never accumulate their own token and never become sell pressure.
- A referrer can be the trader's own address. That is a 0.5% rebate, it is inherent to
  any on-chain referral, and it comes out of the referrer share only.
- Fee shares and the fee itself are constants. The only owner power is changing the
  treasury address (`Ownable2Step`).

```solidity
(SkinToken token, PoolKey memory key) = hook.launch(
    SkinHook.LaunchParams({
        name: "Halo",
        symbol: "HALO",
        supply: 10_000,              // whole tokens, 100 to 1,000,000
        modelURI: "https://three.ws/cdn/skins/halo.glb",
        modelHash: keccak256(glbBytes),
        slot: "head",
        startTick: 92_200,           // about 10,100 tokens per ETH; multiple of 200
        creator: msg.sender
    })
);

token.approve(address(hook), 1e18);
hook.equip(token);                   // wearing it: one token locked
hook.unequip(token);                 // token returned
hook.claim(payoutAddress);           // creator, referrer or treasury withdraws ETH
```

## Build and test

Foundry is required (`curl -L https://foundry.paradigm.xyz | bash && foundryup`).

```bash
cd contracts/v4-hooks
forge build
forge test
```

The suite runs against the real v4-core `PoolManager` and its reference swap router, not
stand-ins. `test/HookMiner.t.sol` proves the production deploy path: a mined CREATE2 salt
lands the hook at an address that passes the hook's own permission check.

## Deploy

A v4 hook's permissions are the low 14 bits of its address, so it must be deployed with a
mined CREATE2 salt. `script/DeploySkinHook.s.sol` mines it and deploys through the
canonical CREATE2 deployer. Without `--broadcast` it is a dry run that prints the address.

```bash
POOL_MANAGER=0x498581ff718922c3f8e6a244956af099b2652b2b \
HOOK_OWNER=0x... HOOK_TREASURY=0x... \
forge script script/DeploySkinHook.s.sol --rpc-url base --broadcast --verify
```

`PoolManager` addresses per chain are in Uniswap's v4 deployment table. Deploying is an
on-chain spend and needs the owner's explicit approval each time. Source verification on
the target explorer is required before the hook can be listed in
[Uniswap/hooklist](https://github.com/Uniswap/hooklist).

## Vendored dependencies

- `lib/v4-core`: Uniswap v4-core at tag `v4.0.0`
  (commit `e50237c43811bd9b526eff40f26772152a42daba`), `src/` plus the one test utility
  the reference routers import. `PoolManager.sol` is BUSL-1.1 and is used here only to
  test against; the hooks import only MIT-licensed interfaces, libraries and types.
- `lib/solmate`: the three files v4-core imports, at the commit v4-core pins
  (`4b47a19038b798b4a33d9749d25e570443520647`).
- forge-std and OpenZeppelin are reused from [`../lib`](../lib).
