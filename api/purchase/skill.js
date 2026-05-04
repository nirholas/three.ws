import { Keypair, Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { findReference, FindReferenceError } from '@solana/pay';
import { db } from '../_lib/db'; // Your database utility

// The GET handler is called by wallets to get transaction details
async function get(req, res) {
  const { agent_id, skill_name } = req.query;

  // 1. Fetch price and creator wallet from DB
  const priceInfo = await db.one(
    `SELECT p.amount, p.currency_mint, a.owner_id
     FROM agent_skill_prices p
     JOIN agents a ON p.agent_id = a.id
     WHERE p.agent_id = $1 AND p.skill_name = $2`,
    [agent_id, skill_name]
  );
  
  const creatorWallet = await db.one('SELECT wallet_address FROM users WHERE id = $1', [priceInfo.owner_id]);

  // 2. Respond with Solana Pay GET spec
  res.status(200).json({
    label: "3D-Agent Marketplace",
    icon: "https://your-app.com/icon.png",
  });
}

// The POST handler is called by wallets after the user approves the transaction
async function post(req, res) {
    const { account } = req.body;
    if (!account) throw new Error('Missing account');

    const { reference } = req.query;
    if (!reference) throw new Error('Missing reference');

    const signature = await verifyTransaction(account, reference);
    // Here you would grant the user access to the skill in your DB
    // grantSkillAccess(account, reference.skill_name);

    res.status(200).json({ status: 'ok', signature });
}


async function verifyTransaction(account, reference) {
    const connection = new Connection(clusterApiUrl('mainnet-beta'));
    
    // Find the transaction signature from the reference
    const signatureInfo = await findReference(connection, new PublicKey(reference));
    
    // Here you would add more validation, e.g., checking the transaction amount and destination match the skill price.

    return signatureInfo.signature;
}

export default async function handler(req, res) {
    if (req.method === 'GET') {
        return await get(req, res);
    } else if (req.method === 'POST') {
        return await post(req, res);
    } else {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }
}
