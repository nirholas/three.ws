use anchor_lang::prelude::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod agent_invocation {
    use super::*;
    pub fn invoke_skill(ctx: Context<InvokeSkill>, skill_name: String, parameters: String) -> Result<()> {
        msg!("Agent {} invoked skill '{}' on agent {} with parameters: {}", 
            ctx.accounts.invoker_agent.key(), 
            skill_name, 
            ctx.accounts.target_agent.key(), 
            parameters);
            
        // In a full implementation, this would:
        // 1. Verify the invoker has the right to call the skill (e.g., holds a specific NFT).
        // 2. Look up the skill price from on-chain data.
        // 3. Transfer the required payment from the invoker's wallet to the target's wallet.
        // 4. Emit an event with the invocation details for off-chain services to process.

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InvokeSkill<'info> {
    /// CHECK: This is the agent performing the invocation
    pub invoker_agent: AccountInfo<'info>,
    /// CHECK: This is the agent whose skill is being invoked
    pub target_agent: AccountInfo<'info>,
    /// CHECK: The user or authority wallet for the invoker
    #[account(signer)]
    pub invoker_authority: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}
