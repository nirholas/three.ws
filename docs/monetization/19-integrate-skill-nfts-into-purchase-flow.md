# Prompt 19: Integrate Skill NFTs into Purchase Flow

## Objective
Modify the skill purchase and verification flow to mint a "Skill NFT" to the user upon a successful purchase, using the on-chain program designed in the previous prompt.

## Explanation
This task connects our off-chain backend with our on-chain program. After a user's payment is confirmed, instead of just writing to our own database, the backend's primary job will be to call the `mint_skill_license` instruction on our Solana program. This creates a durable, on-chain record of ownership for the user.

## Instructions
1.  **Update Verification Endpoint:**
    *   In the `/api/marketplace/skills/verify-purchase` endpoint, after successfully verifying the user's payment transaction, add a new step.

2.  **Call the On-Chain Program:**
    *   The backend, using its own service wallet (the "minter"), will construct and sign a transaction that calls the `mint_skill_license` instruction of our deployed Solana program.
    *   It will need the Anchor-generated client library for the program to build this transaction easily.
    *   The parameters for the instruction (`user`, `agent`, `skill_name`) will come from the context of the purchase.

3.  **Update Access Control:**
    *   Modify the `hasSkillAccess` helper function from prompt #17.
    *   Add a new check: after checking the local database, if access is still denied, the function should query the blockchain to see if the user's wallet holds the required Skill NFT for that agent and skill. This makes the system more decentralized, as ownership can be proven directly on-chain.

## Code Example (Backend Snippet in `verify-purchase.js`)

```javascript
import { AnchorProvider, Program } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
// Assume `idl` and `programId` are available for our Anchor program
import idl from '../../../../contracts/target/idl/skill_marketplace.json';
const programId = new PublicKey(idl.metadata.address);

// ... inside the verify-purchase handler, after payment is confirmed ...

// 1. Set up connection to the on-chain program
const connection = new Connection(clusterApiUrl('devnet'));
const backendMinterWallet = Keypair.fromSecretKey(Buffer.from(process.env.MINTER_PRIVATE_KEY, 'base64'));
const provider = new AnchorProvider(connection, new Wallet(backendMinterWallet), {});
const program = new Program(idl, programId, provider);

// 2. Prepare accounts for the instruction
const skillLicenseAccount = Keypair.generate();
const userPublicKey = new PublicKey(purchaserPublicKey); // from original request
const agentPublicKey = new PublicKey(agent.on_chain_id); // Assuming agent has an on-chain ID

try {
    // 3. Call the 'mint_skill_license' instruction
    const txSignature = await program.methods
        .mintSkillLicense(skillName)
        .accounts({
            skillLicense: skillLicenseAccount.publicKey,
            agent: agentPublicKey,
            user: userPublicKey,
            minter: backendMinterWallet.publicKey,
            systemProgram: SystemProgram.programId,
        })
        .signers([skillLicenseAccount, backendMinterWallet]) // Minter and new account need to sign
        .rpc();
        
    console.log(`Successfully minted Skill NFT. Transaction: ${txSignature}`);

    // We might still write to our local DB for caching/performance,
    // but the on-chain record is now the source of truth.
    await recordPurchaseInLocalDB(userId, agentId, skillName, txSignature);

    return json(res, { success: true, message: 'Skill NFT minted!' });

} catch (e) {
    console.error("Failed to mint skill NFT:", e);
    // Important: Handle this failure, maybe by retrying or refunding the user.
    return error(res, 500, 'Failed to mint on-chain license.');
}
```
