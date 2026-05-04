// api/payments/prepare-skill-purchase.js
import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferInstruction } from '@solana/spl-token';
// These are placeholders for DB functions we will create in later prompts.
// import { findCreatorPayoutWallet, findSkillPrice } from '../_lib/db'; 

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7u6d');
// You will need to replace this with your actual platform wallet address.
const PLATFORM_WALLET = new PublicKey('YourPlatformWalletAddressHere'); 

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        // In a real application, you would get the authenticated user's public key.
        // For now, we'll use a placeholder.
        const buyerPublicKey = new PublicKey('BUYER_PUBLIC_KEY_HERE'); 

        const { agentId, skillName } = req.body;
        if (!agentId || !skillName) {
            return res.status(400).json({ error: 'agentId and skillName are required' });
        }

        // These functions will be implemented in a later prompt.
        // For now, we'll use mock data.
        const priceInfo = { amount: 1000000 }; // 1 USDC in lamports
        const creatorPayoutWallet = 'CREATOR_WALLET_ADDRESS_HERE';

        if (!priceInfo) {
            return res.status(404).json({ error: 'Skill or price not found' });
        }

        if (!creatorPayoutWallet) {
            return res.status(500).json({ error: 'Creator payout wallet not configured' });
        }

        const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
        const { blockhash } = await connection.getLatestBlockhash();

        const transaction = new Transaction({
            recentBlockhash: blockhash,
            feePayer: buyerPublicKey,
        });

        const buyerUsdcAddress = await getAssociatedTokenAddress(USDC_MINT, buyerPublicKey);
        const creatorUsdcAddress = await getAssociatedTokenAddress(USDC_MINT, new PublicKey(creatorPayoutWallet));

        // Assuming a 5% platform fee
        const platformFee = Math.floor(priceInfo.amount * 0.05);
        const creatorAmount = priceInfo.amount - platformFee;
        
        // Transfer to creator
        transaction.add(
            createTransferInstruction(
                buyerUsdcAddress,
                creatorUsdcAddress,
                buyerPublicKey,
                creatorAmount
            )
        );

        // Transfer to platform
        const platformUsdcAddress = await getAssociatedTokenAddress(USDC_MINT, PLATFORM_WALLET);
        transaction.add(
            createTransferInstruction(
                buyerUsdcAddress,
                platformUsdcAddress,
                buyerPublicKey,
                platformFee
            )
        );

        const serializedTransaction = transaction.serialize({ requireAllSignatures: false });

        res.status(200).json({
            transaction: serializedTransaction.toString('base64'),
            message: `Purchase skill "${skillName}" for ${(priceInfo.amount / 1e6).toFixed(2)} USDC`,
            label: 'three.ws Agent Skill',
        });

    } catch (error) {
        console.error('Error preparing skill purchase:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}
