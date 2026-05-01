# Fix: RPC eth_getLogs Block Range Exceeds Current Head Block

## Problem

The `index-delegations` cron job logs this error:

```
{"stage":"index-delegations","chainId":1,"error":"RPC eth_getLogs error: block range extends beyond current head block"}
```

The cron is requesting logs for a block range where the `toBlock` exceeds the current chain head. This happens when the stored "last processed block" cursor is ahead of the actual chain (e.g., due to a bug writing the cursor, or querying a testnet that is behind).

## What to investigate

1. Find the `index-delegations` cron handler — locate where `eth_getLogs` is called and how `fromBlock` and `toBlock` are determined.
2. Check how the cursor (last processed block) is stored and retrieved from the database.
3. Identify if there is a step that fetches the current head block (`eth_blockNumber`) and uses it to cap `toBlock`.

## Expected fix

Always cap `toBlock` to the current chain head before calling `eth_getLogs`:

```js
const currentBlock = await provider.getBlockNumber();
const fromBlock = await getLastProcessedBlock(chainId);
const toBlock = Math.min(fromBlock + MAX_BLOCK_RANGE, currentBlock);

if (fromBlock >= currentBlock) {
  // Nothing new to process
  return;
}

const logs = await provider.getLogs({ fromBlock, toBlock, ... });
await setLastProcessedBlock(chainId, toBlock);
```

Also add a sanity check: if the stored cursor is somehow greater than `currentBlock`, reset it to `currentBlock - 1` and log a warning rather than erroring out.
