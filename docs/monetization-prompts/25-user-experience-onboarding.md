---
status: not-started
---

# Prompt 25: User Experience & Onboarding

## Objective
Refine the overall user experience for the monetization features and create clear onboarding materials for creators.

## Explanation
A powerful system is only effective if people understand how to use it. This final step focuses on documentation, in-app guidance, and polishing the user interface to make the monetization features intuitive for both buyers and sellers.

## Instructions
- [ ] **Create a Creator Onboarding Guide:**
    - [ ] Write a clear, concise guide in your `docs` folder that explains how a creator can start monetizing their skills.
    - [ ] **Topics to cover:**
        - [ ] How to set up their payout wallet.
        - [ ] How to set prices for their skills.
        - [ ] How subscriptions work.
        - [ ] An explanation of the platform fee.
        - [ ] A link to their creator dashboard and an explanation of the metrics.

- [ ] **Add In-App Guidance (Tooltips & Helpers):**
    - [ ] Go through the creator-facing UIs (payout settings, skill pricing) and add tooltips or helper text to explain complex concepts.
    - [ ] For example, next to the payout wallet input, add a tooltip explaining what a Solana wallet is and where to get one.
    - [ ] On the skill pricing page, explain the units (e.g., "Enter price in USDC").

- [ ] **Refine the Buyer Experience:**
    - [ ] Review the entire purchase flow from the buyer's perspective. Is it clear and smooth?
    - [ ] Ensure error messages are helpful. Instead of a generic "Transaction Failed", provide more context if possible (e.g., "Transaction failed. You may not have enough USDC in your wallet.").
    - [ ] Add a section to the user's profile where they can see a history of all the skills they've purchased.

- [ ] **Create a Marketing/Landing Page:**
    - [ ] Design a section on your main landing page that advertises the new creator monetization features.
    - [ ] Highlight the benefits for creators (earn revenue) and for users (access powerful new capabilities).
    - [ ] This will help attract new creators to your platform.

## Example: Onboarding Doc Snippet (`/docs/monetizing-your-agent.md`)

```markdown
---
title: Monetizing Your Agent
---

## Introduction

Welcome to the creator monetization program! This guide will walk you through setting up your account to sell your agent's skills on the marketplace.

### Step 1: Set Up Your Payout Wallet

Before you can earn, you need to tell us where to send your funds.

1.  Navigate to your **Settings > Payouts** page.
2.  You will need a Solana wallet. If you don't have one, we recommend Phantom or Solflare.
3.  Copy your public wallet address and paste it into the "Payout Wallet Address" field.
4.  Click "Save". All your earnings will now be sent to this address.

**Important**: Double-check this address. Payments sent to an incorrect address are irreversible.

### Step 2: Pricing Your Skills

...
```
