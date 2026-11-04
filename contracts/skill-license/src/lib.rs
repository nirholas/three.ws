use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash as sha256;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::spl_token::instruction::AuthorityType;
use anchor_spl::token::{
    self, Burn, CloseAccount, FreezeAccount, Mint, MintTo, SetAuthority, Token, TokenAccount,
};

declare_id!("9rPHPFHmdek5WMH92HHtMuXsbeFBbvsetfbxuVZGsWoj");

/// Max accepted length (bytes) for `skill_name`. Bounds the `SkillLicense`
/// account size and the work spent hashing/recording the name.
const MAX_SKILL_NAME_LEN: usize = 64;

/// PDA seed for the singleton marketplace config.
const MARKETPLACE_SEED: &[u8] = b"marketplace";
/// PDA seed prefix for a per-(owner, agent, skill) license record.
const SKILL_LICENSE_SEED: &[u8] = b"skill_license";
/// PDA seed prefix for the 1/1 NFT mint that backs a license.
const SKILL_MINT_SEED: &[u8] = b"skill_mint";

/// SHA-256 of a skill name, used as the third PDA seed. A raw skill name can be
/// up to 64 bytes — longer than the 32-byte per-seed limit — so we hash it to a
/// fixed 32 bytes. Matches `crypto.createHash('sha256')` on the client, so both
/// sides derive the identical license/mint PDAs.
fn skill_seed(skill_name: &str) -> [u8; 32] {
    sha256(skill_name.as_bytes()).to_bytes()
}

#[program]
pub mod skill_license {
    use super::*;

    /// Create the singleton marketplace config. The signer becomes the admin
    /// `authority` (can rotate the minter); `minter` is the backend wallet
    /// authorized to mint licenses after a payment is verified off-chain.
    pub fn initialize_marketplace(ctx: Context<InitializeMarketplace>, minter: Pubkey) -> Result<()> {
        let marketplace = &mut ctx.accounts.marketplace;
        marketplace.authority = ctx.accounts.authority.key();
        marketplace.minter = minter;
        marketplace.licenses_minted = 0;
        marketplace.bump = ctx.bumps.marketplace;
        msg!("marketplace initialized; minter {}", minter);
        Ok(())
    }

    /// Rotate the authorized minter. Admin-only — used for key rotation if the
    /// backend minter wallet is ever compromised or replaced.
    pub fn set_minter(ctx: Context<SetMinter>, new_minter: Pubkey) -> Result<()> {
        ctx.accounts.marketplace.minter = new_minter;
        msg!("minter rotated to {}", new_minter);
        Ok(())
    }

    /// Mint a skill license to `owner`: create the canonical [`SkillLicense`]
    /// PDA and a real 1-of-1 SPL NFT held by the owner's associated token
    /// account, then permanently lock supply at 1. Backend-signed (`minter`),
    /// so a user cannot self-mint a free license — the on-chain access key only
    /// exists once payment has been verified.
    ///
    /// Deterministic: the license PDA, the NFT mint PDA, and the owner's ATA are
    /// all derived from `(owner, agent_mint, sha256(skill_name))`, so the same
    /// purchase can never mint two licenses (the second `init` fails).
    pub fn mint_skill_license(ctx: Context<MintSkillLicense>, skill_name: String) -> Result<()> {
        require!(!skill_name.is_empty(), SkillLicenseError::EmptySkillName);
        require!(
            skill_name.len() <= MAX_SKILL_NAME_LEN,
            SkillLicenseError::SkillNameTooLong
        );

        let marketplace_bump = ctx.accounts.marketplace.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[MARKETPLACE_SEED, &[marketplace_bump]]];

        // Issue the single token to the owner's ATA, signed by the marketplace PDA.
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.nft_mint.to_account_info(),
                    to: ctx.accounts.owner_token_account.to_account_info(),
                    authority: ctx.accounts.marketplace.to_account_info(),
                },
                signer_seeds,
            ),
            1,
        )?;

        // Permanently lock supply at 1 by removing the mint authority. Freeze
        // authority is intentionally retained by the marketplace so a license can
        // be revoked (frozen) on refund without the holder's signature.
        token::set_authority(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                SetAuthority {
                    current_authority: ctx.accounts.marketplace.to_account_info(),
                    account_or_mint: ctx.accounts.nft_mint.to_account_info(),
                },
                signer_seeds,
            ),
            AuthorityType::MintTokens,
            None,
        )?;

        let now = Clock::get()?.unix_timestamp;
        let license = &mut ctx.accounts.skill_license;
        license.authority = ctx.accounts.owner.key();
        license.agent_mint = ctx.accounts.agent_mint.key();
        license.nft_mint = ctx.accounts.nft_mint.key();
        license.skill_hash = skill_seed(&skill_name);
        license.purchase_date = now;
        license.revoked_at = 0;
        license.bump = ctx.bumps.skill_license;
        license.skill_name = skill_name.clone();

        let marketplace = &mut ctx.accounts.marketplace;
        marketplace.licenses_minted = marketplace
            .licenses_minted
            .checked_add(1)
            .ok_or(SkillLicenseError::Overflow)?;

        emit!(SkillLicenseMinted {
            license: ctx.accounts.skill_license.key(),
            owner: ctx.accounts.owner.key(),
            agent_mint: ctx.accounts.agent_mint.key(),
            nft_mint: ctx.accounts.nft_mint.key(),
            skill_name,
            purchase_date: now,
        });
        Ok(())
    }

    /// Burn a license the caller owns: burn the 1/1 NFT, close the empty token
    /// account, and close the [`SkillLicense`] PDA — reclaiming all rent to the
    /// owner. Used for holder-initiated disposal / pre-transfer teardown.
    pub fn burn_skill_license(ctx: Context<BurnSkillLicense>) -> Result<()> {
        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.nft_mint.to_account_info(),
                    from: ctx.accounts.owner_token_account.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            1,
        )?;

        token::close_account(CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.owner_token_account.to_account_info(),
                destination: ctx.accounts.authority.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
        ))?;

        emit!(SkillLicenseBurned {
            license: ctx.accounts.skill_license.key(),
            owner: ctx.accounts.authority.key(),
            nft_mint: ctx.accounts.nft_mint.key(),
        });
        Ok(())
    }

    /// Revoke a license on refund. Minter-only. Freezes the holder's token
    /// account (using the marketplace freeze authority retained at mint) so the
    /// NFT can no longer be transferred, and stamps `revoked_at`. The PDA is
    /// kept so off-chain verifiers can read the revoked state; the license is no
    /// longer access-bearing.
    pub fn revoke_skill_license(ctx: Context<RevokeSkillLicense>) -> Result<()> {
        require!(
            ctx.accounts.skill_license.revoked_at == 0,
            SkillLicenseError::AlreadyRevoked
        );

        let marketplace_bump = ctx.accounts.marketplace.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[MARKETPLACE_SEED, &[marketplace_bump]]];

        token::freeze_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            FreezeAccount {
                account: ctx.accounts.owner_token_account.to_account_info(),
                mint: ctx.accounts.nft_mint.to_account_info(),
                authority: ctx.accounts.marketplace.to_account_info(),
            },
            signer_seeds,
        ))?;

        let now = Clock::get()?.unix_timestamp;
        ctx.accounts.skill_license.revoked_at = now;

        emit!(SkillLicenseRevoked {
            license: ctx.accounts.skill_license.key(),
            owner: ctx.accounts.skill_license.authority,
            nft_mint: ctx.accounts.nft_mint.key(),
            revoked_at: now,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeMarketplace<'info> {
    #[account(
        init,
        payer = authority,
        space = Marketplace::SPACE,
        seeds = [MARKETPLACE_SEED],
        bump,
    )]
    pub marketplace: Account<'info, Marketplace>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetMinter<'info> {
    #[account(
        mut,
        seeds = [MARKETPLACE_SEED],
        bump = marketplace.bump,
        has_one = authority @ SkillLicenseError::UnauthorizedAdmin,
    )]
    pub marketplace: Account<'info, Marketplace>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(skill_name: String)]
pub struct MintSkillLicense<'info> {
    #[account(
        mut,
        seeds = [MARKETPLACE_SEED],
        bump = marketplace.bump,
    )]
    pub marketplace: Account<'info, Marketplace>,

    /// The authorized backend minter. Must equal `marketplace.minter`; pays rent
    /// + fees for the new accounts.
    #[account(
        mut,
        constraint = minter.key() == marketplace.minter @ SkillLicenseError::UnauthorizedMinter,
    )]
    pub minter: Signer<'info>,

    /// The license recipient. Does not sign — the backend mints on their behalf.
    /// CHECK: only its key is used, to own the ATA and as the license authority.
    pub owner: UncheckedAccount<'info>,

    /// The agent this skill belongs to (its on-chain identity / collection mint).
    /// CHECK: only its key is used, in the PDA seeds and recorded on the license.
    pub agent_mint: UncheckedAccount<'info>,

    #[account(
        init,
        payer = minter,
        space = SkillLicense::SPACE,
        seeds = [
            SKILL_LICENSE_SEED,
            owner.key().as_ref(),
            agent_mint.key().as_ref(),
            &skill_seed(&skill_name),
        ],
        bump,
    )]
    pub skill_license: Account<'info, SkillLicense>,

    #[account(
        init,
        payer = minter,
        seeds = [
            SKILL_MINT_SEED,
            owner.key().as_ref(),
            agent_mint.key().as_ref(),
            &skill_seed(&skill_name),
        ],
        bump,
        mint::decimals = 0,
        mint::authority = marketplace,
        mint::freeze_authority = marketplace,
    )]
    pub nft_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = minter,
        associated_token::mint = nft_mint,
        associated_token::authority = owner,
    )]
    pub owner_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct BurnSkillLicense<'info> {
    #[account(
        mut,
        close = authority,
        has_one = authority @ SkillLicenseError::NotLicenseOwner,
        seeds = [
            SKILL_LICENSE_SEED,
            authority.key().as_ref(),
            skill_license.agent_mint.as_ref(),
            skill_license.skill_hash.as_ref(),
        ],
        bump = skill_license.bump,
    )]
    pub skill_license: Account<'info, SkillLicense>,

    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut, address = skill_license.nft_mint @ SkillLicenseError::MintMismatch)]
    pub nft_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = nft_mint,
        associated_token::authority = authority,
    )]
    pub owner_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RevokeSkillLicense<'info> {
    #[account(
        seeds = [MARKETPLACE_SEED],
        bump = marketplace.bump,
    )]
    pub marketplace: Account<'info, Marketplace>,

    #[account(
        constraint = minter.key() == marketplace.minter @ SkillLicenseError::UnauthorizedMinter,
    )]
    pub minter: Signer<'info>,

    /// The license holder. CHECK: only its key is used, to locate the ATA and
    /// re-derive the license PDA; it does not sign a revocation.
    pub owner: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = skill_license.authority == owner.key() @ SkillLicenseError::NotLicenseOwner,
        seeds = [
            SKILL_LICENSE_SEED,
            owner.key().as_ref(),
            skill_license.agent_mint.as_ref(),
            skill_license.skill_hash.as_ref(),
        ],
        bump = skill_license.bump,
    )]
    pub skill_license: Account<'info, SkillLicense>,

    // Read-only for a freeze: only the holder's token account changes state.
    #[account(address = skill_license.nft_mint @ SkillLicenseError::MintMismatch)]
    pub nft_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = nft_mint,
        associated_token::authority = owner,
    )]
    pub owner_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/// Singleton config: the platform's admin + the wallet authorized to mint
/// licenses, and a lifetime counter of licenses issued.
#[account]
pub struct Marketplace {
    pub authority: Pubkey,
    pub minter: Pubkey,
    pub licenses_minted: u64,
    pub bump: u8,
}

impl Marketplace {
    // discriminator + authority + minter + licenses_minted + bump
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 1;
}

/// On-chain ownership record for one purchased skill. Its mere existence (with
/// `revoked_at == 0`) is the access key off-chain verifiers check.
#[account]
pub struct SkillLicense {
    /// Wallet that owns the license (and holds the NFT).
    pub authority: Pubkey,
    /// Agent the skill belongs to, for grouping.
    pub agent_mint: Pubkey,
    /// The 1/1 NFT mint that backs this license.
    pub nft_mint: Pubkey,
    /// SHA-256 of `skill_name`, the third PDA seed.
    pub skill_hash: [u8; 32],
    /// Unix seconds when the license was minted.
    pub purchase_date: i64,
    /// Unix seconds when revoked, or 0 while active.
    pub revoked_at: i64,
    /// PDA bump.
    pub bump: u8,
    /// Human-readable skill identifier (≤ 64 bytes).
    pub skill_name: String,
}

impl SkillLicense {
    // discriminator + authority + agent_mint + nft_mint + skill_hash
    //   + purchase_date + revoked_at + bump + (4-byte len prefix + max name).
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 32 + 8 + 8 + 1 + 4 + MAX_SKILL_NAME_LEN;
}

#[event]
pub struct SkillLicenseMinted {
    pub license: Pubkey,
    pub owner: Pubkey,
    pub agent_mint: Pubkey,
    pub nft_mint: Pubkey,
    pub skill_name: String,
    pub purchase_date: i64,
}

#[event]
pub struct SkillLicenseBurned {
    pub license: Pubkey,
    pub owner: Pubkey,
    pub nft_mint: Pubkey,
}

#[event]
pub struct SkillLicenseRevoked {
    pub license: Pubkey,
    pub owner: Pubkey,
    pub nft_mint: Pubkey,
    pub revoked_at: i64,
}

#[error_code]
pub enum SkillLicenseError {
    #[msg("skill_name must not be empty")]
    EmptySkillName,
    #[msg("skill_name exceeds the maximum allowed length")]
    SkillNameTooLong,
    #[msg("only the marketplace admin authority may perform this action")]
    UnauthorizedAdmin,
    #[msg("only the authorized minter may mint or revoke licenses")]
    UnauthorizedMinter,
    #[msg("signer is not the owner of this license")]
    NotLicenseOwner,
    #[msg("nft_mint does not match the one recorded on the license")]
    MintMismatch,
    #[msg("license is already revoked")]
    AlreadyRevoked,
    #[msg("arithmetic overflow")]
    Overflow,
}
