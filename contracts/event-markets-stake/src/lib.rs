//! Event Markets staking: a parimutuel pool per market.
//!
//! Stakers back one outcome with a single SPL token (classic or Token-2022).
//! When the platform resolver names the winner, the fee is taken once from the
//! whole pool and the remainder is shared between the winning stakers in
//! proportion to their stake. There is no counterparty, no market maker and no
//! price curve: the payout for a stake is
//!
//!   floor(stake * (total_staked - fee) / winning_total)
//!
//! with `fee = floor(total_staked * fee_bps / 10_000)`. The same integer
//! arithmetic is mirrored in `api/_lib/event-markets/staking/math.js`, and the
//! tests assert the two agree to the base unit.
//!
//! Money paths and who may trigger them:
//!
//!   - `stake`: the staker, before the lock, while the platform is not paused.
//!   - `resolve`: the resolver only, after the lock and before `void_after_ts`.
//!   - `claim`: the winning staker, after `resolve`.
//!   - `refund`: the staker, once the pool is void.
//!   - `void_pool`: the resolver, any time before resolution.
//!   - `void_expired`: anyone, once `void_after_ts` has passed unresolved. This
//!     is the guarantee that a lost resolver key can never trap funds.
//!
//! A pool is void (everyone refunded in full, no fee) when the resolver voids
//! it, when it expires unresolved, when nobody staked the winning outcome, or
//! when every unit was staked on the winner (no contest: there is nobody to win
//! from). The pause flag stops new pools and new stakes only; `claim`, `refund`
//! and `void_expired` are never gated by it.
//!
//! The config authority can retune the fee and destinations for pools created
//! afterwards. Pools snapshot fee, split and destinations at creation, so
//! nobody can reprice or redirect money that is already staked.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    self, Mint, TokenAccount, TokenInterface, TransferChecked,
};

declare_id!("6EHBAEEFZ9J8EUq9gLA6x1Kpbaanfvz55YSy9FiYs9W1");

const CONFIG_SEED: &[u8] = b"config";
const POOL_SEED: &[u8] = b"pool";
const POSITION_SEED: &[u8] = b"position";

/// Most outcomes one pool can carry.
pub const MAX_OUTCOMES: usize = 16;
/// Hard ceiling on the fee, in basis points (10%). Enforced in code so the worst
/// an authority can do is bounded by something a reader can check here.
pub const MAX_FEE_BPS: u16 = 1_000;
const BPS: u128 = 10_000;

pub const STATUS_OPEN: u8 = 0;
pub const STATUS_RESOLVED: u8 = 1;
pub const STATUS_VOID: u8 = 2;

#[program]
pub mod event_markets_stake {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        resolver: Pubkey,
        treasury: Pubkey,
        buyback: Pubkey,
        fee_bps: u16,
        buyback_share_bps: u16,
    ) -> Result<()> {
        require!(fee_bps <= MAX_FEE_BPS, StakeError::FeeTooHigh);
        require!(buyback_share_bps as u128 <= BPS, StakeError::BadSplit);
        let c = &mut ctx.accounts.config;
        c.authority = ctx.accounts.authority.key();
        c.resolver = resolver;
        c.treasury = treasury;
        c.buyback = buyback;
        c.fee_bps = fee_bps;
        c.buyback_share_bps = buyback_share_bps;
        c.paused = false;
        c.bump = ctx.bumps.config;
        Ok(())
    }

    /// Retune the protocol. `paused` is the kill switch for new stakes.
    pub fn set_config(
        ctx: Context<SetConfig>,
        resolver: Option<Pubkey>,
        treasury: Option<Pubkey>,
        buyback: Option<Pubkey>,
        fee_bps: Option<u16>,
        buyback_share_bps: Option<u16>,
        paused: Option<bool>,
        authority: Option<Pubkey>,
    ) -> Result<()> {
        let c = &mut ctx.accounts.config;
        if let Some(v) = resolver { c.resolver = v; }
        if let Some(v) = treasury { c.treasury = v; }
        if let Some(v) = buyback { c.buyback = v; }
        if let Some(v) = fee_bps {
            require!(v <= MAX_FEE_BPS, StakeError::FeeTooHigh);
            c.fee_bps = v;
        }
        if let Some(v) = buyback_share_bps {
            require!(v as u128 <= BPS, StakeError::BadSplit);
            c.buyback_share_bps = v;
        }
        if let Some(v) = paused { c.paused = v; }
        if let Some(v) = authority { c.authority = v; }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_pool(
        ctx: Context<CreatePool>,
        pool_id: [u8; 32],
        outcome_count: u8,
        min_stake: u64,
        max_stake: u64,
        max_pool: u64,
        lock_ts: i64,
        void_after_ts: i64,
    ) -> Result<()> {
        let cfg = &ctx.accounts.config;
        require!(!cfg.paused, StakeError::Paused);
        require!(
            (2..=MAX_OUTCOMES as u8).contains(&outcome_count),
            StakeError::BadOutcomeCount
        );
        require!(min_stake > 0 && min_stake <= max_stake, StakeError::BadLimits);
        require!(max_stake <= max_pool, StakeError::BadLimits);
        let now = Clock::get()?.unix_timestamp;
        require!(lock_ts > now, StakeError::BadTimes);
        require!(void_after_ts > lock_ts, StakeError::BadTimes);

        let p = &mut ctx.accounts.pool;
        p.pool_id = pool_id;
        p.mint = ctx.accounts.mint.key();
        p.outcome_count = outcome_count;
        p.fee_bps = cfg.fee_bps;
        p.buyback_share_bps = cfg.buyback_share_bps;
        p.treasury = cfg.treasury;
        p.buyback = cfg.buyback;
        p.min_stake = min_stake;
        p.max_stake = max_stake;
        p.max_pool = max_pool;
        p.lock_ts = lock_ts;
        p.void_after_ts = void_after_ts;
        p.status = STATUS_OPEN;
        p.winning_outcome = 0;
        p.totals = [0; MAX_OUTCOMES];
        p.total_staked = 0;
        p.fee_paid = 0;
        p.paid_out = 0;
        p.bump = ctx.bumps.pool;
        emit!(PoolCreated { pool: p.key(), pool_id, mint: p.mint, lock_ts, void_after_ts });
        Ok(())
    }

    pub fn stake(ctx: Context<Stake>, outcome: u8, amount: u64) -> Result<()> {
        require!(!ctx.accounts.config.paused, StakeError::Paused);
        let now = Clock::get()?.unix_timestamp;
        let pool = &mut ctx.accounts.pool;
        require!(pool.status == STATUS_OPEN, StakeError::NotOpen);
        require!(now < pool.lock_ts, StakeError::Locked);
        require!(outcome < pool.outcome_count, StakeError::BadOutcome);
        require!(amount >= pool.min_stake, StakeError::BelowMinimum);

        let pos = &mut ctx.accounts.position;
        if pos.amount == 0 {
            pos.pool = pool.key();
            pos.owner = ctx.accounts.staker.key();
            pos.outcome = outcome;
            pos.bump = ctx.bumps.position;
        } else {
            require!(pos.outcome == outcome, StakeError::OutcomeMismatch);
        }
        let new_pos = pos.amount.checked_add(amount).ok_or(StakeError::Overflow)?;
        require!(new_pos <= pool.max_stake, StakeError::OverStakeCap);
        let new_total = pool.total_staked.checked_add(amount).ok_or(StakeError::Overflow)?;
        require!(new_total <= pool.max_pool, StakeError::OverPoolCap);

        pos.amount = new_pos;
        pool.total_staked = new_total;
        let o = outcome as usize;
        pool.totals[o] = pool.totals[o].checked_add(amount).ok_or(StakeError::Overflow)?;

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.staker_tokens.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.staker.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        emit!(Staked { pool: pool.key(), staker: pos.owner, outcome, amount, position_total: new_pos });
        Ok(())
    }

    /// Close staking now. Only ever moves the lock earlier.
    pub fn lock(ctx: Context<ResolverAction>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let pool = &mut ctx.accounts.pool;
        require!(pool.status == STATUS_OPEN, StakeError::NotOpen);
        if now < pool.lock_ts {
            pool.lock_ts = now;
        }
        emit!(PoolLocked { pool: pool.key(), lock_ts: pool.lock_ts });
        Ok(())
    }

    pub fn resolve(ctx: Context<Resolve>, winning_outcome: u8) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let pool = &mut ctx.accounts.pool;
        require!(pool.status == STATUS_OPEN, StakeError::NotOpen);
        require!(now >= pool.lock_ts, StakeError::NotLocked);
        require!(now < pool.void_after_ts, StakeError::Expired);
        require!(winning_outcome < pool.outcome_count, StakeError::BadOutcome);

        let w = pool.totals[winning_outcome as usize];
        // Nobody backed the winner, or nobody backed anything else: there is
        // no losing side to pay from, so refund everyone in full.
        if w == 0 || w == pool.total_staked {
            pool.status = STATUS_VOID;
            emit!(PoolVoided { pool: pool.key(), reason: if w == 0 { 1 } else { 2 } });
            return Ok(());
        }

        let (fee, buyback, treasury) =
            split_fee(pool.total_staked, pool.fee_bps, pool.buyback_share_bps);
        pool.status = STATUS_RESOLVED;
        pool.winning_outcome = winning_outcome;
        pool.fee_paid = fee;

        let pool_id = pool.pool_id;
        let bump = [pool.bump];
        let seeds: &[&[u8]] = &[POOL_SEED, pool_id.as_ref(), &bump];
        let signer = &[seeds];
        for (amount, to) in [
            (treasury, ctx.accounts.treasury_tokens.to_account_info()),
            (buyback, ctx.accounts.buyback_tokens.to_account_info()),
        ] {
            if amount == 0 { continue; }
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.vault.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                        to,
                        authority: pool.to_account_info(),
                    },
                    signer,
                ),
                amount,
                ctx.accounts.mint.decimals,
            )?;
        }
        emit!(PoolResolved { pool: pool.key(), winning_outcome, fee, buyback, treasury });
        Ok(())
    }

    pub fn void_pool(ctx: Context<ResolverAction>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        require!(pool.status == STATUS_OPEN, StakeError::NotOpen);
        pool.status = STATUS_VOID;
        emit!(PoolVoided { pool: pool.key(), reason: 0 });
        Ok(())
    }

    /// Permissionless safety net for a pool nobody resolved in time.
    pub fn void_expired(ctx: Context<VoidExpired>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let pool = &mut ctx.accounts.pool;
        require!(pool.status == STATUS_OPEN, StakeError::NotOpen);
        require!(now >= pool.void_after_ts, StakeError::NotExpired);
        pool.status = STATUS_VOID;
        emit!(PoolVoided { pool: pool.key(), reason: 3 });
        Ok(())
    }

    pub fn claim(ctx: Context<Payout>) -> Result<()> {
        let pool_key = ctx.accounts.pool.key();
        let owner = ctx.accounts.position.owner;
        let payout = {
            let pool = &mut ctx.accounts.pool;
            let pos = &ctx.accounts.position;
            require!(pool.status == STATUS_RESOLVED, StakeError::NotResolved);
            require!(pos.outcome == pool.winning_outcome, StakeError::NotWinner);
            let payout = payout_for(
                pos.amount,
                pool.total_staked,
                pool.fee_paid,
                pool.totals[pool.winning_outcome as usize],
            );
            pool.paid_out = pool.paid_out.checked_add(payout).ok_or(StakeError::Overflow)?;
            payout
        };
        pay_from_vault(&ctx, payout)?;
        emit!(Claimed { pool: pool_key, staker: owner, payout });
        Ok(())
    }

    pub fn refund(ctx: Context<Payout>) -> Result<()> {
        let pool_key = ctx.accounts.pool.key();
        let amount = ctx.accounts.position.amount;
        {
            let pool = &mut ctx.accounts.pool;
            require!(pool.status == STATUS_VOID, StakeError::NotVoid);
            pool.paid_out = pool.paid_out.checked_add(amount).ok_or(StakeError::Overflow)?;
        }
        pay_from_vault(&ctx, amount)?;
        emit!(Refunded { pool: pool_key, staker: ctx.accounts.position.owner, amount });
        Ok(())
    }
}

/// `(fee, buyback, treasury)` for a pool total. Mirrored in `math.js`.
pub fn split_fee(total: u64, fee_bps: u16, buyback_share_bps: u16) -> (u64, u64, u64) {
    let fee = (total as u128 * fee_bps as u128 / BPS) as u64;
    let buyback = (fee as u128 * buyback_share_bps as u128 / BPS) as u64;
    (fee, buyback, fee - buyback)
}

/// Winner payout: floor(stake * (total - fee) / winning_total).
pub fn payout_for(stake: u64, total: u64, fee: u64, winning_total: u64) -> u64 {
    (stake as u128 * (total - fee) as u128 / winning_total as u128) as u64
}

fn pay_from_vault(ctx: &Context<Payout>, amount: u64) -> Result<()> {
    if amount == 0 { return Ok(()); }
    let pool = &ctx.accounts.pool;
    let bump = [pool.bump];
    let seeds: &[&[u8]] = &[POOL_SEED, pool.pool_id.as_ref(), &bump];
    let signer = &[seeds];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.owner_tokens.to_account_info(),
                authority: pool.to_account_info(),
            },
            signer,
        ),
        amount,
        ctx.accounts.mint.decimals,
    )
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub resolver: Pubkey,
    pub treasury: Pubkey,
    pub buyback: Pubkey,
    pub fee_bps: u16,
    pub buyback_share_bps: u16,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub pool_id: [u8; 32],
    pub mint: Pubkey,
    pub treasury: Pubkey,
    pub buyback: Pubkey,
    pub min_stake: u64,
    pub max_stake: u64,
    pub max_pool: u64,
    pub lock_ts: i64,
    pub void_after_ts: i64,
    pub total_staked: u64,
    pub fee_paid: u64,
    pub paid_out: u64,
    pub totals: [u64; MAX_OUTCOMES],
    pub fee_bps: u16,
    pub buyback_share_bps: u16,
    pub outcome_count: u8,
    pub status: u8,
    pub winning_outcome: u8,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub pool: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub outcome: u8,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetConfig<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = authority @ StakeError::Unauthorized)]
    pub config: Account<'info, Config>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(pool_id: [u8; 32])]
pub struct CreatePool<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init, payer = resolver, space = 8 + Pool::INIT_SPACE,
        seeds = [POOL_SEED, pool_id.as_ref()], bump
    )]
    pub pool: Account<'info, Pool>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init, payer = resolver,
        associated_token::mint = mint,
        associated_token::authority = pool,
        associated_token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, address = config.resolver @ StakeError::Unauthorized)]
    pub resolver: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [POOL_SEED, pool.pool_id.as_ref()], bump = pool.bump, has_one = mint)]
    pub pool: Account<'info, Pool>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = pool,
        associated_token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init_if_needed, payer = staker, space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, pool.key().as_ref(), staker.key().as_ref()], bump
    )]
    pub position: Account<'info, Position>,
    #[account(mut, token::mint = mint, token::authority = staker, token::token_program = token_program)]
    pub staker_tokens: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub staker: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResolverAction<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [POOL_SEED, pool.pool_id.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(address = config.resolver @ StakeError::Unauthorized)]
    pub resolver: Signer<'info>,
}

#[derive(Accounts)]
pub struct Resolve<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [POOL_SEED, pool.pool_id.as_ref()], bump = pool.bump, has_one = mint)]
    pub pool: Account<'info, Pool>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = pool,
        associated_token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = pool.treasury, token::token_program = token_program)]
    pub treasury_tokens: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = pool.buyback, token::token_program = token_program)]
    pub buyback_tokens: InterfaceAccount<'info, TokenAccount>,
    #[account(address = config.resolver @ StakeError::Unauthorized)]
    pub resolver: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct VoidExpired<'info> {
    #[account(mut, seeds = [POOL_SEED, pool.pool_id.as_ref()], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
}

#[derive(Accounts)]
pub struct Payout<'info> {
    #[account(mut, seeds = [POOL_SEED, pool.pool_id.as_ref()], bump = pool.bump, has_one = mint)]
    pub pool: Account<'info, Pool>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = pool,
        associated_token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut, close = owner,
        seeds = [POSITION_SEED, pool.key().as_ref(), owner.key().as_ref()], bump = position.bump,
        has_one = owner
    )]
    pub position: Account<'info, Position>,
    #[account(mut, token::mint = mint, token::authority = owner, token::token_program = token_program)]
    pub owner_tokens: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[event]
pub struct PoolCreated { pub pool: Pubkey, pub pool_id: [u8; 32], pub mint: Pubkey, pub lock_ts: i64, pub void_after_ts: i64 }
#[event]
pub struct Staked { pub pool: Pubkey, pub staker: Pubkey, pub outcome: u8, pub amount: u64, pub position_total: u64 }
#[event]
pub struct PoolLocked { pub pool: Pubkey, pub lock_ts: i64 }
#[event]
pub struct PoolResolved { pub pool: Pubkey, pub winning_outcome: u8, pub fee: u64, pub buyback: u64, pub treasury: u64 }
/// reason: 0 resolver, 1 nobody picked the winner, 2 no contest, 3 expired.
#[event]
pub struct PoolVoided { pub pool: Pubkey, pub reason: u8 }
#[event]
pub struct Claimed { pub pool: Pubkey, pub staker: Pubkey, pub payout: u64 }
#[event]
pub struct Refunded { pub pool: Pubkey, pub staker: Pubkey, pub amount: u64 }

#[error_code]
pub enum StakeError {
    #[msg("Fee exceeds the 10% ceiling")]
    FeeTooHigh,
    #[msg("Buyback share must be 0 to 10000 bps")]
    BadSplit,
    #[msg("Staking is paused")]
    Paused,
    #[msg("A pool needs 2 to 16 outcomes")]
    BadOutcomeCount,
    #[msg("Stake limits are inconsistent")]
    BadLimits,
    #[msg("Lock and void times are inconsistent")]
    BadTimes,
    #[msg("Pool is not open")]
    NotOpen,
    #[msg("Pool is locked")]
    Locked,
    #[msg("Pool is not locked yet")]
    NotLocked,
    #[msg("Pool passed its void deadline")]
    Expired,
    #[msg("Pool has not reached its void deadline")]
    NotExpired,
    #[msg("Outcome index out of range")]
    BadOutcome,
    #[msg("Stake is below the pool minimum")]
    BelowMinimum,
    #[msg("A position can back only one outcome")]
    OutcomeMismatch,
    #[msg("Stake would exceed the per-account cap")]
    OverStakeCap,
    #[msg("Stake would exceed the pool cap")]
    OverPoolCap,
    #[msg("Pool is not resolved")]
    NotResolved,
    #[msg("Pool is not void")]
    NotVoid,
    #[msg("Position did not back the winning outcome")]
    NotWinner,
    #[msg("Signer is not authorised")]
    Unauthorized,
    #[msg("Arithmetic overflow")]
    Overflow,
}
