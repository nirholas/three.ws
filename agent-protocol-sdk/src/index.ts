import {
    Connection,
    PublicKey,
    SystemProgram,
    Transaction,
    sendAndConfirmTransaction,
    Keypair
} from '@solana/web3.js';
import { Program, AnchorProvider, web3 } from '@coral-xyz/anchor';
import { IDL, AgentInvocation } from './idl'; // Assumes IDL is generated and placed here

const PROGRAM_ID = new PublicKey("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

/**
 * Invokes a skill on a target agent.
 *
 * @param connection The Solana connection object.
 * @param invokerAuthority The keypair of the wallet authorized to invoke the skill.
 * @param invokerAgent The public key of the agent performing the invocation.
 * @param targetAgent The public key of the agent whose skill is being invoked.
 * @param skillName The name of the skill to invoke.
 * @param parameters A JSON string of parameters for the skill.
 * @returns The transaction signature.
 */
export async function invokeSkill(
    connection: Connection,
    invokerAuthority: Keypair,
    invokerAgent: PublicKey,
    targetAgent: PublicKey,
    skillName: string,
    parameters: string
): Promise<string> {

    const provider = new AnchorProvider(connection, { signTransaction: invokerAuthority.signTransaction, signAllTransactions: invokerAuthority.signAllTransactions, publicKey: invokerAuthority.publicKey }, {});
    const program = new Program<AgentInvocation>(IDL, PROGRAM_ID, provider);

    const tx = await program.methods
        .invokeSkill(skillName, parameters)
        .accounts({
            invokerAgent,
            targetAgent,
            invokerAuthority: invokerAuthority.publicKey,
            systemProgram: SystemProgram.programId,
        })
        .transaction();

    return await sendAndConfirmTransaction(connection, tx, [invokerAuthority]);
}

// NOTE: We also need the IDL file for the contract. This is typically generated
// by Anchor. For now, I will create a placeholder.
