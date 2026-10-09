# Paired launchpad

The contracts behind **paired coins** on three.ws: a coin launched on Robinhood
Chain (4663) whose liquidity is quoted in one to five other assets at once
instead of a single gas token. A coin paired with NVDA, WETH and USDG trades in
three independent bonding curves, one per pairing, and its creator earns fees in
all three.

Two contracts, no dependencies, no proxy.

| Contract | What it is |
|---|---|
| [`src/PairedLaunchpad.sol`](src/PairedLaunchpad.sol) | Factory, one constant-product curve per pairing, fee accounting, batched claims |
| [`src/PairedToken.sol`](src/PairedToken.sol) | Fixed 1B supply ERC-20 with no admin surface: no mint, no owner, no pause |

The source is the paired.exchange launchpad (originally built as clink.fun),
vendored here so three.ws agents launch on the same audited-by-tests code the
deployed contract runs.

## Live deployment

| | |
|---|---|
| Chain | Robinhood Chain, 4663 |
| Launchpad | [`0x6a546350f79DE0Fc83ADfCe99233183aA090fa15`](https://robinhoodchain.blockscout.com/address/0x6a546350f79DE0Fc83ADfCe99233183aA090fa15) |
| Launch fee | read live: `launchFeeWei()` |
| Swap fee | read live: `swapFeeBps()`, capped at 5% in code |
| Creator share of swap fees | 70%, a constant |

three.ws reads the address from `PAIRED_LAUNCHPAD` and falls back to the
deployment above. Every quote asset a coin can pair against is read live from
`quoteTokens()` and `quoteConfig(address)`, so registering a new pairing on chain
makes it available everywhere on three.ws with no code change.

## Build and test

```bash
cd contracts/paired-launchpad
forge test
```

30 tests, including fuzz coverage that a buy-then-sell round trip never
profits, that every curve stays backed by its real reserve, and that supply is
conserved across pools.

## Verify the deployed bytecode

`foundry.toml` pins the compiler settings the live contract was built with.
The executable bytecode is identical. The only bytes that differ are the two
CBOR metadata hashes (the launchpad's own and the one inside the embedded
`PairedToken` creation code), because they encode source file paths:

```bash
forge build
LOCAL=$(jq -r .deployedBytecode.object out/PairedLaunchpad.sol/PairedLaunchpad.json)
CHAIN=$(cast code 0x6a546350f79DE0Fc83ADfCe99233183aA090fa15 --rpc-url https://rpc.mainnet.chain.robinhood.com)
# Mask every IPFS metadata hash, then compare.
node -e 'const m=h=>h.toLowerCase().replace(/a264697066735822[0-9a-f]{68}/g,"");process.exit(m(process.argv[1])===m(process.argv[2])?0:1)' "$LOCAL" "$CHAIN" && echo identical
```

## The design in one page

**One curve per pairing.** A coin paired with NVDA and WETH gets two
independent constant-product curves. They do not arbitrage each other and they
are not a basket: the allocation only decides how the fixed supply is split.

**Virtual quote reserves.** Each curve starts with a virtual quote balance set
per quote asset (`quoteConfig.virtualQuote`, for a 100%-weight pool), so there
is nothing to deposit on the quote side. A creator can launch against WETH or
NVDA without holding either. The only mandatory cost is the flat launch fee in
ETH. The virtual reserve is also the coin's opening market cap in that asset,
which is why each quote is calibrated to a comparable USD value.

**No migration, no ceiling.** Tokens leave the curve asymptotically, so there
is no graduation event where liquidity moves and something can break.

**Bounded admin.** The owner sets the launch fee, the swap fee and the quote
registry. The swap fee is capped at 5% in code. The owner cannot touch a curve,
a token, or accrued fees.

**Fees claim in one transaction.** `claimFees(address[])` collects every quote
asset a creator earned in at once, and `setFeeRecipient` lets the current
recipient move future fees to a new wallet.

## Adding a pairing

A quote asset must be a plain ERC-20: no fee-on-transfer, no rebasing. The
curve accounts in amounts it asked to move, so a token that delivers less than
it was asked to would leave the pool under-backed.

New pairings are registered by the launchpad owner with
`setQuoteConfig(quote, virtualQuote, true)`. On three.ws,
`npm run paired:quotes` prints the calibrated plan (opening value per pairing
in USD, decimals-correct `virtualQuote`, and the exact calldata) for every
asset you name, and only broadcasts with an owner key and `--apply`. See
[docs/paired-coins.md](../../docs/paired-coins.md).

## Status

**Not audited.** The tests demonstrate the intended behaviour; they are not a
substitute for someone trying to break it.
