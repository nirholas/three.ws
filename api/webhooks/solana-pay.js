import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { sql } from '../../_lib/db.js';
import { error, json, readJson, wrap } from '../../_lib/http.js';

const SOLANA_RPC_URL = process.env.RPC_URL_1399901; // Using the placeholder from the prompt
const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

export default wrap(async (req, res) => {
  if (req.method === 'GET') {
    // Solana Pay endpoint validation GET request
    return json(res, {
      label: '3D-Agent Skill Marketplace',
      icon: 'https://three.ws/assets/logo.png', // Using a placeholder logo
    });
  }

  if (req.method === 'POST') {
    const { transaction, reference } = await readJson(req);

    if (!reference) {
      return error(res, 400, 'bad_request', 'Missing reference parameter');
    }

    // 1. Find the purchase record using the reference (purchaseId)
    const [purchase] = await sql`
        SELECT
            p.id, p.status, p.agent_id, p.skill_id,
            pr.amount, pr.currency_mint,
            u.wallet_address AS creator_wallet
        FROM user_skill_purchases p
        JOIN agent_skill_prices pr ON p.price_id = pr.id
        JOIN users u ON pr.creator_id = u.id
        WHERE p.id = ${reference}
    `;
    
    if (!purchase) {
        return error(res, 404, 'not_found', 'Purchase record not found.');
    }
    if (purchase.status !== 'pending') {
      return json(res, { message: 'Purchase already processed.' });
    }

    // 2. Verify the transaction on-chain
    try {
        const tx = await connection.getParsedTransaction(transaction, {
            maxSupportedTransactionVersion: 0,
            commitment: 'confirmed'
        });

        if (!tx) {
            throw new Error('Transaction not found or not confirmed.');
        }

        // Basic validation
        if (tx.meta?.err) {
            throw new Error('Transaction failed on-chain.');
        }

        // Deeper validation: find the correct SPL transfer instruction
        const transferInstruction = tx.transaction.message.instructions.find(ix => {
            if ('parsed' in ix && ix.parsed.type === 'transferChecked') {
                const p = ix.parsed.info;
                const recipientMatch = p.destination === purchase.creator_wallet;
                const mintMatch = p.mint === purchase.currency_mint;
                const amountMatch = BigInt(p.tokenAmount.uiAmount * (10 ** p.tokenAmount.decimals)) === BigInt(purchase.amount);
                return recipientMatch && mintMatch && amountMatch;
            }
            return false;
        });

        if (!transferInstruction) {
            throw new Error('Valid SPL transfer not found in transaction.');
        }

        // 3. If validation passes, update the purchase status
        await sql`
            UPDATE user_skill_purchases
            SET status = 'confirmed', transaction_id = ${transaction}, updated_at = NOW()
            WHERE id = ${reference}
        `;

        // TODO from Prompt 20: Send email notification to creator here

        return json(res, { message: 'Transaction confirmed successfully.' });

    } catch (e) {
        console.error('Transaction verification failed:', e);
        await sql`
            UPDATE user_skill_purchases
            SET status = 'failed', updated_at = NOW()
            WHERE id = ${reference}
        `;
        return error(res, 400, 'transaction_invalid', e.message);
    }
  }

  return error(res, 405, 'method_not_allowed');
});
