---
status: not-started
---

# Prompt 23: On-Chain Royalties for Skills

## Objective
Use an NFT-based approach to represent skill ownership, enabling on-chain royalties for creators.

## Explanation
This is a more decentralized and advanced approach to monetization. Each purchased skill could be represented as an NFT in the user's wallet. The NFT's metadata would grant access to the skill, and royalties could be enforced at the smart contract level.

## Instructions
1.  **Smart Contract Development:**
    *   Develop a smart contract (e.g., using Anchor for Solana) that can mint "Skill NFTs".
    *   The contract would handle the logic for purchasing and transferring these NFTs.
    *   Implement the Metaplex protocol for on-chain royalties, so that every time a Skill NFT is resold on a secondary market, the original creator gets a percentage.

2.  **Frontend Integration:**
    *   The frontend would interact with this smart contract instead of a traditional backend API for purchases.

3.  **Access Control:**
    *   The access control middleware would check the user's wallet for the presence of the required Skill NFT.
