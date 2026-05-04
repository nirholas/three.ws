---
status: not-started
---

# Prompt 18: Legal - Terms of Service & Privacy Policy

## Objective
Create and integrate the necessary legal documents, such as a Terms of Service and Privacy Policy, to comply with regulations and define the rules of your platform.

## Explanation
When you handle user data and money, having clear, comprehensive legal documents is non-negotiable. The Terms of Service (ToS) outlines the agreement between the platform and its users, while the Privacy Policy explains how user data is collected, used, and protected. This task is essential for legal compliance and building user trust.

**Disclaimer:** This prompt provides a general guide. You must consult with a qualified legal professional to draft documents appropriate for your specific business and jurisdiction.

## Instructions
1.  **Draft the Legal Documents:**
    *   Work with a lawyer to draft a **Terms of Service**. This should cover:
        *   User responsibilities.
        *   Payment terms, creator payout policies, and fees.
        *   Intellectual property rights for agents and skills.
        *   Rules for API usage and subscriptions.
        *   Disclaimers and limitations of liability.
    *   Draft a **Privacy Policy**. This should cover:
        *   What data you collect (e.g., email, payment info, IP addresses).
        *   How you use the data.
        *   How you share data with third parties (like Stripe).
        *   User rights regarding their data (e.g., GDPR, CCPA compliance).

2.  **Create Static Pages for the Documents:**
    *   Create two new HTML files in your project: `terms-of-service.html` and `privacy-policy.html`.
    *   Paste the content of your legal documents into these pages. Format them for readability (e.g., using proper headings and lists).

3.  **Link to the Documents:**
    *   **Footer:** Add links to both the ToS and Privacy Policy in the main site footer so they are accessible from every page.
    *   **Registration Form:** Add a checkbox to the signup form that says "I agree to the <a href="/terms-of-service.html">Terms of Service</a> and <a href="/privacy-policy.html">Privacy Policy</a>." This checkbox must be required to complete registration.
    *   **Settings/Profile:** It's also good practice to have links to these documents in the user's account settings area.

4.  **Backend Check for Agreement:**
    *   Your registration API endpoint (`/api/auth/register`) should ideally accept a boolean parameter like `agreedToTerms: true`.
    *   The API should reject any registration request where this is not `true`. This creates a server-side record of the user's agreement.
