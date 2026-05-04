# Prompt 21: Gifting Skills to Other Users

**Status:** - [ ] Not Started

## Objective
Allow users to purchase a skill as a gift for another user on the platform.

## Explanation
Gifting is a great way to introduce new users to the platform and can be a fun social feature. It allows users to share their favorite skills with friends.

## Instructions
1.  **Modify the Purchase Flow:**
    *   In the purchase confirmation modal, add a checkbox or button: "Purchase as a gift?".
    *   If checked, reveal an input field for the recipient's username or wallet address.

2.  **Backend Logic for Gifting:**
    *   Modify the `purchase-skill` backend endpoint to handle an optional `recipient_user_id`.
    *   If a recipient is specified, the transaction verification remains the same (the buyer pays).
    *   However, when recording the ownership in the `user_agent_skills` table, the record should be created for the `recipient_user_id`, not the buyer's ID.
    *   You may want to add a `gifted_by_user_id` column to the table to track this.

3.  **Notifications:**
    *   Implement a notification system (if one doesn't exist) to inform the recipient that they have received a gift.
    *   The notification should specify the skill, the agent, and who sent the gift.

4.  **On-Chain Receipt (NFT):**
    *   If you are minting NFTs as receipts (Prompt 12), the NFT should be minted to the recipient's wallet, not the buyer's. The metadata could include a "Gifted By" attribute.

## Code Example (Conceptual - Backend `purchase-skill` modification)

```javascript
export default async function handler(req, res) {
  const buyerUserId = req.user.id;
  const { agentId, skillName, transactionSignature, recipientUsername } = req.body;
  let finalOwnerId = buyerUserId;

  const db = getDB();

  if (recipientUsername) {
    const recipient = await db.findUserByUsername(recipientUsername);
    if (!recipient) {
      return res.status(404).json({ error: 'Recipient not found.' });
    }
    finalOwnerId = recipient.id;
  }
  
  // ... (Verify transaction was paid by buyerUserId)

  if (verificationSuccess) {
    // Record purchase for the final owner (recipient or buyer)
    await db.recordSkillPurchase(finalOwnerId, agentId, skillName, buyerUserId); // buyerUserId is the gifter

    // Trigger a notification to the recipient
    if (recipientUsername) {
      await sendNotification(finalOwnerId, `You received the skill ${skillName} as a gift!`);
    }
    
    res.status(200).json({ success: true, message: 'Gift purchase successful!' });
  }
  // ...
}
```
