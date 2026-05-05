import { createNft } from '@metaplex-foundation/mpl-token-metadata';
import { generateSigner, percentAmount } from '@metaplex-foundation/umi';
import { initializeUmi } from '../../_lib/solana/umi';
import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { error, json, method, wrap } from '../../_lib/http.js';

export default wrap(async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).end();
    }

    const user = await getSessionUser(req);
    if (!user) return error(res, 401, 'unauthorized', 'sign in required');

    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean);
    const agentId = parts[2];

    const [agent] = await sql`
        SELECT user_id, skill_collection_mint, name FROM agent_identities WHERE id = ${agentId} AND deleted_at IS NULL
    `;

    if (!agent || agent.user_id !== user.id) {
        return error(res, 403, 'forbidden', 'You do not own this agent.');
    }
    if (agent.skill_collection_mint) {
        return error(res, 400, 'bad_request', 'Collection already exists');
    }

    try {
        const umi = initializeUmi();
        const collectionMint = generateSigner(umi);

        // TODO: Upload collection metadata to Arweave/IPFS
        const collectionMetadataUri = 'https://arweave.net/...'; 

        await createNft(umi, {
            mint: collectionMint,
            name: `Agent ${agent.name} Skills`,
            symbol: 'A1SKILL',
            uri: collectionMetadataUri,
            sellerFeeBasisPoints: percentAmount(0),
            isCollection: true,
        }).sendAndConfirm(umi);

        const collectionMintAddress = collectionMint.publicKey;

        await sql`
            UPDATE agent_identities SET skill_collection_mint = ${collectionMintAddress} WHERE id = ${agentId}
        `;

        return json(res, 200, { collectionMint: collectionMintAddress });
    } catch (e) {
        console.error('Failed to create collection NFT:', e);
        return error(res, 500, 'server_error', 'Failed to create collection');
    }
});
