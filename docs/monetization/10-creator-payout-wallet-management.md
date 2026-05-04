# Prompt 10: Creator Payout Wallet Management

## Objective
Implement the UI and backend logic for an agent creator to specify their Solana treasury wallet, where they will receive payments from skill sales.

## Explanation
For creators to receive their earnings, they must provide a valid Solana wallet address. This task involves adding an input field in the monetization dashboard for this address and creating a secure backend endpoint to save it. This address will be stored and associated with the agent, to be used later in the payment transaction logic.

## Instructions
1.  **Add UI in Dashboard:**
    *   In the "Monetization" tab in `agent-edit.html`, use the placeholder from prompt #7. It should contain an `<input>` for the wallet public key and a "Save" button.

2.  **Frontend Logic:**
    *   In `src/agent-edit.js`, fetch the agent's current treasury wallet address when the tab loads and populate the input field.
    *   Add a click event listener to the "Save" button. This handler will read the value from the input, perform basic validation (e.g., check if it's a valid Solana public key format), and send it to the backend.

3.  **Backend Endpoint:**
    *   Create a new endpoint, for example `/api/agents/[id]/treasury`, to handle updating the treasury wallet.
    *   This endpoint must be secure, verifying that the user making the request is the creator of the agent.
    *   It will take the `treasuryWallet` public key from the request body and update the `creator_treasury_wallet` column on the `agents` table for the specified agent.

## Database Schema (Alter `agents` table)

```sql
-- Add a new column to the agents table to store the payout address
ALTER TABLE agents
ADD COLUMN creator_treasury_wallet TEXT;

-- You might want to add a check constraint for valid base58 format
-- but this can also be handled at the application layer.
```

## Code Example (`src/agent-edit.js`)

```javascript
// Add to the monetization tab logic
const treasuryInput = document.getElementById('treasuryWallet');
const saveTreasuryBtn = document.getElementById('saveTreasuryWallet');

async function loadTreasuryWallet(agentId) {
    const agent = await getAgentData(agentId); // Assuming this function exists
    if (agent.creator_treasury_wallet) {
        treasuryInput.value = agent.creator_treasury_wallet;
    }
}

saveTreasuryBtn.addEventListener('click', async () => {
    const agentId = /* get agent id from context */;
    const newWallet = treasuryInput.value.trim();

    // Basic validation (more robust validation is recommended)
    if (!newWallet || newWallet.length < 32 || newWallet.length > 44) {
        alert('Please enter a valid Solana public key.');
        return;
    }

    try {
        const response = await fetch(`/api/agents/${agentId}/treasury`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ treasuryWallet: newWallet }),
        });

        if (!response.ok) throw new Error('Failed to save wallet address.');

        alert('Payout wallet updated successfully!');
    } catch (error) {
        alert(`Error: ${error.message}`);
    }
});

// Call loadTreasuryWallet when the tab is shown
```

## Code Example (`api/agents/[id]/treasury.js`)

```javascript
import { supabase } from '../../_lib/supabase';
import { json, error } from '../../_lib/http';
import { getAuthUser } from '../../_lib/auth';

export default async function handler(req, res) {
    if (req.method !== 'PUT') return error(res, 405, 'Method Not Allowed');

    const { id: agentId } = req.query;
    const user = await getAuthUser(req);
    const { treasuryWallet } = req.body;

    if (!user) return error(res, 401, 'Unauthorized');
    if (!treasuryWallet) return error(res, 400, 'Missing treasuryWallet');

    // Verify ownership
    const { data: agent, error: agentError } = await supabase
        .from('agents')
        .select('creator_id')
        .eq('id', agentId)
        .single();

    if (agentError || agent.creator_id !== user.id) {
        return error(res, 403, 'Forbidden');
    }

    // Update the agent's treasury wallet
    const { error: updateError } = await supabase
        .from('agents')
        .update({ creator_treasury_wallet: treasuryWallet })
        .eq('id', agentId);

    if (updateError) {
        return error(res, 500, 'Failed to update treasury wallet.');
    }

    return json(res, { success: true });
}
```
