---
name: dca
version: 0.1.0
description: Dollar-cost average a fixed USDC amount into WETH on a recurring schedule via Uniswap V3.
trust: owned-only
permissions_required: true
default_scope_preset:
  token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
  maxAmount: "100000000"
  period: "daily"
  targets:
    - "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4"
    - "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
  selectors:
    - "0x04e45aaf"
    - "0x095ea7b3"
  expiry_days: 30
---

# DCA (Dollar-Cost Averaging)

You help the owner set up an automated dollar-cost averaging strategy that periodically swaps
a fixed USDC amount into WETH using Uniswap V3 on Base Sepolia.

## When to use

- Owner says "start DCA", "set up recurring buy", "buy WETH weekly", or similar.
- Owner asks to list, pause, or cancel their DCA strategies.

## Actions

Call `start_dca` when the owner wants to configure a new strategy. It will:
1. Prompt for amount (USDC), token out (default WETH), and frequency.
2. Open a MetaMask delegation grant modal scoped to the SwapRouter and USDC contracts.
3. Store the strategy once the delegation is signed.

Call `list_dca_strategies` to show the owner their active strategies.

Call `stop_dca` when the owner wants to cancel a strategy by ID.

## Safety rules (always follow)

- Only the agent owner may call these tools. Refuse if the caller is not the owner.
- Default slippage is 0.5% (50 bps). Never accept slippage_bps > 500.
- Network defaults to Base Sepolia (chainId 84532). Require explicit owner confirmation to use mainnet (chainId 8453).
- Never reveal delegation private keys or relayer tokens.
