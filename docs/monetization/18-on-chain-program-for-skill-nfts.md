# Prompt 18: On-Chain Program for Skill NFTs

## Objective
Design and outline the structure of a Solana program (smart contract) that represents ownership of a purchased skill as a Non-Fungible Token (NFT).

## Explanation
To fully embrace decentralization and give users true ownership, purchasing a skill should mint them an NFT that acts as an on-chain access key. This is a significant architectural step. The NFT would be tied to the user's wallet, the agent, and the specific skill. Our backend could then check for the presence of this NFT in a user's wallet as an alternative way to verify access. This prompt focuses on the design of the on-chain program using Anchor.

## Instructions
1.  **Define the Program's State:**
    *   What data needs to be stored on-chain?
    *   We'll need an account to represent the skill license. Let's call it `SkillLicense`.
    *   The `SkillLicense` account should store:
        *   `authority` (the user's wallet that owns it).
        *   `agent_mint` (the public key of an NFT representing the agent itself, for grouping).
        *   `skill_name` (a string identifying the skill).
        *   `purchase_date`.

2.  **Define the Program's Instructions:**
    *   What actions can users take?
    *   The primary instruction will be `mint_skill_license`.
    *   This instruction will be called by our backend (acting as a minter authority) after a payment is verified.
    *   It will create a new `SkillLicense` account and a corresponding NFT for the user.
    *   We might also need a `burn_skill_license` for refunds or transfers.

3.  **Set up an Anchor Project:**
    *   If not already present, set up a new Anchor project in the `/contracts` directory.
    *   Define the `SkillLicense` account struct in `lib.rs`.
    *   Define the `mint_skill_license` instruction handler.

## Anchor (Rust) Code Example (`contracts/src/lib.rs`)

```rust
use anchor_lang::prelude::*;
// We would also use anchor_spl::token for NFT minting

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod skill_marketplace {
    use super::*;
    pub fn mint_skill_license(
        ctx: Context<MintSkillLicense>, 
        skill_name: String
    ) -> Result<()> {
        let license = &mut ctx.accounts.skill_license;
        license.authority = *ctx.accounts.user.key;
        license.agent_id = *ctx.accounts.agent.key; // Simplified: agent is an account
        license.skill_name = skill_name;
        license.purchase_date = Clock::get()?.unix_timestamp;

        // Here, we would also add the logic to mint a Metaplex NFT
        // to the user's wallet, using this license account as a basis.
        // This is a complex step involving CPIs to the Token and Metaplex programs.

        msg!("Skill license created for skill: {}", license.skill_name);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct MintSkillLicense<'info> {
    #[account(init, payer = minter, space = 8 + 32 + 32 + 32 + 8)]
    pub skill_license: Account<'info, SkillLicense>,
    
    /// CHECK: The agent this skill belongs to
    pub agent: AccountInfo<'info>,
    
    /// CHECK: The user who is receiving the license
    #[account(mut)]
    pub user: Signer<'info>,

    // The backend's wallet, which has authority to mint licenses
    #[account(mut)]
    pub minter: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[account]
pub struct SkillLicense {
    pub authority: Pubkey, // User who owns the skill
    pub agent_id: Pubkey,  // Agent the skill is for
    pub skill_name: String,
    pub purchase_date: i64,
}
```
