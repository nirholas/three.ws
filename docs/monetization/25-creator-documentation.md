# Prompt 25: Documentation for Creators

## Objective
Create a well-written documentation page that explains the monetization features to agent creators, covering how to set prices, how payouts work, and the platform fees.

## Explanation
To encourage adoption of the new monetization features, we need to provide clear and comprehensive documentation for our creators. This page should be the go-to resource for any creator looking to start selling their skills.

## Instructions
1.  **Create a New Docs Page:**
    *   In the `docs/` directory, create a new file, e.g., `monetization.md` or `selling-skills.md`.
    *   Add a link to this new page in your main documentation navigation.

2.  **Write the Content:**
    *   Structure the document with clear headings.
    *   **Introduction:** Briefly explain the opportunity for creators to earn revenue.
    *   **Getting Started:** A step-by-step guide:
        1.  "Set up your Payout Wallet": Explain where to find this setting in their dashboard and why it's important. Include a screenshot.
        2.  "Pricing Your Skills": Show them where to go in the agent editor to set prices. Explain that a price of 0 means the skill is free.
    *   **How Payouts Work:**
        *   Explain that payments are made instantly on the Solana blockchain.
        *   Clarify that funds are sent directly to their configured payout wallet.
    *   **Platform Fees:**
        *   Be transparent about the platform fee. State the percentage clearly (e.g., "three.ws takes a 5% platform fee on every sale.").
        *   Explain that this fee is automatically deducted from the transaction.
    *   **FAQ Section:**
        *   "What currency can I sell in?" (Initially, just USDC).
        *   "When do I get paid?" (Instantly).
        *   "Where can I see my sales?" (Link to their Transaction History dashboard).

3.  **Review and Publish:**
    *   Read through the documentation to ensure it's clear, concise, and free of jargon.
    *   Publish the page so it's accessible to creators.

## Markdown Example (`docs/selling-skills.md`)

```markdown
# Monetizing Your Agent's Skills

Welcome, creator! This guide will walk you through setting up your account to sell your agent's unique skills on the marketplace.

## How It Works

Our platform allows you to set a price for any skill your agent possesses. When a user wants to unlock that capability, they can purchase it directly from your agent's page. Payments are handled instantly and securely on the Solana blockchain.

## Getting Started: 2 Simple Steps

### 1. Set Your Payout Wallet

Before you can receive payments, you need to tell us where to send the funds.

-   Go to your **Dashboard**.
-   Navigate to the **Settings** tab.
-   In the "Payout Wallet" section, enter your Solana public key. This is where all your earnings will be sent.
-   Click "Save".

![Screenshot of payout wallet setting](./images/payout-wallet-setting.png)

### 2. Price Your Skills

Now you're ready to set prices.

-   Go to **My Agents** and select the agent you wish to edit.
-   In the agent editor, find the "Skills" section.
-   Next to each skill, you'll see an input field for the price in USDC.
-   To make a skill free, simply leave the price as 0.
-   Click "Save Prices" when you're done.

## Platform Fees

three.ws takes a 5% platform fee on every sale. This fee is automatically deducted from the purchase amount during the transaction. For example, if you price a skill at 1.00 USDC, you will receive 0.95 USDC.

## Frequently Asked Questions

**Q: When do I get paid?**
A: Instantly. The payment is sent to your wallet as soon as the user's transaction is confirmed on the blockchain.

**Q: Where can I track my sales?**
A: You can see a full list of all your sales in the "Transaction History" section of your dashboard.
```
