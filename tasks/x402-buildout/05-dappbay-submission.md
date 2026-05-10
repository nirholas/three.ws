# Task: Submit three.ws to BNB DappBay

## Context

three.ws has deployed ThreeWSPayments on BSC at `0x00000000381f09742a30a5a49975514AeC1B72Cc` — a CREATE2 vanity address with 8 leading zeros, deployed via ThreeWSFactory (`0x00000000D49195AE81759cd247cFeDD9D0B479df`). Both contracts are verified on BSCScan.

DappBay is BNB Chain's official dapp discovery platform. Submission URL: `https://dappbay.bnbchain.org/submit-dapp`

## Project details for submission

**Name:** three.ws

**Tagline:** AI agent infrastructure — pay-per-call MCP tools via x402 micropayments on BNB Chain

**Description:**
three.ws is an AI agent platform that exposes 3D model validation, inspection, and optimization as paid MCP (Model Context Protocol) tool calls. Agents pay $0.001 USDC per call on BNB Smart Chain via the ThreeWSPayments contract. The platform uses CREATE2 vanity addresses for gas efficiency and operates a custom factory (ThreeWSFactory) for deterministic deployments across chains.

**Website:** https://three.ws

**Category:** DeFi / AI / Developer Tools

**Chains:** BNB Smart Chain

**Contracts:**
- `0x00000000D49195AE81759cd247cFeDD9D0B479df` — ThreeWSFactory (CREATE2 deployer, 8 leading zeros)
- `0x00000000381f09742a30a5a49975514AeC1B72Cc` — ThreeWSPayments (x402 payment receiver, 8 leading zeros)

**Social:**
- GitHub: https://github.com/nirholas/3D-Agent
- MCP endpoint: https://three.ws/api/mcp
- Pay demo: https://three.ws/pay

**What makes it unique:**
- 8 leading zeros on all contracts (rare, gas-efficient)
- Live x402 micropayment integration — AI agents pay autonomously per tool call
- Same factory address deployed across BSC, Base, and Arbitrum
- Offline-capable vanity address grinder at three.ws/eth-vanity

## Submission steps

1. Go to `https://dappbay.bnbchain.org/submit-dapp`
2. Fill in all fields above
3. For contract risk assessment: both contracts are verified — paste both addresses
4. Submit and note the submission ID

## Definition of done

- Submission completed at DappBay
- Submission confirmation/ID recorded
- No "high risk" flags (contracts are verified, so this should pass)
