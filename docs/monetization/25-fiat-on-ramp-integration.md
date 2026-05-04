---
status: not-started
---

# Prompt 25: Fiat On-Ramp Integration

## Objective
Integrate a fiat on-ramp service (like Crossmint or Moonpay) to allow users to purchase skills with a credit card.

## Explanation
To reach the widest possible audience, it's essential to offer a way for non-crypto-native users to participate. A fiat on-ramp will handle the conversion from fiat to the required cryptocurrency, making the process seamless for the user.

## Instructions
1.  **Choose a Provider:**
    *   Research and select a fiat on-ramp provider that offers a good developer experience and supports Solana.

2.  **Integrate their SDK:**
    *   In the frontend, integrate the provider's SDK.
    *   The "Purchase" button would open their widget, where the user can complete the payment with a credit card.

3.  **Webhook for Confirmation:**
    *   The on-ramp service will typically send a webhook to your backend when the crypto transaction is complete.
    *   Your backend will listen for this webhook, verify it, and then unlock the skill for the user.
