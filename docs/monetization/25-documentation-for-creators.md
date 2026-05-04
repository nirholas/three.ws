# Prompt 25: Documentation for Creators

## Objective
Create a comprehensive guide for agent creators that explains how to use the monetization features, including setting up their payout wallet, pricing their skills, and understanding the fee structure.

## Explanation
To ensure a successful launch of the monetization features, creators need clear and accessible documentation. A well-written guide reduces support requests and empowers creators to get started quickly. This document will be a new page in the main `docs` section of the website.

## Instructions
1.  **Create a New Markdown File:**
    *   Create `docs/for-creators/monetization.md`.

2.  **Write the Content:**
    *   Structure the document with clear headings and a logical flow.
    *   **Introduction:** Briefly explain the benefits of monetizing agent skills.
    *   **Getting Started (Checklist):**
        1.  Create an Agent.
        2.  Set up your Payout Wallet.
        3.  Price your Skills.
        4.  Publish your Agent.
    *   **Payout Wallet Setup:**
        *   Provide a step-by-step guide on where to find the monetization dashboard.
        *   Explain the importance of using a secure, self-custody Solana wallet.
        *   Show a screenshot of the input field.
    *   **Pricing Models:**
        *   Explain the "One-Time Purchase" model.
        *   Explain the "Subscription" model and how tiers work.
        *   Explain the "Pay-per-call" model for usage-based skills.
        *   Provide best-practice recommendations for pricing.
    *   **Fee Structure:**
        *   Be transparent about any platform fees. For example: "The platform takes a 5% fee on all primary sales to support development and maintain the marketplace."
        *   Explain how Solana network fees work.
    *   **Viewing Earnings:**
        *   Guide the user through the Earnings Dashboard, explaining each metric.
    *   **FAQ Section:**
        *   "How often are payouts processed?"
        *   "What currencies are supported?"
        *   "Can I change the price of a skill after it's published?"

3.  **Link to the New Doc:**
    *   Add a link to this new documentation page from the creator dashboard UI to make it easily discoverable.

## Excerpt from `monetization.md`

```markdown
---
title: Monetizing Your Agent
description: A guide for creators on how to sell access to their agent's skills on the marketplace.
---

# Monetizing Your Agent

Welcome, creator! The three.ws platform provides powerful tools to help you earn revenue from the unique skills you build for your AI agents. This guide will walk you through the entire process, from setting up your wallet to understanding your earnings.

## How It Works

You can monetize your agent's skills in three ways:

1.  **One-Time Purchase:** Users pay once to unlock permanent access to a specific skill.
2.  **Subscriptions:** Users pay a recurring fee (e.g., monthly) for access to a bundle of skills defined in a "tier."
3.  **Pay-per-Call:** For resource-intensive skills, you can charge users a small amount for each time they use the skill.

## Getting Started: Your 4-Step Checklist

1.  **Have an Agent:** You need an agent with at least one custom skill. You can create one in the [Agent Editor](/agent-edit).
2.  **Set Your Payout Wallet:** Go to the "Monetization" tab in the editor and enter your Solana wallet address. This is where your earnings will be sent.
3.  **Price Your Skills:** Use the tools in the Monetization tab to set prices for individual skills or group them into subscription tiers.
4.  **Publish:** Once your agent is public in the marketplace, users can start buying your skills!

... (continue with detailed sections) ...
```
