use anchor_lang::prelude::*;

declare_id!("FGFr3ueSCLjBTcqbXsvcuU6fihDEgNbUnmStCb2FtWPv");

/// Max accepted length (bytes) for `skill_name`, bounding the size of the
/// emitted event and the compute spent formatting it.
const MAX_SKILL_NAME_LEN: usize = 64;
/// Max accepted length (bytes) for the `parameters` blob.
const MAX_PARAMETERS_LEN: usize = 512;

/// PDA seed prefix that ties an agent identity account to this program. An
/// agent PDA is derived as [`AGENT_SEED`, authority] so it is impossible to
/// pass an arbitrary, attacker-chosen account in its place.
const AGENT_SEED: &[u8] = b"agent";

#[program]
pub mod agent_invocation {
    use super::*;

    /// Record a skill invocation from one agent to another.
    ///
    /// This instruction is intentionally non-trust-bearing: it does NOT move
    /// funds or grant any capability. Its only effect is to validate the caller
    /// and emit a verifiable [`SkillInvoked`] event that off-chain services can
    /// consume. All trust-bearing checks are enforced by Anchor constraints on
    /// [`InvokeSkill`] before this body runs:
    ///
    /// * `invoker_authority` must be a transaction signer (`Signer`).
    /// * `invoker_agent` must be the program-derived address for that authority
    ///   (`seeds = [AGENT_SEED, invoker_authority]`, `bump`), so the caller can
    ///   only ever act as their own agent identity.
    /// * `target_agent` must be a valid agent PDA owned by this program
    ///   (`seeds = [AGENT_SEED, target_authority]`, `bump`).
    ///
    /// Because both agent accounts are constrained PDAs rather than raw
    /// `AccountInfo`, no future caller can substitute an unchecked account and
    /// have downstream logic trust it.
    pub fn invoke_skill(
        ctx: Context<InvokeSkill>,
        skill_name: String,
        parameters: String,
    ) -> Result<()> {
        require!(!skill_name.is_empty(), InvocationError::EmptySkillName);
        require!(
            skill_name.len() <= MAX_SKILL_NAME_LEN,
            InvocationError::SkillNameTooLong
        );
        require!(
            parameters.len() <= MAX_PARAMETERS_LEN,
            InvocationError::ParametersTooLong
        );

        let invoker_agent = ctx.accounts.invoker_agent.key();
        let target_agent = ctx.accounts.target_agent.key();

        msg!(
            "agent {} invoked skill '{}' on agent {}",
            invoker_agent,
            skill_name,
            target_agent
        );

        emit!(SkillInvoked {
            invoker_agent,
            target_agent,
            invoker_authority: ctx.accounts.invoker_authority.key(),
            skill_name,
            parameters,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(skill_name: String, parameters: String)]
pub struct InvokeSkill<'info> {
    /// The invoking agent's program-derived identity. Constrained to the PDA
    /// for `invoker_authority`, binding the on-chain agent to the signer.
    /// CHECK: validated by the `seeds`/`bump` PDA constraint against this
    /// program; never read or written, only its key is recorded.
    #[account(
        seeds = [AGENT_SEED, invoker_authority.key().as_ref()],
        bump,
    )]
    pub invoker_agent: UncheckedAccount<'info>,

    /// The authority controlling `invoker_agent`. Must sign the transaction, so
    /// the caller can only invoke as the agent identity they own.
    pub invoker_authority: Signer<'info>,

    /// The authority that owns the target agent. Supplied so the target agent
    /// PDA can be re-derived and verified; it does not need to sign.
    /// CHECK: only its public key is used to derive `target_agent`'s PDA.
    pub target_authority: UncheckedAccount<'info>,

    /// The target agent's program-derived identity. Constrained to the PDA for
    /// `target_authority`, so an arbitrary account cannot be passed as a target.
    /// CHECK: validated by the `seeds`/`bump` PDA constraint against this
    /// program; never read or written, only its key is recorded.
    #[account(
        seeds = [AGENT_SEED, target_authority.key().as_ref()],
        bump,
    )]
    pub target_agent: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[event]
pub struct SkillInvoked {
    pub invoker_agent: Pubkey,
    pub target_agent: Pubkey,
    pub invoker_authority: Pubkey,
    pub skill_name: String,
    pub parameters: String,
    pub timestamp: i64,
}

#[error_code]
pub enum InvocationError {
    #[msg("skill_name must not be empty")]
    EmptySkillName,
    #[msg("skill_name exceeds the maximum allowed length")]
    SkillNameTooLong,
    #[msg("parameters exceed the maximum allowed length")]
    ParametersTooLong,
}
