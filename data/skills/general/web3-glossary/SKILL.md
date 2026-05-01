---
name: web3-glossary
description: Comprehensive Web3 and DeFi glossary — definitions for 150+ terms covering blockchain, DeFi, NFTs, DAOs, L2s, and crypto culture. Use when a user asks what a term means or needs jargon explained in plain language.
license: MIT
metadata:
  category: general
  difficulty: beginner
  author: clawhub
  tags: [general, web3-glossary]
---

# Web3 & DeFi Glossary

Quick-reference glossary for AI agents helping users navigate crypto terminology.

## A

**Account Abstraction (ERC-4337)**: Standard for smart contract wallets that enables features like gasless transactions, social recovery, and batched operations.

**Airdrop**: Free distribution of tokens to wallet addresses, usually to reward early users or build community.

**AMM (Automated Market Maker)**: DEX model using liquidity pools and mathematical formulas instead of order books. Examples: Uniswap, Camelot.

**APR (Annual Percentage Rate)**: Yearly return WITHOUT compounding.

**APY (Annual Percentage Yield)**: Yearly return WITH compounding. Always higher than equivalent APR.

**Arbitrage**: Profiting from price differences between markets. Key for maintaining stablecoin pegs (e.g., USDs mint/redeem arbitrage).

**Arbitrum**: Ethereum Layer 2 using optimistic rollups. Largest L2 by TVL. Home of Sperax (USDs, SPA, Farms).

## B

**Block**: A batch of transactions confirmed together. Ethereum: ~12 sec, Arbitrum: ~2 sec.

**Bridge**: Protocol for moving assets between blockchains. Examples: Stargate, Across, Hop.

**Buyback-and-Burn**: Protocol uses revenue to buy tokens on the market and permanently destroy them. Sperax uses 30% of USDs yield for SPA buyback-and-burn.

## C

**CDP (Collateralized Debt Position)**: Locking collateral to mint/borrow assets. Used by Maker (DAI) and Liquity (LUSD).

**CEX (Centralized Exchange)**: Traditional crypto exchange (Coinbase, Binance). Custodial — they hold your keys.

**Concentrated Liquidity**: V3-style LP where you choose a price range. Higher capital efficiency but higher impermanent loss risk.

**Composability**: The ability to combine DeFi protocols like building blocks. "DeFi Legos."

## D

**DAO (Decentralized Autonomous Organization)**: Community-governed organization using smart contracts and token voting.

**DCA (Dollar Cost Averaging)**: Investing fixed amounts at regular intervals to reduce timing risk.

**DeFi (Decentralized Finance)**: Financial services built on blockchain — lending, trading, yield farming without intermediaries.

**DEX (Decentralized Exchange)**: Exchange where trades execute via smart contracts. Non-custodial. Examples: Uniswap, Camelot.

**DEX Aggregator**: Tool that checks multiple DEXs for the best swap price. Examples: 1inch, Paraswap, 0x.

## E

**E-Mode (Efficiency Mode)**: Aave V3 feature allowing higher LTV for correlated asset pairs (like stablecoin-to-stablecoin).

**ERC-20**: Standard interface for fungible tokens on Ethereum.

**ERC-721**: Standard for non-fungible tokens (NFTs).

**ERC-8004**: Standard for on-chain AI agent identity, reputation, and validation. Created by Sperax. Deployed on 12 chains.

**EVM (Ethereum Virtual Machine)**: The execution environment for smart contracts. Used by Ethereum and compatible chains (Arbitrum, Base, Polygon, etc.).

## F

**Flash Loan**: Uncollateralized loan that must be borrowed and repaid in a single transaction. Used for arbitrage and liquidations.

**Frontrunning**: Placing a transaction ahead of another to profit from the price impact. A type of MEV.

## G

**Gas**: Fee paid to execute transactions on a blockchain. Paid in the native token (ETH for Ethereum/Arbitrum).

**Governance**: Decision-making process for protocol changes. Usually through token-weighted voting.

## H

**Health Factor**: In lending protocols, ratio of collateral value to debt. Below 1.0 = liquidatable.

**Honeypot**: Scam token you can buy but can't sell.

## I

**Impermanent Loss (IL)**: Value difference between holding tokens in an LP vs just holding. "Impermanent" because it reverses if prices return to original ratio.

## L

**Layer 1 (L1)**: Base blockchain (Ethereum, Bitcoin, Solana).

**Layer 2 (L2)**: Scaling solution built on top of L1. Types: Optimistic Rollups (Arbitrum, Optimism), ZK Rollups (zkSync, StarkNet).

**Liquidation**: When a borrower's collateral value drops below the required ratio and their position is forcibly closed.

**Liquidity**: How easily an asset can be traded without significant price impact.

**LTV (Loan-to-Value)**: Maximum borrowing power relative to collateral value.

## M

**MEV (Maximal Extractable Value)**: Profit extracted by reordering/inserting transactions. Includes sandwich attacks and frontrunning.

**Multisig**: Wallet requiring multiple signatures to execute transactions. Used for protocol treasuries and security.

## N

**NFT (Non-Fungible Token)**: Unique token representing ownership (art, agent identity via ERC-8004, LP positions in V3).

## O

**Oracle**: Service providing external data (prices) to smart contracts. Chainlink is the dominant provider.

**Over-Collateralized**: When collateral value exceeds the borrowed amount (e.g., 150% collateral for 100% loan).

## P

**Peg**: Target price for a stablecoin (usually $1 USD).

**Permit (EIP-2612)**: Gasless token approval via signed message instead of on-chain transaction.

**Pool**: Smart contract holding tokens for trading or lending.

## R

**Rebase**: Mechanism where token supply adjusts to distribute yield. USDs uses rebasing — your balance grows automatically.

**Rug Pull**: Scam where developers create a project, attract funds, and drain the liquidity.

## S

**Sandwich Attack**: MEV attack: buy before your swap (frontrun), your swap executes at worse price, sell after (backrun).

**Slippage**: Difference between expected and actual swap price.

**Smart Contract**: Self-executing code on a blockchain.

**Staking**: Locking tokens to earn rewards. SPA → veSPA staking earns protocol fees + xSPA.

## T

**TVL (Total Value Locked)**: Total value deposited in a DeFi protocol. Key adoption metric.

**Timelock**: Delay between governance vote passing and execution, giving users time to react.

**Token Approval**: Permission given to a smart contract to spend your tokens.

## U

**USDs**: Sperax's auto-yield stablecoin on Arbitrum. 100% collateralized by USDC/USDT. Yield distributed automatically via rebase.

**Utilization Rate**: In lending, ratio of borrowed to supplied assets. High utilization = high rates.

## V

**Vault**: Smart contract that automates a yield strategy. Examples: Yearn vaults, Beefy vaults.

**veToken (Vote-Escrowed)**: Governance model where locking tokens grants time-weighted voting power. veSPA = locked SPA.

**veSPA**: Vote-escrowed SPA. Lock SPA for 7d–4y. Earns protocol fees + xSPA rewards weekly.

## W

**Wallet**: Software/hardware storing private keys. Types: hot (MetaMask), cold (Ledger), smart contract (Safe).

**Whale**: Large token holder who can significantly impact price.

**Wrapped Token**: Token representation of another asset (WETH = wrapped ETH, WBTC = wrapped Bitcoin).

## X

**xSPA**: Reward token distributed to veSPA stakers. Can be staked (→ veSPA) or redeemed (→ 0.5–1.0 SPA over time).

## Y

**Yield Farming**: Providing liquidity or staking to earn token rewards.

**Yield Aggregator**: Protocol that automatically compounds yield (Yearn, Beefy).

## Links

- Sperax Ecosystem: https://chat.sperax.io
- Ethereum Docs: https://ethereum.org
- DeFi Llama: https://defillama.com
