---
status: not-started
---
# Prompt 12: Frontend Initiates Purchase

**Status:** Not Started

## Objective
Write the frontend JavaScript to call the backend API and fetch the unsigned transaction when a user clicks "Purchase".

## Explanation
This is the first step in the client-side purchase flow. After the user clicks the purchase button, the frontend needs to communicate with the backend to get a transaction that can then be passed to the user's wallet for signing.

## Instructions
1.  **In `src/marketplace.js`, add a click event listener to the skills container.**
2.  **Delegate the event to handle clicks on `.purchase-btn` buttons.**
3.  **Inside the handler:**
    - Check if the user's wallet is connected. If not, prompt them to connect it.
    - Get the skill name from the `data-skill-name` attribute.
    - Get the current agent ID from the page context.
    - Get the user's public key from the wallet adapter state.
    - Show a "Preparing transaction..." loading indicator.
    - Call the `POST /api/skills/:skill_id/purchase` endpoint (from Prompt 5). Note: you might need to pass the skill name and get the ID. The API might be better as `/api/skills/purchase` with the name in the body.
    - Pass the user's public key (`account`) in the request body.
    - The API will respond with a base64-encoded transaction string.

## Code Example (Frontend - `src/marketplace.js`)
```javascript
// Using a hypothetical wallet state object
// const { publicKey, connected } = useWallet(); 

$('d-skills').addEventListener('click', async (event) => {
    if (!event.target.matches('.purchase-btn')) return;

    if (!connected || !publicKey) {
        alert('Please connect your wallet to purchase a skill.');
        return;
    }

    const skillName = event.target.dataset.skillName;
    const agentId = getCurrentAgentId(); // Function to get agent ID from URL or state

    try {
        const response = await fetch(`/api/skills/purchase`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                skillName: skillName,
                agentId: agentId,
                account: publicKey.toBase58(),
            })
        });

        if (!response.ok) throw new Error('Failed to prepare transaction.');

        const { transaction } = await response.json();
        // Next step: pass this 'transaction' string to the signing function
        await signAndSendTransaction(transaction);

    } catch (error) {
        alert(`Purchase failed: ${error.message}`);
    }
});
```
