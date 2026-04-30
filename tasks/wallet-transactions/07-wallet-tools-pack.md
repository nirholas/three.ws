# Task 07 — Wallet Tools Pack Registration

## Goal
Bundle the four wallet transaction tools (from Tasks 05 and 06) into a named `walletToolSchema` export and register it as a curated tool pack so users can enable it from the tool dropdown like any other pack.

## Context
- `chat/src/tools.js` exports: `curatedToolPacks`, `defaultToolSchema`, `agentToolSchema`, `pumpToolSchema`
- `curatedToolPacks` is an array of `{ name, description, tools }` objects used to populate the tool-pack picker UI
- `chat/src/App.svelte` imports `{ defaultToolSchema, agentToolSchema, pumpToolSchema, curatedToolPacks }` from `./tools.js`
- After this task, `walletToolSchema` should be importable from `tools.js` and appear in the curated tool packs list

## Changes to `chat/src/tools.js`

### 1. Extract `walletToolSchema`
Move the four wallet tools added in Tasks 05 and 06 out of `pumpToolSchema` (or from wherever they were added) into their own named export:

```js
export const walletToolSchema = [
  {
    clientDefinition: { /* solana_transfer clientDefinition */ },
    function: { /* solana_transfer function schema */ },
  },
  {
    clientDefinition: { /* solana_swap clientDefinition */ },
    function: { /* solana_swap function schema */ },
  },
  {
    clientDefinition: { /* evm_transfer clientDefinition */ },
    function: { /* evm_transfer function schema */ },
  },
  {
    clientDefinition: { /* evm_swap clientDefinition */ },
    function: { /* evm_swap function schema */ },
  },
];
```

### 2. Add to `curatedToolPacks`
Append a new entry to the `curatedToolPacks` array:

```js
{
  name: 'Wallet Transactions',
  description: 'Send and swap tokens on Solana and EVM chains directly from chat. Supports SOL, SPL tokens, ETH, ERC20, and DEX swaps via Jupiter and 1inch.',
  tools: walletToolSchema,
},
```

Place it after the existing packs (after the pump.fun / crypto pack if one exists).

### 3. Update `App.svelte` import
In `chat/src/App.svelte`, update the import line:

```js
import { defaultToolSchema, agentToolSchema, pumpToolSchema, walletToolSchema, curatedToolPacks } from './tools.js';
```

No other changes to App.svelte are needed — the curated tool packs are already consumed by the ToolPackModal component via `curatedToolPacks`.

## Verification
- Open the tool dropdown / tool pack modal in the chat UI.
- A "Wallet Transactions" pack appears in the list with the correct description.
- Enabling the pack adds all four tools (`solana_transfer`, `solana_swap`, `evm_transfer`, `evm_swap`) to the active tool set.
- The LLM can see all four tool definitions when the pack is enabled.
- No other tool packs or existing functionality is affected.
